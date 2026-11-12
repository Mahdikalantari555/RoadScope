/** Admin-facing re-exports kept separate so route handlers import one module. */
export {
  loadAccidents,
  loadAuditLogs,
  loadMetadata,
  loadModerationQueue,
} from "./data";

const ALLOWED = ["reported", "verified", "rejected", "duplicate"];

export function parseStatusParam(value: string | null): string[] {
  if (!value) return ["reported"];
  const statuses = value
    .split(",")
    .map((s) => s.trim())
    .filter((s) => ALLOWED.includes(s));
  return statuses.length > 0 ? statuses : ["reported"];
}
