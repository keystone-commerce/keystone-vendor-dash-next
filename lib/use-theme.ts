"use client";

import { useCallback, useEffect, useState } from "react";

export type Theme = "light" | "dark";

export const THEME_STORAGE_KEY = "keystone-theme";

/** Apply the theme by toggling the `dark` class Tailwind keys off (darkMode: "class"). */
function applyTheme(theme: Theme) {
  document.documentElement.classList.toggle("dark", theme === "dark");
}

/**
 * Reads the saved preference (falling back to the OS setting), keeps the `dark`
 * class in sync, and persists changes. The initial class is set by an inline
 * script in the layout so there's no flash of the wrong theme before hydration.
 */
export function useTheme() {
  const [theme, setThemeState] = useState<Theme>("light");

  useEffect(() => {
    let initial: Theme = "light";
    try {
      const stored = localStorage.getItem(THEME_STORAGE_KEY) as Theme | null;
      initial =
        stored ??
        (window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light");
    } catch {
      /* storage blocked — fall back to light */
    }
    setThemeState(initial);
    applyTheme(initial);
  }, []);

  const setTheme = useCallback((next: Theme) => {
    setThemeState(next);
    applyTheme(next);
    try {
      localStorage.setItem(THEME_STORAGE_KEY, next);
    } catch {
      /* non-fatal */
    }
  }, []);

  const toggle = useCallback(
    () => setTheme(theme === "dark" ? "light" : "dark"),
    [theme, setTheme],
  );

  return { theme, setTheme, toggle, isDark: theme === "dark" };
}
