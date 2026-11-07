"use client";
import { useCallback, useEffect, useMemo, useState } from "react";
import { ArrowRight, Check, LockKeyhole, RefreshCcw, ShieldCheck, Sparkles, X } from "lucide-react";
import type { AuditEvent, PunchItem } from "@/lib/types";
import PayPalButton from "./PayPalButton";
import { AdvisoryReport, EvidencePane, Ledger, StatusTag, Timeline, cx, money, when } from "./parts";

type Role = "homeowner" | "contractor";
type Meta = { paypal: { configured: boolean; clientId: string | null }; ai: { configured: boolean } };

const base = { project_id: "preview", currency: "USD" as const, state: "awaiting_authorization" as const, paypal_order_id: null, paypal_auth_id: null, paypal_capture_id: null, paypal_status: null, payee_merchant_id: null, before_path: null, after_path: null, before_url: null, after_url: null, ai_review: null, homeowner_decision: null, decision_at: null, order_attempt: 1, last_error: null };
const PREVIEW: PunchItem[] = [
  { ...base, id: "preview-paint", slug: "paint", title: "Paint touch-up", location: "Living room · North wall", description: "Repair the scuffed paint beside the window.", acceptance_criteria: "Scuff no longer visibly apparent; finish is reasonably uniform in submitted after-photo; include a wide context shot and a close-up.", amount_cents: 3000 },
  { ...base, id: "preview-tile", slug: "tile", title: "Tile repair", location: "Kitchen · Backsplash", description: "Replace the cracked tile near the sink.", acceptance_criteria: "Tile appears uncracked and aligned with adjacent tiles; grout line visually continuous; include before photo and clear close-up of repair.", amount_cents: 2000 }
];
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
    case "submitted": return { who: "contractor", text: "Run the advisory evidence review." };
    case "reviewed": return { who: "homeowner", text: "Read the evidence and decide: accept and pay, or reject and release." };
    case "capture_pending": case "void_pending": return { who: null, text: "PayPal is processing. Reconcile to confirm the outcome." };
    case "payment_error": return { who: null, text: "The payment response was not confirmed. Reconcile with PayPal; do not retry blindly." };
    default: return { who: null, text: "Closed. The outcome below is the status PayPal reported." };
  }
}
const ss = { get: (k: string) => { try { return sessionStorage.getItem(k) || ""; } catch { return ""; } }, set: (k: string, v: string) => { try { sessionStorage.setItem(k, v); } catch { /* storage unavailable */ } } };

