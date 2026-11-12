/**
 * Minimal structured logger (JSON lines). Swap for pino/winston without touching call sites.
 */
type Level = "debug" | "info" | "warn" | "error";

const ORDER: Record<Level, number> = { debug: 10, info: 20, warn: 30, error: 40 };
const threshold = ORDER[(process.env.LOG_LEVEL as Level) ?? "info"] ?? ORDER.info;

function serialise(value: unknown): unknown {
  if (value instanceof Error) {
    return { name: value.name, message: value.message, stack: process.env.NODE_ENV === "production" ? undefined : value.stack };
  }
  return value;
}

function emit(level: Level, msg: string, ctx?: Record<string, unknown>): void {
  if (ORDER[level] < threshold) return;
  const entry: Record<string, unknown> = { ts: new Date().toISOString(), level, msg };
  if (ctx) {
    for (const [k, v] of Object.entries(ctx)) entry[k] = serialise(v);
  }
  const line = JSON.stringify(entry);
  if (level === "error") console.error(line);
  else console.log(line);
}

export const logger = {
  debug: (msg: string, ctx?: Record<string, unknown>) => emit("debug", msg, ctx),
  info: (msg: string, ctx?: Record<string, unknown>) => emit("info", msg, ctx),
  warn: (msg: string, ctx?: Record<string, unknown>) => emit("warn", msg, ctx),
  error: (msg: string, ctx?: Record<string, unknown>) => emit("error", msg, ctx),
};
