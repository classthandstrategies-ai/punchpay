"use client";
import { useCallback, useEffect, useId, useRef, useState, type ReactNode } from "react";
import { Check, CircleAlert, Columns2, HelpCircle, Minus, SlidersHorizontal, Upload, X } from "lucide-react";
import type { AIReport, AuditEvent, CriterionResult, PunchItem } from "@/lib/types";

export const money = (cents: number) => `$${(cents / 100).toFixed(2)}`;
export const cx = (...p: (string | false | null | undefined)[]) => p.filter(Boolean).join(" ");
export function missingEvidence(item: Pick<PunchItem, "before_path" | "after_path">) {
  if (!item.before_path && !item.after_path) return "Missing evidence: no before or after photo has been submitted.";
  if (!item.before_path) return "Missing evidence: the before photo has not been submitted.";
  if (!item.after_path) return "Missing evidence: the after photo has not been submitted.";
  return null;
}
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
  payment_error: { text: "Needs reconciliation", tone: "alert" },
  hold_ended: { text: "Hold ended · not paid", tone: "released" }
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
  reconciled_no_movement: "Reconciled · PayPal confirms no money moved",
  decision_accepted_retried: "Homeowner retried the acceptance (same PayPal request)",
  decision_rejected_retried: "Homeowner retried the rejection (same PayPal request)",
  decision_not_processed: "PayPal declined the request · no money moved",
  capture_failed: "PayPal declined the capture · not paid",
  hold_ended: "PayPal reports the hold ended · not paid",
  reconcile_conflict: "Reconcile found a conflict · escalated, not recorded"
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

/**
 * Side-by-side by default; a wipe slider when both images are present, for checking the same spot.
 * The wipe can be dragged directly on the image (mouse, pen and touch via Pointer Events) and the
 * range input below stays the keyboard and screen-reader control, so both paths set the same state.
 */
export function EvidenceCompare({ before, after, annotated, children }: { before?: string | null; after?: string | null; annotated?: boolean; children: ReactNode }) {
  const [mode, setMode] = useState<"pair" | "slider">("pair");
  const [split, setSplit] = useState(50);
  const [dragging, setDragging] = useState(false);
  const frame = useRef<HTMLDivElement>(null);
  const id = useId();

  const setFromClientX = useCallback((clientX: number) => {
    const box = frame.current?.getBoundingClientRect();
    if (!box || box.width === 0) return;
    setSplit(Math.round(Math.min(100, Math.max(0, ((clientX - box.left) / box.width) * 100))));
  }, []);
  useEffect(() => {
    if (!dragging) return;
    const move = (e: PointerEvent) => { e.preventDefault(); setFromClientX(e.clientX); };
    const stop = () => setDragging(false);
    window.addEventListener("pointermove", move, { passive: false });
    window.addEventListener("pointerup", stop); window.addEventListener("pointercancel", stop);
    return () => { window.removeEventListener("pointermove", move); window.removeEventListener("pointerup", stop); window.removeEventListener("pointercancel", stop); };
  }, [dragging, setFromClientX]);

  const key = annotated && (before || after)
    ? <p className="annotation-key"><span className="ak-mark" aria-hidden="true" />Illustrative annotation: the dashed ring is drawn into these synthetic images to mark where the defect was drawn. It is not AI-generated detection, and no model placed it.</p>
    : null;
  // One photo (or none): no wipe is possible, but the annotation still needs its label.
  if (!before || !after) return <>{children}{key}</>;
  return <div className="compare">
    <div className="compare-bar">
      <div className="compare-toggle" role="group" aria-label="Evidence view">
        <button type="button" aria-pressed={mode === "pair"} onClick={() => setMode("pair")}><Columns2 size={14} aria-hidden="true" />Side by side</button>
        <button type="button" aria-pressed={mode === "slider"} onClick={() => setMode("slider")}><SlidersHorizontal size={14} aria-hidden="true" />Overlay &amp; wipe</button>
      </div>
      <p className="compare-hint">{mode === "pair" ? "Hard to spot the difference? Switch to Overlay & wipe to check the same spot in both photos." : "Drag across the photo, or use the slider below. Arrow keys move it one step at a time."}</p>
    </div>
    {mode === "pair" ? children : <figure className="evidence compare-wipe">
      <div ref={frame} className={cx("evidence-frame", "is-wipe", dragging && "is-dragging")}
        onPointerDown={(e) => { if (e.button === 0 || e.pointerType !== "mouse") { e.preventDefault(); setDragging(true); setFromClientX(e.clientX); } }}>
        <img src={after} alt="After photo" draggable={false} />
        <img src={before} alt="Before photo, overlaid up to the slider position" className="wipe-top" draggable={false} style={{ clipPath: `inset(0 ${100 - split}% 0 0)` }} />
        <span className="wipe-line" style={{ left: `${split}%` }} aria-hidden="true"><i /></span>
        <span className="evidence-corner">A</span><span className="evidence-corner is-right">B</span>
      </div>
      <figcaption>
        <label htmlFor={id}><b>Before ⟷ After</b>Drag on the photo, or use this slider</label>
        <input id={id} type="range" min={0} max={100} value={split} onChange={(e) => setSplit(Number(e.target.value))} aria-valuetext={`${split}% before, ${100 - split}% after`} />
      </figcaption>
    </figure>}
    {key}
  </div>;
}

