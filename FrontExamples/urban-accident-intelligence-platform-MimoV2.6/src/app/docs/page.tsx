import { API_ENDPOINTS, API_VERSION } from "@/lib/apiCatalog";

export const dynamic = "force-dynamic";

const methodColour: Record<string, string> = {
  GET: "var(--cyan)",
  POST: "var(--amber)",
  PATCH: "var(--warn)",
  DELETE: "var(--fatal)",
};

export default function DocsPage() {
  return (
    <main className="h-screen w-screen overflow-y-auto bg-[var(--bg)]">
      <div className="mx-auto max-w-[1080px] px-6 py-10">
        <div className="micro">API reference</div>
        <h1 className="mt-2 text-[39px] leading-[1.02] font-extrabold tracking-[-0.025em] text-[var(--text)]">
          Urban Accident Intelligence
          <span className="block text-[var(--amber)]">REST API v{API_VERSION}</span>
        </h1>
        <p className="mt-4 max-w-[680px] text-[12px] leading-[1.85] text-[var(--text-2)]">
          All spatial payloads use GeoJSON in EPSG:4326; metric operations are performed in a local
          equirectangular frame. Timestamps are ISO-8601 in UTC. Errors return{" "}
          <code className="font-[IBM_Plex_Mono,monospace] text-[var(--cyan)]">
            {"{ error, issues: [{ path, message }] }"}
          </code>{" "}
          with a descriptive HTTP status. Every dataset served by this build is synthetic and labelled as
          such in the response envelope.
        </p>

        <div className="mt-8 border-t border-[var(--rule-strong)]">
          {API_ENDPOINTS.map((e) => (
            <section key={`${e.method}-${e.path}`} className="border-b border-[var(--rule)] py-5">
              <div className="flex flex-wrap items-baseline gap-3">
                <span
                  className="tnum border px-2 py-1 text-[10px] tracking-[0.12em]"
                  style={{ borderColor: methodColour[e.method], color: methodColour[e.method] }}
                >
                  {e.method}
                </span>
                <code className="tnum text-[15px] text-[var(--text)]">{e.path}</code>
                <span className="text-[11px] text-[var(--text-3)]">{e.summary}</span>
              </div>
              <p className="mt-2 max-w-[760px] text-[11px] leading-[1.85] text-[var(--text-2)]">
                {e.description}
              </p>
              {e.params && (
                <table className="mt-3 w-full border-collapse">
                  <thead>
                    <tr>
                      {["Parameter", "In", "Type", "Description"].map((h) => (
                        <th
                          key={h}
                          className="micro border-b border-[var(--rule-strong)] py-1.5 pr-3 text-left font-normal"
                        >
                          {h}
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {e.params.map((p) => (
                      <tr key={p.name} className="border-b border-[var(--rule)]">
                        <td className="tnum py-1.5 pr-3 text-[10px] text-[var(--amber)]">
                          {p.name}
                          {p.required && <span className="text-[var(--fatal)]"> *</span>}
                        </td>
                        <td className="py-1.5 pr-3 text-[10px] text-[var(--text-3)]">{p.in}</td>
                        <td className="tnum py-1.5 pr-3 text-[10px] text-[var(--text-3)]">{p.type}</td>
                        <td className="py-1.5 text-[10px] leading-[1.7] text-[var(--text-2)]">{p.description}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
              <div className="mt-2 text-[10px] text-[var(--text-3)]">
                <span className="micro">Returns</span>
                <span className="ml-2 text-[var(--text-2)]">{e.returns}</span>
              </div>
              {e.example && (
                <code className="mt-2 block font-[IBM_Plex_Mono,monospace] text-[10px] text-[var(--cyan)]">
                  {e.example}
                </code>
              )}
            </section>
          ))}
        </div>

        <p className="mt-8 text-[10px] leading-[1.8] text-[var(--text-3)]">
          Machine-readable catalogue: <code className="text-[var(--cyan)]">GET /api/docs</code>. This build
          runs without PostGIS; the spatial engine is implemented in{" "}
          <code className="text-[var(--cyan)]">src/lib/geo.ts</code> and the PostGIS DDL for the production
          deployment is shipped as <code className="text-[var(--cyan)]">drizzle/0001_postgis_reference.sql</code>.
        </p>
      </div>
    </main>
  );
}
