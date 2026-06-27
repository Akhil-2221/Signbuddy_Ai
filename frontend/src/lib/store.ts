"use client";

import { create } from "zustand";
import type { User, AccessibilitySettings, SignLanguage, OutputPreference } from "@/types";

interface AppState {
  user: User | null;
  accessToken: string | null;
  setSession: (user: User, accessToken: string) => void;
  clearSession: () => void;
  updateAccessibility: (settings: Partial<AccessibilitySettings>) => void;
  updatePreferences: (prefs: { signLanguage?: SignLanguage; output?: OutputPreference; spokenLanguage?: string }) => void;
}

export const useAppStore = create<AppState>((set) => ({
  user: null,
  accessToken: null,

  setSession: (user, accessToken) => {
    if (typeof window !== "undefined") {
      window.sessionStorage.setItem("sb_access_token", accessToken);
    }
    set({ user, accessToken });
  },

  clearSession: () => {
    if (typeof window !== "undefined") {
      window.sessionStorage.removeItem("sb_access_token");
    }
    set({ user: null, accessToken: null });
  },

  updateAccessibility: (settings) =>
    set((state) =>
      state.user
        ? {
            user: {
              ...state.user,
              accessibilitySettings: { ...state.user.accessibilitySettings, ...settings },
            },
          }
        : state
    ),

  updatePreferences: (prefs) =>
    set((state) =>
      state.user
        ? {
            user: {
              ...state.user,
              preferredSignLanguage: prefs.signLanguage ?? state.user.preferredSignLanguage,
              preferredOutput: prefs.output ?? state.user.preferredOutput,
              preferredSpokenLanguage: prefs.spokenLanguage ?? state.user.preferredSpokenLanguage,
            },
          }
        : state
    ),
}));
