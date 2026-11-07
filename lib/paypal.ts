import "server-only";
import { PayPalSandbox } from "@/scripts/paypal-core.mjs";
export type { PayPalOrder, PayPalAuthorization, PayPalCapture } from "@/scripts/paypal-core.mjs";
export { getCaptureFromOrder, PayPalError } from "@/scripts/paypal-core.mjs";

let client: PayPalSandbox | null = null;
/** Single sandbox client built from server-only env. The live PayPal host is not reachable from this code. */
export function paypal() {
  if (!client) client = new PayPalSandbox({ clientId: process.env.PAYPAL_CLIENT_ID, secret: process.env.PAYPAL_CLIENT_SECRET, merchantId: process.env.PAYPAL_MERCHANT_ID });
  return client;
}
export function paypalConfigured() {
  return !!(process.env.PAYPAL_CLIENT_ID && process.env.PAYPAL_CLIENT_SECRET && process.env.PAYPAL_MERCHANT_ID);
}

/** Map a PayPal capture status to item state. Only COMPLETED is "paid"; failures are never shown as in progress. */
export function captureState(status: string | undefined): "captured" | "capture_pending" | "payment_error" {
  if (status === "COMPLETED" || status === "PARTIALLY_REFUNDED" || status === "REFUNDED") return "captured";
  if (status === "PENDING") return "capture_pending";
  return "payment_error";
}

/**
 * Stable request IDs keyed to the PayPal resource being acted on, so a retry after a
 * network failure replays the original request instead of duplicating money movement.
 * `attempt` only increments when an unapproved order is deliberately abandoned.
 */
export const requestIds = {
  order: (itemId: string, attempt: number) => `punchpay-order-${itemId}-${attempt}`,
  authorize: (orderId: string) => `punchpay-authorize-${orderId}`,
  capture: (authId: string) => `punchpay-capture-${authId}`,
  void: (authId: string) => `punchpay-void-${authId}`
};
