import type { Config } from "tailwindcss";

// Design tokens from docs/Screen Handoff.html — paper/ink/oxblood, italic-serif voice.
const config: Config = {
  content: ["./src/app/**/*.{ts,tsx}", "./src/components/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        paper: "#F4ECDF",
        "paper-deep": "#EBE0CC",
        "paper-card": "#F8F1E4",
        ink: "#1F1410",
        "ink-soft": "#3D2C22",
        "ink-mute": "#8C7868",
        rule: "#C9B89C",
        "rule-soft": "#DCCDB4",
        oxblood: "#7A1F23",
        "oxblood-deep": "#5C1518",
      },
      fontFamily: {
        serif: ["var(--font-serif)", "Georgia", "serif"],
        sans: ["var(--font-sans)", "system-ui", "sans-serif"],
        mono: ["var(--font-mono)", "ui-monospace", "monospace"],
      },
      letterSpacing: {
        label: "0.22em",
        button: "0.18em",
      },
      keyframes: {
        "fade-up": {
          "0%": { opacity: "0", transform: "translateY(4px)" },
          "100%": { opacity: "1", transform: "translateY(0)" },
        },
        "pulse-soft": {
          "0%, 100%": { opacity: "1" },
          "50%": { opacity: "0.35" },
        },
      },
      animation: {
        "fade-up": "fade-up 300ms ease both",
        "pulse-soft": "pulse-soft 1.6s ease-in-out infinite",
      },
    },
  },
  plugins: [],
};

export default config;
