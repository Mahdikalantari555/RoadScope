export type Role = "citizen" | "analyst" | "admin";

export const ROLE_DESCRIPTIONS: Record<Role, string> = {
  citizen: "Submit reports, track their status and explore published verification states.",
  analyst: "Read access to verified data, spatial analysis, risk scenarios and exports.",
  admin: "Full moderation, record editing, dataset management and audit trail.",
};
