import type { Config } from "tailwindcss";

export default {
  content: ["./src/**/*.{ts,tsx}"],
  darkMode: "class",
  theme: {
    extend: {
      colors: {
        brand: {
          50: "#eef4ff", 100: "#d9e6ff", 200: "#bcd3ff", 300: "#8eb6ff", 400: "#598cff",
          500: "#3363fc", 600: "#1d43f1", 700: "#1631d6", 800: "#192bad", 900: "#1a2b88", 950: "#141c53",
        },
      },
      fontFamily: { sans: ["Inter", "Segoe UI", "system-ui", "-apple-system", "Roboto", "sans-serif"] },
    },
  },
  plugins: [],
} satisfies Config;
