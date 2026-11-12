"use client";
import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { ArrowRight, Check, CircleAlert, Hourglass, LockKeyhole, RefreshCcw, ShieldCheck, Sparkles, X } from "lucide-react";
import type { AuditEvent, PunchItem, Role } from "@/lib/types";
import { liveBackend, type Action, type ActionResult, type Backend, type Meta } from "@/lib/backend";
import { DEMO_ITEMS, criteriaOf } from "@/lib/demo-items";
import PayPalButton from "./PayPalButton";
import { AdvisoryReport, CloseoutSummary, EvidenceCompare, EvidencePane, KeyMilestones, Ledger, StatusTag, Timeline, WorkOverview, closeoutFigures, cx, missingEvidence, money, when } from "./parts";

const ROMAN = ["I", "II", "III", "IV", "V", "VI"];
const STEPS = ["Funds held", "Photos", "Review", "Decision"];

function stepIndex(state: PunchItem["state"]) {
  if (state === "awaiting_authorization" || state === "order_created") return 0;
  if (state === "authorized") return 1;
  if (state === "submitted") return 2;
  if (state === "reviewed") return 3;
  return 4;
}
function nextStep(item: PunchItem): { who: Role | null; text: string } {
  switch (item.state) {
    case "awaiting_authorization": case "order_created": return { who: "homeowner", text: `Approve a ${money(item.amount_cents)} hold for this fix in PayPal.` };
    case "authorized": return { who: "contractor", text: item.before_path ? "Upload the after photo." : item.after_path ? "Upload the before photo." : "Upload a before and an after photo." };
    case "submitted": return { who: "contractor", text: "Request the advisory evidence review." };
    case "reviewed": return item.homeowner_decision
      ? { who: "homeowner", text: `PayPal confirmed nothing moved. Retry the ${item.homeowner_decision === "accepted" ? "acceptance" : "rejection"}; it replays the same PayPal request.` }
      : { who: "homeowner", text: "Read the evidence and decide: accept and pay, or reject and release." };
    case "capture_pending": case "void_pending": return { who: null, text: "PayPal is processing. Reconcile to confirm the outcome." };
    case "payment_error": return { who: null, text: "The payment response was not confirmed. Reconcile with PayPal; do not retry blindly." };
    case "hold_ended": return { who: null, text: "Closed without payment. PayPal ended the hold before any money moved." };
    default: return { who: null, text: "Closed. The outcome below is the status PayPal reported." };
  }
}
const ss = { get: (k: string) => { try { return sessionStorage.getItem(k) || ""; } catch { return ""; } }, set: (k: string, v: string) => { try { sessionStorage.setItem(k, v); } catch { /* storage unavailable */ } } };
const roleName = (r: Role) => (r === "homeowner" ? "Homeowner" : "Contractor");

type Props = {
  /** Supplied by /simulation. Without it the Dashboard uses the live, passcode-protected API. */
  backend?: Backend;
  /** Rendered under the masthead (the simulation's scenario band). */
  banner?: ReactNode;
  initial?: { slug?: string; role?: Role };
  /** Called after every action and refresh; the simulation uses it to redraw its PayPal-side ledger. */
  onChange?: () => void;
};

