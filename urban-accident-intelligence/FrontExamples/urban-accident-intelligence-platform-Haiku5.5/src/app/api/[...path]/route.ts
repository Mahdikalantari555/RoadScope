import { handleApi } from "@/server/api/router";

export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ path: string[] }> };

async function handle(req: Request, ctx: Ctx): Promise<Response> {
  const { path } = await ctx.params;
  return handleApi(req, path ?? []);
}

export const GET = handle;
export const POST = handle;
export const PATCH = handle;
export const DELETE = handle;