const VERDICT: Record<AIReport["assessment"], { text: string; tone: string }> = {
  appears_satisfied: { text: "Visible evidence appears to meet the criteria", tone: "good" },
  insufficient_evidence: { text: "Not enough visible evidence to say", tone: "unsure" },
  visible_concern: { text: "Visible concern against the criteria", tone: "concern" }
};

/**
 * Qualitative coverage, counted from the criteria the report actually returned. This is a count of
 * the model's own per-criterion results, never a confidence or probability: no score is invented.
 */
function coverage(report: AIReport) {
  const n = report.criteria.length;
  if (!n) return null;
  const by = (r: CriterionResult) => report.criteria.filter((c) => c.result === r).length;
  const unsure = by("uncertain"), against = by("not_supported"), comparable = report.views_comparable ?? "yes";
  if (against) return { tone: "concern", text: `${against} of ${n} criteria are contradicted by what the photos show` };
  if (unsure) return { tone: "unsure", text: `${unsure} of ${n} criteria cannot be judged from these photos` };
  if (comparable !== "yes") return { tone: "unsure", text: `All ${n} criteria are supported, but the two views are only partly comparable` };
  return { tone: "good", text: `All ${n} criteria are supported by comparable before and after views` };
}

/**
 * What would make the evidence decidable. Derived here, in the UI, from the criteria the model
 * returned; it is labeled as PunchPay's own suggestion so it is never read as a model statement.
 */
function wouldHelp(report: AIReport) {
  const out: string[] = [];
  const comparable = report.views_comparable ?? "yes";
  if (comparable !== "yes") out.push("An after photo taken from the same position and angle as the before photo.");
  for (const c of report.criteria) if (c.result === "uncertain") out.push(`A closer, better-lit photo showing: ${c.criterion}`);
  for (const c of report.criteria) if (c.result === "not_supported") out.push(`Rework, or a photo that shows: ${c.criterion}`);
  return out;
}