export default function Dashboard({ backend: injected, banner, initial, onChange }: Props) {
  const simulation = injected?.kind === "simulation";
  const [items, setItems] = useState<PunchItem[]>(DEMO_ITEMS);
  const [audit, setAudit] = useState<AuditEvent[]>([]);
  const [meta, setMeta] = useState<Meta | null>(null);
  const [selectedId, setSelectedId] = useState(() => DEMO_ITEMS.find((i) => i.slug === initial?.slug)?.id ?? DEMO_ITEMS[0].id);
  const [role, setRoleState] = useState<Role>(initial?.role ?? "homeowner");
  const [passcode, setPasscode] = useState("");
  const [draft, setDraft] = useState("");
  const [connection, setConnection] = useState<{ status: "loading" | "live" | "preview"; reason: string }>({ status: "loading", reason: "Connecting…" });
  const [busy, setBusy] = useState<string | null>(null);
  const [notice, setNotice] = useState<{ text: string; ok: boolean } | null>(null);
  const [confirming, setConfirming] = useState<"accepted" | "rejected" | null>(null);
  const outcomeRef = useRef<HTMLDivElement>(null);
  const focusOutcome = useRef(false);

  const backend = useMemo(() => injected ?? liveBackend(passcode), [injected, passcode]);
  const live = connection.status === "live";

  const refresh = useCallback(async (b: Backend) => {
    try {
      const snap = await b.load();
      setItems(snap.items); setAudit(snap.audit); setMeta(snap.meta);
      setConnection({ status: "live", reason: "" });
      setSelectedId((prev) => snap.items.some((i) => i.id === prev) ? prev : snap.items[0]?.id || "");
      if (snap.meta.roles.length === 1) setRoleState(snap.meta.roles[0]);
    } catch (e) {
      setConnection({ status: "preview", reason: e instanceof Error ? e.message : "Backend unavailable" });
      setItems(DEMO_ITEMS); setAudit([]); setMeta(null);
      setSelectedId((prev) => DEMO_ITEMS.some((i) => i.id === prev) ? prev : DEMO_ITEMS[0].id);
    } finally { onChange?.(); }
  }, [onChange]);

  useEffect(() => {
    if (injected) { void refresh(injected); return; }
    const saved = ss.get("punchpay_passcode"); const savedRole = ss.get("punchpay_role");
    if (savedRole === "contractor" || savedRole === "homeowner") setRoleState(savedRole);
    setPasscode(saved); setDraft(saved);
    void refresh(liveBackend(saved));
  }, [injected, refresh]);
  useEffect(() => {
    if (simulation || !passcode) return;
    const onFocus = () => void refresh(backend); // signed image URLs are short-lived
    window.addEventListener("focus", onFocus); return () => window.removeEventListener("focus", onFocus);
  }, [simulation, passcode, backend, refresh]);
  useEffect(() => {
    if (focusOutcome.current && outcomeRef.current) { outcomeRef.current.focus(); focusOutcome.current = false; }
  });

  const allowed: Role[] = meta?.roles?.length ? meta.roles : ["homeowner", "contractor"];
  const setRole = (r: Role) => { if (!allowed.includes(r)) return; setRoleState(r); if (!simulation) ss.set("punchpay_role", r); setConfirming(null); };
  const unlock = (e: React.FormEvent) => { e.preventDefault(); setPasscode(draft); ss.set("punchpay_passcode", draft); setConnection({ status: "loading", reason: "Checking passcode…" }); void refresh(liveBackend(draft)); };
  const lock = () => { setPasscode(""); setDraft(""); ss.set("punchpay_passcode", ""); void refresh(liveBackend("")); };

  const selected = items.find((i) => i.id === selectedId) || items[0];
  const closeout = useMemo(() => closeoutFigures(items, audit), [items, audit]);

  async function run(key: string, task: () => Promise<ActionResult | void>, { focus = false } = {}) {
    setBusy(key); setNotice(null);
    try {
      const json = (await task()) || {};
      if (json.already) setNotice({ text: "Already recorded. Nothing was sent to PayPal again.", ok: true });
      else if (json.message) setNotice({ text: json.message, ok: true });
      else if (json.capture_id) setNotice({ text: `${simulation ? "Simulated capture" : "PayPal capture"} ${json.capture_id} · ${json.paypal_status}`, ok: true });
      else if (json.authorization_id && json.state === "voided") setNotice({ text: `${simulation ? "Simulated authorization" : "Authorization"} ${json.authorization_id} · ${json.paypal_status}`, ok: true });
      focusOutcome.current = focus;
    } catch (e) { setNotice({ text: e instanceof Error ? e.message : "Action failed", ok: false }); focusOutcome.current = focus; }
    finally { setConfirming(null); await refresh(backend); setBusy(null); }
  }
  const act = (key: string, action: Action, body?: object, opts?: { focus?: boolean }) => run(key, () => backend.post(selected.id, action, body), opts);
  const upload = (stage: "before" | "after", file: File) => {
    if (file.size > 4 * 1024 * 1024) { setNotice({ text: "Images must be 4 MB or smaller.", ok: false }); return; }
    void run(`upload-${stage}`, () => backend.upload(selected.id, stage, file));
  };
  const simApprove = () => run("sim-hold", async () => {
    const order = await backend.post(selected.id, "create-order");
    await backend.simulateBuyerApproval!(String(order.id));
    const auth = await backend.post(selected.id, "authorize");
    return { message: `Simulated hold ${auth.id} · ${auth.status}. Funds held for this item only.` };
  });

  const step = nextStep(selected);
  const idx = items.indexOf(selected);
  const canUpload = live && role === "contractor" && ["authorized", "submitted", "reviewed"].includes(selected.state) && !selected.homeowner_decision;
  const itemEvents = audit.filter((e) => e.item_id === selected.id);
  const isTerminal = ["captured", "voided", "hold_ended"].includes(selected.state);
  const missing = missingEvidence(selected);
  const source = simulation ? "simulated PayPal" : "PayPal";
  const Source = simulation ? "Simulated PayPal" : "PayPal"; // sentence-initial
  const retry = selected.state === "reviewed" ? selected.homeowner_decision : null;

  return <div className={cx("page", simulation && "is-simulation")}>
    <header className="masthead">
      <a className="wordmark" href="/" aria-label="PunchPay home"><span className="mark" aria-hidden="true"><Check size={14} strokeWidth={3} /></span>PunchPay</a>
      <p className="masthead-meta"><span>Closeout dossier</span><span>No. 001</span><span>Oak Street, Austin TX</span></p>
      <div className="masthead-controls">
        {allowed.length > 1 ? <div className="role-switch" role="radiogroup" aria-label="Viewing as">
          <span className="role-label">Viewing as</span>
          {(["homeowner", "contractor"] as Role[]).map((r) => <button key={r} type="button" role="radio" aria-checked={role === r} className={cx(role === r && "is-on")} onClick={() => setRole(r)}>{roleName(r)}</button>)}
        </div> : <p className="role-fixed"><span className="role-label">Signed in as</span>{roleName(allowed[0])}</p>}
        <span className={cx("sandbox-flag", simulation && "is-sim")} title={simulation ? "Offline simulation. No PayPal or Claude calls are made." : "All payments use the PayPal sandbox. No real money moves."}>{simulation ? "Simulation" : "Sandbox"}</span>
      </div>
    </header>

    {banner}

    {!simulation && !live && <div className="access-band" role="region" aria-label="Demo access">
      <p><LockKeyhole size={15} aria-hidden="true" /><span>{connection.status === "loading" ? <b>{connection.reason}</b> : <><b>Design preview.</b> {connection.reason} <a href="/simulation">Or open the offline simulation.</a></>}</span></p>
      <form onSubmit={unlock}>
        <label className="sr-only" htmlFor="passcode">Demo passcode</label>
        <input id="passcode" type="password" autoComplete="off" placeholder="Demo passcode" value={draft} onChange={(e) => setDraft(e.target.value)} />
        <button type="submit" className="btn btn-ink" disabled={!draft || connection.status === "loading"}>Unlock</button>
      </form>
    </div>}

    <main aria-busy={connection.status === "loading"}>
      <section className="cover" aria-labelledby="cover-title">
        <div className="cover-text">
          <p className="kicker">Project closeout · {items.length} outstanding {items.length === 1 ? "fix" : "fixes"}</p>
          <h1 id="cover-title">Every fix reviewed.<br /><em>Every payment decided.</em></h1>
          <p className="lede">A homeowner and a contractor finishing a renovation rarely disagree about the whole job — they disagree about one or two fixes. PunchPay settles them one at a time.</p>
          <ol className="how" aria-label="How PunchPay works">
            <li><b>A hold per fix.</b> The homeowner approves a separate PayPal authorization for each item, so money is reserved but not charged.</li>
            <li><b>Evidence, then a described review.</b> The contractor submits before and after photos; Claude describes what they show against the agreed criteria, and says plainly what it cannot tell.</li>
            <li><b>The homeowner decides.</b> Accept and that item&rsquo;s hold is captured; reject and it is voided. One item never affects the other, and the review never moves money.</li>
          </ol>
        </div>
        <div className="tally-wrap"><CloseoutSummary f={closeout} simulation={simulation} live={live} /></div>
      </section>

      <div className="dossier">
        <nav className="item-index" aria-label="Punch list items">
          <WorkOverview items={items} selectedId={selected.id} onPick={(id) => { setSelectedId(id); setConfirming(null); }} />
          <p className="index-head">Punch list</p>
          {items.map((item, i) => <button key={item.id} type="button" className={cx("index-entry", item.id === selected.id && "is-current")} aria-current={item.id === selected.id ? "true" : undefined} onClick={() => { setSelectedId(item.id); setConfirming(null); }}>
            <span className="ie-num">{String(i + 1).padStart(2, "0")}</span>
            <span className="ie-main"><b>{item.title}</b><small>{item.location}</small><StatusTag state={item.state} /></span>
            <span className="ie-amount">{money(item.amount_cents)}</span>
          </button>)}
          <p className="index-note"><ShieldCheck size={14} aria-hidden="true" />Each item is a separate PayPal authorization. Rejecting one never affects the other.</p>
        </nav>

        <article className="item-file" aria-labelledby="item-title" key={selected.id}>
          <header className="file-head">
            <p className="file-ref">Item {String(idx + 1).padStart(2, "0")} of {String(items.length).padStart(2, "0")} · Inspection file</p>
            <div className="file-title">
              <div><h2 id="item-title">{selected.title}</h2><p>{selected.location} · {selected.description}</p></div>
              <p className="file-amount">{money(selected.amount_cents)}<small>USD · fixed by contract</small></p>
            </div>
            <ol className="steps" aria-label="Progress">
              {STEPS.map((s, i) => { const at = stepIndex(selected.state); return <li key={s} className={cx(i < at && "is-done", i === at && !isTerminal && "is-now")} aria-current={i === at && !isTerminal ? "step" : undefined}><span>{i < at ? <Check size={11} strokeWidth={3} aria-hidden="true" /> : i + 1}</span>{s}</li>; })}
            </ol>
            <div className={cx("next-step", step.who && step.who !== role && "is-elsewhere", selected.state === "payment_error" && "is-alert")} aria-live="polite">
              <p><span className="ns-label">{step.who ? `Next · ${roleName(step.who)}` : isTerminal ? "Closed" : "Attention"}</span>{step.text}</p>
              {step.who && step.who !== role && allowed.includes(step.who) && <button type="button" className="btn btn-quiet" onClick={() => setRole(step.who!)}>Switch to {step.who} <ArrowRight size={14} aria-hidden="true" /></button>}
            </div>
          </header>

          <div className="file-body">
          <div className="col-evidence">
          <section className="file-section">
            <h3><span className="sec-num">{ROMAN[0]}</span>Agreed acceptance criteria</h3>
            <ol className="criteria">{criteriaOf(selected).map((c, i) => <li key={i}>{c.charAt(0).toUpperCase() + c.slice(1)}</li>)}</ol>
          </section>

          <section className="file-section">
            <h3><span className="sec-num">{ROMAN[1]}</span>Funds hold<small>{simulation ? "Simulated Orders v2 · AUTHORIZE" : "PayPal Orders v2 · AUTHORIZE"}</small></h3>
            {selected.paypal_auth_id ? <p className="hold-line"><ShieldCheck size={16} aria-hidden="true" /><span>
              {selected.state === "captured" ? <>The {money(selected.amount_cents)} hold was captured after the homeowner accepted the work.</>
                : selected.state === "voided" ? <>The {money(selected.amount_cents)} hold was voided after the homeowner rejected the work.</>
                : selected.state === "hold_ended" ? <>{Source} reports this hold <b>{selected.paypal_status}</b>. It ended before any money moved; nothing was paid for this item.</>
                : <>{money(selected.amount_cents)} authorized by the homeowner and held by {source} for this item only. Nothing is charged until the homeowner decides.{selected.paypal_auth_expires_at && <span className="hold-expiry"><Hourglass size={12} aria-hidden="true" />Hold valid until {when(selected.paypal_auth_expires_at)}</span>}</>}
              <code>{selected.paypal_auth_id}</code></span></p>
              : role !== "homeowner" ? <p className="muted-line">Waiting for the homeowner to approve this hold in PayPal.</p>
              : simulation && live ? <div className="hold-action">
                <p>Approve a hold of <b>{money(selected.amount_cents)}</b> for this fix. In the live app this opens PayPal’s sandbox checkout; here a simulated buyer approves it.</p>
                <button type="button" className="btn btn-ink" disabled={!!busy} onClick={simApprove}>{busy === "sim-hold" ? "Placing the simulated hold…" : `Approve ${money(selected.amount_cents)} hold (simulated buyer)`}</button>
              </div>
              : live && meta?.paypal.configured && meta.paypal.clientId ? <div className="hold-action">
                <p>Approve a hold of <b>{money(selected.amount_cents)}</b> for this fix. PayPal reserves the funds; nothing is captured now.</p>
                <PayPalButton clientId={meta.paypal.clientId} itemId={selected.id} passcode={passcode} onSettled={(text, ok) => { setNotice({ text, ok }); void refresh(backend); }} />
                {selected.state === "order_created" && <button type="button" className="btn btn-quiet" disabled={!!busy} onClick={() => act("sync", "sync")}><RefreshCcw size={14} aria-hidden="true" />{busy === "sync" ? "Checking PayPal…" : "Already approved? Check PayPal status"}</button>}
              </div>
              : <p className="muted-line">{!live ? "Unlock the demo to approve holds in the PayPal sandbox." : "PayPal sandbox credentials are not configured on the server."}</p>}
          </section>

          <section className="file-section">
            <h3><span className="sec-num">{ROMAN[2]}</span>Photo evidence<small>{simulation ? "Synthetic illustrations · labeled" : "Submitted by the contractor"}</small></h3>
            <EvidenceCompare before={selected.before_url} after={selected.after_url} annotated={simulation}>
              <div className="evidence-pair">
                <EvidencePane stage="before" src={selected.before_url} hasPhoto={!!selected.before_path} canUpload={canUpload} busy={!!busy} onUpload={(f) => upload("before", f)} />
                <EvidencePane stage="after" src={selected.after_url} hasPhoto={!!selected.after_path} canUpload={canUpload} busy={!!busy} onUpload={(f) => upload("after", f)} />
              </div>
            </EvidenceCompare>
            {busy?.startsWith("upload") && <p className="inline-note" role="status">Uploading and checking the image…</p>}
            {missing && selected.paypal_auth_id && !isTerminal && <p className="missing-note"><CircleAlert size={14} aria-hidden="true" />{missing}</p>}
            {role === "contractor" && <p className="fine">{canUpload ? (simulation ? "JPG, PNG or WebP up to 4 MB. In the simulation, your photo never leaves this browser tab." : "JPG, PNG or WebP up to 4 MB. Photos are re-encoded with location and camera metadata removed, stored privately, and shown through short-lived links. Replacing a photo clears the previous review.") : selected.paypal_auth_id ? "Evidence is locked once the homeowner has decided." : "Photos can be submitted once the homeowner has approved this hold."}</p>}
          </section>

          </div>
          <div className="col-judgment">
          <section className="file-section">
            <h3><span className="sec-num">{ROMAN[3]}</span>Advisory evidence review<small>{simulation ? "Fixture · not a live model" : "Claude · describes, never decides"}</small></h3>
            {busy === "review" ? <div className="report-loading" role="status"><span className="pulse" aria-hidden="true" />{simulation ? "Loading the fixture review…" : "Claude is comparing the before and after photos against each criterion…"}</div>
              : selected.ai_review ? <AdvisoryReport report={selected.ai_review} />
              : <p className="muted-line">{missing ? `The review needs both photos. ${missing}` : "Photos are in. The contractor can request the advisory review."}</p>}
            {role === "contractor" && live && (selected.state === "submitted" || selected.state === "reviewed" || (selected.state === "authorized" && selected.paypal_auth_id)) && !selected.homeowner_decision && <>
              <button type="button" className="btn btn-outline" disabled={!!busy || !meta?.ai.configured || !!missing} onClick={() => act("review", "review")} aria-describedby={missing ? "review-why" : undefined}>
                <Sparkles size={15} aria-hidden="true" />{busy === "review" ? "Reviewing photos…" : selected.ai_review ? "Run the review again" : "Request advisory review"}
              </button>
              {missing && <p className="fine" id="review-why">Unavailable until both photos are submitted.</p>}
              {!meta?.ai.configured && <p className="fine">ANTHROPIC_API_KEY is not set on the server; no sample report is substituted.</p>}
            </>}
          </section>

          <section className="file-section decision">
            <h3><span className="sec-num">{ROMAN[4]}</span>Homeowner decision</h3>
            {selected.state === "captured" ? <div className="outcome outcome-paid" role="status" tabIndex={-1} ref={outcomeRef}>
              <span className="seal" aria-hidden="true"><Check size={22} strokeWidth={2.5} /></span>
              <div><p className="outcome-title">Accepted. {money(selected.amount_cents)} paid to the contractor.</p><p>{simulation ? "Simulated capture" : "PayPal capture"} <code>{selected.paypal_capture_id}</code> reports <b>{selected.paypal_status}</b>{selected.decision_at && <> · decided {when(selected.decision_at)}</>}</p></div>
            </div>
              : selected.state === "voided" ? <div className="outcome outcome-released" role="status" tabIndex={-1} ref={outcomeRef}>
                <span className="seal" aria-hidden="true"><X size={20} strokeWidth={2.5} /></span>
                <div><p className="outcome-title">Rejected. The {money(selected.amount_cents)} hold was released.</p><p>{simulation ? "Simulated authorization" : "PayPal authorization"} <code>{selected.paypal_auth_id}</code> reports <b>{selected.paypal_status}</b>. The homeowner was not charged for this item.</p></div>
              </div>
              : selected.state === "hold_ended" ? <div className="outcome outcome-released" role="status" tabIndex={-1} ref={outcomeRef}>
                <span className="seal" aria-hidden="true"><Hourglass size={20} strokeWidth={2} /></span>
                <div><p className="outcome-title">Closed without payment.</p><p>{Source} reports the hold <b>{selected.paypal_status}</b>{selected.paypal_capture_id && <> (capture <code>{selected.paypal_capture_id}</code>)</>}. No money reached the contractor. A new agreement is needed to pay for this item.</p></div>
              </div>
              : selected.state === "reviewed" && role === "homeowner" ? (confirming ? <div className="confirm" role="group" aria-label="Confirm decision">
                <p>{confirming === "accepted" ? <>Capture <b>{money(selected.amount_cents)}</b> from this item’s {source} hold and pay the contractor?</> : <>Void this item’s <b>{money(selected.amount_cents)}</b> hold? The contractor will not be paid for it.</>}</p>
                <div className="confirm-actions">
                  <button type="button" className={confirming === "accepted" ? "btn btn-pine" : "btn btn-clay"} disabled={!!busy || !live} autoFocus onClick={() => act("decide", "decision", { decision: confirming }, { focus: true })}>{busy === "decide" ? `Waiting for ${source}…` : confirming === "accepted" ? "Confirm and pay" : "Confirm and release"}</button>
                  <button type="button" className="btn btn-quiet" disabled={!!busy} onClick={() => setConfirming(null)}>Cancel</button>
                </div>
              </div> : retry ? <div className="decide">
                <p className="retry-note">Your earlier {retry === "accepted" ? "acceptance" : "rejection"} did not reach {source}, and {source} confirms no money moved. You can retry the same decision; it cannot be changed once recorded.</p>
                <button type="button" className={retry === "accepted" ? "btn btn-pine" : "btn btn-outline-clay"} disabled={!!busy || !live} onClick={() => setConfirming(retry)}>{retry === "accepted" ? <><Check size={16} aria-hidden="true" />Retry: accept and pay {money(selected.amount_cents)}</> : <><X size={15} aria-hidden="true" />Retry: reject and release</>}</button>
                <button type="button" className="btn btn-quiet" disabled={!!busy || !live} onClick={() => act("sync", "sync")}><RefreshCcw size={14} aria-hidden="true" />{busy === "sync" ? `Checking ${source}…` : `Re-check ${source} first`}</button>
                <p className="fine">If {source} settled the earlier request after PunchPay gave up, re-checking records that outcome instead of moving money again.</p>
              </div> : <div className="decide">
                <button type="button" className="btn btn-pine" disabled={!!busy || !live} onClick={() => setConfirming("accepted")}><Check size={16} aria-hidden="true" />Accept and pay {money(selected.amount_cents)}</button>
                <button type="button" className="btn btn-outline-clay" disabled={!!busy || !live} onClick={() => setConfirming("rejected")}><X size={15} aria-hidden="true" />Reject and release</button>
                <p className="fine">Your decision is yours. The review above is advisory and is not consulted when money moves.{selected.ai_review?.assessment !== "appears_satisfied" && " If the evidence is unclear, you can also ask the contractor for a clearer photo before deciding."}</p>
              </div>)
              : ["capture_pending", "void_pending", "payment_error"].includes(selected.state) ? <div className="reconcile" tabIndex={-1} ref={outcomeRef}>
                <p>{selected.state === "payment_error" ? `${Source}’s response was not confirmed, so PunchPay stopped instead of retrying.` : `${Source} has not reported a final status yet.`}{selected.last_error && <small>{selected.last_error}</small>}</p>
                <button type="button" className="btn btn-outline" disabled={!!busy || !live} onClick={() => act("sync", "sync")}><RefreshCcw size={14} aria-hidden="true" />{busy === "sync" ? `Checking ${source}…` : `Reconcile with ${source}`}</button>
                <p className="fine">Reconcile only reads from {source}. It never captures, voids or retries.</p>
              </div>
              : <p className="muted-line">{selected.state === "reviewed" ? "Waiting for the homeowner to decide." : missing && selected.paypal_auth_id ? "The decision opens once both photos are in and the advisory review is recorded." : "The decision opens once evidence has been submitted and reviewed."}</p>}
          </section>

          <section className="file-section">
            <h3><span className="sec-num">{ROMAN[5]}</span>Record<small>Append-only</small></h3>
            {itemEvents.length ? <>
              <KeyMilestones events={itemEvents} />
              <details className="full-log">
                <summary>Full audit history for this item ({itemEvents.length} {itemEvents.length === 1 ? "entry" : "entries"})</summary>
                <Timeline events={itemEvents} compact />
              </details>
            </> : <Timeline events={itemEvents} compact />}
          </section>
          </div>
          </div>
        </article>
      </div>

      <section className="register" aria-labelledby="ledger-title">
        <div className="register-head"><h2 id="ledger-title">Payments ledger</h2><p>{simulation ? "References beginning SIM- come from the in-browser PayPal fake. They are not PayPal transactions." : "Every reference below came back from the PayPal sandbox API. Statuses are confirmed by a follow-up GET, never assumed."}</p></div>
        <Ledger items={items} />
        <div className="register-head"><h2>Project record</h2><p>All events across both items, newest first.</p></div>
        <Timeline events={audit} items={items} />
      </section>
    </main>

    <footer className="colophon">
      <p>PunchPay · Built for the PayPal AI Hackathon 2026 · {simulation ? "Offline simulation, fixture data only" : "PayPal sandbox only, no real money"} · Not escrow, inspection or certification.</p>
      {!simulation && live && <button type="button" className="text-button" onClick={lock}><LockKeyhole size={13} aria-hidden="true" />Lock demo</button>}
      {simulation ? <a className="text-button" href="/">Live sandbox app</a> : <a className="text-button" href="/simulation">Offline simulation</a>}
    </footer>

    <div className="toast-region" aria-live="polite">
      {notice && <div className={cx("toast", !notice.ok && "is-error")} role={notice.ok ? "status" : "alert"}>
        <span>{notice.text}</span><button type="button" aria-label="Dismiss" onClick={() => setNotice(null)}><X size={15} /></button>
      </div>}
    </div>
  </div>;
}
