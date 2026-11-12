import { Suspense } from "react";
import { LoginForm } from "@/components/auth/LoginForm";

export const dynamic = "force-dynamic";

export default function LoginPage() {
  return (
    <Suspense fallback={<div className="p-4 text-[12px] text-muted">Loading sign-in…</div>}>
      <LoginForm />
    </Suspense>
  );
}
