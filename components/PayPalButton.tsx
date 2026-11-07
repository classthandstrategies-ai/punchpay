"use client";
import { useEffect, useRef, useState } from "react";

type Buttons = { render: (el: HTMLElement) => Promise<void>; close?: () => Promise<void>; isEligible?: () => boolean };
type PayPalSdk = { Buttons: (options: Record<string, unknown>) => Buttons };
declare global { interface Window { paypal?: PayPalSdk } }

let sdkPromise: Promise<PayPalSdk> | null = null;
let sdkClientId = "";
function loadSdk(clientId: string): Promise<PayPalSdk> {
  if (sdkPromise && sdkClientId === clientId) return sdkPromise;
  sdkClientId = clientId;
  sdkPromise = new Promise((resolve, reject) => {
    document.getElementById("paypal-sdk")?.remove();
    const script = document.createElement("script");
    script.id = "paypal-sdk";
    // Sandbox client ID → sandbox checkout. AUTHORIZE intent; PayPal wallet only for a clear demo.
    script.src = `https://www.paypal.com/sdk/js?client-id=${encodeURIComponent(clientId)}&currency=USD&intent=authorize&components=buttons&disable-funding=card,credit,paylater,venmo`;
    script.async = true;
    script.onload = () => (window.paypal ? resolve(window.paypal) : reject(new Error("PayPal SDK unavailable")));
    script.onerror = () => { sdkPromise = null; reject(new Error("PayPal checkout could not load. Check your connection and try again.")); };
    document.head.appendChild(script);
  });
  return sdkPromise;
}

type Props = { clientId: string; itemId: string; passcode: string; onSettled: (message: string, ok: boolean) => void };

/** Mounts PayPal Buttons for ONE item. The server creates and authorizes the order; the browser only relays approval. */
export default function PayPalButton({ clientId, itemId, passcode, onSettled }: Props) {
  const host = useRef<HTMLDivElement>(null);
  const settled = useRef(onSettled);
  settled.current = onSettled;
  const [phase, setPhase] = useState<"loading" | "ready" | "working" | "error">("loading");
  const [message, setMessage] = useState("");

  useEffect(() => {
    let alive = true;
    let buttons: Buttons | null = null;
    const post = async (path: string) => {
      const res = await fetch(path, { method: "POST", headers: { "x-demo-passcode": passcode, "Content-Type": "application/json" }, body: "{}" });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(json.error || `Request failed (${res.status})`);
      return json;
    };
    loadSdk(clientId).then((paypal) => {
      if (!alive || !host.current) return;
      buttons = paypal.Buttons({
        style: { layout: "vertical", shape: "rect", color: "gold", label: "paypal", height: 44, tagline: false },
        createOrder: async () => { setMessage(""); return (await post(`/api/items/${itemId}/create-order`)).id; },
        onApprove: async () => {
          setPhase("working"); setMessage("Placing the authorization hold…");
          try { const json = await post(`/api/items/${itemId}/authorize`); settled.current(`Authorization ${json.status} · ${json.id}`, true); }
          catch (e) { const m = e instanceof Error ? e.message : "Authorization failed"; setPhase("error"); setMessage(m); settled.current(m, false); }
        },
        onCancel: () => { setMessage("Checkout closed. Nothing was authorized; you can reopen it any time."); },
        onError: (error: unknown) => { const m = error instanceof Error ? error.message : "PayPal could not complete approval"; setPhase("error"); setMessage(m); settled.current(m, false); }
      });
      return buttons.render(host.current).then(() => { if (alive) setPhase("ready"); });
    }).catch((e) => { if (alive) { setPhase("error"); setMessage(e instanceof Error ? e.message : "Could not load PayPal"); } });
    return () => { alive = false; buttons?.close?.().catch(() => null); };
  }, [clientId, itemId, passcode]);

  return <div className="paypal-slot" aria-busy={phase === "loading" || phase === "working"}>
    {phase === "loading" && <div className="paypal-skeleton" aria-hidden="true" />}
    <div ref={host} className="paypal-host" />
    {message && <p className={phase === "error" ? "inline-note is-error" : "inline-note"} role="status">{message}</p>}
  </div>;
}
