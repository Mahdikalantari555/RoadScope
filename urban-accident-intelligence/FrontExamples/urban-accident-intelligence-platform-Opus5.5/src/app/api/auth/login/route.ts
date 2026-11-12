import { eq } from "drizzle-orm";
import { cookies } from "next/headers";
import { z } from "zod";
import { db } from "@/db";
import { users } from "@/db/schema";
import { SESSION_COOKIE, sessionCookieOptions, signSession, verifyPassword } from "@/lib/server/auth";
import { audit } from "@/lib/server/data";
import { ApiError, handle, parseBody } from "@/lib/server/http";
import { ensureSeeded } from "@/lib/server/seed";

export const dynamic = "force-dynamic";

export const POST = handle(async (req: Request) => {
  await ensureSeeded();
  const b = await parseBody(req, z.object({ email: z.string().email(), password: z.string().min(1).max(200) }));
  const [u] = await db.select().from(users).where(eq(users.email, b.email.toLowerCase()));
  if (!u || !verifyPassword(b.password, u.passwordHash)) throw new ApiError(401, "Invalid email or password");
  (await cookies()).set(SESSION_COOKIE, signSession(u.id), sessionCookieOptions);
  await audit(u.id, "auth.login", "user", u.id);
  return Response.json({ id: u.id, email: u.email, displayName: u.displayName, role: u.role });
});
