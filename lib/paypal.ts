import "server-only";
import { PayPalSandbox } from "@/scripts/paypal-core.mjs";
export type { PayPalOrder, PayPalAuthorization, PayPalCapture } from "@/scripts/paypal-core.mjs";
export { getCaptureFromOrder, PayPalError } from "@/scripts/paypal-core.mjs";
export { requestIds, captureState } from "./flows";

let client: PayPalSandbox | null = null;
/** Single sandbox client built from server-only env. The live PayPal host is not reachable from this code. */
export function paypal() {
  if (!client) client = new PayPalSandbox({ clientId: process.env.PAYPAL_CLIENT_ID, secret: process.env.PAYPAL_CLIENT_SECRET, merchantId: process.env.PAYPAL_MERCHANT_ID });
  return client;
}
export function paypalConfigured() {
  return !!(process.env.PAYPAL_CLIENT_ID && process.env.PAYPAL_CLIENT_SECRET && process.env.PAYPAL_MERCHANT_ID);
}
