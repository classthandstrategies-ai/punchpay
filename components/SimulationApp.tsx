"use client";
import { useCallback, useEffect, useState } from "react";
import { FlaskConical, RotateCcw } from "lucide-react";
import Dashboard from "./Dashboard";
import { cx, money } from "./parts";
import { simulationBackend } from "@/lib/sim/backend";
import { buildScenario, SCENARIOS, type ScenarioId, type SimWorld } from "@/lib/sim/scenarios";
import type { Backend } from "@/lib/backend";
import type { Movement } from "@/lib/sim/paypal-fake";

const ROMAN = ["I", "II", "III", "IV", "V", "VI"];
const isId = (v: string | null): v is ScenarioId => SCENARIOS.some((s) => s.id === v);

/**
 * /simulation: the six offline demonstrations. Runs PunchPay's real flows against in-memory fakes.
 * Nothing is sent to PayPal, Claude or Supabase, and every screen is labeled as simulated.
 */
export default function SimulationApp() {
  const [scenarioId, setScenarioId] = useState<ScenarioId>("accept-paint");
  const [run, setRun] = useState(0);
  const [world, setWorld] = useState<{ world: SimWorld; backend: Backend; key: string } | null>(null);
  const [movements, setMovements] = useState<Movement[]>([]);
  const [dupResult, setDupResult] = useState<string>("");

  useEffect(() => {
    const fromUrl = new URLSearchParams(window.location.search).get("scenario");
    if (isId(fromUrl)) setScenarioId(fromUrl);
  }, []);
  useEffect(() => {
    let alive = true;
    setWorld(null); setMovements([]); setDupResult("");
    buildScenario(scenarioId).then((w) => { if (alive) setWorld({ world: w, backend: simulationBackend(w), key: `${scenarioId}-${run}` }); });
    return () => { alive = false; };
  }, [scenarioId, run]);

  const choose = (id: ScenarioId) => {
    setScenarioId(id); setRun((r) => r + 1);
    const url = new URL(window.location.href); url.searchParams.set("scenario", id); window.history.replaceState(null, "", url);
  };
  const onChange = useCallback(() => { if (world) setMovements([...world.world.fake.movements]); }, [world]);
  const scenario = SCENARIOS.find((s) => s.id === scenarioId)!;

  async function duplicateAccept() {
    if (!world) return;
    const paint = world.world.store.list().find((i) => i.slug === "paint")!;
    setDupResult("Sending…");
    try {
      const r = await world.backend.post(paint.id, "decision", { decision: "accepted" });
      setDupResult(r.already ? "Answered from the record: already captured. Nothing was sent to PayPal." : `Accepted: ${r.state}.`);
    } catch (e) { setDupResult(`Refused: ${e instanceof Error ? e.message : "error"}`); }
    onChange();
  }

  const banner = <section className="sim-band" aria-labelledby="sim-title">
    <div className="sim-head">
      <p className="sim-flag"><FlaskConical size={14} aria-hidden="true" />Offline simulation · fixture data · no PayPal, Claude or database calls</p>
      <h2 id="sim-title">Six situations, one set of payment rules</h2>
      <p className="sim-lede">Each scenario runs PunchPay’s real decision and reconcile code against an in-browser stand-in for the PayPal sandbox. References beginning <code>SIM-</code> are simulated and are not PayPal transactions. Photos are labeled synthetic illustrations; reviews are pre-written fixtures, not live AI.</p>
    </div>
    <ol className="sim-list">
      {SCENARIOS.map((s, i) => <li key={s.id}><button type="button" className={cx(s.id === scenarioId && "is-on")} aria-current={s.id === scenarioId ? "true" : undefined} onClick={() => choose(s.id)}><span>{ROMAN[i]}</span>{s.title}</button></li>)}
    </ol>
    <div className="sim-detail">
      <div>
        <p className="sim-summary">{scenario.summary}</p>
        <ol className="sim-steps">{scenario.steps.map((t, i) => <li key={i}>{t}</li>)}</ol>
        <div className="sim-actions">
          {scenario.duplicateControl && <button type="button" className="btn btn-outline" disabled={!world} onClick={duplicateAccept}>Send the accept again (second tab)</button>}
          <button type="button" className="text-button" onClick={() => setRun((r) => r + 1)}><RotateCcw size={13} aria-hidden="true" />Restart this scenario</button>
        </div>
        {dupResult && <p className="inline-note" role="status">{dupResult}</p>}
      </div>
      <aside className="sim-ledger" aria-label="Simulated PayPal side">
        <h3>Simulated PayPal side</h3>
        <p>What the fake PayPal actually did, independent of PunchPay’s own record.</p>
        {movements.length ? <ul>{movements.map((m) => <li key={m.resource_id + m.kind}><b>{m.kind === "capture" ? `Capture ${money(Math.round(Number(m.amount) * 100))}` : `Void ${money(Math.round(Number(m.amount) * 100))}`}</b> <span>{m.status}</span><code>{m.resource_id}</code></li>)}</ul> : <p className="muted-line">No captures or voids yet.</p>}
        <p className="sim-count">{movements.filter((m) => m.kind === "capture" && m.status === "COMPLETED").length} capture(s) · {movements.filter((m) => m.kind === "void").length} void(s)</p>
      </aside>
    </div>
  </section>;

  if (!world) return <div className="page is-simulation"><p className="sim-loading" role="status">Preparing scenario…</p></div>;
  return <Dashboard key={world.key} backend={world.backend} banner={banner} initial={scenario.focus} onChange={onChange} />;
}
