/**
 * REST router. A single catch-all Next.js route delegates to this table-driven router, so every
 * endpoint is declared once, validated in its handler, and documented in the OpenAPI document.
 */
import { randomUUID } from "node:crypto";
import { ensureReady } from "@/server/bootstrap";
import { errorResponse, jsonResponse, type RouteContext } from "@/server/http";
import { logger } from "@/server/logger";
import { accidentHandlers } from "./handlers-accidents";
import { analysisHandlers } from "./handlers-analysis";
import { adminHandlers } from "./handlers-admin";
import { OPENAPI_DOCUMENT } from "@/lib/openapi-spec";

type Handler = (ctx: RouteContext) => Promise<Response>;

interface Route {
  method: string;
  path: string;
  pattern: RegExp;
  keys: string[];
  handler: Handler;
}

function compile(method: string, path: string, handler: Handler): Route {
  const keys: string[] = [];
  const source = path.replace(/:([a-zA-Z]+)/g, (_, key: string) => {
    keys.push(key);
    return "([^/]+)";
  });
  return { method, path, pattern: new RegExp(`^${source}$`), keys, handler };
}

const ROUTES: Route[] = [
  compile("GET", "/meta", adminHandlers.meta),
  compile("GET", "/auth/me", adminHandlers.me),
  compile("POST", "/auth/login", adminHandlers.login),
  compile("POST", "/auth/logout", adminHandlers.logout),

  compile("GET", "/accidents", accidentHandlers.list),
  compile("POST", "/accidents", accidentHandlers.createReport),
  compile("GET", "/accidents/geojson", accidentHandlers.geojson),
  compile("POST", "/accidents/check-duplicates", accidentHandlers.checkDuplicates),
  compile("GET", "/accidents/track", accidentHandlers.track),
  compile("GET", "/accidents/:id", accidentHandlers.detail),
  compile("PATCH", "/accidents/:id", accidentHandlers.patch),
  compile("POST", "/accidents/:id/review", accidentHandlers.review),
  compile("POST", "/accidents/:id/attachments", accidentHandlers.upload),
  compile("GET", "/attachments/:id", accidentHandlers.attachment),

  compile("GET", "/segments", analysisHandlers.segments),
  compile("GET", "/segments/:id", analysisHandlers.segmentDetail),
  compile("GET", "/dashboard", analysisHandlers.dashboard),
  compile("GET", "/quality", analysisHandlers.quality),
  compile("GET", "/network", analysisHandlers.network),
  compile("GET", "/analysis/jobs", analysisHandlers.listJobs),
  compile("POST", "/analysis/jobs", analysisHandlers.createJob),
  compile("GET", "/analysis/jobs/:id", analysisHandlers.getJob),
  compile("GET", "/analysis/jobs/:id/export", analysisHandlers.exportJob),

  compile("GET", "/datasets", adminHandlers.listDatasets),
  compile("POST", "/datasets/synthetic", adminHandlers.generateDataset),
  compile("POST", "/datasets/import", adminHandlers.importDataset),
  compile("PATCH", "/datasets/:id", adminHandlers.patchDataset),
  compile("DELETE", "/datasets/:id", adminHandlers.deleteDataset),
  compile("GET", "/audit", adminHandlers.audit),

  compile("GET", "/openapi.json", async () => jsonResponse(OPENAPI_DOCUMENT)),
];

function parseId(value: string): number {
  const n = Number(value);
  if (!Number.isInteger(n) || n <= 0) throw new Error(`Invalid numeric identifier: ${value}`);
  return n;
}

export { parseId };

export async function handleApi(req: Request, segments: string[]): Promise<Response> {
  const requestId = randomUUID().slice(0, 8);
  const started = Date.now();
  const url = new URL(req.url);
  const path = `/${segments.join("/")}`.replace(/\/+$/, "") || "/";
  try {
    if (path !== "/openapi.json") await ensureReady();
    const pathMatches = ROUTES.filter((r) => r.pattern.test(path));
    if (pathMatches.length === 0) {
      return jsonResponse({ error: { code: "not_found", message: "Endpoint not found", details: null, requestId } }, { status: 404 });
    }
    const route = pathMatches.find((r) => r.method === req.method.toUpperCase());
    if (!route) {
      return jsonResponse({ error: { code: "method_not_allowed", message: `Method ${req.method} is not allowed for ${path}`, details: null, requestId } }, { status: 405 });
    }
    const match = route.pattern.exec(path)!;
    const params: Record<string, string> = {};
    route.keys.forEach((k, i) => (params[k] = decodeURIComponent(match[i + 1]!)));
    const response = await route.handler({ req, params, url, requestId });
    logger.info("api.request", { requestId, method: req.method, path, status: response.status, ms: Date.now() - started });
    return response;
  } catch (error) {
    logger.warn("api.error", { requestId, method: req.method, path });
    return errorResponse(error, requestId);
  }
}


