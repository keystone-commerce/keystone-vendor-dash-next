"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useState,
  type ReactNode,
} from "react";

export type Theme = "light" | "dark";

export const THEME_STORAGE_KEY = "keystone-theme";

/** Storage is untrusted — only accept the two valid values (a stale/hand-edited key
 *  like "sepia" would otherwise be assigned straight into state). */
function isTheme(value: unknown): value is Theme {
  return value === "light" || value === "dark";
}

/** Apply the theme by toggling the `dark` class Tailwind keys off (darkMode: "class"). */
function applyTheme(theme: Theme) {
  document.documentElement.classList.toggle("dark", theme === "dark");
}

interface ThemeContextValue {
  theme: Theme;
  setTheme: (t: Theme) => void;
  toggle: () => void;
  isDark: boolean;
}

const ThemeContext = createContext<ThemeContextValue | null>(null);

/**
 * Single source of theme truth shared by every `useTheme()` consumer (toggle,
 * charts, …) via context — so a toggle anywhere re-renders them all. Reads the
 * saved preference (or the OS setting) on mount; an inline script in the layout
 * sets the initial `dark` class so there's no flash before hydration.
 */
export function ThemeProvider({ children }: { children: ReactNode }) {
  const [theme, setTheme] = useState<Theme>("light");
  const [ready, setReady] = useState(false);

  // Resolve the initial theme once, on mount.
  useEffect(() => {
    let initial: Theme = "light";
    try {
      const stored = localStorage.getItem(THEME_STORAGE_KEY);
      initial = isTheme(stored)
        ? stored
        : window.matchMedia("(prefers-color-scheme: dark)").matches
          ? "dark"
          : "light";
    } catch {
      /* storage blocked — fall back to light */
    }
    setTheme(initial);
    setReady(true);
  }, []);

  // Keep the DOM class + storage in sync whenever the theme changes (post-init).
  useEffect(() => {
    if (!ready) return;
    applyTheme(theme);
    try {
      localStorage.setItem(THEME_STORAGE_KEY, theme);
    } catch {
      /* non-fatal */
    }
  }, [theme, ready]);

  const toggle = useCallback(() => setTheme((cur) => (cur === "dark" ? "light" : "dark")), []);

  return (
    <ThemeContext.Provider value={{ theme, setTheme, toggle, isDark: theme === "dark" }}>
      {children}
    </ThemeContext.Provider>
  );
}

export function useTheme(): ThemeContextValue {
  const ctx = useContext(ThemeContext);
  if (!ctx) throw new Error("useTheme must be used within <ThemeProvider>.");
  return ctx;
}
