"use client";
import { Suspense, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { useApp } from "@/components/providers";
import { Button, Field, Notice } from "@/components/ui";
import { api } from "@/lib/client/api";

function LoginInner() {
  const router = useRouter();
  const sp = useSearchParams();
  const { reloadMeta } = useApp();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [err, setErr] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setErr(null);
    try {
      await api("/api/auth/login", { method: "POST", json: { email, password } });
      await reloadMeta();
      const next = sp.get("next");
      router.push(next && next.startsWith("/") && next !== "/login" ? next : "/admin");
    } catch (e2) {
      setErr((e2 as Error).message);
    } finally {
      setLoading(false);
    }
  };
  return (
    <div className="h-full grid place-items-center p-6 overflow-y-auto">
      <form onSubmit={submit} className="w-full max-w-sm border border-line bg-panel rounded-[4px] p-5 space-y-4">
        <div>
          <h1 className="text-[15px] font-semibold">Sign in</h1>
          <p className="text-[12px] text-muted">Citizens can report without an account. Sign-in is required for administration.</p>
        </div>
        <Field label="E-mail">
          <input className="field" type="email" autoComplete="username" value={email} onChange={(e) => setEmail(e.target.value)} required />
        </Field>
        <Field label="Password">
          <input className="field" type="password" autoComplete="current-password" value={password} onChange={(e) => setPassword(e.target.value)} required />
        </Field>
        {err && <Notice tone="danger">{err}</Notice>}
        <Button variant="primary" size="md" className="w-full" loading={loading} type="submit">
          Sign in
        </Button>
        <div className="border-t border-line pt-3 text-[11.5px] text-muted space-y-1">
          <div className="label">Demo accounts</div>
          <button type="button" className="block hover:text-accent" onClick={() => { setEmail("admin@uai.local"); setPassword("admin-demo"); }}>
            admin@uai.local · admin-demo <span className="text-faint">(administrator)</span>
          </button>
          <button type="button" className="block hover:text-accent" onClick={() => { setEmail("citizen@uai.local"); setPassword("citizen-demo"); }}>
            citizen@uai.local · citizen-demo <span className="text-faint">(regular user)</span>
          </button>
          <p className="text-faint">Defaults are overridable via DEMO_ADMIN_PASSWORD / DEMO_CITIZEN_PASSWORD.</p>
        </div>
      </form>
    </div>
  );
}

export default function LoginPage() {
  return (
    <Suspense fallback={null}>
      <LoginInner />
    </Suspense>
  );
}
