/**
 * Thin HTTP client for the Python AI service.
 * This is the ONLY place backend code talks to the AI layer — keeps the boundary clean
 * so the AI service (currently a mock/interface) can be swapped for a real trained model
 * without touching any route or controller code.
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
 * Transcribe spoken audio to text (speech-to-text direction).
 * @param {{audioBase64: string, languageHint: string}} payload
 */
export async function transcribeSpeech(payload) {
  return postJson("/v1/speech/transcribe", payload);
}

/**
 * Translate text between spoken/written languages.
 * @param {{text: string, sourceLang: string, targetLang: string}} payload
 */
export async function translateText(payload) {
  return postJson("/v1/translate/text", payload);
}

/**
 * Score a practice attempt against a target sign for the AI Tutor.
 * @param {{frames: object[], targetSignId: string, signLanguage: string}} payload
 */
export async function scorePracticeAttempt(payload) {
  return postJson("/v1/tutor/score", payload);
}

export async function checkAiServiceHealth() {
  const res = await fetch(`${AI_SERVICE_URL}/health`);
  return res.ok;
}
