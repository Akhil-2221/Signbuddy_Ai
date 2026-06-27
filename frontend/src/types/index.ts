export type SignLanguage = "ASL" | "ISL" | "BSL";

export type SpokenLanguage =
  | "en" | "te" | "hi" | "ta" | "kn" | "ml" | "mr" | "bn"
  | "fr" | "de" | "es" | "ar" | "zh";

export const SPOKEN_LANGUAGES: { code: SpokenLanguage; label: string; nativeLabel: string }[] = [
  { code: "en", label: "English", nativeLabel: "English" },
  { code: "te", label: "Telugu", nativeLabel: "తెలుగు" },
  { code: "hi", label: "Hindi", nativeLabel: "हिन्दी" },
  { code: "ta", label: "Tamil", nativeLabel: "தமிழ்" },
  { code: "kn", label: "Kannada", nativeLabel: "ಕನ್ನಡ" },
  { code: "ml", label: "Malayalam", nativeLabel: "മലയാളം" },
  { code: "mr", label: "Marathi", nativeLabel: "मराठी" },
  { code: "bn", label: "Bengali", nativeLabel: "বাংলা" },
  { code: "fr", label: "French", nativeLabel: "Français" },
  { code: "de", label: "German", nativeLabel: "Deutsch" },
  { code: "es", label: "Spanish", nativeLabel: "Español" },
  { code: "ar", label: "Arabic", nativeLabel: "العربية" },
  { code: "zh", label: "Chinese", nativeLabel: "中文" },
];

/**
 * Maps our ISO 639-1 spoken-language codes to proper BCP-47 locale tags
 * required by the Web Speech APIs (SpeechSynthesis / SpeechRecognition).
 * Naively appending "-US" to every code (e.g. "hi-US") produces invalid
 * locales the browser silently mis-handles — this is the correct mapping.
 */
export const SPEECH_LOCALE: Record<string, string> = {
  en: "en-US",
  te: "te-IN",
  hi: "hi-IN",
  ta: "ta-IN",
  kn: "kn-IN",
  ml: "ml-IN",
  mr: "mr-IN",
  bn: "bn-IN",
  fr: "fr-FR",
  de: "de-DE",
  es: "es-ES",
  ar: "ar-SA",
  zh: "zh-CN",
};

export function speechLocaleFor(code: string | undefined | null): string {
  return SPEECH_LOCALE[code ?? "en"] ?? "en-US";
}

export type OutputPreference = "text" | "speech" | "both";
export type TextSize = "small" | "medium" | "large" | "extra_large";

export interface AccessibilitySettings {
  highContrast: boolean;
  darkMode: boolean;
  textSize: TextSize;
  reduceMotion: boolean;
  voiceSpeed: number;
}

export interface User {
  id: string;
  email: string | null;
  fullName: string;
  role: "deaf_user" | "hearing_user" | "interpreter" | "admin" | "institution_admin";
  preferredSignLanguage: SignLanguage;
  preferredOutput: OutputPreference;
  preferredSpokenLanguage: string;
  accessibilitySettings: AccessibilitySettings;
  isAnonymous: boolean;
}

export type SessionMode =
  | "sign_to_text"
  | "sign_to_speech"
  | "speech_to_text"
  | "two_way"
  | "emergency";

export interface TranslationSession {
  id: string;
  mode: SessionMode;
  sign_language: SignLanguage;
  output_language: string;
  started_at: string;
  ended_at: string | null;
}

export interface Utterance {
  id: string;
  session_id: string;
  sequence_index: number;
  direction: "sign_in" | "speech_in";
  recognized_text: string;
  translated_text: string | null;
  confidence_score: number;
  low_confidence_flag: boolean;
  user_corrected_text: string | null;
  created_at: string;
}

export interface SignDictionaryEntry {
  id: string;
  sign_language: SignLanguage;
  gloss: string;
  category: string | null;
  difficulty_level: number;
  video_url: string;
  thumbnail_url: string | null;
  instructions_text: string | null;
}

export interface Lesson {
  id: string;
  sign_language: SignLanguage;
  title: string;
  description: string | null;
  difficulty_level: number;
  order_index: number;
  sign_ids: string[];
}

export interface EmergencyPhrase {
  id: string;
  sign_language: SignLanguage;
  phrase_key: string;
  display_text_en: string;
  translations: Record<string, string>;
  icon: string | null;
  priority_order: number;
}

/** Mirrors LandmarkFrame in ai-service/pipeline/interfaces.py */
export interface LandmarkFrame {
  hand_landmarks_left: number[][] | null;
  hand_landmarks_right: number[][] | null;
  pose_landmarks: number[][] | null;
  face_landmarks: number[][] | null;
  timestamp_ms: number;
}
