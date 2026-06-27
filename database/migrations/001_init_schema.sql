-- =====================================================================
-- SignBuddy AI — PostgreSQL Schema
-- =====================================================================
-- Conventions:
--   - UUID primary keys (gen_random_uuid(), from pgcrypto)
--   - snake_case naming
--   - created_at / updated_at on every table
--   - Soft deletes via deleted_at where user-generated content matters
-- =====================================================================

CREATE EXTENSION IF NOT EXISTS pgcrypto;
-- -- optional: only if location-based features (e.g. nearby interpreters) are added later

-- ---------------------------------------------------------------------
-- USERS & PROFILES
-- ---------------------------------------------------------------------

CREATE TYPE user_role AS ENUM ('deaf_user', 'hearing_user', 'interpreter', 'admin', 'institution_admin');
CREATE TYPE preferred_output AS ENUM ('text', 'speech', 'both');
CREATE TYPE sign_language_code AS ENUM ('ASL', 'ISL', 'BSL');

CREATE TABLE institutions (
    id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    name                TEXT NOT NULL,
    type                TEXT NOT NULL,  -- 'school' | 'hospital' | 'government' | 'corporate'
    contact_email       TEXT,
    plan_tier           TEXT NOT NULL DEFAULT 'free', -- 'free' | 'pro' | 'enterprise'
    created_at          TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE users (
    id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    email               TEXT UNIQUE,                 -- nullable: allow anonymous/guest accounts
    phone               TEXT UNIQUE,
    password_hash       TEXT,                         -- null if OAuth-only
    full_name           TEXT NOT NULL,
    role                user_role NOT NULL DEFAULT 'deaf_user',
    preferred_sign_language sign_language_code DEFAULT 'ASL',
    preferred_output    preferred_output NOT NULL DEFAULT 'both',
    preferred_spoken_language TEXT NOT NULL DEFAULT 'en', -- ISO 639-1 code
    accessibility_settings JSONB NOT NULL DEFAULT '{
        "highContrast": false,
        "darkMode": false,
        "textSize": "medium",
        "reduceMotion": false,
        "voiceSpeed": 1.0
    }'::jsonb,
    is_anonymous        BOOLEAN NOT NULL DEFAULT FALSE,
    institution_id      UUID REFERENCES institutions(id),
    email_verified_at   TIMESTAMPTZ,
    last_login_at        TIMESTAMPTZ,
    created_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
    deleted_at          TIMESTAMPTZ
);

