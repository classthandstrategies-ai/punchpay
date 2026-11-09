/**
 * In-memory Store for the offline simulation and the tests. Implements the same atomic
 * compare-and-set contract as the Supabase store, and mirrors the key database guards from
 * supabase/migrations (decision finality, evidence lock, immutable PayPal IDs, terminal states),
 * so the flows meet the same refusals they would meet in Postgres.
 */
import type { AuditEvent, ItemState, PunchItem } from "../types";
import type { Actor, Store } from "../flows.ts";
import { HttpError } from "../errors.ts";

const ALLOWED: Record<ItemState, ItemState[]> = {
  awaiting_authorization: ["awaiting_authorization", "order_created"],
  order_created: ["order_created", "awaiting_authorization", "authorized"],
  authorized: ["authorized", "submitted", "hold_ended"],
  submitted: ["submitted", "reviewed", "hold_ended"],
  // `reviewed -> captured/voided`: a reconcile may find a late capture or void that PayPal processed
  // after the item was returned to `reviewed`. The guards below still require the matching decision.
  reviewed: ["reviewed", "submitted", "capture_pending", "void_pending", "hold_ended", "captured", "voided"],
  capture_pending: ["capture_pending", "captured", "payment_error", "reviewed", "hold_ended"],
  void_pending: ["void_pending", "voided", "payment_error", "reviewed", "hold_ended"],
  payment_error: ["payment_error", "captured", "capture_pending", "voided", "reviewed", "hold_ended"],
  captured: ["captured"], voided: ["voided"], hold_ended: ["hold_ended"]
};
const refuse = (why: string) => { throw Object.assign(new HttpError(409, "The database refused this change because it would break the payment rules. Refresh and check the item."), { guard: why }); };

export function guard(old: PunchItem, next: PunchItem) {
  if (!ALLOWED[old.state].includes(next.state)) refuse(`illegal ${old.state} -> ${next.state}`);
  if (next.amount_cents !== old.amount_cents) refuse("amount immutable");
  for (const k of ["paypal_auth_id", "paypal_capture_id"] as const) if (old[k] && next[k] !== old[k]) refuse(`${k} immutable`);
  if (old.homeowner_decision && next.homeowner_decision !== old.homeowner_decision) refuse("decision final");
  const evidenceChanged = next.before_path !== old.before_path || next.after_path !== old.after_path || JSON.stringify(next.ai_review) !== JSON.stringify(old.ai_review);
  if (evidenceChanged && (old.homeowner_decision || ["captured", "voided", "capture_pending", "void_pending", "payment_error", "hold_ended"].includes(old.state))) refuse("evidence locked");
  if (next.state === "captured" && (!next.paypal_capture_id || next.homeowner_decision !== "accepted")) refuse("captured needs capture id + acceptance");
  if (next.state === "voided" && next.homeowner_decision !== "rejected") refuse("voided needs rejection");
  if (next.state === "capture_pending" && next.homeowner_decision !== "accepted") refuse("capture_pending needs acceptance");
  if (next.state === "void_pending" && next.homeowner_decision !== "rejected") refuse("void_pending needs rejection");
  if (["submitted", "reviewed"].includes(next.state) && (!next.before_path || !next.after_path)) refuse("review needs photos");
  if (!["awaiting_authorization", "order_created"].includes(next.state) && !next.paypal_auth_id) refuse("hold before evidence");
}

export class MemoryStore implements Store {
  items = new Map<string, PunchItem>();
  audit: AuditEvent[] = [];
  /** When true, audit writes fail (to prove a logging failure never re-issues money movement). */
  failAudit = false;
  private seq = 0;
  private clock: () => number;

  constructor(items: PunchItem[], { now = Date.now }: { now?: () => number } = {}) {
    this.clock = now;
    for (const item of items) this.items.set(item.id, structuredClone(item));
  }

  async get(id: string) {
    const item = this.items.get(id);
    if (!item) throw new HttpError(404, "Item not found");
    return structuredClone(item);
  }

  async claim(id: string, prior: ItemState | ItemState[], next: ItemState, patch: Partial<PunchItem> = {}, match: Partial<Record<"before_path" | "after_path", string | null>> = {}) {
    // Synchronous from read to write: atomic with respect to every other async caller.
    const current = this.items.get(id);
    if (!current) throw new HttpError(404, "Item not found");
    const priors = Array.isArray(prior) ? prior : [prior];
    const matches = Object.entries(match).every(([k, v]) => current[k as "before_path" | "after_path"] === v);
    if (!priors.includes(current.state) || !matches) throw new HttpError(409, "This item changed in another session. Refresh before retrying.");
    const updated: PunchItem = { ...current, ...structuredClone(patch), state: next, updated_at: new Date(this.clock()).toISOString() };
    guard(current, updated);
    this.items.set(id, updated);
    return structuredClone(updated);
  }

  async record(itemId: string, actor: Actor, action: string, payload: Record<string, unknown> = {}) {
    if (this.failAudit) return; // mirrors recordEvent: failures are swallowed and logged, never thrown
    this.seq += 1;
    this.audit.unshift({ id: `sim-event-${this.seq}`, item_id: itemId, actor, action, payload: structuredClone(payload), created_at: new Date(this.clock()).toISOString() });
  }

  list() { return [...this.items.values()].map((i) => structuredClone(i)).sort((a, b) => b.amount_cents - a.amount_cents); }
}
