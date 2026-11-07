/**
 * Roles granted by a sandbox passcode. Node-only (node:crypto); no other server imports so it is unit-testable.
 * - HOMEOWNER_PASSCODE / CONTRACTOR_PASSCODE: one role each (server-enforced role separation).
 * - DEMO_PASSCODE: the presenter, who may act as both roles in a single-screen demo.
 * Hackathon sandbox gate only. NOT identity, accounts, or production authorization.
 */
import { timingSafeEqual } from "node:crypto";
import type { Role } from "./types";

const same = (configured: string, supplied: string) => {
  const a = Buffer.from(configured), b = Buffer.from(supplied);
  return configured.length >= 8 && a.length === b.length && timingSafeEqual(a, b);
};

export function grantedRoles(supplied: string, env: Record<string, string | undefined> = process.env): Role[] {
  const roles = new Set<Role>();
  if (!supplied) return [];
  if (same(env.DEMO_PASSCODE || "", supplied)) { roles.add("homeowner"); roles.add("contractor"); }
  if (same(env.HOMEOWNER_PASSCODE || "", supplied)) roles.add("homeowner");
  if (same(env.CONTRACTOR_PASSCODE || "", supplied)) roles.add("contractor");
  return [...roles];
}
