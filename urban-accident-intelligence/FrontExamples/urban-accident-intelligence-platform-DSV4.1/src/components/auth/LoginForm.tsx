"use client";

import { useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import Link from "next/link";
import { LogIn, ShieldCheck } from "lucide-react";
import { Callout, Field, Panel, Spinner } from "@/components/ui";
import { DEMO_ACCOUNTS } from "@/lib/demoAccounts";

export function LoginForm() {
  const router = useRouter();
  const params = useSearchParams();
  const next = params.get("next") ?? "/";
  const [email, setEmail] = useState(DEMO_ACCOUNTS[0].email);
  const [password, setPassword] = useState(DEMO_ACCOUNTS[0].password);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const submit = async (event?: React.FormEvent) => {
    event?.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const response = await fetch("/api/auth/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email, password }),
      });
      const payload = await response.json();
      if (!response.ok) throw new Error(payload.error ?? "Sign-in failed");
      router.push(next);
      router.refresh();
    } catch (err) {
      setError((err as Error).message);
      setBusy(false);
    }
  };

  return (
    <div className="mx-auto flex min-h-[calc(100vh-48px)] max-w-4xl items-start justify-center p-4">
      <div className="grid w-full gap-2.5 md:grid-cols-[minmax(0,1fr)_300px]">
        <Panel title="Sign in" icon={<LogIn size={12} />}>
          <form onSubmit={submit} className="space-y-2.5">
            <p className="text-[11.5px] leading-relaxed text-muted">
              Role-based access protects moderation and analytical configuration. Citizens may explore and report; analysts may run spatial analyses and
              risk scenarios; administrators may moderate records and manage datasets.
            </p>
            <Field label="Email">
              <input className="input" type="email" value={email} onChange={(event) => setEmail(event.target.value)} autoComplete="username" />
            </Field>
            <Field label="Password">
              <input className="input" type="password" value={password} onChange={(event) => setPassword(event.target.value)} autoComplete="current-password" />
            </Field>
            {error && <Callout tone="danger" title="Sign-in failed">{error}</Callout>}
            <button type="submit" className="btn btn-primary w-full" disabled={busy}>
              {busy ? <Spinner label="Signing in…" /> : <><ShieldCheck size={13} /> Sign in</>}
            </button>
            <div className="text-[10px] leading-relaxed text-faint">
              Sessions are HMAC-signed, HttpOnly cookies valid for 12 hours. Demo credentials are seeded; no real personal data is involved.
            </div>
            <div className="pt-1 text-center">
              <Link href="/" className="link text-[11px]">Continue as read-only visitor</Link>
            </div>
          </form>
        </Panel>

        <Panel title="Demo roles" icon={<ShieldCheck size={12} />}>
          <div className="space-y-1.5">
            {DEMO_ACCOUNTS.map((account) => (
              <button
                key={account.email}
                type="button"
                className="w-full rounded border border-line bg-panel2 px-2 py-1.5 text-left transition-colors hover:border-accent focus-ring"
                onClick={() => {
                  setEmail(account.email);
                  setPassword(account.password);
                }}
              >
                <div className="flex items-center justify-between gap-2">
                  <span className="text-[11.5px] font-medium capitalize text-ink">{account.role}</span>
                  <span className="badge">{account.name}</span>
                </div>
                <div className="mono mt-0.5 text-[10px] text-faint">{account.email}</div>
                <div className="mono text-[10px] text-faint">{account.password}</div>
              </button>
            ))}
            <p className="pt-1 text-[9.5px] leading-relaxed text-faint">
              These accounts exist only in the synthetic demonstration database. Passwords are hashed with scrypt; sessions carry no reusable secrets.
            </p>
          </div>
        </Panel>
      </div>
    </div>
  );
}
