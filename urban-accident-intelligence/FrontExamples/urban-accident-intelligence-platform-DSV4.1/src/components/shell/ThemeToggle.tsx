"use client";

import { useEffect, useState } from "react";
import { Moon, Sun } from "lucide-react";

export function ThemeToggle({ compact = false }: { compact?: boolean }) {
  const [theme, setTheme] = useState<"dark" | "light">("dark");

  useEffect(() => {
    const stored = window.localStorage.getItem("uai-theme");
    const initial = stored === "light" ? "light" : "dark";
    setTheme(initial);
    document.documentElement.setAttribute("data-theme", initial);
  }, []);

  const toggle = () => {
    const next = theme === "dark" ? "light" : "dark";
    setTheme(next);
    document.documentElement.setAttribute("data-theme", next);
    window.localStorage.setItem("uai-theme", next);
    window.dispatchEvent(new CustomEvent("uai-theme-change", { detail: next }));
  };

  return (
    <button
      type="button"
      onClick={toggle}
      className="btn btn-ghost focus-ring"
      aria-label={`Switch to ${theme === "dark" ? "light" : "dark"} theme`}
      title={`Switch to ${theme === "dark" ? "light" : "dark"} theme`}
    >
      {theme === "dark" ? <Sun size={14} /> : <Moon size={14} />}
      {!compact && <span className="hidden sm:inline">{theme === "dark" ? "Light" : "Dark"}</span>}
    </button>
  );
}
