export type ItemState =
  | "awaiting_authorization" | "order_created" | "authorized" | "submitted"
  | "reviewed" | "capture_pending" | "captured" | "void_pending" | "voided" | "payment_error";
export type CriterionResult = "supported" | "uncertain" | "not_supported";
export type AIReport = {
  assessment: "appears_satisfied" | "insufficient_evidence" | "visible_concern";
  summary: string;
  criteria: { criterion: string; result: CriterionResult; evidence: string }[];
  observations: string[];
  uncertainty: string[];
  views_comparable?: "yes" | "partly" | "no";
  model: string;
  reviewed_at: string;
  source: "live_model" | "sample_fixture";
};
export type PunchItem = {
  id: string;
  project_id: string;
  slug: string;
  title: string;
  location: string;
  description: string;
  acceptance_criteria: string;
  amount_cents: number;
  currency: "USD";
  state: ItemState;
  paypal_order_id: string | null;
  paypal_auth_id: string | null;
  paypal_capture_id: string | null;
  paypal_status: string | null;
  payee_merchant_id: string | null;
  before_path: string | null;
  after_path: string | null;
  before_url?: string | null;
  after_url?: string | null;
  ai_review: AIReport | null;
  homeowner_decision: "accepted" | "rejected" | null;
  decision_at: string | null;
  order_attempt: number;
  last_error: string | null;
  updated_at?: string;
};
export type AuditEvent = { id: string; item_id: string; action: string; actor: string; created_at: string; payload: Record<string, unknown> };