export function AdvisoryReport({ report }: { report: AIReport }) {
  const v = VERDICT[report.assessment];
  const cov = coverage(report);
  const help = wouldHelp(report);
  return <div className={cx("report", `verdict-${v.tone}`)}>
    <p className="report-verdict">{v.text}</p>
    {cov && <p className={cx("report-strength", `str-${cov.tone}`)}><b>Evidence coverage</b>{cov.text}</p>}
    <p className="report-count">{(["supported", "uncertain", "not_supported"] as const).map((r) => `${report.criteria.filter((c) => c.result === r).length} ${r.replace("_", " ")}`).join(" · ")}{report.views_comparable && report.views_comparable !== "yes" && ` · views ${report.views_comparable === "no" ? "not" : "partly"} comparable`}</p>
    <p className="report-summary">{report.summary}</p>
    <ul className="criteria-results">
      {report.criteria.map((c, i) => <li key={i} className={`r-${c.result}`}>
        <span className="r-mark" role="img" aria-label={c.result.replace("_", " ")}>{c.result === "supported" ? <Check size={13} /> : c.result === "not_supported" ? <X size={13} /> : <Minus size={13} />}</span>
        <div><p className="r-criterion">{c.criterion}</p><p className="r-evidence">{c.evidence}</p></div>
      </li>)}
    </ul>
    {report.observations.length > 0 && <div className="report-notes"><h5>Also visible</h5><ul>{report.observations.map((o, i) => <li key={i}>{o}</li>)}</ul></div>}
    <div className="report-notes is-limits"><h5><CircleAlert size={13} aria-hidden="true" /> What these photos cannot show</h5><ul>{report.uncertainty.map((o, i) => <li key={i}>{o}</li>)}{report.views_comparable && report.views_comparable !== "yes" && <li>Before and after views are {report.views_comparable === "no" ? "not" : "only partly"} comparable.</li>}</ul></div>
    {help.length > 0 && <div className="report-notes is-help"><h5><HelpCircle size={13} aria-hidden="true" /> Would more evidence help?</h5>
      <ul>{help.map((o, i) => <li key={i}>{o}</li>)}</ul>
      <p className="help-origin">Suggested by PunchPay from the criteria above. Not a statement from the model.</p></div>}
    <p className="report-source">{report.source === "live_model" ? `Live analysis · ${report.model}` : "Sample fixture written for synthetic illustrations · not a live model"} · {when(report.reviewed_at)} · Advisory, not a certification or inspection</p>
  </div>;
}

