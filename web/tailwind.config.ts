import type { Config } from "tailwindcss";

export default {
  content: ["./app/**/*.{ts,tsx}", "./components/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        teal: { DEFAULT: "#1FADA6" },
        ink: "#0D1B2A",
        sub: "#3D526B",
        muted: "#64748B",
      },
    },
  },
  plugins: [],
} satisfies Config;
