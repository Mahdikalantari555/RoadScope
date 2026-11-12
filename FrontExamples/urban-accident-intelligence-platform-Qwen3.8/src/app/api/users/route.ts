import { db } from "@/db";
import { asc } from "drizzle-orm";
import { users } from "@/db/schema";
import { seedReferenceData } from "@/lib/bootstrap";
import { handleApiError, json } from "@/lib/api";
import { PERSONAS } from "@/lib/domain/taxonomy";

export const dynamic = "force-dynamic";

/** GET /api/users — persona registry used to assume a role in the demonstrator. */
export async function GET() {
  try {
    await seedReferenceData();
    const rows = await db.select().from(users).orderBy(asc(users.role), asc(users.displayName));
    return json({
      personas: PERSONAS.map((p) => ({ role: p.role, displayName: p.displayName, email: p.email, permissions: p.permissions })),
      users: rows.map((u) => ({
        id: u.id,
        email: u.email,
        displayName: u.displayName,
        role: u.role,
        permissions: u.permissions,
        synthetic: u.isSyntheticActor,
      })),
      citizenContributors: rows.filter((u) => u.isSyntheticActor).length,
    });
  } catch (err) {
    return handleApiError(err);
  }
}
