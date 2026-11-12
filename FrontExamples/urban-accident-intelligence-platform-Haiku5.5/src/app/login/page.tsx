"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { LogIn } from "lucide-react";
import { useApp } from "@/components/AppProvider";
import { Alert, Button, Field, inputCls } from "@/components/ui";
import { apiPost, errorMessage } from "@/lib/client-api";

export default function LoginPage() {
  const router = useRouter();
  const { refreshMeta } = useApp();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await apiPost("/auth/login", { email, password });
      await refreshMeta();
      router.push("/admin");
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="flex flex-1 items-center justify-center p-6">
      <form onSubmit={submit} className="flex w-full max-w-sm flex-col gap-4 rounded-lg border border-line bg-panel p-6">
        <div className="flex items-center gap-2">
          <span className="grid size-8 place-items-center rounded-md bg-accent/15 text-accent">
            <LogIn size={16} />
          </span>
          <div>
            <h1 className="text-[15px] font-semibold tracking-tight">Sign in</h1>
            <p className="text-[11.5px] text-muted">Administrators review reports and manage datasets.</p>
          </div>
        </div>
        <Field label="Email">
          <input type="email" autoComplete="username" className={inputCls} value={email} onChange={(e) => setEmail(e.target.value)} required />
        </Field>
        <Field label="Password">
          <input type="password" autoComplete="current-password" className={inputCls} value={password} onChange={(e) => setPassword(e.target.value)} required />
        </Field>
        {error ? <Alert tone="error">{error}</Alert> : null}
        <Button type="submit" variant="primary" busy={busy} disabled={busy}>
          Sign in
        </Button>
        <p className="text-[11px] leading-relaxed text-faint">
          Accounts are created from the ADMIN_EMAIL / ADMIN_PASSWORD settings in your environment file. Sessions expire after 12 hours.
        </p>
      </form>
    </div>
  );
}
