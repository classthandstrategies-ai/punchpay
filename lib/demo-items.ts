import type { PunchItem } from "./types";

/** The two-item story, identical to supabase/seed.sql. Used for the design preview and the simulation. */
const base = {
  project_id: "5ab5943f-3c10-498e-82a0-029c3837684a", currency: "USD" as const, state: "awaiting_authorization" as const,
  paypal_order_id: null, paypal_auth_id: null, paypal_capture_id: null, paypal_status: null, payee_merchant_id: null,
  before_path: null, after_path: null, before_url: null, after_url: null, ai_review: null, homeowner_decision: null,
  decision_at: null, order_attempt: 1, last_error: null, paypal_auth_expires_at: null
};
export const DEMO_ITEMS: PunchItem[] = [
  { ...base, id: "d28cf4a1-2c7a-49c5-9821-115cbe6c1d11", slug: "paint", title: "Paint touch-up", location: "Living room · North wall", description: "Repair the scuffed paint beside the window.", acceptance_criteria: "Scuff no longer visibly apparent; finish looks uniform with the surrounding wall; after photo shows the same wall area as the before photo.", amount_cents: 3000 },
  { ...base, id: "d28cf4a1-2c7a-49c5-9821-115cbe6c1d22", slug: "tile", title: "Tile repair", location: "Kitchen · Backsplash", description: "Replace the cracked tile near the sink.", acceptance_criteria: "Replaced tile appears uncracked; tile sits flush and aligned with adjacent tiles; grout lines look continuous around the tile.", amount_cents: 2000 }
];
export const criteriaOf = (item: Pick<PunchItem, "acceptance_criteria">) => item.acceptance_criteria.split(/;\s*/).map((c) => c.trim().replace(/\.$/, "")).filter(Boolean);
