import { readFile, writeFile } from "node:fs/promises";
import { PayPalSandbox } from "./paypal-core.mjs";
const stateFile = new URL("../.paypal-sandbox-state.json", import.meta.url);
const cmd = process.argv[2];
const api = new PayPalSandbox({clientId:process.env.PAYPAL_CLIENT_ID,secret:process.env.PAYPAL_CLIENT_SECRET,merchantId:process.env.PAYPAL_MERCHANT_ID});
async function load() { try { return JSON.parse(await readFile(stateFile,"utf8")); } catch { return {}; } }
async function save(data) { await writeFile(stateFile,JSON.stringify(data,null,2)); }
async function main() {
  if (cmd === "create") {
    const s = await load();
    for (const [slug,cents] of [["paint",3000],["tile",2000]]) {
      if (!s[slug]?.orderId) { s[slug] = await api.createItemOrder(slug,cents); await save(s); }
      console.log(`${slug.toUpperCase()} ${cents / 100} USD: ${s[slug].orderId}\n  BUYER APPROVAL: ${s[slug].approveUrl}`);
    }
    console.log("\n1. Open BOTH approval URLs, login as sandbox PERSONAL buyer and approve each one.");
    console.log("2. Only after both approvals, run: npm run sandbox:settle");
    console.log("No charge/capture has occurred yet.");
  } else if (cmd === "settle") {
    const s = await load();
    if (!s.paint?.orderId || !s.tile?.orderId) throw new Error("Run sandbox:create first");
    // Verify both approvals before settling either; failures preserve state for manual inspection.
    for (const slug of ["paint","tile"]) {
      const order = await api.request(`/v2/checkout/orders/${encodeURIComponent(s[slug].orderId)}`);
      if (order?.status !== "APPROVED" && !s[slug].authorizationId) throw new Error(`${slug} order is ${order?.status}, not APPROVED. Reopen approval URL.`);
    }
    for (const slug of ["paint","tile"]) {
      if (!s[slug].authorizationId) {Object.assign(s[slug],await api.approveThenAuthorize(slug,s[slug]));await save(s);}
    }
    if (!s.paint.captureId) {Object.assign(s.paint,await api.capture("paint",s.paint.authorizationId));await save(s);}
    if (s.tile.status !== "VOIDED") {Object.assign(s.tile,await api.void("tile",s.tile.authorizationId));await save(s);}
    console.log("\nVERIFIED SANDBOX OUTCOMES:");
    console.log(`Paint $30 → ${s.paint.status} · Capture ${s.paint.captureId}`);
    console.log(`Tile  $20 → ${s.tile.status} · Authorization ${s.tile.authorizationId}`);
    console.log(`Contractor merchant ID → ${api.merchantId}`);
    console.log("The IDs and statuses above are API-verified; these are sandbox transactions, not real money.");
  } else { throw new Error("Usage: npm run sandbox:create OR npm run sandbox:settle"); }
}
main().catch(error => { console.error("SANDBOX GATE BLOCKED:",error.message);process.exitCode=1; });
