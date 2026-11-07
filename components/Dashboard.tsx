"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import { ArrowUpRight, ArrowRight, Check, CheckCheck, ChevronRight, CircleAlert, CircleCheck, ClipboardCheck, Clock3, FileCheck2, House, ImagePlus, LockKeyhole, RefreshCcw, ShieldCheck, Sparkles, X, Zap } from "lucide-react";
import type { PunchItem, AIReport, AuditEvent } from "@/lib/types";
import PayPalButton from "./PayPalButton";

const preview: PunchItem[] = [
  { id: "preview-paint", project_id: "preview", slug: "paint", title: "Paint touch-up", location: "Living room · North wall", description: "Repair the scuffed paint beside the window.", acceptance_criteria: "Scuff no longer visibly apparent; finish is reasonably uniform. Include a context shot and close-up.", amount_cents: 3000, currency: "USD", state: "awaiting_authorization", paypal_order_id: null, paypal_auth_id: null, paypal_capture_id: null, paypal_status: null, payee_merchant_id: null, before_path: null, after_path: null, before_url: null, after_url: null, ai_review: null, homeowner_decision: null, decision_at: null },
  { id: "preview-tile", project_id: "preview", slug: "tile", title: "Tile repair", location: "Kitchen · Backsplash", description: "Replace the cracked tile near the sink.", acceptance_criteria: "Tile appears uncracked and aligned with adjacent tiles; grout line visually continuous. Include repair close-up.", amount_cents: 2000, currency: "USD", state: "awaiting_authorization", paypal_order_id: null, paypal_auth_id: null, paypal_capture_id: null, paypal_status: null, payee_merchant_id: null, before_path: null, after_path: null, before_url: null, after_url: null, ai_review: null, homeowner_decision: null, decision_at: null }
];
const status: Record<string, { text: string; className: string }> = {
  awaiting_authorization: { text: "Awaiting approval", className: "neutral" },
  order_created: { text: "Awaiting PayPal", className: "amber" },
  authorized: { text: "Funds authorized", className: "blue" },
  submitted: { text: "Evidence ready", className: "blue" },
  reviewed: { text: "Ready for decision", className: "amber" },
  capture_pending: { text: "Capture processing", className: "amber" },
  captured: { text: "Paid", className: "green" },
  void_pending: { text: "Void processing", className: "amber" },
  voided: { text: "Released", className: "stone" },
  payment_error: { text: "Reconciliation needed", className: "red" }
};
const currency = (cents: number) => `$${(cents / 100).toFixed(2)}`;
function classJoin(...parts: (string | false | null | undefined)[]) { return parts.filter(Boolean).join(" "); }

function EvidenceTile({ src, label, eyebrow, onUpload, disabled }: { src?: string | null; label: string; eyebrow: string; onUpload?: (f: File) => void; disabled?: boolean }) {
  const input = useRef<HTMLInputElement>(null);
  return <div className="evidence-tile">
    <div className="evidence-visual">
      {src ? <img src={src} alt={`${label} uploaded evidence`} /> : <div className="evidence-placeholder"><div className="placeholder-illustration"><House size={43} strokeWidth={1.15} /><span /></div><span>No image uploaded</span></div>}
      {onUpload && <button disabled={disabled} className="evidence-upload" title={`Upload ${label.toLowerCase()} photo`} onClick={() => input.current?.click()}><ImagePlus size={16} /></button>}
      <input ref={input} type="file" accept="image/jpeg,image/png,image/webp" hidden onChange={(e) => { const f = e.target.files?.[0]; if (f && onUpload) onUpload(f); e.target.value = ""; }} />
    </div>
    <div className="evidence-caption"><div><small>{eyebrow}</small><b>{label}</b></div><span className={src ? "photo-indicator ready" : "photo-indicator"}>{src ? <Check size={13} /> : <ImagePlus size={13} />}</span></div>
  </div>;
}
function AIReview({ report }: { report: AIReport | null }) {
  if (!report) return <div className="empty-analysis"><div className="sparkle-orbit"><Sparkles size={22} /></div><b>Evidence, not assumptions.</b><p>Once both photos are submitted, Claude will compare only what is visible against the agreed criteria.</p></div>;
  return <div className="ai-report">
    <div className="ai-verdict"><span className={classJoin("verdict-icon", report.assessment === "appears_satisfied" ? "good" : report.assessment === "visible_concern" ? "concern" : "uncertain")}><Sparkles size={17} /></span><div><small>AI assessment</small><b>{report.assessment === "appears_satisfied" ? "Appears to meet criteria" : report.assessment === "visible_concern" ? "Visible concerns found" : "Insufficient evidence"}</b></div></div>
    <p className="ai-summary">{report.summary}</p>
    <div className="review-criteria">{report.criteria?.map((criterion, i) => <div className="review-row" key={i}><span className={classJoin("review-bullet", criterion.result)}>{criterion.result === "supported" ? <Check size={12} /> : criterion.result === "not_supported" ? <X size={12} /> : <CircleAlert size={12} />}</span><span><b>{criterion.criterion}</b><small>{criterion.evidence}</small></span></div>)}</div>
    {report.uncertainty?.length > 0 && <p className="uncertainty"><CircleAlert size={13} /> {report.uncertainty.join(" ")}</p>}
    <div className="ai-footer">{report.source === "live_model" ? "Live Claude analysis" : "Sample fixture, not live AI"}<span>Human decision required</span></div>
  </div>;
}

