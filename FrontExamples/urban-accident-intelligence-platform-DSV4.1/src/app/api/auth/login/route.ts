import { eq } from "drizzle-orm";
import { z } from "zod";
import { cookies } from "next/headers";
import { db } from "@/db";
import { users } from "@/db/schema";
import { jsonError, jsonOk, logAudit } from "@/lib/api";
import { encodeSession, newSession, SESSION_COOKIE, verifyPassword } from "@/lib/auth";
import { ensureBootstrap } from "@/lib/bootstrap";

export const dynamic = "force-dynamic";

const schema = z.object({ email: z.string().email(), password: z.string().min(4).max(120) });

export async function POST(request: Request) {
  try {
    await ensureBootstrap();
    const parsed = schema.safeParse(await request.json());
    if (!parsed.success) return jsonError("Enter a valid email and password.", 422);
    const rows = await db.select().from(users).where(eq(users.email, parsed.data.email.toLowerCase())).limit(1);
    if (rows.length === 0) return jsonError("Invalid credentials.", 401);
    const user = rows[0];
    if (!verifyPassword(parsed.data.password, user.passwordHash)) return jsonError("Invalid credentials.", 401);
    const session = newSession(user);
    const store = await cookies();
    store.set(SESSION_COOKIE, encodeSession(session), {
      httpOnly: true,
      sameSite: "lax",
      path: "/",
      secure: process.env.NODE_ENV === "production",
      maxAge: 60 * 60 * 12,
    });
    await logAudit({ actor: user.email, action: "auth.login", entityType: "user", entityId: String(user.id) });
    return jsonOk({ ok: true, user: { name: user.displayName, email: user.email, role: user.role } });
  } catch (error) {
    console.error("login failed", error);
    return jsonError("Sign-in failed. Try again.", 500);
  }
}
