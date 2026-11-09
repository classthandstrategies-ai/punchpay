/**
 * SimulatedPayPal: an in-memory stand-in for the PayPal sandbox REST API, used ONLY by the offline
 * simulation (/simulation) and the regression tests. It plugs into the real PayPalSandbox client as its
 * `fetchImpl`, so PunchPay's real verification and flow code runs unchanged against it.
 *
 * It never touches the network. Every ID it issues starts with "SIM-" so a simulated reference can
 * never be mistaken for a PayPal transaction. It honours PayPal-Request-Id replay, approval, the
 * AUTHORIZE → CAPTURE / VOID lifecycle, and can inject the faults the demo needs to show.
 */
import { BASE, PayPalSandbox } from "../../scripts/paypal-core.mjs";

type Money = { currency_code: string; value: string };
type Auth = { id: string; status: string; amount: Money; expiration_time: string; payee: { merchant_id: string }; supplementary_data: { related_ids: { order_id: string } }; create_time: string };
type Capture = { id: string; status: string; amount: Money; final_capture: boolean; supplementary_data: { related_ids: { authorization_id: string; order_id: string } }; create_time: string };
type Order = { id: string; intent: string; status: string; purchase_units: { reference_id: string; description?: string; amount: Money; payee: { merchant_id: string } }[]; create_time: string };

export type Faults = {
  /** Next capture is processed by PayPal, but the response never arrives (network drop). One-shot. */
  captureResponseLost?: boolean;
  /** Next capture never reaches PayPal (DNS/connection failure). One-shot. */
  captureUnreachable?: boolean;
  /** Next authorization is DENIED by PayPal (e.g. funding declined). One-shot. */
  authorizationDenied?: boolean;
  /** Next capture comes back DECLINED. One-shot. */
  captureDeclined?: boolean;
};
export type Movement = { kind: "capture" | "void"; resource_id: string; authorization_id: string; amount: string; status: string; request_id: string; at: string };

const json = (status: number, body: unknown) => ({ ok: status < 400, status, json: async () => body, text: async () => JSON.stringify(body) });
const problem = (status: number, issue: string) => json(status, { name: status === 404 ? "RESOURCE_NOT_FOUND" : "UNPROCESSABLE_ENTITY", details: [{ issue }], debug_id: "SIM-DEBUG" });
const clone = <T,>(v: T): T => JSON.parse(JSON.stringify(v));

export class SimulatedPayPal {
  readonly merchantId: string;
  orders = new Map<string, Order>();
  auths = new Map<string, Auth>();
  captures = new Map<string, Capture>();
  /** PayPal-Request-Id → the response PayPal gave the first time (replayed on retry). */
  private replay = new Map<string, { status: number; body: unknown }>();
  /** Every POST that moved (or released) money, in order. The demo shows this as the "PayPal side" ledger. */
  movements: Movement[] = [];
  calls: { method: string; path: string; requestId?: string }[] = [];
  faults: Faults = {};
  private seq = 0;
  private clock: () => number;

  constructor({ merchantId = "SIM-CONTRACTOR-MERCHANT", now = Date.now }: { merchantId?: string; now?: () => number } = {}) {
    this.merchantId = merchantId;
    this.clock = now;
  }

  client() {
    return new PayPalSandbox({ clientId: "SIMULATION-NOT-A-PAYPAL-APP", secret: "SIMULATION", merchantId: this.merchantId, fetchImpl: this.fetch as unknown as typeof fetch });
  }

  private id(prefix: string) { this.seq += 1; return `SIM-${prefix}-${String(this.seq).padStart(4, "0")}${Math.random().toString(36).slice(2, 6).toUpperCase()}`; }
  private iso(offsetMs = 0) { return new Date(this.clock() + offsetMs).toISOString(); }

  /** Order representation as PayPal returns it, with payments nested under the purchase unit. */
  private orderView(order: Order) {
    const auths = [...this.auths.values()].filter((a) => a.supplementary_data.related_ids.order_id === order.id);
    const caps = [...this.captures.values()].filter((c) => c.supplementary_data.related_ids.order_id === order.id);
    return clone({
      ...order,
      purchase_units: order.purchase_units.map((u) => ({ ...u, ...(auths.length || caps.length ? { payments: { ...(auths.length ? { authorizations: auths } : {}), ...(caps.length ? { captures: caps } : {}) } } : {}) })),
      links: [{ rel: "approve", href: `https://simulation.invalid/approve/${order.id}`, method: "GET" }]
    });
  }

