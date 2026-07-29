import type { Config } from "tailwindcss";

/** Colours are CSS variables (RGB channels) so light/dark can swap — see globals.css. */
const rgb = (v: string) => `rgb(var(${v}) / <alpha-value>)`;

const config: Config = {
  darkMode: "class",
  content: ["./app/**/*.{ts,tsx}", "./components/**/*.{ts,tsx}", "./features/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        bg: rgb("--k-bg"),
        card: rgb("--k-card"),
        ink: rgb("--k-ink"),
        muted: rgb("--k-muted"),
        border: rgb("--k-border"),
        orange: {
          DEFAULT: rgb("--k-orange"),
          deep: rgb("--k-orange-deep"),
          light: rgb("--k-orange-light"),
        },
        rust: { DEFAULT: rgb("--k-rust"), dark: rgb("--k-rust-dark") },
        keystone: {
          green: rgb("--k-green"),
          amber: rgb("--k-amber"),
          red: rgb("--k-red"),
          blue: rgb("--k-blue"),
        },

        // shadcn/ui token names mapped onto the Keystone palette, so components
        // copied from shadcn (components/ui/*) render on-brand in both themes.
        background: rgb("--k-card"),
        foreground: rgb("--k-ink"),
        primary: { DEFAULT: rgb("--k-orange"), foreground: "#ffffff" },
        "primary-foreground": "#ffffff",
        secondary: { DEFAULT: rgb("--k-orange-light"), foreground: rgb("--k-ink") },
        "secondary-foreground": rgb("--k-ink"),
        accent: { DEFAULT: rgb("--k-orange-light"), foreground: rgb("--k-ink") },
        "accent-foreground": rgb("--k-ink"),
        destructive: { DEFAULT: rgb("--k-red"), foreground: "#ffffff" },
        "destructive-foreground": "#ffffff",
        input: rgb("--k-border"),
        ring: rgb("--k-orange-deep"),

        // Geist tokens (see :root vars in globals.css) for components/ui.
        "gray-1000": "var(--ds-gray-1000)",
        "gray-alpha-400": "var(--ds-gray-alpha-400)",
        "background-100": "var(--ds-background-100)",
      },
      borderRadius: { keystone: "12px" },
      fontFamily: {
        sans: ["Inter", "system-ui", "-apple-system", "Segoe UI", "Roboto", "sans-serif"],
      },
    },
  },
  plugins: [],
};
export default config;
