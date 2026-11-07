import "server-only";

export const PAYPAL_BASE = "https://api-m.sandbox.paypal.com";
export type PayPalOrder = {
  id: string;
  status: string;
  purchase_units?: { payee?: { merchant_id?: string; email_address?: string }; payments?: { authorizations?: { id: string; status: string }[] } }[];
};
export type PayPalAuthorization = { id: string; status: string; payee?: { merchant_id?: string } };
export type PayPalCapture = { id: string; status: string; amount?: { value: string; currency_code: string } };

async function token() {
  const id = process.env.PAYPAL_CLIENT_ID;
  const secret = process.env.PAYPAL_CLIENT_SECRET;
  if (!id || !secret) throw new Error("PayPal sandbox merchant credentials required");
  const resp = await fetch(`${PAYPAL_BASE}/v1/oauth2/token`, {
    method: "POST",
    headers: { Authorization: `Basic ${Buffer.from(`${id}:${secret}`).toString("base64")}`, "Content-Type": "application/x-www-form-urlencoded" },
    body: "grant_type=client_credentials", cache: "no-store"
  });
  const out = await resp.json();
  if (!resp.ok || !out.access_token) throw new Error(`PayPal OAuth failed (${resp.status})`);
  return out.access_token as string;
}
export async function paypalRequest<T>(path: string, init: { method?: "GET" | "POST"; body?: object; key?: string } = {}): Promise<T | null> {
  const accessToken = await token();
  const response = await fetch(`${PAYPAL_BASE}${path}`, {
    method: init.method || "GET",
    headers: {
      Authorization: `Bearer ${accessToken}`,
      "Content-Type": "application/json",
      Prefer: "return=representation",
      ...(init.key ? { "PayPal-Request-Id": init.key } : {})
    },
    ...(init.body ? { body: JSON.stringify(init.body) } : {}),
    cache: "no-store"
  });
  const text = await response.text();
  const data = text ? JSON.parse(text) : null;
  if (!response.ok) {
    const detail = data?.details?.[0]?.issue || data?.name || "unknown";
    throw new Error(`PayPal ${response.status}: ${detail}`);
  }
  return data as T | null;
}
export async function createOrder(item: { id: string; title: string; amount_cents: number }) {
  const order = await paypalRequest<PayPalOrder>("/v2/checkout/orders", {
    method: "POST", key: `punchpay-order-${item.id}`,
    body: {
      intent: "AUTHORIZE",
      purchase_units: [{ reference_id: item.id, description: item.title, amount: { currency_code: "USD", value: (item.amount_cents / 100).toFixed(2) } }],
      payment_source: { paypal: { experience_context: { user_action: "CONTINUE", return_url: `${process.env.NEXT_PUBLIC_APP_URL || "http://localhost:3000"}/`, cancel_url: `${process.env.NEXT_PUBLIC_APP_URL || "http://localhost:3000"}/` } } }
    }
  });
  if (!order?.id) throw new Error("PayPal returned no order ID");
  assertMerchantPayee(order);
  return order;
}
export function assertMerchantPayee(order: PayPalOrder) {
  const expected = process.env.PAYPAL_MERCHANT_ID;
  const actual = order.purchase_units?.[0]?.payee?.merchant_id;
  if (!expected) throw new Error("PAYPAL_MERCHANT_ID must be set to contractor business sandbox merchant ID");
  if (!actual) throw new Error("Payee merchant ID missing; cannot verify contractor receives payment");
  if (actual !== expected) throw new Error("Payee mismatch: contractor is not PayPal merchant");
  return actual;
}
export async function authorizeOrder(orderId: string, itemId: string) {
  const order = await paypalRequest<PayPalOrder>(`/v2/checkout/orders/${encodeURIComponent(orderId)}`);
  if (order?.status !== "APPROVED") throw new Error(`Order not approved by buyer (status ${order?.status})`);
  assertMerchantPayee(order);
  const result = await paypalRequest<PayPalOrder>(`/v2/checkout/orders/${encodeURIComponent(orderId)}/authorize`, { method: "POST", body: {}, key: `punchpay-authorize-${itemId}` });
  assertMerchantPayee(result!);
  const authorization = result?.purchase_units?.[0]?.payments?.authorizations?.[0];
  if (!authorization?.id) throw new Error("PayPal returned no authorization ID");
  return authorization;
}
export async function captureAuthorization(authId: string, itemId: string) {
  const r = await paypalRequest<PayPalCapture>(`/v2/payments/authorizations/${encodeURIComponent(authId)}/capture`, { method: "POST", body: { final_capture: true }, key: `punchpay-capture-${itemId}` });
  if (!r?.id) throw new Error("Capture response has no capture ID");
  return r;
}
export async function voidAuthorization(authId: string, itemId: string) {
  await paypalRequest<PayPalAuthorization>(`/v2/payments/authorizations/${encodeURIComponent(authId)}/void`, { method: "POST", body: {}, key: `punchpay-void-${itemId}` });
  const verified = await paypalRequest<PayPalAuthorization>(`/v2/payments/authorizations/${encodeURIComponent(authId)}`);
  if (verified?.status !== "VOIDED") throw new Error("Void requested but PayPal status not yet verified as VOIDED");
  return verified;
}
