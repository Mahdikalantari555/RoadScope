import type { Role } from "./roles";

/** Client-safe demo credential catalogue (no secrets, synthetic environment only). */
export const DEMO_ACCOUNTS: { email: string; password: string; role: Role; name: string }[] = [
  { email: "admin@vantia.example", password: "admin1234", role: "admin", name: "Mara Okafor" },
  { email: "analyst@vantia.example", password: "analyst1234", role: "analyst", name: "Ivo Lindqvist" },
  { email: "citizen@vantia.example", password: "citizen1234", role: "citizen", name: "Rae Molenaar" },
];
