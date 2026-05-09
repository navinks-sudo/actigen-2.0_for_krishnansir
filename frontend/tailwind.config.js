/** @type {import('tailwindcss').Config} */
export default {
  content: ["./index.html", "./src/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        canvas: "#fafaf7",
        surface: "#ffffff",
        ink: {
          900: "#0b1020",
          800: "#1a2236",
          700: "#3b4664",
          600: "#5b6584",
          500: "#7a8399",
          400: "#9ba3b6",
          300: "#c7ccd9",
          200: "#e3e7ef",
          100: "#f1f3f8",
          50: "#f7f8fb",
        },
        brand: {
          50: "#f0fdfa",
          100: "#ccfbf1",
          200: "#99f6e4",
          300: "#5eead4",
          400: "#2dd4bf",
          500: "#14b8a6",
          600: "#0d9488",
          700: "#0f766e",
          800: "#115e59",
          900: "#134e4a",
        },
        accent: {
          peach: "#fbbf77",
          coral: "#fb7185",
          mint: "#34d399",
          lavender: "#a78bfa",
          sky: "#38bdf8",
          amber: "#f59e0b",
        },
      },
      fontFamily: {
        sans: ["Inter", "system-ui", "sans-serif"],
        mono: ["JetBrains Mono", "ui-monospace", "monospace"],
        display: ['"Plus Jakarta Sans"', "Inter", "system-ui", "sans-serif"],
      },
      boxShadow: {
        soft: "0 1px 2px rgba(15,23,42,0.04), 0 1px 3px rgba(15,23,42,0.06)",
        card: "0 1px 2px rgba(15,23,42,0.04), 0 8px 24px -8px rgba(15,23,42,0.08)",
        pop: "0 4px 16px -2px rgba(20,184,166,0.35), 0 2px 6px rgba(15,23,42,0.06)",
        ring: "0 0 0 4px rgba(99,102,241,0.12)",
      },
      backgroundImage: {
        mesh:
          "radial-gradient(at 0% 0%, rgba(167,139,250,0.18) 0px, transparent 50%), radial-gradient(at 100% 0%, rgba(56,189,248,0.16) 0px, transparent 50%), radial-gradient(at 100% 100%, rgba(251,113,133,0.12) 0px, transparent 50%), radial-gradient(at 0% 100%, rgba(52,211,153,0.12) 0px, transparent 50%)",
        "brand-grad": "linear-gradient(135deg,#0f766e 0%,#14b8a6 45%,#059669 100%)",
      },
      keyframes: {
        shimmer: {
          "0%": { backgroundPosition: "-200% 0" },
          "100%": { backgroundPosition: "200% 0" },
        },
        floaty: {
          "0%,100%": { transform: "translateY(0)" },
          "50%": { transform: "translateY(-6px)" },
        },
        ping2: {
          "0%": { transform: "scale(1)", opacity: "0.6" },
          "100%": { transform: "scale(2.4)", opacity: "0" },
        },
      },
      animation: {
        shimmer: "shimmer 2.5s linear infinite",
        floaty: "floaty 4s ease-in-out infinite",
        ping2: "ping2 1.6s cubic-bezier(0,0,0.2,1) infinite",
      },
    },
  },
  plugins: [],
};
