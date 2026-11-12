"use client";

import { ENDPOINTS } from "@/lib/openapi-spec";
import { Badge, PageHeader, Panel } from "@/components/ui";

const METHOD_TONE: Record<string, "ok" | "accent" | "warn" | "danger" | "neutral"> = {
  GET: "ok",
  POST: "accent",
  PATCH: "warn",
  DELETE: "danger",
};

export default function ApiDocsPage() {
  const tags = [...new Set(ENDPOINTS.map((e) => e.tag))];
  return (
    <div className="scroll-thin flex min-h-0 flex-1 flex-col gap-4 overflow-y-auto p-4">
      <PageHeader
        title="REST API"
        description={
          <>
            JSON over HTTP, rooted at <code className="font-mono text-fg">/api</code>. Geometry is GeoJSON (WGS 84). Timestamps are ISO 8601 UTC. Errors use the envelope{" "}
            <code className="font-mono text-fg">{"{ error: { code, message, details, requestId } }"}</code>. Machine-readable description:{" "}
            <a href="/api/openapi.json" className="text-accent underline-offset-2 hover:underline">
              /api/openapi.json
            </a>
            .
          </>
        }
      />
      {tags.map((tag) => (
        <Panel key={tag} title={tag} subtitle={`${ENDPOINTS.filter((e) => e.tag === tag).length} endpoint(s)`}>
          <div className="flex flex-col divide-y divide-line">
            {ENDPOINTS.filter((e) => e.tag === tag).map((e) => (
              <div key={`${e.method} ${e.path}`} className="flex flex-col gap-1.5 py-3 first:pt-0 last:pb-0">
                <div className="flex flex-wrap items-center gap-2">
                  <Badge tone={METHOD_TONE[e.method] ?? "neutral"} className="!font-mono">
                    {e.method}
                  </Badge>
                  <code className="font-mono text-[12.5px]">{e.path}</code>
                  <Badge tone={e.auth === "admin" ? "warn" : e.auth === "user" ? "accent" : "muted"}>
                    {e.auth === "public" ? "public" : e.auth === "user" ? "signed-in" : "administrator"}
                  </Badge>
                </div>
                <p className="text-[12px] text-muted">{e.summary}</p>
                {e.query?.length ? (
                  <ul className="mt-0.5 flex flex-col gap-0.5 text-[11.5px]">
                    {e.query.map((q) => (
                      <li key={q.name}>
                        <code className="font-mono text-fg">{q.name}</code> <span className="text-faint">— {q.description}</span>
                      </li>
                    ))}
                  </ul>
                ) : null}
                {e.body ? (
                  <div className="text-[11.5px] text-muted">
                    Body: <code className="font-mono text-[11px] text-fg">{e.body}</code>
                  </div>
                ) : null}
                <div className="text-[11px] text-faint">Response: {e.responses}</div>
              </div>
            ))}
          </div>
        </Panel>
      ))}
    </div>
  );
}
