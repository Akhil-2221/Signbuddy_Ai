import { z } from "zod";
import { query } from "../db/pool.js";
import { ApiError, asyncHandler } from "../middleware/error.js";
import {
  recognizeSignFromLandmarks,
  transcribeSpeech,
  translateText,
} from "../services/aiServiceClient.js";

const LOW_CONFIDENCE_THRESHOLD = 0.6;

const startSessionSchema = z.object({
  mode: z.enum(["sign_to_text", "sign_to_speech", "speech_to_text", "two_way", "emergency"]),
  signLanguage: z.enum(["ASL", "ISL", "BSL"]).default("ASL"),
  outputLanguage: z.string().default("en"),
  deviceType: z.enum(["mobile", "desktop", "tablet"]).optional(),
});

export const startSession = asyncHandler(async (req, res) => {
  const parsed = startSessionSchema.safeParse(req.body);
  if (!parsed.success) {
    throw new ApiError(400, "validation_error", "Invalid session payload", parsed.error.flatten());
  }
  const { mode, signLanguage, outputLanguage, deviceType } = parsed.data;

  const result = await query(
    `INSERT INTO translation_sessions (user_id, mode, sign_language, output_language, device_type)
     VALUES ($1, $2, $3, $4, $5)
     RETURNING *`,
    [req.user.sub, mode, signLanguage, outputLanguage, deviceType ?? null]
  );

  res.status(201).json({ session: result.rows[0] });
});

export const endSession = asyncHandler(async (req, res) => {
  const { sessionId } = req.params;

  const avgResult = await query(
    `SELECT AVG(confidence_score) AS avg_confidence FROM session_utterances WHERE session_id = $1`,
    [sessionId]
  );
  const avgConfidence = avgResult.rows[0]?.avg_confidence ?? null;

  const result = await query(
    `UPDATE translation_sessions
     SET ended_at = now(), avg_confidence = $2
     WHERE id = $1 AND user_id = $3
     RETURNING *`,
    [sessionId, avgConfidence, req.user.sub]
  );

  if (result.rows.length === 0) {
    throw new ApiError(404, "session_not_found", "Session not found");
  }

  res.json({ session: result.rows[0] });
});

const landmarkFrameSchema = z.object({
  sessionId: z.string().uuid(),
  signLanguage: z.enum(["ASL", "ISL", "BSL"]),
  frames: z.array(z.record(z.any())).min(1),
  sequenceIndex: z.number().int().nonnegative(),
});

/**
 * Core "sign → text/speech" endpoint.
 * Frontend streams batches of MediaPipe landmark frames here; this calls the AI service,
 * persists the recognized utterance, and flags low-confidence results for the fallback UI.
 */
export const recognizeSign = asyncHandler(async (req, res) => {
  const parsed = landmarkFrameSchema.safeParse(req.body);
  if (!parsed.success) {
    throw new ApiError(400, "validation_error", "Invalid landmark payload", parsed.error.flatten());
  }
  const { sessionId, signLanguage, frames, sequenceIndex } = parsed.data;

  const aiResult = await recognizeSignFromLandmarks({
    frames,
    signLanguage,
    sessionId,
  });

  const lowConfidence = aiResult.confidence < LOW_CONFIDENCE_THRESHOLD;

  const inserted = await query(
    `INSERT INTO session_utterances
       (session_id, sequence_index, direction, recognized_text, confidence_score, low_confidence_flag, latency_ms)
     VALUES ($1, $2, 'sign_in', $3, $4, $5, $6)
     RETURNING *`,
    [sessionId, sequenceIndex, aiResult.text, aiResult.confidence, lowConfidence, aiResult.latencyMs ?? null]
  );

  res.json({
    utterance: inserted.rows[0],
    fallbackSuggested: lowConfidence,
  });
});

const speechSchema = z.object({
  sessionId: z.string().uuid(),
  audioBase64: z.string().min(1),
  languageHint: z.string().default("en"),
  sequenceIndex: z.number().int().nonnegative(),
});

export const transcribeSpeechToText = asyncHandler(async (req, res) => {
  const parsed = speechSchema.safeParse(req.body);
  if (!parsed.success) {
    throw new ApiError(400, "validation_error", "Invalid speech payload", parsed.error.flatten());
  }
  const { sessionId, audioBase64, languageHint, sequenceIndex } = parsed.data;

  const aiResult = await transcribeSpeech({ audioBase64, languageHint });

  const inserted = await query(
    `INSERT INTO session_utterances
       (session_id, sequence_index, direction, recognized_text, confidence_score, low_confidence_flag, latency_ms)
     VALUES ($1, $2, 'speech_in', $3, $4, $5, $6)
     RETURNING *`,
    [sessionId, sequenceIndex, aiResult.text, aiResult.confidence ?? 0.95, (aiResult.confidence ?? 1) < LOW_CONFIDENCE_THRESHOLD, aiResult.latencyMs ?? null]
  );

  res.json({ utterance: inserted.rows[0] });
});

const translateSchema = z.object({
  utteranceId: z.string().uuid(),
  text: z.string().min(1),
  sourceLang: z.string(),
  targetLang: z.string(),
});

export const translateUtterance = asyncHandler(async (req, res) => {
  const parsed = translateSchema.safeParse(req.body);
  if (!parsed.success) {
    throw new ApiError(400, "validation_error", "Invalid translate payload", parsed.error.flatten());
  }
  const { utteranceId, text, sourceLang, targetLang } = parsed.data;

  const aiResult = await translateText({ text, sourceLang, targetLang });

  const updated = await query(
    `UPDATE session_utterances SET translated_text = $2 WHERE id = $1 RETURNING *`,
    [utteranceId, aiResult.translatedText]
  );

  res.json({ utterance: updated.rows[0] });
});

export const correctUtterance = asyncHandler(async (req, res) => {
  const { utteranceId } = req.params;
  const { correctedText } = req.body;
  if (!correctedText) {
    throw new ApiError(400, "validation_error", "correctedText is required");
  }

  const updated = await query(
    `UPDATE session_utterances SET user_corrected_text = $2 WHERE id = $1 RETURNING *`,
    [utteranceId, correctedText]
  );
  if (updated.rows.length === 0) {
    throw new ApiError(404, "utterance_not_found", "Utterance not found");
  }

  // Feed correction into the feedback loop for continuous model improvement
  await query(
    `INSERT INTO recognition_feedback (utterance_id, user_id, was_correct, corrected_text)
     VALUES ($1, $2, FALSE, $3)`,
    [utteranceId, req.user.sub, correctedText]
  );

  res.json({ utterance: updated.rows[0] });
});

export const getSessionHistory = asyncHandler(async (req, res) => {
  const { sessionId } = req.params;
  const session = await query(
    `SELECT * FROM translation_sessions WHERE id = $1 AND user_id = $2`,
    [sessionId, req.user.sub]
  );
  if (session.rows.length === 0) {
    throw new ApiError(404, "session_not_found", "Session not found");
  }

  const utterances = await query(
    `SELECT * FROM session_utterances WHERE session_id = $1 ORDER BY sequence_index ASC`,
    [sessionId]
  );

  res.json({ session: session.rows[0], utterances: utterances.rows });
});

export const listUserSessions = asyncHandler(async (req, res) => {
  const limit = Math.min(Number(req.query.limit) || 20, 100);
  const result = await query(
    `SELECT * FROM translation_sessions WHERE user_id = $1 ORDER BY started_at DESC LIMIT $2`,
    [req.user.sub, limit]
  );
  res.json({ sessions: result.rows });
});
