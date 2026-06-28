import { WebSocketServer } from "ws";
import { verifyAccessToken } from "../utils/auth.js";
import { recognizeSignFromLandmarks } from "../services/aiServiceClient.js";
import { query } from "../db/pool.js";
import { logger } from "../utils/logger.js";

/**
 * websocketServer.js — Production fix.
 *
 * CAUSE 10 ── Empty text inserted into DB and sent to frontend
 *   When the AI returns text="" (low-confidence suppression), the original
 *   code still did INSERT INTO session_utterances with recognized_text=""
 *   and sent the result over WebSocket. The frontend received it and called
 *   setLatestUtterance() with empty text, blanking the caption panel.
 *   FIX: If text is empty/whitespace, return early. No DB write. No WS send.
 *   The frontend keeps the last valid word visible.
 *
 * CAUSE 11 ── LOW_CONFIDENCE_THRESHOLD = 0.6 too high
 *   With 60 ISL classes, correct softmax peaks are typically 0.25–0.55.
 *   The backend flagged most correct predictions as low-confidence,
 *   triggering the yellow "uncertain" UI state and confusing users.
 *   FIX: Lower to 0.30. The AI service gates hard at 0.25 — this threshold
 *   only controls whether the UI shows the yellow "uncertain" indicator.
 */

const LOW_CONFIDENCE_THRESHOLD = 0.30;

export function attachWebSocketServer(httpServer) {
  const wss = new WebSocketServer({ server: httpServer, path: "/ws/recognize" });

  wss.on("connection", (ws, req) => {
    const url   = new URL(req.url, "http://localhost");
    const token = url.searchParams.get("token");

    let user;
    try {
      user = verifyAccessToken(token);
    } catch {
      ws.send(JSON.stringify({ type: "error", message: "Invalid or missing token" }));
      ws.close();
      return;
    }

    logger.info(`WS connected for user ${user.sub}`);

    ws.on("message", async (raw) => {
      let msg;
      try {
        msg = JSON.parse(raw.toString());
      } catch {
        ws.send(JSON.stringify({ type: "error", message: "Malformed JSON" }));
        return;
      }

      if (msg.type !== "frame_batch") return;

      try {
        const aiResult = await recognizeSignFromLandmarks({
          frames:       msg.frames,
          signLanguage: msg.signLanguage,
          sessionId:    msg.sessionId,
        });

        // FIX 10: Skip empty results entirely — no DB write, no WS send.
        // The frontend will keep the last valid word on screen.
        if (!aiResult.text || !aiResult.text.trim()) {
          return;
        }

        const lowConfidence = aiResult.confidence < LOW_CONFIDENCE_THRESHOLD;

        const inserted = await query(
          `INSERT INTO session_utterances
             (session_id, sequence_index, direction, recognized_text, confidence_score, low_confidence_flag, latency_ms)
           VALUES ($1, $2, 'sign_in', $3, $4, $5, $6)
           RETURNING *`,
          [
            msg.sessionId,
            msg.sequenceIndex,
            aiResult.text,
            aiResult.confidence,
            lowConfidence,
            aiResult.latencyMs ?? null,
          ]
        );

        ws.send(
          JSON.stringify({
            type:              "recognition_result",
            utterance:         inserted.rows[0],
            fallbackSuggested: lowConfidence,
          })
        );
      } catch (err) {
        logger.error("WS recognition error", { err: err.message });
        ws.send(
          JSON.stringify({ type: "error", message: "Recognition failed, please retry" })
        );
      }
    });

    ws.on("close", () => logger.info(`WS disconnected for user ${user.sub}`));
  });

  return wss;
}
