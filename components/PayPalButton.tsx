"use client";
import { useEffect, useRef, useState } from "react";
type Props = { clientId: string; itemId: string; passcode: string; onComplete: () => Promise<void> };
type PayPalSdk = { Buttons: (options: Record<string, unknown>) => { render: (el: HTMLElement) => Promise<void> } };
declare global { interface Window { paypal?: PayPalSdk } }
export default function PayPalButton({ clientId, itemId, passcode, onComplete }: Props) {
  const host = useRef<HTMLDivElement>(null);
  const [message, setMessage] = useState("");
  useEffect(() => {
    let active = true;
    async function mount() {
      try {
        if (!window.paypal) {
          const script = document.createElement("script");
          script.src = `https://www.paypal.com/sdk/js?client-id=${encodeURIComponent(clientId)}&currency=USD&intent=authorize&components=buttons`;
          script.async = true;
          await new Promise<void>((resolve, reject) => { script.onload = () => resolve(); script.onerror = () => reject(new Error("PayPal SDK failed to load")); document.head.appendChild(script); });
        }
        if (!active || !host.current || !window.paypal) return;
        const button = window.paypal.Buttons({
          style: { layout: "vertical", shape: "rect", label: "paypal", height: 43 },
          createOrder: async () => {
            const res = await fetch(`/api/items/${itemId}/create-order`, { method: "POST", headers: { "x-demo-passcode": passcode } });
            const json = await res.json();
            if (!res.ok) throw new Error(json.error || "Unable to create order");
            return json.id;
          },
          onApprove: async (data: { orderID: string }) => {
            const res = await fetch(`/api/items/${itemId}/authorize`, { method: "POST", headers: { "x-demo-passcode": passcode, "Content-Type": "application/json" }, body: JSON.stringify({ order_id: data.orderID }) });
            const json = await res.json();
            if (!res.ok) throw new Error(json.error || "Authorization failed");
            setMessage(`Authorization ${json.status} · ${json.id}`);
            await onComplete();
          },
          onError: (error: Error) => { setMessage(error.message || "PayPal approval error"); }
        });
        if (host.current) await button.render(host.current);
      } catch (e) { if (active) setMessage(e instanceof Error ? e.message : "Could not load PayPal"); }
    }
    mount();
    return () => { active = false; if (host.current) host.current.innerHTML = ""; };
  }, [clientId, itemId, passcode, onComplete]);
  return <><div ref={host} className="paypal-host" />{message && <p className="inline-feedback" role="status">{message}</p>}</>;
}
