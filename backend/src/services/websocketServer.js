import { WebSocketServer } from "ws";
import { verifyAccessToken } from "../utils/auth.js";
import { recognizeSignFromLandmarks } from "../services/aiServiceClient.js";
import { query } from "../db/pool.js";
import { logger } from "../utils/logger.js";

const LOW_CONFIDENCE_THRESHOLD = 0.6;

/**
 * Real-time landmark streaming over WebSocket.
 * The REST endpoint (/api/v1/sessions/recognize/sign) works for batch/polling use,
 * but live continuous signing needs a persistent low-latency channel — this is it.
 *
 * Client message shape:  { type: "frame_batch", sessionId, signLanguage, sequenceIndex, frames }
 * Server message shape:  { type: "recognition_result", utterance } | { type: "error", message }
 */
export function attachWebSocketServer(httpServer) {
  const wss = new WebSocketServer({ server: httpServer, path: "/ws/recognize" });

  wss.on("connection", (ws, req) => {
    const url = new URL(req.url, "http://localhost");
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
          frames: msg.frames,
          signLanguage: msg.signLanguage,
          sessionId: msg.sessionId,
        });

        const lowConfidence = aiResult.confidence < LOW_CONFIDENCE_THRESHOLD;

        const inserted = await query(
          `INSERT INTO session_utterances
             (session_id, sequence_index, direction, recognized_text, confidence_score, low_confidence_flag, latency_ms)
           VALUES ($1, $2, 'sign_in', $3, $4, $5, $6)
           RETURNING *`,
          [msg.sessionId, msg.sequenceIndex, aiResult.text, aiResult.confidence, lowConfidence, aiResult.latencyMs ?? null]
        );

        ws.send(
          JSON.stringify({
            type: "recognition_result",
            utterance: inserted.rows[0],
            fallbackSuggested: lowConfidence,
          })
        );
      } catch (err) {
        logger.error("WS recognition error", { err: err.message });
        ws.send(JSON.stringify({ type: "error", message: "Recognition failed, please retry" }));
      }
    });

    ws.on("close", () => logger.info(`WS disconnected for user ${user.sub}`));
  });

  return wss;
}