  /** The sandbox buyer approving checkout. In the live app only a human in PayPal's window can do this. */
  approve(orderId: string) {
    const order = this.orders.get(orderId);
    if (!order) throw new Error(`No simulated order ${orderId}`);
    if (order.status === "CREATED") order.status = "APPROVED";
  }
  /** Time passing beyond the 29-day authorization validity. */
  expire(authId: string) {
    const auth = this.auths.get(authId);
    if (auth && auth.status === "CREATED") auth.status = "EXPIRED";
  }
  /**
   * PayPal processing a capture that PunchPay never saw the response to: the request outlived the
   * client timeout, so PunchPay gave up, but PayPal completed it server-side afterwards. The
   * capture is discoverable only by a GET of the authorization or its order.
   */
  capture(authId: string) {
    const auth = this.auths.get(authId);
    if (!auth) throw new Error(`No simulated authorization ${authId}`);
    if (auth.status !== "CREATED") throw new Error(`Authorization ${authId} is ${auth.status}, not an open hold`);
    const capture: Capture = { id: this.id("CAPTURE"), status: "COMPLETED", amount: auth.amount, final_capture: true, create_time: this.iso(), supplementary_data: { related_ids: { authorization_id: auth.id, order_id: auth.supplementary_data.related_ids.order_id } } };
    this.captures.set(capture.id, capture);
    auth.status = "CAPTURED";
    this.movements.push({ kind: "capture", resource_id: capture.id, authorization_id: auth.id, amount: capture.amount.value, status: capture.status, request_id: "(late: response never reached PunchPay)", at: this.iso() });
    return capture;
  }
  /**
   * Time passing beyond PayPal's `PayPal-Request-Id` retention, after which a retry with the same
   * ID is treated as a brand-new request instead of replaying the first response — and PayPal
   * signals nothing when this happens. PunchPay must not rely on replay to prevent a second
   * capture; the GET-verified authorization status is the authoritative guard.
   */
  lapseIdempotencyKeys() {
    this.replay.clear();
  }

  fetch = async (url: string, opts: { method?: string; headers?: Record<string, string>; body?: string } = {}) => {
    const method = opts.method || "GET";
    const u = String(url);
    if (!u.startsWith(BASE)) throw new Error("Simulation refuses non-sandbox URLs");
    const path = u.slice(BASE.length);
    const requestId = opts.headers?.["PayPal-Request-Id"];
    this.calls.push({ method, path, requestId });
    if (path === "/v1/oauth2/token") return json(200, { access_token: "SIM-TOKEN", expires_in: 32400 });

    if (method === "POST" && requestId) {
      const key = `${path}::${requestId}`;
      const prior = this.replay.get(key);
      if (prior) return json(prior.status, clone(prior.body));
      const result = this.post(path, opts.body ? JSON.parse(opts.body) : {}, requestId);
      if (result instanceof Error) throw result;
      this.replay.set(key, { status: result.status, body: clone(result.body) });
      if (result.lose) throw new TypeError("fetch failed (simulated: response lost after PayPal processed the request)");
      return json(result.status, result.body);
    }
    if (method !== "GET") return problem(400, "MISSING_REQUEST_ID");

    let m: RegExpMatchArray | null;
    if ((m = path.match(/^\/v2\/checkout\/orders\/([^/]+)$/))) { const o = this.orders.get(decodeURIComponent(m[1])); return o ? json(200, this.orderView(o)) : problem(404, "INVALID_RESOURCE_ID"); }
    if ((m = path.match(/^\/v2\/payments\/authorizations\/([^/]+)$/))) { const a = this.auths.get(decodeURIComponent(m[1])); return a ? json(200, clone(a)) : problem(404, "INVALID_RESOURCE_ID"); }
    if ((m = path.match(/^\/v2\/payments\/captures\/([^/]+)$/))) { const c = this.captures.get(decodeURIComponent(m[1])); return c ? json(200, clone(c)) : problem(404, "INVALID_RESOURCE_ID"); }
    return problem(404, "NOT_FOUND");
  };

