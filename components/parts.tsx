"use client";
import { useRef } from "react";
import { Check, CircleAlert, Minus, Upload, X } from "lucide-react";
import type { AIReport, AuditEvent, PunchItem } from "@/lib/types";

export const money = (cents: number) => `$${(cents / 100).toFixed(2)}`;
export const cx = (...p: (string | false | null | undefined)[]) => p.filter(Boolean).join(" ");
export const when = (iso: string) => new Date(iso).toLocaleString("en-US", { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });

export const STATE_LABEL: Record<PunchItem["state"], { text: string; tone: "open" | "active" | "wait" | "paid" | "released" | "alert" }> = {
  awaiting_authorization: { text: "Awaiting funds hold", tone: "open" },
  order_created: { text: "Awaiting PayPal approval", tone: "wait" },
  authorized: { text: "Funds held · awaiting photos", tone: "active" },
  submitted: { text: "Photos in · awaiting review", tone: "active" },
  reviewed: { text: "Ready for homeowner", tone: "wait" },
  capture_pending: { text: "Capture in progress", tone: "wait" },
  captured: { text: "Accepted · Paid", tone: "paid" },
  void_pending: { text: "Release in progress", tone: "wait" },
  voided: { text: "Rejected · Released", tone: "released" },
  payment_error: { text: "Needs reconciliation", tone: "alert" }
};

export function StatusTag({ state }: { state: PunchItem["state"] }) {
  const s = STATE_LABEL[state];
  return <span className={cx("status-tag", `tone-${s.tone}`)}><i aria-hidden="true" />{s.text}</span>;
}

const EVENT_LABEL: Record<string, string> = {
  order_created: "PayPal order created for this item (AUTHORIZE)",
  order_abandoned: "Unapproved PayPal order replaced",
  authorization_verified: "Homeowner approved · funds held by PayPal",
  authorization_recovered: "Authorization recovered from PayPal",
  evidence_before_uploaded: "Before photo submitted",
  evidence_after_uploaded: "After photo submitted",
  evidence_reviewed: "Advisory AI review recorded",
  decision_accepted: "Homeowner accepted the work",
  decision_rejected: "Homeowner rejected the work",
  capture_verified: "Payment captured · PayPal reports COMPLETED",
  capture_pending_at_paypal: "Capture submitted · PayPal reports PENDING",
  void_verified: "Hold released · PayPal reports VOIDED",
  payment_outcome_unconfirmed: "Payment response not confirmed · parked for reconciliation",
  reconciled_capture: "Reconciled with PayPal · capture",
  reconciled_void: "Reconciled with PayPal · void",
  reconciled_no_movement: "Reconciled · PayPal confirms no money moved"
};
const ACTOR: Record<string, string> = { homeowner: "Homeowner", contractor: "Contractor", ai: "Claude (advisory)", paypal: "PayPal sandbox", system: "PunchPay" };

function eventDetail(e: AuditEvent) {
  const p = e.payload as Record<string, string | undefined>;
  return p.capture_id || p.authorization_id || p.order_id || (p.assessment ? p.assessment.replaceAll("_", " ") : "") || "";
}

export function Timeline({ events, items, compact }: { events: AuditEvent[]; items?: PunchItem[]; compact?: boolean }) {
  if (!events.length) return <p className="empty-line">Nothing recorded yet. Every hold, photo, review and decision is appended here.</p>;
  const title = (id: string) => items?.find((i) => i.id === id)?.title;
  return <ol className={cx("timeline", compact && "is-compact")}>
    {events.map((e) => <li key={e.id} className={`actor-${e.actor}`}>
      <span className="tl-dot" aria-hidden="true" />
      <div className="tl-body">
        <p className="tl-what">{EVENT_LABEL[e.action] || e.action.replaceAll("_", " ")}</p>
        <p className="tl-meta">
          <span>{ACTOR[e.actor] || e.actor}</span>
          {items && title(e.item_id) && <span>{title(e.item_id)}</span>}
          <time dateTime={e.created_at}>{when(e.created_at)}</time>
          {eventDetail(e) && <code>{eventDetail(e)}</code>}
        </p>
      </div>
    </li>)}
  </ol>;
}