export default function Dashboard() {
  const [items, setItems] = useState<PunchItem[]>(preview);
  const [audit, setAudit] = useState<AuditEvent[]>([]);
  const [selectedId, setSelectedId] = useState("preview-paint");
  const [role, setRole] = useState<"homeowner" | "contractor">("homeowner");
  const [passcode, setPasscode] = useState("");
  const [editPasscode, setEditPasscode] = useState("");
  const [notice, setNotice] = useState("");
  const [busy, setBusy] = useState(false);
  const [live, setLive] = useState(false);
  const [payPalConfigured, setPayPalConfigured] = useState(false);
  const clientId = process.env.NEXT_PUBLIC_PAYPAL_CLIENT_ID || "";
  const refresh = useCallback(async () => {
    try {
      const response = await fetch("/api/items", { cache: "no-store", headers: { "x-demo-passcode": passcode } });
      if (!response.ok) throw new Error("Backend not connected");
      const json = await response.json();
      if (!Array.isArray(json.items)) throw new Error("Invalid backend response");
      const next = json.items as PunchItem[];
      setItems(next);
      setAudit(Array.isArray(json.audit) ? json.audit : []);
      setLive(true);
      setPayPalConfigured(!!json.configured);
      setSelectedId((previous) => next.find(i => i.id === previous) ? previous : (next.find(i => i.slug === "paint")?.id || next[0]?.id || ""));
    } catch { setLive(false); setItems(preview); setAudit([]); }
  }, [passcode]);
  useEffect(() => { const saved = sessionStorage.getItem("punchpay_demo_passcode") || ""; setPasscode(saved); setEditPasscode(saved); refresh(); }, [refresh]);
  const selected = items.find(i => i.id === selectedId) || items[0];
  const total = items.reduce((s, item) => s + item.amount_cents, 0);
  const paid = items.filter(i => i.state === "captured").reduce((s, item) => s + item.amount_cents, 0);
  const released = items.filter(i => i.state === "voided").reduce((s, item) => s + item.amount_cents, 0);
  const completed = items.filter(i => ["captured", "voided"].includes(i.state)).length;
  const ready = !!passcode && live;
  async function act(path: string, body?: unknown, multipart?: FormData) {
    setBusy(true); setNotice("");
    try {
      const response = await fetch(path, { method: "POST", headers: { "x-demo-passcode": passcode, ...(multipart ? {} : { "Content-Type": "application/json" }) }, ...(multipart ? { body: multipart } : { body: JSON.stringify(body || {}) }) });
      const json = await response.json();
      if (!response.ok) throw new Error(json.error || "Action unsuccessful");
      await refresh();
      setNotice("Updated. Payment details are shown only when confirmed by PayPal.");
    } catch (error) { setNotice(error instanceof Error ? error.message : "Action failed"); }
    finally { setBusy(false); }
  }
  const upload = (stage: "before" | "after", file: File) => { if (!selected) return; const form = new FormData(); form.append("stage", stage); form.append("file", file); void act(`/api/items/${selected.id}/upload`, undefined, form); };
  const uploadAllowed = ready && ["authorized", "submitted", "reviewed"].includes(selected?.state || "");
  return <div className="shell">
    <aside className="sidebar">
      <a className="brand" href="/"><span className="brand-mark"><span className="mark-outline" /><Check size={18} strokeWidth={3} /></span><span>Punch<span className="brand-accent">Pay</span><small>RENOVATION CLOSEOUT</small></span></a>
      <div className="side-workspace"><div className="workspace-symbol">O</div><span>Oak Street Project<small>Residential renovation</small></span><ChevronRight size={15} /></div>
      <div className="side-label">WORKSPACE</div>
      <nav className="side-nav" aria-label="Navigation"><div className="nav-active"><ClipboardCheck size={17} /> Punch list <span>02</span></div><div className="nav-muted"><FileCheck2 size={17} /> Evidence reports</div><div className="nav-muted"><ShieldCheck size={17} /> Payment ledger</div></nav>
      <div className="sidebar-bottom"><div className="sandbox-box"><span className="sandbox-led" /><b>PayPal Sandbox</b><small>Testing mode · No real money</small></div><div className="profile"><div className="avatar">AM</div><span>Alex Morgan<small>Homeowner · Demo</small></span><span className="profile-dots">···</span></div></div>
    </aside>
    <main className="main">
      <header className="topbar"><div className="breadcrumb">Projects <ChevronRight size={13} /> Oak Street <ChevronRight size={13} /><strong>Closeout</strong></div><div className="topbar-actions"><span className="top-status"><span /> Sandbox environment</span><span className="top-avatar">AM</span></div></header>
      <div className="content">
        <div className="intro-row"><div><div className="eyebrow"><span className="mini-line" /> PROJECT CLOSEOUT / 001</div><h1>Finish well.<br /><em>Settle fairly.</em></h1><p className="intro-sub">A clearer way to complete the last 1% of a renovation.<br className="desktop-break" /> Every fix has evidence, a decision, and its own payment outcome.</p></div><div className="intro-meta"><div className="round-icon"><House size={19} /></div><span>THE OAK STREET RENOVATION<small>Austin, Texas · Mason & Co.</small></span></div></div>
        <section className="metrics" aria-label="Closeout overview"><div className="metric"><small>Total at stake</small><strong>{currency(total)}</strong><span>Across {items.length} independent items</span></div><div className="metric"><small>Paid to contractor</small><strong>{currency(paid)}</strong><span><span className="dot green" /> Captured in PayPal</span></div><div className="metric"><small>Released to homeowner</small><strong>{currency(released)}</strong><span><span className="dot stone" /> Voided authorizations</span></div><div className="metric metric-progress"><small>Closeout progress</small><strong>{completed}<span>/{items.length}</span></strong><div className="meter"><div style={{width:`${items.length ? 100*completed/items.length : 0}%`}}/></div></div></section>
        <div className="list-heading"><div><div className="section-kicker">01 / REVIEW & DECIDE</div><h2>Outstanding work <span>({items.length})</span></h2></div><div className="role-switch" aria-label="Switch demo role"><button className={role === "homeowner" ? "active" : ""} onClick={() => setRole("homeowner")}>Homeowner</button><button className={role === "contractor" ? "active" : ""} onClick={() => setRole("contractor")}>Contractor</button></div></div>
        <div className="workspace-grid"><div className="items-column"><p className="list-helper">Each fix has its own approval, evidence, and PayPal authorization.</p><div className="items-list">{items.map((item, i) => <button key={item.id} className={classJoin("item-card", selected?.id === item.id && "is-selected")} onClick={() => setSelectedId(item.id)}><div className="item-top"><span className="item-index">{String(i+1).padStart(2, "0")}</span><span className={classJoin("status-pill", status[item.state]?.className)}><span className="status-dot"/>{status[item.state]?.text || item.state}</span></div><div className="item-info"><div><h3>{item.title}</h3><p>{item.location}</p></div><span className="item-price">{currency(item.amount_cents)}</span></div><div className="item-bottom"><span>{item.paypal_auth_id ? <ShieldCheck size={15} /> : <Clock3 size={15} />}{item.paypal_auth_id ? "Individually authorized" : "PayPal approval required"}</span><span className="card-arrow"><ArrowUpRight size={16} /></span></div></button>)}</div><div className="trust-note"><ShieldCheck size={20}/><div><b>No blind approvals.</b><span>AI reviews visual evidence. You remain in control of what gets paid.</span></div></div></div>
        {selected && <section className="detail-panel"><div className="panel-top"><div><div className="panel-eyebrow">ITEM {items.indexOf(selected)+1} OF {items.length} <span>/</span> INSPECTION FILE</div><h2>{selected.title}</h2><p>{selected.description}</p></div><span className="panel-amount">{currency(selected.amount_cents)}<small>FIX VALUE</small></span></div>
          <div className="criteria-block"><div className="block-icon"><ClipboardCheck size={17} /></div><div><small>AGREED ACCEPTANCE CRITERIA</small><p>{selected.acceptance_criteria}</p></div></div>
          <div className="panel-section"><div className="panel-section-head"><h3>Photo evidence</h3><span>BEFORE / AFTER</span></div><div className="evidence-grid"><EvidenceTile label="Before" eyebrow="01 · ORIGINAL" src={selected.before_url} disabled={busy} onUpload={role === "contractor" && uploadAllowed ? f => upload("before",f) : undefined} /><EvidenceTile label="After" eyebrow="02 · COMPLETED" src={selected.after_url} disabled={busy} onUpload={role === "contractor" && uploadAllowed ? f => upload("after",f) : undefined} /></div>{role === "contractor" && <p className="micro-caption">{uploadAllowed ? "Click the upload icon to add or replace a photo (JPG, PNG, WebP, up to 6 MB)." : "Photos can be uploaded after homeowner PayPal authorization."}</p>}</div>
          <div className="panel-section ai-section"><div className="panel-section-head"><h3><span className="ai-emblem"><Sparkles size={15}/></span> AI evidence review</h3><span>ADVISORY ONLY</span></div><AIReview report={selected.ai_review} />{role === "contractor" && ["submitted", "reviewed"].includes(selected.state) && <button disabled={busy || !ready} className="secondary-button full" onClick={() => void act(`/api/items/${selected.id}/review`)}><Sparkles size={16}/> {selected.ai_review ? "Rerun Claude review" : "Analyze evidence with Claude"}</button>}</div>
          <div className="decision-block"><div className="decision-heading"><div className="decision-icon"><LockKeyhole size={17}/></div><span><b>{role === "homeowner" ? "Your decision, your control" : "Ready for homeowner sign-off"}</b><small>Payment moves only after the homeowner decides.</small></span></div>
          {selected.state === "captured" || selected.state === "voided" ? <div className={classJoin("terminal-state", selected.state === "captured" ? "paid" : "released")}><span>{selected.state === "captured" ? <CircleCheck size={22} /> : <CheckCheck size={22}/>}</span><div><b>{selected.state === "captured" ? "Accepted · Payment captured" : "Rejected · Authorization voided"}</b><small>PayPal verified: {selected.paypal_status || selected.state.toUpperCase()}{selected.paypal_capture_id ? ` · ${selected.paypal_capture_id}` : selected.paypal_auth_id ? ` · ${selected.paypal_auth_id}` : ""}</small></div></div>
          : selected.state === "reviewed" ? role === "homeowner" ? <div className="decision-buttons"><button disabled={busy || !ready} className="accept-button" onClick={() => {if (window.confirm(`Accept ${selected.title} and capture ${currency(selected.amount_cents)} from its separate PayPal authorization?`)) void act(`/api/items/${selected.id}/decision`, {decision:"accepted"});}}><Check size={17}/> Accept & pay {currency(selected.amount_cents)}</button><button disabled={busy || !ready} className="reject-button" onClick={() => {if (window.confirm(`Reject ${selected.title} and void its PayPal authorization for ${currency(selected.amount_cents)}?`)) void act(`/api/items/${selected.id}/decision`, {decision:"rejected"});}}><X size={16}/> Reject & release</button></div> : <p className="decision-message">Evidence reviewed. Switch to the homeowner role to make the decision.</p>
          : selected.state === "awaiting_authorization" || selected.state === "order_created" ? role === "homeowner" && ready && clientId && payPalConfigured ? <div className="paypal-wrap"><p>Authorize <b>{currency(selected.amount_cents)}</b> separately in the PayPal sandbox. No capture occurs yet.</p><PayPalButton key={selected.id} clientId={clientId} itemId={selected.id} passcode={passcode} onComplete={refresh}/></div> : <p className="decision-message">{!ready ? "Connect the backend and set your demo access passcode to begin PayPal sandbox approval." : role !== "homeowner" ? "Waiting for homeowner to authorize this item with PayPal." : "Configure PayPal sandbox client ID to start approvals."}</p>
          : <div className="pending-state"><Clock3 size={16}/><span>{selected.state === "authorized" ? "Authorized. Contractor can now submit before-and-after photos." : selected.state === "submitted" ? "Evidence submitted. Run Claude review before deciding." : "Payment state requires verification or reconciliation."}</span></div>}
          {selected.state === "payment_error" || selected.state === "capture_pending" || selected.state === "void_pending" ? <button disabled={busy || !ready} className="secondary-button full" onClick={() => void act(`/api/items/${selected.id}/sync`)}><RefreshCcw size={15}/> Reconcile with PayPal</button> : null}
          </div>
          <div className="audit-block"><div className="panel-section-head"><h3><Clock3 size={15}/> Decision trail</h3><span>PER ITEM · APPENDED EVENTS</span></div>{audit.filter(event => event.item_id === selected.id).slice(0,5).length ? <div className="audit-list">{audit.filter(event => event.item_id === selected.id).slice(0,5).map(event => <div key={event.id} className="audit-event"><span className="audit-stem"><span/></span><div><b>{event.action.replaceAll("_", " ")}</b><small>{event.actor} · {new Date(event.created_at).toLocaleString("en-US",{month:"short",day:"numeric",hour:"numeric",minute:"2-digit"})}</small></div></div>)}</div> : <p className="audit-empty">No recorded activity yet. Authorization and evidence events will appear here.</p>}</div>
          <div className="panel-end"><ShieldCheck size={14}/><span>Not escrow. Authorization is time-limited. AI never approves payments.</span></div>
        </section>}</div>
        <footer className="page-footer"><span>PUNCHPAY / BUILT FOR THE PAYPAL AI HACKATHON 2026</span><span>Made for the moments that deserve proof. <ArrowRight size={13}/></span></footer>
      </div>
    </main>
    <div className="access-panel"><div className="access-copy"><LockKeyhole size={16}/><span>{live ? "Backend connected" : "Design preview"} · {passcode ? "Demo passcode saved this session" : "Enter demo passcode to act"}</span></div><div className="access-form"><input type="password" autoComplete="off" placeholder="Demo passcode" value={editPasscode} onChange={e => setEditPasscode(e.target.value)} onKeyDown={e => { if(e.key === "Enter") { setPasscode(editPasscode); sessionStorage.setItem("punchpay_demo_passcode",editPasscode); }}}/><button onClick={() => { setPasscode(editPasscode); sessionStorage.setItem("punchpay_demo_passcode",editPasscode); }}>Unlock</button><button className="refresh-button" aria-label="Refresh backend status" title="Refresh" onClick={() => void refresh()}><RefreshCcw size={15}/></button></div></div>
    {notice && <div className="toast" role="status"><CircleAlert size={16}/>{notice}<button onClick={() => setNotice("")} aria-label="Dismiss"><X size={16}/></button></div>}
  </div>;
}
