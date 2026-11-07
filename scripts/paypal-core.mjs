/**
 * Dependency-free PayPal SANDBOX client shared by the Next.js routes and the CLI proof tool.
 * - Only the sandbox host is reachable; there is no way to configure a live host.
 * - Every money-moving POST carries a caller-supplied, stable PayPal-Request-Id.
 * - Every resource is re-verified (payee merchant, amount, item reference) before money moves.
 */
export const BASE = "https://api-m.sandbox.paypal.com";
/**
 * Per-request timeout. Keeps every PayPal call far shorter than the reconcile in-flight window
 * (lib/flows.ts IN_FLIGHT_MS), so a reconcile can never race a capture/void that is still running here.
 */
export const REQUEST_TIMEOUT_MS = 15_000;
const basic = (s) => (typeof Buffer !== "undefined" ? Buffer.from(s).toString("base64") : btoa(s));
const timeoutSignal = (ms) => (typeof AbortSignal !== "undefined" && AbortSignal.timeout ? AbortSignal.timeout(ms) : undefined);

/** A PunchPay verification failure. Its message is written for people and safe to show in the UI. */
export class VerificationError extends Error {
  constructor(message) { super(message); this.name = "VerificationError"; }
}

export function amount(cents) {
  if (!Number.isInteger(cents) || cents <= 0 || cents > 100000) throw new VerificationError("Invalid cents amount");
  return (cents / 100).toFixed(2);
}

/** Works for an order (purchase_units[0].payee) or a Payments v2 authorization (payee). */
export function assertPayee(resource, expectedMerchantId) {
  if (!expectedMerchantId) throw new VerificationError("PAYPAL_MERCHANT_ID is mandatory");
  const id = resource?.purchase_units?.[0]?.payee?.merchant_id ?? resource?.payee?.merchant_id;
  if (!id || id !== expectedMerchantId) throw new VerificationError(`Payee merchant mismatch: expected ${expectedMerchantId}, returned ${id || "not reported"}`);
  return id;
}

export function assertAmount(money, cents, label = "amount") {
  const expected = amount(cents);
  if (!money || money.currency_code !== "USD" || money.value !== expected)
    throw new VerificationError(`PayPal ${label} mismatch: expected USD ${expected}, returned ${money ? `${money.currency_code} ${money.value}` : "none"}`);
}

/** The order must belong to this item, pay this merchant, and be for exactly the server-defined amount. */
export function assertOrderMatches(order, { referenceId, cents, merchantId }) {
  const unit = order?.purchase_units?.[0];
  if (!unit) throw new VerificationError("PayPal order has no purchase unit");
  if (order.purchase_units.length !== 1) throw new VerificationError("PayPal order must have exactly one purchase unit");
  if (referenceId && unit.reference_id !== referenceId) throw new VerificationError(`Order belongs to ${unit.reference_id || "unknown"}, not ${referenceId}`);
  assertAmount(unit.amount, cents, "order amount");
  return assertPayee(order, merchantId);
}

export function getAuth(order) {
  const auth = order?.purchase_units?.[0]?.payments?.authorizations?.[0];
  if (!auth?.id) throw new VerificationError("No authorization returned");
  return auth;
}

export function getCaptureFromOrder(order) {
  return order?.purchase_units?.[0]?.payments?.captures?.[0] ?? null;
}

export function approvalUrl(order) {
  return order?.links?.find((link) => link.rel === "payer-action" || link.rel === "approve")?.href ?? null;
}

/** Runs post-POST verification; any failure is tagged so callers never mistake it for "nothing was sent". */
async function afterSend(fn) {
  try { return await fn(); } catch (error) { if (error && typeof error === "object") error.afterSend = true; throw error; }
}

export class PayPalError extends Error {
  constructor(message, { status, issue, debugId } = {}) {
    super(message);
    this.name = "PayPalError";
    this.status = status;
    this.issue = issue;
    this.debugId = debugId;
  }
}

