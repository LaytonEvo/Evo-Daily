"use client";

import { useEffect, useState } from "react";
import { Moon, Sun } from "lucide-react";

const KEY = "evotasks-theme";

/**
 * Light/dark switch. The choice is per-device and remembered locally — it is a
 * viewing preference, not something worth a column on the user.
 *
 * Defaults to whatever the phone or laptop is already set to, so most people
 * never touch this.
 */
export function ThemeToggle() {
  const [dark, setDark] = useState(false);
  const [ready, setReady] = useState(false);

  useEffect(() => {
    let stored: string | null = null;
    try {
      stored = localStorage.getItem(KEY);
    } catch {
      // Private browsing can refuse storage; the OS preference still works.
    }
    const prefersDark =
      stored === "dark" ||
      (stored === null && window.matchMedia("(prefers-color-scheme: dark)").matches);
    setDark(prefersDark);
    document.documentElement.classList.toggle("dark", prefersDark);
    setReady(true);
  }, []);

  function toggle() {
    const next = !dark;
    setDark(next);
    document.documentElement.classList.toggle("dark", next);
    try {
      localStorage.setItem(KEY, next ? "dark" : "light");
    } catch {
      // Preference lasts the session only. Not worth telling anyone about.
    }
  }

  return (
    <button
      type="button"
      onClick={toggle}
      aria-label={dark ? "Switch to light theme" : "Switch to dark theme"}
      className="rounded-xl p-2.5 text-muted-foreground transition-colors hover:bg-accent hover:text-accent-foreground"
    >
      {/* Render nothing until the stored choice is known, or the icon flips
          visibly on every load. */}
      {ready ? dark ? <Sun className="h-5 w-5" /> : <Moon className="h-5 w-5" /> : (
        <span className="block h-5 w-5" />
      )}
    </button>
  );
}
