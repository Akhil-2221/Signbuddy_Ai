"""
Tests for the FastAPI endpoints. Uses TestClient (no real server needed).
Run with: pytest -q  (from ai-service/)
"""

from fastapi.testclient import TestClient

from app.main import app

client = TestClient(app)


def test_health():
    res = client.get("/health")
    assert res.status_code == 200
    assert res.json()["status"] == "ok"


def _sample_frame():
    return {
        "hand_landmarks_left": None,
        "hand_landmarks_right": [[0.1, 0.2, 0.0]] * 21,
        "pose_landmarks": None,
        "face_landmarks": None,
        "timestamp_ms": 1000,
    }


def test_recognize_landmarks_returns_well_formed_response():
    res = client.post(
        "/v1/recognize/landmarks",
        json={
            "frames": [_sample_frame() for _ in range(5)],
            "signLanguage": "ASL",
            "sessionId": "11111111-1111-1111-1111-111111111111",
        },
    )
    assert res.status_code == 200
    body = res.json()
    assert isinstance(body["text"], str)
    assert 0.0 <= body["confidence"] <= 1.0
    assert isinstance(body["lowConfidence"], bool)
    assert isinstance(body["latencyMs"], int)


def test_recognize_landmarks_rejects_empty_frames():
    res = client.post(
        "/v1/recognize/landmarks",
        json={"frames": [], "signLanguage": "ASL", "sessionId": "x"},
    )
    assert res.status_code == 400


def test_transcribe_falls_back_to_mock_without_api_key(monkeypatch):
    monkeypatch.delenv("OPENAI_API_KEY", raising=False)
    res = client.post("/v1/speech/transcribe", json={"audioBase64": "AAAA", "languageHint": "en"})
    assert res.status_code == 200
    assert "mock" in res.json()["text"].lower()


def test_translate_passthrough_same_language():
    res = client.post(
        "/v1/translate/text",
        json={"text": "hello", "sourceLang": "en", "targetLang": "en"},
    )
    assert res.status_code == 200
    assert res.json()["translatedText"] == "hello"


def test_tutor_score_returns_expected_shape():
    res = client.post(
        "/v1/tutor/score",
        json={
            "frames": [_sample_frame()],
            "targetSignId": "HELLO",
            "signLanguage": "ASL",
        },
    )
    assert res.status_code == 200
    body = res.json()
    assert "predictedGloss" in body
    assert "confidence" in body
    assert "isCorrect" in body