export class PayPalSandbox {
  constructor({ clientId, secret, merchantId, fetchImpl, timeoutMs = REQUEST_TIMEOUT_MS }) {
    if (!clientId || !secret || !merchantId) throw new Error("PAYPAL_CLIENT_ID, PAYPAL_CLIENT_SECRET and PAYPAL_MERCHANT_ID required");
    this.clientId = clientId; this.secret = secret; this.merchantId = merchantId; this.timeoutMs = timeoutMs;
    this.fetch = fetchImpl || ((...args) => fetch(...args));
    this.cachedToken = null; this.tokenExpiresAt = 0;
  }

  async token() {
    if (this.cachedToken && Date.now() < this.tokenExpiresAt) return this.cachedToken;
    const auth = basic(`${this.clientId}:${this.secret}`);
    const response = await this.fetch(`${BASE}/v1/oauth2/token`, { method: "POST", headers: { Authorization: `Basic ${auth}`, "Content-Type": "application/x-www-form-urlencoded" }, body: "grant_type=client_credentials", cache: "no-store", signal: timeoutSignal(this.timeoutMs) });
    const json = await response.json();
    if (!response.ok || !json.access_token) throw new PayPalError(`PayPal OAuth error ${response.status}: ${json.error || "no token"}`, { status: response.status });
    this.cachedToken = json.access_token;
    this.tokenExpiresAt = Date.now() + Math.max(0, (Number(json.expires_in) || 0) - 120) * 1000;
    return this.cachedToken;
  }

  async request(path, { method = "GET", body, requestId } = {}) {
    if (!path.startsWith("/v2/")) throw new Error("Only PayPal v2 sandbox API paths permitted");
    if (method === "POST" && !requestId) throw new Error("POST requires a stable PayPal-Request-Id");
    const bearer = await this.token();
    const res = await this.fetch(`${BASE}${path}`, {
      method, cache: "no-store", signal: timeoutSignal(this.timeoutMs),
      headers: { Authorization: `Bearer ${bearer}`, "Content-Type": "application/json", Prefer: "return=representation", ...(requestId ? { "PayPal-Request-Id": requestId } : {}) },
      ...(body ? { body: JSON.stringify(body) } : {})
    });
    const text = await res.text();
    let json = null;
    try { json = text ? JSON.parse(text) : null; } catch { json = null; }
    if (!res.ok) {
      const issue = json?.details?.[0]?.issue || json?.name || "unexpected response";
      throw new PayPalError(`PayPal ${res.status}: ${issue}${json?.debug_id ? ` (debug ${json.debug_id})` : ""}`, { status: res.status, issue, debugId: json?.debug_id });
    }
    return json;
  }

  getOrder(orderId) { return this.request(`/v2/checkout/orders/${encodeURIComponent(orderId)}`); }
  getAuthorization(authId) { return this.request(`/v2/payments/authorizations/${encodeURIComponent(authId)}`); }
  getCapture(captureId) { return this.request(`/v2/payments/captures/${encodeURIComponent(captureId)}`); }

  /** AUTHORIZE-intent order with the contractor explicitly named as payee. */
  async createOrder({ referenceId, description, cents, requestId, returnUrl, cancelUrl }) {
    const unit = { reference_id: referenceId, description, amount: { currency_code: "USD", value: amount(cents) }, payee: { merchant_id: this.merchantId } };
    const body = { intent: "AUTHORIZE", purchase_units: [unit] };
    if (returnUrl) body.payment_source = { paypal: { experience_context: { user_action: "CONTINUE", shipping_preference: "NO_SHIPPING", return_url: returnUrl, cancel_url: cancelUrl || returnUrl } } };
    const order = await this.request("/v2/checkout/orders", { method: "POST", requestId, body });
    if (!order?.id) throw new VerificationError("PayPal returned no order ID");
    // If the create response omits the payee, verify it on the stored order instead (never skip it).
    const verified = order.purchase_units?.[0]?.payee?.merchant_id ? order : { ...order, ...(await this.getOrder(order.id)), links: order.links };
    const payee = assertOrderMatches(verified, { referenceId, cents, merchantId: this.merchantId });
    return { order: verified, payee };
  }