  private post(path: string, body: Record<string, unknown>, requestId: string): { status: number; body: unknown; lose?: boolean } | Error {
    let m: RegExpMatchArray | null;
    if (path === "/v2/checkout/orders") {
      const units = (body.purchase_units as Order["purchase_units"]) || [];
      const order: Order = { id: this.id("ORDER"), intent: String(body.intent), status: "CREATED", create_time: this.iso(), purchase_units: units.map((u) => ({ reference_id: u.reference_id, description: u.description, amount: u.amount, payee: { merchant_id: u.payee?.merchant_id || this.merchantId } })) };
      this.orders.set(order.id, order);
      return { status: 201, body: this.orderView(order) };
    }
    if ((m = path.match(/^\/v2\/checkout\/orders\/([^/]+)\/authorize$/))) {
      const order = this.orders.get(decodeURIComponent(m[1]));
      if (!order) return { status: 404, body: { name: "RESOURCE_NOT_FOUND", details: [{ issue: "INVALID_RESOURCE_ID" }] } };
      if (order.status !== "APPROVED") return { status: 422, body: { name: "UNPROCESSABLE_ENTITY", details: [{ issue: "ORDER_NOT_APPROVED" }] } };
      const denied = this.faults.authorizationDenied; this.faults.authorizationDenied = false;
      const unit = order.purchase_units[0];
      const auth: Auth = { id: this.id("AUTH"), status: denied ? "DENIED" : "CREATED", amount: unit.amount, payee: unit.payee, expiration_time: this.iso(29 * 86400_000), create_time: this.iso(), supplementary_data: { related_ids: { order_id: order.id } } };
      this.auths.set(auth.id, auth);
      order.status = "COMPLETED";
      return { status: 201, body: this.orderView(order) };
    }
    if ((m = path.match(/^\/v2\/payments\/authorizations\/([^/]+)\/capture$/))) {
      if (this.faults.captureUnreachable) { this.faults.captureUnreachable = false; return new TypeError("fetch failed (simulated: PayPal unreachable, request never sent)"); }
      const auth = this.auths.get(decodeURIComponent(m[1]));
      if (!auth) return { status: 404, body: { name: "RESOURCE_NOT_FOUND", details: [{ issue: "INVALID_RESOURCE_ID" }] } };
      if (auth.status !== "CREATED") return { status: 422, body: { name: "UNPROCESSABLE_ENTITY", details: [{ issue: auth.status === "CAPTURED" ? "AUTHORIZATION_ALREADY_CAPTURED" : `AUTHORIZATION_${auth.status}` }] } };
      const declined = this.faults.captureDeclined; this.faults.captureDeclined = false;
      const lose = this.faults.captureResponseLost; this.faults.captureResponseLost = false;
      const capture: Capture = { id: this.id("CAPTURE"), status: declined ? "DECLINED" : "COMPLETED", amount: (body.amount as Money) || auth.amount, final_capture: true, create_time: this.iso(), supplementary_data: { related_ids: { authorization_id: auth.id, order_id: auth.supplementary_data.related_ids.order_id } } };
      this.captures.set(capture.id, capture);
      if (!declined) auth.status = "CAPTURED";
      this.movements.push({ kind: "capture", resource_id: capture.id, authorization_id: auth.id, amount: capture.amount.value, status: capture.status, request_id: requestId, at: this.iso() });
      return { status: 201, body: clone(capture), lose };
    }
    if ((m = path.match(/^\/v2\/payments\/authorizations\/([^/]+)\/void$/))) {
      const auth = this.auths.get(decodeURIComponent(m[1]));
      if (!auth) return { status: 404, body: { name: "RESOURCE_NOT_FOUND", details: [{ issue: "INVALID_RESOURCE_ID" }] } };
      if (auth.status !== "CREATED") return { status: 422, body: { name: "UNPROCESSABLE_ENTITY", details: [{ issue: `AUTHORIZATION_${auth.status}` }] } };
      auth.status = "VOIDED";
      this.movements.push({ kind: "void", resource_id: auth.id, authorization_id: auth.id, amount: auth.amount.value, status: "VOIDED", request_id: requestId, at: this.iso() });
      return { status: 204, body: null };
    }
    return { status: 404, body: { name: "RESOURCE_NOT_FOUND", details: [{ issue: "NOT_FOUND" }] } };
  }
}