export function EvidencePane({ stage, src, hasPhoto, canUpload, busy, onUpload }: { stage: "before" | "after"; src?: string | null; hasPhoto: boolean; canUpload: boolean; busy: boolean; onUpload: (f: File) => void }) {
  const input = useRef<HTMLInputElement>(null);
  const label = stage === "before" ? "Before" : "After";
  return <figure className={cx("evidence", src && "has-image")}>
    <div className="evidence-frame">
      {src ? <img src={src} alt={`${label} photo submitted by the contractor`} /> :
        <div className="evidence-empty"><span className="crosshair" aria-hidden="true" /><span>{hasPhoto ? "Photo stored · link expired, refresh" : `No ${label.toLowerCase()} photo yet`}</span></div>}
      <span className="evidence-corner">{stage === "before" ? "A" : "B"}</span>
    </div>
    <figcaption>
      <span><b>{label}</b>{stage === "before" ? "Condition reported" : "Condition after fix"}</span>
      {canUpload && <>
        <button type="button" className="text-button" disabled={busy} onClick={() => input.current?.click()}><Upload size={14} aria-hidden="true" />{src || hasPhoto ? "Replace" : "Upload"}</button>
        <input ref={input} type="file" accept="image/jpeg,image/png,image/webp" hidden aria-label={`Upload ${label.toLowerCase()} photo`}
          onChange={(e) => { const f = e.target.files?.[0]; if (f) onUpload(f); e.target.value = ""; }} />
      </>}
    </figcaption>
  </figure>;
}

const VERDICT: Record<AIReport["assessment"], { text: string; tone: string }> = {
  appears_satisfied: { text: "Visible evidence appears to meet the criteria", tone: "good" },
  insufficient_evidence: { text: "Not enough visible evidence to say", tone: "unsure" },
  visible_concern: { text: "Visible concern against the criteria", tone: "concern" }
};

export function AdvisoryReport({ report }: { report: AIReport }) {
  const v = VERDICT[report.assessment];
  return <div className={cx("report", `verdict-${v.tone}`)}>
    <p className="report-verdict">{v.text}</p>
    <p className="report-summary">{report.summary}</p>
    <ul className="criteria-results">
      {report.criteria.map((c, i) => <li key={i} className={`r-${c.result}`}>
        <span className="r-mark" aria-label={c.result.replace("_", " ")}>{c.result === "supported" ? <Check size={13} /> : c.result === "not_supported" ? <X size={13} /> : <Minus size={13} />}</span>
        <div><p className="r-criterion">{c.criterion}</p><p className="r-evidence">{c.evidence}</p></div>
      </li>)}
    </ul>
    {report.observations.length > 0 && <div className="report-notes"><h5>Also visible</h5><ul>{report.observations.map((o, i) => <li key={i}>{o}</li>)}</ul></div>}
    <div className="report-notes is-limits"><h5><CircleAlert size={13} aria-hidden="true" /> What these photos cannot show</h5><ul>{report.uncertainty.map((o, i) => <li key={i}>{o}</li>)}{report.views_comparable && report.views_comparable !== "yes" && <li>Before and after views are {report.views_comparable === "no" ? "not" : "only partly"} comparable.</li>}</ul></div>
    <p className="report-source">{report.source === "live_model" ? `Live analysis · ${report.model}` : "Sample fixture · not a live model"} · {when(report.reviewed_at)} · Advisory, not a certification or inspection</p>
  </div>;
}

export function Ledger({ items }: { items: PunchItem[] }) {
  return <div className="ledger-wrap"><table className="ledger">
    <thead><tr><th scope="col">Item</th><th scope="col" className="num">Amount</th><th scope="col">Hold</th><th scope="col">Outcome</th><th scope="col">PayPal reference</th></tr></thead>
    <tbody>{items.map((i) => {
      const outcome = i.state === "captured" ? "Captured" : i.state === "voided" ? "Voided" : i.state === "payment_error" ? "Unconfirmed" : i.state.endsWith("_pending") ? "In progress" : "Open";
      return <tr key={i.id}>
        <th scope="row">{i.title}<small>{i.location}</small></th>
        <td className="num" data-label="Amount">{money(i.amount_cents)}</td>
        <td data-label="Hold">{i.paypal_auth_id ? "Authorized" : i.paypal_order_id ? "Awaiting approval" : "Not placed"}</td>
        <td data-label="Outcome"><span className={cx("ledger-outcome", `o-${outcome.toLowerCase().replace(" ", "-")}`)}>{outcome}</span>{i.paypal_status && <small>PayPal: {i.paypal_status}</small>}</td>
        <td className="refs" data-label="PayPal reference">
          {i.paypal_order_id && <span>Order <code>{i.paypal_order_id}</code></span>}
          {i.paypal_auth_id && <span>Auth <code>{i.paypal_auth_id}</code></span>}
          {i.paypal_capture_id && <span>Capture <code>{i.paypal_capture_id}</code></span>}
          {i.payee_merchant_id && <span>Payee <code>{i.payee_merchant_id}</code></span>}
          {!i.paypal_order_id && <span className="muted">None yet</span>}
        </td>
      </tr>;
    })}</tbody>
  </table></div>;
}