export default function Dashboard() {
  const [items, setItems] = useState<PunchItem[]>(PREVIEW);
  const [audit, setAudit] = useState<AuditEvent[]>([]);
  const [meta, setMeta] = useState<Meta | null>(null);
  const [selectedId, setSelectedId] = useState(PREVIEW[0].id);
  const [role, setRoleState] = useState<Role>("homeowner");
  const [passcode, setPasscode] = useState("");
  const [draft, setDraft] = useState("");
  const [connection, setConnection] = useState<{ live: boolean; reason: string }>({ live: false, reason: "Connecting…" });
  const [busy, setBusy] = useState<string | null>(null);
  const [notice, setNotice] = useState<{ text: string; ok: boolean } | null>(null);
  const [confirming, setConfirming] = useState<"accepted" | "rejected" | null>(null);

  const refresh = useCallback(async (code: string) => {
    if (!code) { setConnection({ live: false, reason: "Enter the demo passcode to load the live sandbox project." }); return; }
    try {
      const res = await fetch("/api/items", { cache: "no-store", headers: { "x-demo-passcode": code } });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(json.error || `Backend unavailable (${res.status})`);
      const next = json.items as PunchItem[];
      setItems(next); setAudit(json.audit || []); setMeta({ paypal: json.paypal, ai: json.ai });
      setConnection({ live: true, reason: "" });
      setSelectedId((prev) => next.some((i) => i.id === prev) ? prev : next[0]?.id || "");
    } catch (e) {
      setConnection({ live: false, reason: e instanceof Error ? e.message : "Backend unavailable" });
      setItems(PREVIEW); setAudit([]); setMeta(null); setSelectedId((prev) => PREVIEW.some((i) => i.id === prev) ? prev : PREVIEW[0].id);
    }
  }, []);

  useEffect(() => {
    const saved = ss.get("punchpay_passcode"); const savedRole = ss.get("punchpay_role");
    if (savedRole === "contractor" || savedRole === "homeowner") setRoleState(savedRole);
    setPasscode(saved); setDraft(saved); void refresh(saved);
  }, [refresh]);
  useEffect(() => {
    const onFocus = () => { if (passcode) void refresh(passcode); }; // signed image URLs are short-lived
    window.addEventListener("focus", onFocus); return () => window.removeEventListener("focus", onFocus);
  }, [passcode, refresh]);

  const setRole = (r: Role) => { setRoleState(r); ss.set("punchpay_role", r); setConfirming(null); };
  const unlock = (e: React.FormEvent) => { e.preventDefault(); setPasscode(draft); ss.set("punchpay_passcode", draft); void refresh(draft); };
  const lock = () => { setPasscode(""); setDraft(""); ss.set("punchpay_passcode", ""); void refresh(""); };

  const selected = items.find((i) => i.id === selectedId) || items[0];
  const live = connection.live;
  const totals = useMemo(() => ({
    all: items.reduce((s, i) => s + i.amount_cents, 0),
    held: items.filter((i) => ["authorized", "submitted", "reviewed", "capture_pending", "void_pending", "payment_error"].includes(i.state)).reduce((s, i) => s + i.amount_cents, 0),
    paid: items.filter((i) => i.state === "captured").reduce((s, i) => s + i.amount_cents, 0),
    released: items.filter((i) => i.state === "voided").reduce((s, i) => s + i.amount_cents, 0),
    closed: items.filter((i) => i.state === "captured" || i.state === "voided").length
  }), [items]);

  async function act(key: string, path: string, body?: object, form?: FormData) {
    setBusy(key); setNotice(null);
    try {
      const res = await fetch(path, { method: "POST", headers: { "x-demo-passcode": passcode, ...(form ? {} : { "Content-Type": "application/json" }) }, body: form ?? JSON.stringify(body ?? {}) });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(json.error || `Request failed (${res.status})`);
      if (json.message) setNotice({ text: json.message, ok: true });
      else if (json.capture_id) setNotice({ text: `PayPal capture ${json.capture_id} · ${json.paypal_status}`, ok: true });
      else if (json.authorization_id && json.state === "voided") setNotice({ text: `Authorization ${json.authorization_id} · ${json.paypal_status}`, ok: true });
    } catch (e) { setNotice({ text: e instanceof Error ? e.message : "Action failed", ok: false }); }
    finally { setConfirming(null); await refresh(passcode); setBusy(null); }
  }
  const upload = (stage: "before" | "after", file: File) => {
    if (file.size > 6 * 1024 * 1024) { setNotice({ text: "Images must be 6 MB or smaller.", ok: false }); return; }
    const form = new FormData(); form.append("stage", stage); form.append("file", file);
    void act(`upload-${stage}`, `/api/items/${selected.id}/upload`, undefined, form);
  };

  const step = nextStep(selected);
  const idx = items.indexOf(selected);
  const canUpload = live && role === "contractor" && ["authorized", "submitted", "reviewed"].includes(selected.state);
  const itemEvents = audit.filter((e) => e.item_id === selected.id);
  const isTerminal = selected.state === "captured" || selected.state === "voided";

  return <div className="page">
    <header className="masthead">
      <a className="wordmark" href="/" aria-label="PunchPay home"><span className="mark" aria-hidden="true"><Check size={14} strokeWidth={3} /></span>PunchPay</a>
      <p className="masthead-meta"><span>Closeout dossier</span><span>No. 001</span><span>Oak Street, Austin TX</span></p>
      <div className="masthead-controls">
        <div className="role-switch" role="radiogroup" aria-label="Viewing as">
          <span className="role-label">Viewing as</span>
          {(["homeowner", "contractor"] as Role[]).map((r) => <button key={r} type="button" role="radio" aria-checked={role === r} className={cx(role === r && "is-on")} onClick={() => setRole(r)}>{r === "homeowner" ? "Homeowner" : "Contractor"}</button>)}
        </div>
        <span className="sandbox-flag" title="All payments use the PayPal sandbox. No real money moves.">Sandbox</span>
      </div>
    </header>

    {!live && <div className="access-band" role="region" aria-label="Demo access">
      <p><LockKeyhole size={15} aria-hidden="true" /><span><b>Design preview.</b> {connection.reason}</span></p>
      <form onSubmit={unlock}>
        <label className="sr-only" htmlFor="passcode">Demo passcode</label>
        <input id="passcode" type="password" autoComplete="off" placeholder="Demo passcode" value={draft} onChange={(e) => setDraft(e.target.value)} />
        <button type="submit" className="btn btn-ink">Unlock</button>
      </form>
    </div>}

    <main>
      <section className="cover" aria-labelledby="cover-title">
        <div className="cover-text">
          <p className="kicker">Project closeout · Two outstanding fixes</p>
          <h1 id="cover-title">Every fix reviewed.<br /><em>Every payment decided.</em></h1>
          <p className="lede">Each fix has its own PayPal hold, its own photo evidence and its own decision. Claude describes what the photos show; the homeowner alone decides what gets paid.</p>
        </div>
        <dl className="tally" aria-label="Payment summary">
          <div><dt>Under contract</dt><dd>{money(totals.all)}</dd></div>
          <div><dt>Held in PayPal</dt><dd>{money(totals.held)}</dd></div>
          <div className="t-paid"><dt>Paid to contractor</dt><dd>{money(totals.paid)}</dd></div>
          <div className="t-released"><dt>Released to homeowner</dt><dd>{money(totals.released)}</dd></div>
          <p className="tally-foot">{totals.closed} of {items.length} items closed · amounts from PayPal-verified states</p>
        </dl>
      </section>

      <div className="dossier">
        <nav className="item-index" aria-label="Punch list items">
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
              {STEPS.map((s, i) => <li key={s} className={cx(i < stepIndex(selected.state) && "is-done", i === stepIndex(selected.state) && !isTerminal && "is-now")}><span>{i < stepIndex(selected.state) ? <Check size={11} strokeWidth={3} /> : i + 1}</span>{s}</li>)}
            </ol>
            <div className={cx("next-step", step.who && step.who !== role && "is-elsewhere")}>
              <p><span className="ns-label">{step.who ? `Next · ${step.who === "homeowner" ? "Homeowner" : "Contractor"}` : isTerminal ? "Closed" : "Attention"}</span>{step.text}</p>
              {step.who && step.who !== role && <button type="button" className="btn btn-quiet" onClick={() => setRole(step.who!)}>Switch to {step.who} <ArrowRight size={14} aria-hidden="true" /></button>}
            </div>
          </header>

          <section className="file-section">
            <h3><span className="sec-num">{ROMAN[0]}</span>Agreed acceptance criteria</h3>
            <ol className="criteria">{selected.acceptance_criteria.split(/;\s*/).filter(Boolean).map((c, i) => <li key={i}>{c.charAt(0).toUpperCase() + c.slice(1).replace(/\.$/, "")}</li>)}</ol>
          </section>

          <section className="file-section">
            <h3><span className="sec-num">{ROMAN[1]}</span>Funds hold<small>PayPal Orders v2 · AUTHORIZE</small></h3>
            {selected.paypal_auth_id ? <p className="hold-line"><ShieldCheck size={16} aria-hidden="true" /><span>{money(selected.amount_cents)} authorized by the homeowner and held by PayPal for this item only. Nothing is charged until the homeowner decides.<code>{selected.paypal_auth_id}</code></span></p>
              : role === "homeowner" && live && meta?.paypal.configured && meta.paypal.clientId ? <div className="hold-action">
                <p>Approve a hold of <b>{money(selected.amount_cents)}</b> for this fix. PayPal reserves the funds; nothing is captured now.</p>
                <PayPalButton clientId={meta.paypal.clientId} itemId={selected.id} passcode={passcode} onSettled={(text, ok) => { setNotice({ text, ok }); void refresh(passcode); }} />
                {selected.state === "order_created" && <button type="button" className="btn btn-quiet" disabled={!!busy} onClick={() => act("sync", `/api/items/${selected.id}/sync`)}><RefreshCcw size={14} aria-hidden="true" />Already approved? Check PayPal status</button>}
              </div>
              : <p className="muted-line">{!live ? "Unlock the demo to approve holds in the PayPal sandbox." : role !== "homeowner" ? "Waiting for the homeowner to approve this hold in PayPal." : "PayPal sandbox credentials are not configured on the server."}</p>}
          </section>

          <section className="file-section">
            <h3><span className="sec-num">{ROMAN[2]}</span>Photo evidence<small>Submitted by the contractor</small></h3>
            <div className="evidence-pair">
              <EvidencePane stage="before" src={selected.before_url} hasPhoto={!!selected.before_path} canUpload={canUpload} busy={!!busy} onUpload={(f) => upload("before", f)} />
              <EvidencePane stage="after" src={selected.after_url} hasPhoto={!!selected.after_path} canUpload={canUpload} busy={!!busy} onUpload={(f) => upload("after", f)} />
            </div>
            {busy?.startsWith("upload") && <p className="inline-note" role="status">Uploading and checking the image…</p>}
            {role === "contractor" && <p className="fine">{canUpload ? "JPG, PNG or WebP up to 6 MB. Photos are stored privately and shown through short-lived links. Replacing a photo clears the previous review." : selected.paypal_auth_id ? "Evidence is locked once the homeowner has decided." : "Photos can be submitted once the homeowner has approved this hold."}</p>}
          </section>

          <section className="file-section">
            <h3><span className="sec-num">{ROMAN[3]}</span>Advisory evidence review<small>Claude · describes, never decides</small></h3>
            {selected.ai_review ? <AdvisoryReport report={selected.ai_review} />
              : <p className="muted-line">{selected.before_path && selected.after_path ? "Photos are in. The contractor can request the advisory review." : "Claude compares the before and after photos against each criterion once both are submitted, and says plainly what it cannot see."}</p>}
            {role === "contractor" && live && (selected.state === "submitted" || selected.state === "reviewed") && <>
              <button type="button" className="btn btn-outline" disabled={!!busy || !meta?.ai.configured} onClick={() => act("review", `/api/items/${selected.id}/review`)}>
                <Sparkles size={15} aria-hidden="true" />{busy === "review" ? "Reviewing photos…" : selected.ai_review ? "Run the review again" : "Request advisory review"}
              </button>
              {!meta?.ai.configured && <p className="fine">ANTHROPIC_API_KEY is not set on the server; no sample report is substituted.</p>}
            </>}
          </section>

          <section className="file-section decision">
            <h3><span className="sec-num">{ROMAN[4]}</span>Homeowner decision</h3>
            {selected.state === "captured" ? <div className="outcome outcome-paid" role="status">
              <span className="seal" aria-hidden="true"><Check size={22} strokeWidth={2.5} /></span>
              <div><p className="outcome-title">Accepted. {money(selected.amount_cents)} paid to the contractor.</p><p>PayPal capture <code>{selected.paypal_capture_id}</code> reports <b>{selected.paypal_status}</b>{selected.decision_at && <> · decided {when(selected.decision_at)}</>}</p></div>
            </div>
              : selected.state === "voided" ? <div className="outcome outcome-released" role="status">
                <span className="seal" aria-hidden="true"><X size={20} strokeWidth={2.5} /></span>
                <div><p className="outcome-title">Rejected. The {money(selected.amount_cents)} hold was released.</p><p>PayPal authorization <code>{selected.paypal_auth_id}</code> reports <b>{selected.paypal_status}</b>. The homeowner was not charged for this item.</p></div>
              </div>
              : selected.state === "reviewed" && role === "homeowner" ? (confirming ? <div className="confirm" role="group" aria-label="Confirm decision">
                <p>{confirming === "accepted" ? <>Capture <b>{money(selected.amount_cents)}</b> from this item’s PayPal hold and pay the contractor?</> : <>Void this item’s <b>{money(selected.amount_cents)}</b> hold? The contractor will not be paid for it.</>}</p>
                <div className="confirm-actions">
                  <button type="button" className={confirming === "accepted" ? "btn btn-pine" : "btn btn-clay"} disabled={!!busy || !live} autoFocus onClick={() => act("decide", `/api/items/${selected.id}/decision`, { decision: confirming })}>{busy === "decide" ? "Waiting for PayPal…" : confirming === "accepted" ? "Confirm and pay" : "Confirm and release"}</button>
                  <button type="button" className="btn btn-quiet" disabled={!!busy} onClick={() => setConfirming(null)}>Cancel</button>
                </div>
              </div> : <div className="decide">
                <button type="button" className="btn btn-pine" disabled={!!busy || !live} onClick={() => setConfirming("accepted")}><Check size={16} aria-hidden="true" />Accept and pay {money(selected.amount_cents)}</button>
                <button type="button" className="btn btn-outline-clay" disabled={!!busy || !live} onClick={() => setConfirming("rejected")}><X size={15} aria-hidden="true" />Reject and release</button>
                <p className="fine">Your decision is yours. The review above is advisory and is not consulted when money moves.</p>
              </div>)
              : ["capture_pending", "void_pending", "payment_error"].includes(selected.state) ? <div className="reconcile">
                <p>{selected.state === "payment_error" ? "PayPal’s response was not confirmed, so PunchPay stopped instead of retrying." : "PayPal has not reported a final status yet."}{selected.last_error && <small>{selected.last_error}</small>}</p>
                <button type="button" className="btn btn-outline" disabled={!!busy || !live} onClick={() => act("sync", `/api/items/${selected.id}/sync`)}><RefreshCcw size={14} aria-hidden="true" />{busy === "sync" ? "Checking PayPal…" : "Reconcile with PayPal"}</button>
              </div>
              : <p className="muted-line">{selected.state === "reviewed" ? "Waiting for the homeowner to decide." : "The decision opens once evidence has been submitted and reviewed."}</p>}
          </section>

          <section className="file-section">
            <h3><span className="sec-num">{ROMAN[5]}</span>Record<small>Append-only</small></h3>
            <Timeline events={itemEvents} compact />
          </section>
        </article>
      </div>

      <section className="register" aria-labelledby="ledger-title">
        <div className="register-head"><h2 id="ledger-title">Payments ledger</h2><p>Every reference below came back from the PayPal sandbox API. Statuses are confirmed by a follow-up GET, never assumed.</p></div>
        <Ledger items={items} />
        <div className="register-head"><h2>Project record</h2><p>All events across both items, newest first.</p></div>
        <Timeline events={audit} items={items} />
      </section>
    </main>

    <footer className="colophon">
      <p>PunchPay · Built for the PayPal AI Hackathon 2026 · PayPal sandbox only, no real money · Not escrow, inspection or certification.</p>
      {live && <button type="button" className="text-button" onClick={lock}><LockKeyhole size={13} aria-hidden="true" />Lock demo</button>}
    </footer>

    {notice && <div className={cx("toast", !notice.ok && "is-error")} role={notice.ok ? "status" : "alert"}>
      <span>{notice.text}</span><button type="button" aria-label="Dismiss" onClick={() => setNotice(null)}><X size={15} /></button>
    </div>}
  </div>;
}
