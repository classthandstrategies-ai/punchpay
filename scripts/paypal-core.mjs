/** Dependency-free PayPal sandbox client. No production hostname accepted. */
export const BASE = "https://api-m.sandbox.paypal.com";
export function amount(cents) {
  if (!Number.isInteger(cents) || cents <= 0 || cents > 100000) throw new Error("Invalid cents amount");
  return (cents/100).toFixed(2);
}
export function assertPayee(order, expectedMerchantId) {
  if (!expectedMerchantId) throw new Error("PAYPAL_MERCHANT_ID is mandatory");
  const id = order?.purchase_units?.[0]?.payee?.merchant_id;
  if (!id || id !== expectedMerchantId) throw new Error(`Payee merchant mismatch: expected ${expectedMerchantId}, returned ${id || "not reported"}`);
  return id;
}
export function getAuth(order) {
  const auth = order?.purchase_units?.[0]?.payments?.authorizations?.[0];
  if (!auth?.id) throw new Error("No authorization returned");
  return auth;
}
export class PayPalSandbox {
  constructor({clientId, secret, merchantId, fetchImpl=fetch}) {
    if (!clientId || !secret || !merchantId) throw new Error("PAYPAL_CLIENT_ID, PAYPAL_CLIENT_SECRET and PAYPAL_MERCHANT_ID required");
    this.clientId = clientId; this.secret = secret; this.merchantId = merchantId; this.fetch = fetchImpl;
  }
  async token() {
    const auth = Buffer.from(`${this.clientId}:${this.secret}`).toString("base64");
    const response = await this.fetch(`${BASE}/v1/oauth2/token`, {method:"POST",headers:{Authorization:`Basic ${auth}`,"Content-Type":"application/x-www-form-urlencoded"},body:"grant_type=client_credentials"});
    const json = await response.json();
    if (!response.ok || !json.access_token) throw new Error(`PayPal OAuth error ${response.status}: ${json.error || "no token"}`);
    return json.access_token;
  }
  async request(path, {method="GET",body,requestId}={}) {
    if (!path.startsWith("/v2/")) throw new Error("Only PayPal v2 sandbox API paths permitted");
    const bearer = await this.token();
    const res = await this.fetch(`${BASE}${path}`, {method, headers:{Authorization:`Bearer ${bearer}`,"Content-Type":"application/json",Prefer:"return=representation",...(requestId?{"PayPal-Request-Id":requestId}:{})}, ...(body?{body:JSON.stringify(body)}:{})});
    const text = await res.text();
    const json = text ? JSON.parse(text) : null;
    if (!res.ok) throw new Error(`PayPal ${res.status}: ${json?.details?.[0]?.issue || json?.name || text.slice(0,180)}`);
    return json;
  }
  async createItemOrder(slug,cents) {
    const order = await this.request("/v2/checkout/orders", {method:"POST",requestId:`punchpay-smoke-${slug}-order`,body:{intent:"AUTHORIZE",purchase_units:[{reference_id:slug,description:slug === "paint" ? "Paint touch-up" : "Tile repair",amount:{currency_code:"USD",value:amount(cents)}}],payment_source:{paypal:{experience_context:{return_url:"http://localhost:3000/",cancel_url:"http://localhost:3000/"}}}}});
    assertPayee(order,this.merchantId);
    if (!order.id) throw new Error("Order ID missing");
    const approveUrl = order.links?.find(link=>link.rel === "payer-action" || link.rel === "approve")?.href;
    if (!approveUrl) throw new Error("Approval link missing");
    return {orderId:order.id,approveUrl,merchantId:this.merchantId,cents};
  }
  async approveThenAuthorize(slug,record) {
    const order = await this.request(`/v2/checkout/orders/${encodeURIComponent(record.orderId)}`);
    assertPayee(order,this.merchantId);
    if (order.status !== "APPROVED") throw new Error(`${slug}: buyer has not approved order (status ${order.status})`);
    const authorized = await this.request(`/v2/checkout/orders/${encodeURIComponent(record.orderId)}/authorize`,{method:"POST",body:{},requestId:`punchpay-smoke-${slug}-authorize`});
    assertPayee(authorized,this.merchantId);
    const auth = getAuth(authorized);
    return {authorizationId:auth.id, authorizationStatus:auth.status};
  }
  async capture(slug,authId) {
    const capture = await this.request(`/v2/payments/authorizations/${encodeURIComponent(authId)}/capture`,{method:"POST",body:{final_capture:true},requestId:`punchpay-smoke-${slug}-capture`});
    if (!capture?.id) throw new Error("Capture ID missing");
    const verified = await this.request(`/v2/payments/captures/${encodeURIComponent(capture.id)}`);
    if (verified?.status !== "COMPLETED") throw new Error(`Capture not completed (status: ${verified?.status || "missing"})`);
    return {captureId:capture.id,status:verified.status};
  }
  async void(slug,authId) {
    await this.request(`/v2/payments/authorizations/${encodeURIComponent(authId)}/void`,{method:"POST",body:{},requestId:`punchpay-smoke-${slug}-void`});
    const verified = await this.request(`/v2/payments/authorizations/${encodeURIComponent(authId)}`);
    if (verified?.status !== "VOIDED") throw new Error(`Void not verified (status: ${verified?.status || "missing"})`);
    return {authorizationId:authId,status:verified.status};
  }
}
