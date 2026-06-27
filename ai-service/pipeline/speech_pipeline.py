"""
Speech-to-text and text-to-speech wiring.

STT: if OPENAI_API_KEY (or a local Whisper model) is configured, this calls
real Whisper transcription. Otherwise it falls back to a # MOCK deterministic
response so the rest of the pipeline is testable without API keys.

TTS: returns instructions for the FRONTEND to use the browser's native
Web Speech API (free, no API key, works offline-ish) by default. Optionally
wired for a cloud TTS provider if higher-quality voices are needed later.
"""

from __future__ import annotations

import base64
import os
import tempfile

_USE_REAL_WHISPER = bool(os.getenv("OPENAI_API_KEY"))


def transcribe_audio(audio_base64: str, language_hint: str = "en") -> dict:
    if not _USE_REAL_WHISPER:
        # MOCK fallback — no API key configured
        return {
            "text": "[mock transcription — configure OPENAI_API_KEY for real speech-to-text]",
            "confidence": 0.99,
            "latency_ms": 50,
        }

    # Real path — requires `pip install openai` and OPENAI_API_KEY set
    import time

    from openai import OpenAI

    client = OpenAI()
    start = time.monotonic()

    audio_bytes = base64.b64decode(audio_base64)
    with tempfile.NamedTemporaryFile(suffix=".wav") as tmp:
        tmp.write(audio_bytes)
        tmp.flush()
        with open(tmp.name, "rb") as f:
            transcript = client.audio.transcriptions.create(
                model="whisper-1",
                file=f,
                language=language_hint,
            )

    latency_ms = int((time.monotonic() - start) * 1000)
    return {"text": transcript.text, "confidence": 0.95, "latency_ms": latency_ms}


def translate_text(text: str, source_lang: str, target_lang: str) -> dict:
    """
    # MOCK if no translation provider configured.
    Real implementation: wire to Google Cloud Translate, DeepL, or an LLM call.
    """
    if source_lang == target_lang:
        return {"translated_text": text}

    translate_api_key = os.getenv("TRANSLATE_API_KEY")
    if not translate_api_key:
        return {"translated_text": f"[{target_lang}] {text}"}  # MOCK passthrough

    # Real path placeholder — plug in your provider of choice here.
    raise NotImplementedError("Wire a real translation provider using TRANSLATE_API_KEY")
