import { currentUser } from "@/lib/server/auth";
import { handle } from "@/lib/server/http";

export const dynamic = "force-dynamic";

export const GET = handle(async () => Response.json({ user: await currentUser() }));
