/**
 * aiServiceClient.js — Fixed version
 *
 * ROOT CAUSE FIX (BUG E):
 *   Added resetClassifierBuffer() which POSTs to /v1/reset on the AI service.
 *   The AI service calls classifier.reset_buffer(), clearing the rolling frame
 *   buffer and prediction smoother between signs.
 */

const AI_SERVICE_URL = process.env.AI_SERVICE_URL || "http://localhost:8000";

async function postJson(path, body) {
  const res = await fetch(`${AI_SERVICE_URL}${path}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`AI service error ${res.status}: ${text}`);
  }
  return res.json();
}

/**
 * Send a batch of hand/pose landmark frames for sign recognition.
 * @param {{frames: object[], signLanguage: string, sessionId: string}} payload
 * @returns {Promise<{text: string, confidence: number, lowConfidence: boolean, latencyMs: number}>}
 */
export async function recognizeSignFromLandmarks(payload) {
  return postJson("/v1/recognize/landmarks", payload);
}

/**
 * Reset the classifier's rolling frame buffer and prediction smoother.
 * Call between signs to prevent contamination.
 */
export async function resetClassifierBuffer() {
  const res = await fetch(`${AI_SERVICE_URL}/v1/reset`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({}),
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`AI service reset error ${res.status}: ${text}`);
  }
  return res.json();
}

/**
 * Transcribe spoken audio to text (speech-to-text direction).
 */
export async function transcribeSpeech(payload) {
  return postJson("/v1/speech/transcribe", payload);
}

/**
 * Translate text between spoken/written languages.
 */
export async function translateText(payload) {
  return postJson("/v1/translate/text", payload);
}

/**
 * Score a practice attempt against a target sign for the AI Tutor.
 */
export async function scorePracticeAttempt(payload) {
  return postJson("/v1/tutor/score", payload);
}

export async function checkAiServiceHealth() {
  const res = await fetch(`${AI_SERVICE_URL}/health`);
  return res.ok;
}