CREATE TABLE refresh_tokens (
    id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id             UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    token_hash          TEXT NOT NULL,
    device_label        TEXT,
    expires_at          TIMESTAMPTZ NOT NULL,
    revoked_at          TIMESTAMPTZ,
    created_at          TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_refresh_tokens_user ON refresh_tokens(user_id);

-- ---------------------------------------------------------------------
-- TRANSLATION SESSIONS (sign<->text<->speech conversation history)
-- ---------------------------------------------------------------------

CREATE TYPE session_mode AS ENUM ('sign_to_text', 'sign_to_speech', 'speech_to_text', 'two_way', 'emergency');

CREATE TABLE translation_sessions (
    id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id             UUID REFERENCES users(id) ON DELETE SET NULL,
    mode                session_mode NOT NULL,
    sign_language       sign_language_code NOT NULL DEFAULT 'ASL',
    output_language     TEXT NOT NULL DEFAULT 'en',
    started_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
    ended_at            TIMESTAMPTZ,
    device_type         TEXT,             -- 'mobile' | 'desktop' | 'tablet'
    avg_confidence      NUMERIC(4,3),     -- 0.000 - 1.000, computed on close
    created_at          TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_sessions_user ON translation_sessions(user_id);
CREATE INDEX idx_sessions_started ON translation_sessions(started_at);

-- Individual recognized utterances within a session (NOT raw video — only text + metadata)
CREATE TABLE session_utterances (
    id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    session_id          UUID NOT NULL REFERENCES translation_sessions(id) ON DELETE CASCADE,
    sequence_index      INTEGER NOT NULL,
    direction           TEXT NOT NULL,     -- 'sign_in' | 'speech_in'
    recognized_text      TEXT NOT NULL,
    translated_text      TEXT,             -- if output_language != recognition language
    confidence_score     NUMERIC(4,3) NOT NULL,
    low_confidence_flag  BOOLEAN NOT NULL DEFAULT FALSE,
    user_corrected_text  TEXT,             -- if user manually corrected output
    latency_ms           INTEGER,
    created_at           TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_utterances_session ON session_utterances(session_id);

-- ---------------------------------------------------------------------
-- AI TUTOR / LEARNING MODULE
-- ---------------------------------------------------------------------

CREATE TABLE sign_dictionary (
    id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    sign_language       sign_language_code NOT NULL,
    gloss               TEXT NOT NULL,         -- canonical word/phrase, e.g. "HELLO"
    category             TEXT,                  -- 'greetings' | 'emergency' | 'numbers' | 'family' ...
    difficulty_level     SMALLINT NOT NULL DEFAULT 1, -- 1-5
    video_url            TEXT NOT NULL,
    thumbnail_url        TEXT,
    instructions_text     TEXT,
    handshape_tags        TEXT[],               -- searchable tags for related-sign lookups
    created_at            TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE (sign_language, gloss)
);
CREATE INDEX idx_dictionary_lang_category ON sign_dictionary(sign_language, category);

CREATE TABLE lessons (
    id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    sign_language       sign_language_code NOT NULL,
    title                TEXT NOT NULL,
    description           TEXT,
    difficulty_level      SMALLINT NOT NULL DEFAULT 1,
    order_index           INTEGER NOT NULL,
    sign_ids              UUID[] NOT NULL,       -- ordered list referencing sign_dictionary
    created_at             TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE user_lesson_progress (
    id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id             UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    lesson_id           UUID NOT NULL REFERENCES lessons(id) ON DELETE CASCADE,
    status               TEXT NOT NULL DEFAULT 'not_started', -- 'not_started' | 'in_progress' | 'completed'
    best_score           NUMERIC(5,2),          -- % accuracy on practice attempts
    attempts_count        INTEGER NOT NULL DEFAULT 0,
    last_attempted_at      TIMESTAMPTZ,
    completed_at            TIMESTAMPTZ,
    UNIQUE (user_id, lesson_id)
);

CREATE TABLE practice_attempts (
    id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id             UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    sign_id              UUID NOT NULL REFERENCES sign_dictionary(id),
    predicted_gloss        TEXT NOT NULL,
    target_gloss            TEXT NOT NULL,
    confidence_score         NUMERIC(4,3) NOT NULL,
    is_correct                BOOLEAN NOT NULL,
    created_at                 TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_practice_user_sign ON practice_attempts(user_id, sign_id);

-- ---------------------------------------------------------------------
-- FEEDBACK LOOP (for continuous model improvement)
-- ---------------------------------------------------------------------

CREATE TABLE recognition_feedback (
    id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    utterance_id         UUID REFERENCES session_utterances(id) ON DELETE CASCADE,
    user_id              UUID REFERENCES users(id) ON DELETE SET NULL,
    was_correct           BOOLEAN NOT NULL,
    corrected_text          TEXT,
    notes                   TEXT,
    created_at                TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ---------------------------------------------------------------------
-- EMERGENCY MODE
-- ---------------------------------------------------------------------

CREATE TABLE emergency_phrases (
    id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    sign_language       sign_language_code NOT NULL,
    phrase_key            TEXT NOT NULL,          -- 'need_ambulance', 'call_police', etc.
    display_text_en        TEXT NOT NULL,
    translations             JSONB NOT NULL DEFAULT '{}'::jsonb, -- {"hi": "...", "te": "...", ...}
    icon                       TEXT,
    priority_order             INTEGER NOT NULL DEFAULT 0,
    UNIQUE (sign_language, phrase_key)
);

-- ---------------------------------------------------------------------
-- AUDIT / ANALYTICS (aggregate only — no raw video/audio ever stored)
-- ---------------------------------------------------------------------

CREATE TABLE usage_events (
    id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id             UUID REFERENCES users(id) ON DELETE SET NULL,
    event_type           TEXT NOT NULL,   -- 'session_start' | 'lesson_complete' | 'low_confidence' | ...
    metadata               JSONB NOT NULL DEFAULT '{}'::jsonb,
    created_at               TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_usage_events_type_time ON usage_events(event_type, created_at);

-- ---------------------------------------------------------------------
-- updated_at trigger helper
-- ---------------------------------------------------------------------
CREATE OR REPLACE FUNCTION set_updated_at()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = now();
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_users_updated_at BEFORE UPDATE ON users
    FOR EACH ROW EXECUTE FUNCTION set_updated_at();