export function Ledger({ items }: { items: PunchItem[] }) {
  return <div className="ledger-wrap"><table className="ledger">
    <thead><tr><th scope="col">Item</th><th scope="col" className="num">Amount</th><th scope="col">Hold</th><th scope="col">Outcome</th><th scope="col">PayPal reference</th></tr></thead>
    <tbody>{items.map((i) => {
      const outcome = i.state === "captured" ? "Captured" : i.state === "voided" ? "Voided" : i.state === "hold_ended" ? "Ended" : i.state === "payment_error" ? "Unconfirmed" : i.state.endsWith("_pending") ? "In progress" : "Open";
      return <tr key={i.id}>
        <th scope="row">{i.title}<small>{i.location}</small></th>
        <td className="num" data-label="Amount">{money(i.amount_cents)}</td>
        <td data-label="Hold">{i.state === "captured" ? "Captured" : i.state === "voided" ? "Released" : i.state === "hold_ended" ? "Ended, not paid" : i.paypal_auth_id ? "Held" : i.paypal_order_id ? "Awaiting approval" : "Not placed"}</td>
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

/* ── Project closeout ───────────────────────────────────────────────────────────────────────── */

export type Closeout = ReturnType<typeof closeoutFigures>;

/**
 * Project-level money figures, derived only from recorded state — never from the contract value.
 *
 * `authorized` counts an item only once PayPal has returned a verified authorization for it
 * (`paypal_auth_id` is written by the flows exclusively after `verifiedAuthorization` succeeds),
 * so an item still awaiting buyer approval is contracted but NOT authorized.
 *
 * Duplicate captures are reported only when they are measurable: the audit trail is PunchPay's
 * record of the capture IDs PayPal actually returned, so a duplicate is two distinct capture IDs
 * against one item. With no capture on record there is nothing to measure, and the figure is
 * withheld rather than shown as a zero that would read as a guarantee.
 */
export function closeoutFigures(items: PunchItem[], audit: AuditEvent[]) {
  const sum = (f: (i: PunchItem) => boolean) => items.filter(f).reduce((s, i) => s + i.amount_cents, 0);
  const captureIds = new Map<string, Set<string>>();
  for (const e of audit) {
    const id = (e.payload as { capture_id?: unknown } | null)?.capture_id;
    if (typeof id === "string" && id) (captureIds.get(e.item_id) ?? captureIds.set(e.item_id, new Set()).get(e.item_id)!).add(id);
  }
  const sets = [...captureIds.values()];
  return {
    contract: sum(() => true),
    authorized: sum((i) => !!i.paypal_auth_id),
    captured: sum((i) => i.state === "captured"),
    voided: sum((i) => i.state === "voided"),
    holdEnded: sum((i) => i.state === "hold_ended"),
    openHold: sum((i) => !!i.paypal_auth_id && !["captured", "voided", "hold_ended"].includes(i.state)),
    authorizedCount: items.filter((i) => !!i.paypal_auth_id).length,
    closed: items.filter((i) => ["captured", "voided", "hold_ended"].includes(i.state)).length,
    total: items.length,
    duplicates: { measurable: sets.length > 0, items: sets.length, records: sets.reduce((s, x) => s + x.size, 0), duplicated: sets.filter((x) => x.size > 1).length }
  };
}

export function CloseoutSummary({ f, simulation, live }: { f: Closeout; simulation: boolean; live: boolean }) {
  const dup = f.duplicates;
  return <div className="closeout">
    <div className="closeout-head">
      <h2>Project closeout</h2>
      <span className={cx("closeout-flag", simulation ? "is-sim" : live ? "is-sandbox" : "is-preview")}>
        {simulation ? "simulated states, not PayPal records" : live ? "amounts from PayPal-verified states" : "preview, no data loaded"}
      </span>
    </div>
    {/* A <dl> row may carry several <dd>: the value, then the sentence that says where it came
        from. (A <p> inside a <dl> is invalid and fails the accessibility audit.) */}
    <dl className="closeout-figures">
      <div className="cf-authorized">
        <dt>Authorized{simulation ? " (simulated)" : ""}</dt><dd className="cf-value">{money(f.authorized)}</dd>
        <dd className="cf-note">{f.authorizedCount} of {f.total} items have a verified hold. Contract value is {money(f.contract)}.</dd>
      </div>
      <div className="cf-captured">
        <dt>Captured</dt><dd className="cf-value">{money(f.captured)}</dd>
        <dd className="cf-note">{f.captured ? "Paid to the contractor after the homeowner accepted." : "Nothing captured yet."}</dd>
      </div>
      <div className="cf-voided">
        <dt>Voided</dt><dd className="cf-value">{money(f.voided)}</dd>
        <dd className="cf-note">{f.voided ? "Holds released; the homeowner was not charged." : "No holds voided yet."}</dd>
      </div>
      <div className="cf-dup">
        <dt>Duplicate captures</dt>
        <dd className="cf-value">{dup.measurable ? dup.duplicated : <span className="cf-nm">—</span>}</dd>
        <dd className="cf-note">{dup.measurable
          ? `Measured across ${dup.records} capture reference${dup.records === 1 ? "" : "s"} on ${dup.items} item${dup.items === 1 ? "" : "s"} in the audit trail.`
          : "Not measurable yet: no capture has been recorded, so there is nothing to compare."}</dd>
      </div>
    </dl>
    {(f.openHold > 0 || f.holdEnded > 0) && <p className="closeout-rest">
      {f.openHold > 0 && <span><b>{money(f.openHold)}</b> still held, awaiting a decision.</span>}
      {f.holdEnded > 0 && <span><b>{money(f.holdEnded)}</b> in holds ended without payment.</span>}
    </p>}
    <p className="closeout-foot">{f.closed} of {f.total} items closed{simulation && " · simulated references begin SIM- and are not PayPal transactions"}</p>
  </div>;
}

/* ── Contractor work overview ───────────────────────────────────────────────────────────────── */

type BucketId = "hold" | "evidence" | "review" | "ready" | "captured" | "voided" | "attention";
const BUCKETS: { id: BucketId; label: string; tone: string }[] = [
  { id: "hold", label: "Awaiting funds hold", tone: "open" },
  { id: "evidence", label: "Awaiting evidence", tone: "active" },
  { id: "review", label: "Review pending", tone: "active" },
  { id: "ready", label: "Ready for homeowner", tone: "wait" },
  { id: "captured", label: "Approved · captured", tone: "paid" },
  { id: "voided", label: "Rejected · released", tone: "released" },
  { id: "attention", label: "Needs attention", tone: "alert" }
];

/** Buckets the existing state machine into the headings people actually scan for. */
export function bucketOf(item: PunchItem): BucketId {
  if (["payment_error", "capture_pending", "void_pending", "hold_ended"].includes(item.state)) return "attention";
  if (item.state === "reviewed") return item.homeowner_decision ? "attention" : "ready";
  if (item.state === "captured") return "captured";
  if (item.state === "voided") return "voided";
  if (item.state === "submitted") return "review";
  if (item.state === "authorized") return "evidence";
  return "hold";
}

export function WorkOverview({ items, selectedId, onPick }: { items: PunchItem[]; selectedId: string; onPick: (id: string) => void }) {
  const groups = BUCKETS.map((b) => ({ ...b, members: items.filter((i) => bucketOf(i) === b.id) })).filter((b) => b.members.length);
  if (!groups.length) return null;
  return <div className="overview" aria-label="Work status overview">
    <p className="overview-head">At a glance</p>
    <ul className="overview-list">
      {groups.map((b) => <li key={b.id} className={cx(`tone-${b.tone}`, b.members.some((m) => m.id === selectedId) && "has-current")}>
        {/* The visible text repeats the punch list below, so the button carries one clean name
            instead of reading every item title out again. */}
        <button type="button" onClick={() => onPick(b.members[0].id)}
          aria-label={`${b.label}: ${b.members.length} ${b.members.length === 1 ? "item" : "items"}. Open the first.`}>
          <span className="ov-count" aria-hidden="true">{b.members.length}</span>
          <span className="ov-label" aria-hidden="true"><i />{b.label}</span>
          <span className="ov-items" aria-hidden="true">{b.members.map((m) => m.title).join(", ")}</span>
        </button>
      </li>)}
    </ul>
  </div>;
}

/* ── Key milestones (concise, item-specific) ────────────────────────────────────────────────── */

const MILESTONES: { label: string; actions: string[] }[] = [
  { label: "Funds held", actions: ["authorization_verified", "authorization_recovered"] },
  { label: "Evidence submitted", actions: ["evidence_before_uploaded", "evidence_after_uploaded"] },
  { label: "Advisory review", actions: ["evidence_reviewed"] },
  { label: "Homeowner decision", actions: ["decision_accepted", "decision_rejected", "decision_accepted_retried", "decision_rejected_retried"] },
  { label: "PayPal outcome", actions: ["capture_verified", "void_verified", "reconciled_capture", "reconciled_void", "capture_failed", "hold_ended", "capture_pending_at_paypal"] }
];

/** The four or five moments that matter, read from the same append-only audit the full log shows. */
export function KeyMilestones({ events }: { events: AuditEvent[] }) {
  const rows = MILESTONES.map((m) => {
    const hit = [...events].reverse().find((e) => m.actions.includes(e.action));
    return { label: m.label, at: hit?.created_at, what: hit ? EVENT_LABEL[hit.action] ?? hit.action.replaceAll("_", " ") : null };
  });
  return <ol className="milestones">
    {rows.map((r) => <li key={r.label} className={cx(r.at ? "is-done" : "is-pending")}>
      <span className="ms-dot" aria-hidden="true">{r.at ? <Check size={10} strokeWidth={3} /> : null}</span>
      <span className="ms-label">{r.label}</span>
      {r.at ? <time dateTime={r.at}>{when(r.at)}</time> : <span className="ms-wait">Not yet</span>}
    </li>)}
  </ol>;
}
