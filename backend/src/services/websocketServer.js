import { WebSocketServer } from "ws";
import { verifyAccessToken } from "../utils/auth.js";
import { recognizeSignFromLandmarks } from "../services/aiServiceClient.js";
import { query } from "../db/pool.js";
import { logger } from "../utils/logger.js";

/**
 * websocketServer.js — Minimal fix from original.
 *
 * WHAT WAS WRONG:
 *
 * FIX 1 — Empty text was being inserted into DB and sent to frontend:
 *   When the AI classifier suppressed a low-confidence prediction, it returned
 *   text="". The backend still did a DB INSERT with recognized_text="" and
 *   sent the result over WebSocket. The frontend received it, called
 *   setLatestUtterance(), and blanked the caption panel — erasing the last
 *   valid recognized word from the screen.
 *   FIX: If aiResult.text is empty/whitespace, skip the DB insert and return
 *   early. The frontend keeps the last valid word visible.
 *
 * FIX 2 — LOW_CONFIDENCE_THRESHOLD = 0.6 was too high:
 *   With 60 ISL classes, a correct softmax peak is typically 0.25–0.55.
 *   A backend threshold of 0.6 caused most correct predictions to be flagged
 *   as low-confidence and trigger the "fallbackSuggested" yellow UI state,
 *   confusing users into thinking the recognition failed.
 *   FIX: Lower to 0.30 to match realistic model confidence ranges.
 *   The AI service already gates at 0.25 internally; this threshold is only
 *   for the UI "yellow" low-confidence indicator — not for suppression.
 *
 * Everything else (auth, message handling, DB schema) is UNCHANGED.
 */

// Lowered from 0.6 — with 60 classes, correct peaks are typically 0.25-0.55
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

        // FIX 1: Skip empty results — classifier suppressed this prediction.
        // Do NOT insert into DB and do NOT send to frontend.
        // The frontend will keep the last valid word visible.
        if (!aiResult.text || aiResult.text.trim() === "") {
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
