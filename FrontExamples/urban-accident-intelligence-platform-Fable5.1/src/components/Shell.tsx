"use client";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useState, type ReactNode } from "react";
import { SyntheticTag } from "./ui";

const NAV = [
  ["/", "Explorer"], ["/report", "Report incident"], ["/steward", "Steward QA"], ["/lab", "Analysis lab"], ["/risk", "Risk & EB"], ["/simulate", "Simulator"],
] as const;

export default function Shell({ children }: { children: ReactNode }) {
  const path = usePathname();
  const [theme, setTheme] = useState<"dark" | "light">("dark");
  const [source, setSource] = useState<{ name: string; kind: string; scenario?: string } | null>(null);
  useEffect(() => { const t = (localStorage.getItem("uai-theme") as "dark" | "light") || "dark"; setTheme(t); document.documentElement.classList.toggle("light", t === "light"); }, []);
  useEffect(() => { fetch("/api/network").then((r) => r.json()).then((d) => setSource(d.source)).catch(() => {}); }, [path]);
  const toggle = () => { const t = theme === "dark" ? "light" : "dark"; setTheme(t); localStorage.setItem("uai-theme", t); document.documentElement.classList.toggle("light", t === "light"); window.dispatchEvent(new Event("uai-theme")); };
  return (
    <div className="h-screen flex flex-col">
      <header className="h-9 flex items-center border-b shrink-0 px-3 gap-4" style={{ borderColor: "var(--line)", background: "var(--bg-1)" }}>
        <div className="font-semibold tracking-wide text-[12px]"><span style={{ color: "var(--accent)" }}>UAI</span> · Urban Accident Intelligence</div>
        <nav className="nav flex h-full text-[11.5px]">{NAV.map(([href, label]) => <Link key={href} href={href} className={path === href ? "active" : ""}>{label}</Link>)}</nav>
        <div className="ml-auto flex items-center gap-3 text-[10.5px]" style={{ color: "var(--fg-2)" }}>
          {source ? <span className="flex items-center gap-2"><SyntheticTag kind={source.kind} /><span className="mono">{source.name}</span></span> : <span>no active dataset</span>}
          <button className="btn btn-xs" onClick={toggle}>{theme === "dark" ? "☀ publication" : "◐ dark"}</button>
        </div>
      </header>
      <main className="flex-1 min-h-0">{children}</main>
    </div>
  );
}
