import "server-only";
import { createClient } from "@supabase/supabase-js";
import type { PunchItem, AuditEvent } from "./types";

export function db() {
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) throw new Error("Supabase is not configured");
  return createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });
}
export function requireDemoAccess(request: Request) {
  const configured = process.env.DEMO_PASSCODE;
  if (!configured || configured.length < 8 || request.headers.get("x-demo-passcode") !== configured)
    throw new Error("Demo passcode required (minimum 8 characters)");
}
export async function itemById(id: string): Promise<PunchItem> {
  const { data, error } = await db().from("punch_items").select("*").eq("id", id).single();
  if (error || !data) throw new Error("Item not found");
  return data as PunchItem;
}
export async function saveItem(id: string, patch: Partial<PunchItem>) {
  const { data, error } = await db().from("punch_items").update({ ...patch, updated_at: new Date().toISOString() }).eq("id", id).select().single();
  if (error || !data) throw new Error(error?.message || "Unable to update item");
  return data as PunchItem;
}
export async function claimItemState(id: string, prior: string, next: string, patch: Record<string, unknown> = {}) {
  const { data, error } = await db().from("punch_items")
    .update({ ...patch, state: next, updated_at: new Date().toISOString() })
    .eq("id", id).eq("state", prior).select().maybeSingle();
  if (error) throw new Error(error.message);
  if (!data) throw new Error("State changed. Refresh before retrying.");
  return data as PunchItem;
}
export async function logEvent(itemId: string, actor: AuditEvent["actor"], action: string, payload: Record<string, unknown> = {}) {
  const { error } = await db().from("audit_events").insert({ item_id: itemId, actor, action, payload });
  if (error) throw new Error(`Audit log failed: ${error.message}`);
}
export async function signedImage(path: string | null) {
  if (!path) return null;
  const { data, error } = await db().storage.from("punchpay-evidence").createSignedUrl(path, 3600);
  if (error) return null;
  return data.signedUrl;
}
export function responseError(error: unknown) {
  const message = error instanceof Error ? error.message : "Request failed";
  const status = /passcode/i.test(message) ? 401 : /not found/i.test(message) ? 404 : 400;
  return Response.json({ error: message }, { status });
}
