import path from "node:path";

/** Runtime configuration read from environment variables (see .env.example). */
export const config = {
  get uploadDir(): string {
    return path.resolve(process.env.UPLOAD_DIR ?? "./data/uploads");
  },
  dailyReportLimit: Number(process.env.DAILY_REPORT_LIMIT ?? 25),
  maxUploadBytes: 8 * 1024 * 1024,
  maxAttachmentsPerReport: 5,
  cookieSecure: process.env.COOKIE_SECURE === "true",
  adminEmail: process.env.ADMIN_EMAIL ?? "",
  adminPassword: process.env.ADMIN_PASSWORD ?? "",
  demoUserEmail: process.env.DEMO_USER_EMAIL ?? "",
  demoUserPassword: process.env.DEMO_USER_PASSWORD ?? "",
  seed: Number(process.env.DEMO_SEED ?? 20260101),
};