  /**
   * Authorize a buyer-approved order. Re-entrant: if a previous authorize succeeded but its
   * response was lost, the order is COMPLETED and the existing authorization is returned.
   */
  async authorizeApproved(orderId, { referenceId, cents, requestId }) {
    const order = await this.getOrder(orderId);
    assertOrderMatches(order, { referenceId, cents, merchantId: this.merchantId });
    let auth = order?.purchase_units?.[0]?.payments?.authorizations?.[0];
    if (!auth) {
      if (order.status !== "APPROVED") throw new VerificationError(`Order not approved by buyer (status ${order.status})`);
      const authorized = await this.request(`/v2/checkout/orders/${encodeURIComponent(orderId)}/authorize`, { method: "POST", body: {}, requestId });
      assertOrderMatches(authorized, { referenceId, cents, merchantId: this.merchantId });
      auth = getAuth(authorized);
    }
    assertAmount(auth.amount, cents, "authorization amount");
    // Only an open authorization is a real hold. DENIED/VOIDED/PENDING must never be recorded as "funds held".
    if (auth.status !== "CREATED") throw new VerificationError(`PayPal authorization is ${auth.status}, not an open hold`);
    return { authorization: auth, recovered: order.status === "COMPLETED", payee: this.merchantId };
  }

  /**
   * Verified Payments v2 authorization owned by this merchant, for this exact amount.
   * The authorization GET documents a read-only `payee`. If a response omits it, the payee is
   * verified through the parent order instead (which must also list this authorization), never skipped.
   */
  async verifiedAuthorization(authId, cents, orderId) {
    const auth = await this.getAuthorization(authId);
    if (auth?.id !== authId) throw new VerificationError("PayPal returned a different authorization");
    assertAmount(auth.amount, cents, "authorization amount");
    // Order ownership: an authorization that PayPal links to a different order is never accepted for this item.
    const related = auth.supplementary_data?.related_ids?.order_id;
    if (related && orderId && related !== orderId) throw new VerificationError(`Authorization belongs to order ${related}, not ${orderId}`);
    if (auth.payee?.merchant_id) { assertPayee(auth, this.merchantId); auth.payeeVerifiedVia = "authorization"; return auth; }
    const parent = auth.supplementary_data?.related_ids?.order_id || orderId;
    if (!parent) throw new VerificationError("Authorization reports no payee and no parent order; cannot verify who is paid");
    const order = await this.getOrder(parent);
    assertPayee(order, this.merchantId);
    if (!order.purchase_units?.[0]?.payments?.authorizations?.some((a) => a.id === authId)) throw new VerificationError("Parent order does not contain this authorization");
    auth.payeeVerifiedVia = "parent_order";
    return auth;
  }

  async captureAuthorization(authId, { cents, requestId, orderId }) {
    const auth = await this.verifiedAuthorization(authId, cents, orderId);
    // CAPTURED is allowed only as an idempotent replay of our own request ID (PayPal returns latest status).
    if (!["CREATED", "PENDING", "CAPTURED"].includes(auth.status)) throw new VerificationError(`Authorization cannot be captured (status ${auth.status})`);
    const capture = await this.request(`/v2/payments/authorizations/${encodeURIComponent(authId)}/capture`, { method: "POST", requestId, body: { amount: { currency_code: "USD", value: amount(cents) }, final_capture: true } });
    return afterSend(async () => {
      if (!capture?.id) throw new VerificationError("Capture response has no capture ID");
      const verified = await this.getCapture(capture.id);
      assertAmount(verified?.amount, cents, "capture amount");
      return { captureId: capture.id, status: verified?.status || capture.status };
    });
  }

  async voidAuthorization(authId, { cents, requestId, orderId }) {
    const auth = await this.verifiedAuthorization(authId, cents, orderId);
    if (auth.status === "CREATED" || auth.status === "PENDING") {
      await this.request(`/v2/payments/authorizations/${encodeURIComponent(authId)}/void`, { method: "POST", body: {}, requestId });
    } else if (auth.status !== "VOIDED") throw new VerificationError(`Authorization cannot be voided (status ${auth.status})`);
    return afterSend(async () => {
      const verified = await this.getAuthorization(authId);
      if (verified?.status !== "VOIDED") throw new VerificationError(`Void not verified (status: ${verified?.status || "missing"})`);
      return { authorizationId: authId, status: verified.status };
    });
  }
}
