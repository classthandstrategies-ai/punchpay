/**
 * Milestone A proof: two independent AUTHORIZE orders approved by a real sandbox buyer,
 * then CAPTURE paint ($30) and VOID tile ($20), each verified by an independent GET.
 * State is resumable in the gitignored .paypal-sandbox-state.json. Sandbox host only.
 */
import { readFile, writeFile } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import { PayPalSandbox, approvalUrl, amount } from "./paypal-core.mjs";

const stateFile = new URL("../.paypal-sandbox-state.json", import.meta.url);
const cmd = process.argv[2];
const ITEMS = { paint: { cents: 3000, description: "Paint touch-up · Living room north wall" }, tile: { cents: 2000, description: "Tile repair · Kitchen backsplash" } };
const api = new PayPalSandbox({ clientId: process.env.PAYPAL_CLIENT_ID, secret: process.env.PAYPAL_CLIENT_SECRET, merchantId: process.env.PAYPAL_MERCHANT_ID });
const returnUrl = `${process.env.NEXT_PUBLIC_APP_URL || "http://localhost:3000"}/?sandbox-proof=approved`;

async function load() { try { return JSON.parse(await readFile(stateFile, "utf8")); } catch { return {}; } }
async function save(data) { await writeFile(stateFile, JSON.stringify(data, null, 2)); }
const ref = (s, slug) => `proof-${s.run}-${slug}`;
const stamp = () => new Date().toISOString();

async function create() {
  const s = await load();
  if (process.argv.includes("--fresh") || !s.run) { for (const k of Object.keys(s)) delete s[k]; s.run = randomUUID().slice(0, 8); s.started = stamp(); }
  for (const [slug, { cents, description }] of Object.entries(ITEMS)) {
    if (!s[slug]?.orderId) {
      const { order, payee } = await api.createOrder({ referenceId: ref(s, slug), description, cents, requestId: `punchpay-proof-${s.run}-${slug}-order`, returnUrl });
      s[slug] = { orderId: order.id, orderStatus: order.status, approveUrl: approvalUrl(order), payee, amount: amount(cents), createdAt: stamp() };
      if (!s[slug].approveUrl) throw new Error(`${slug}: PayPal returned no approval link`);
      await save(s);
    }
    console.log(`${slug.toUpperCase()} $${amount(cents)} USD · order ${s[slug].orderId} · payee ${s[slug].payee}\n  BUYER APPROVAL: ${s[slug].approveUrl}`);
  }
  console.log("\n1. Open BOTH approval URLs in a browser and log in as the sandbox PERSONAL buyer; approve each.");
  console.log("2. After both approvals, run: npm run sandbox:settle");
  console.log("Nothing has been authorized or captured yet.");
}

async function settle() {
  const s = await load();
  if (!s.paint?.orderId || !s.tile?.orderId) throw new Error("Run sandbox:create first");
  // Confirm BOTH buyer approvals before moving either item.
  for (const slug of Object.keys(ITEMS)) {
    if (s[slug].authorizationId) continue;
    const order = await api.getOrder(s[slug].orderId);
    if (order.status !== "APPROVED" && order.status !== "COMPLETED") throw new Error(`${slug} order is ${order.status}, not APPROVED. Open its approval URL as the sandbox buyer.`);
  }
  for (const [slug, { cents }] of Object.entries(ITEMS)) {
    if (s[slug].authorizationId) continue;
    const { authorization, recovered } = await api.authorizeApproved(s[slug].orderId, { referenceId: ref(s, slug), cents, requestId: `punchpay-proof-${s.run}-${slug}-authorize` });
    Object.assign(s[slug], { authorizationId: authorization.id, authorizationStatus: authorization.status, authorizationExpires: authorization.expiration_time, authorizedAt: stamp(), recovered });
    await save(s);
  }
  if (!s.paint.captureId) {
    const c = await api.captureAuthorization(s.paint.authorizationId, { cents: ITEMS.paint.cents, requestId: `punchpay-capture-${s.paint.authorizationId}` });
    Object.assign(s.paint, { captureId: c.captureId, captureStatus: c.status, capturedAt: stamp() }); await save(s);
  }
  if (s.tile.voidStatus !== "VOIDED") {
    const v = await api.voidAuthorization(s.tile.authorizationId, { cents: ITEMS.tile.cents, requestId: `punchpay-void-${s.tile.authorizationId}` });
    Object.assign(s.tile, { voidStatus: v.status, voidedAt: stamp() }); await save(s);
  }
  await verify(s);
}

/** Independent GETs after the fact; nothing here moves money. */
async function verify(s = null) {
  s = s || await load();
  if (!s.paint?.captureId || !s.tile?.authorizationId) throw new Error("Nothing settled yet; run sandbox:settle");
  const capture = await api.getCapture(s.paint.captureId);
  const paintAuth = await api.verifiedAuthorization(s.paint.authorizationId, ITEMS.paint.cents);
  const tileAuth = await api.verifiedAuthorization(s.tile.authorizationId, ITEMS.tile.cents);
  const result = {
    verifiedAt: stamp(), merchantId: api.merchantId,
    paint: { orderId: s.paint.orderId, authorizationId: paintAuth.id, authorizationStatus: paintAuth.status, captureId: capture.id, captureStatus: capture.status, captureAmount: capture.amount, payee: paintAuth.payee?.merchant_id },
    tile: { orderId: s.tile.orderId, authorizationId: tileAuth.id, authorizationStatus: tileAuth.status, amount: tileAuth.amount, payee: tileAuth.payee?.merchant_id }
  };
  s.verification = result; await save(s);
  console.log("\nINDEPENDENTLY VERIFIED SANDBOX OUTCOMES (GET):");
  console.log(JSON.stringify(result, null, 2));
  const ok = capture.status === "COMPLETED" && tileAuth.status === "VOIDED" && result.paint.payee === api.merchantId && result.tile.payee === api.merchantId;
  console.log(ok ? "\nGATE PASSED: $30 capture COMPLETED, $20 authorization VOIDED, payee = contractor merchant." : "\nGATE NOT PASSED: see statuses above.");
  if (!ok) process.exitCode = 1;
}

const commands = { create, settle, verify: () => verify() };
if (!commands[cmd]) { console.error("Usage: npm run sandbox:create [-- --fresh] | sandbox:settle | sandbox:verify"); process.exit(1); }
commands[cmd]().catch((error) => { console.error("SANDBOX GATE BLOCKED:", error.message); process.exitCode = 1; });
