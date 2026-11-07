import "server-only";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import type { PunchItem, AuditEvent, ItemState, Role } from "./types";
import { HttpError } from "./errors";
import { grantedRoles } from "./access";
import type { Store } from "./flows";

export { HttpError };
export const EVIDENCE_BUCKET = "punchpay-evidence";
let client: SupabaseClient | null = null;

export function db() {
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) throw new HttpError(503, "Supabase is not configured");
  if (!client) client = createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });
  return client;
}
export function backendConfigured() {
  return !!(process.env.SUPABASE_URL && process.env.SUPABASE_SERVICE_ROLE_KEY);
}

/** Requires a valid passcode; with `role`, also requires that the passcode grants that role. */
export function requireAccess(request: Request, role?: Role): Role[] {
  const roles = grantedRoles(request.headers.get("x-demo-passcode") || "");
  if (!roles.length) throw new HttpError(401, "Demo passcode required");
  if (role && !roles.includes(role)) throw new HttpError(403, `Only the ${role} can do this. Unlock with the ${role} passcode.`);
  return roles;
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export async function itemById(id: string): Promise<PunchItem> {
  if (!UUID.test(id)) throw new HttpError(404, "Item not found");
  const { data, error } = await db().from("punch_items").select("*").eq("id", id).maybeSingle();
  if (error) { console.error(`[punchpay] read ${id}: ${error.message}`); throw new HttpError(500, "Database error"); }
  if (!data) throw new HttpError(404, "Item not found");
  return data as PunchItem;
}

/**
 * Atomic compare-and-set on item state. Only one concurrent request can win a transition,
 * which is what prevents double capture / double void from the app side.
 */
export async function claimItemState(id: string, prior: ItemState | ItemState[], next: ItemState, patch: Partial<PunchItem> = {}, match: Partial<Record<"before_path" | "after_path", string | null>> = {}) {
  const priors = Array.isArray(prior) ? prior : [prior];
  let query = db().from("punch_items")
    .update({ ...patch, state: next, updated_at: new Date().toISOString() })
    .eq("id", id).in("state", priors);
  for (const [column, value] of Object.entries(match)) query = value === null ? query.is(column, null) : query.eq(column, value);
  const { data, error } = await query.select().maybeSingle();
  if (error) {
    console.error(`[punchpay] update ${id} ${priors.join("|")} -> ${next} refused: ${error.code} ${error.message}`);
    // P0001 = state-machine trigger, 23514 = check constraint, 23505 = duplicate PayPal ID. Details stay in server logs.
    if (["P0001", "23514", "23505"].includes(error.code)) throw new HttpError(409, "The database refused this change because it would break the payment rules. Refresh and check the item.");
    throw new HttpError(500, "Database error");
  }
  if (!data) throw new HttpError(409, "This item changed in another session. Refresh before retrying.");
  return data as PunchItem;
}

/**
 * Best-effort audit log. Called AFTER PayPal has confirmed a money movement, so a logging
 * failure must never throw (a throw could cause a client retry or mark a paid item as failed).
 */
export async function recordEvent(itemId: string, actor: AuditEvent["actor"], action: string, payload: Record<string, unknown> = {}) {
  try {
    const { error } = await db().from("audit_events").insert({ item_id: itemId, actor, action, payload });
    if (error) console.error(`[punchpay] audit log failed for ${action}: ${error.message}`);
  } catch (error) {
    console.error(`[punchpay] audit log failed for ${action}:`, error);
  }
}

export const supabaseStore: Store = { get: itemById, claim: claimItemState, record: recordEvent };

export async function signedImage(path: string | null) {
  if (!path) return null;
  const { data, error } = await db().storage.from(EVIDENCE_BUCKET).createSignedUrl(path, 900);
  if (error) return null;
  return data.signedUrl;
}

/** Only PunchPay's own messages reach the browser; everything else is logged and replaced with generic text. */
export function responseError(error: unknown) {
  if (error instanceof HttpError) return Response.json({ error: error.message }, { status: error.status });
  if (error instanceof Error && error.name === "PayPalError") {
    console.error("[punchpay]", error.message);
    return Response.json({ error: error.message }, { status: 502 });
  }
  if (error instanceof Error && error.name === "VerificationError") return Response.json({ error: error.message }, { status: 422 });
  if (error instanceof Error && (error.name === "TimeoutError" || error.name === "AbortError")) {
    console.error("[punchpay] timeout", error.message);
    return Response.json({ error: "PayPal did not respond in time. Nothing was retried; check status before trying again." }, { status: 504 });
  }
  console.error("[punchpay] unexpected", error);
  return Response.json({ error: "Unexpected server error" }, { status: 500 });
}
