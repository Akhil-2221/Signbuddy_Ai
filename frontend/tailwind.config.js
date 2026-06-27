/** @type {import('tailwindcss').Config} */
module.exports = {
  darkMode: "class",
  content: [
    "./src/app/**/*.{ts,tsx}",
    "./src/components/**/*.{ts,tsx}",
  ],
  theme: {
    extend: {
      colors: {
        // Calm, high-contrast palette chosen for accessibility first:
        // deep teal as the trust/primary anchor, warm coral ONLY for
        // urgent/emergency actions so it carries real meaning, not decoration.
        ink: {
          900: "#0E1E1F",
          700: "#1C3638",
          500: "#3A5A5C",
        },
        signal: {
          // primary action color
          DEFAULT: "#0E7C7B",
          50: "#E6F5F4",
          100: "#C2E6E4",
          400: "#159996",
          600: "#0B6362",
          700: "#084F4E",
        },
        urgent: {
          DEFAULT: "#D14B3D",
          50: "#FBE9E7",
          600: "#B23A2E",
        },
        canvas: {
          DEFAULT: "#FAFAF8",
          dark: "#10181A",
        },
        surface: {
          DEFAULT: "#FFFFFF",
          dark: "#162325",
        },
      },
      fontFamily: {
        display: ["var(--font-display)", "system-ui", "sans-serif"],
        body: ["var(--font-body)", "system-ui", "sans-serif"],
      },
      fontSize: {
        // accessible base scale — never below 16px for body text
        base: ["1rem", { lineHeight: "1.6" }],
        lg: ["1.25rem", { lineHeight: "1.6" }],
        xl: ["1.5rem", { lineHeight: "1.5" }],
        "2xl": ["2rem", { lineHeight: "1.3" }],
        "3xl": ["2.75rem", { lineHeight: "1.2" }],
      },
      borderRadius: {
        xl: "1rem",
        "2xl": "1.5rem",
      },
      keyframes: {
        pulseRing: {
          "0%": { transform: "scale(0.95)", opacity: "0.7" },
          "70%": { transform: "scale(1.3)", opacity: "0" },
          "100%": { transform: "scale(1.3)", opacity: "0" },
        },
      },
      animation: {
        pulseRing: "pulseRing 1.6s cubic-bezier(0.4,0,0.6,1) infinite",
      },
    },
  },
  plugins: [],
};
