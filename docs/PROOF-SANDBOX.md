# PayPal sandbox proof (Milestone A)

**Status: NOT YET RUN.** No sandbox credentials have been configured, so no order, authorization, capture or void has happened. This file will only be filled in with values observed from the PayPal sandbox API. Nothing here is a placeholder for a real result.

## What the proof does
`scripts/paypal-smoke.mjs`, which uses the same `scripts/paypal-core.mjs` client as the web app:

1. `npm run sandbox:create`: creates two Orders v2 `intent: AUTHORIZE` orders ($30.00 paint, $20.00 tile), each with `purchase_units[0].payee.merchant_id` explicitly set to `PAYPAL_MERCHANT_ID`. Each response is checked for the exact amount, reference, and that the payee returned equals the contractor merchant. Prints two buyer approval links.
2. A human logs in as the sandbox **Personal** buyer and approves both links. The script cannot do this step.
3. `npm run sandbox:settle`:
   - refuses to continue unless both orders are `APPROVED`;
   - authorizes both, with a stable `PayPal-Request-Id` for each;
   - GETs each authorization to verify payee and amount;
   - captures $30.00 on paint and voids tile.
4. `npm run sandbox:verify`: independent GETs of the capture and both authorizations. Nothing here moves money. It prints a PASS/FAIL line per check and passes only if all of these hold:
   - the paint capture is `COMPLETED` for exactly $30.00;
   - the capture belongs to the paint authorization (checked whenever PayPal reports the link);
   - the paint authorization is `CAPTURED`;
   - the tile authorization is `VOIDED`;
   - both authorizations name the contractor as payee, directly or via their parent order.

Re-running `create`, `settle` or `verify` is safe. Saved orders are reused, completed steps are skipped, and retries use the same `PayPal-Request-Id`. `npm run sandbox:create -- --fresh` starts a new run.

**Offline rehearsal (not proof):** `tests/proof-rehearsal.test.mjs` runs these exact commands against the in-memory simulator. It covers four cases:
- partial approval is refused
- the full pass moves money exactly twice
- reruns move nothing
- a declined capture fails the gate, and a payee mismatch blocks settle before money moves

It shows the script is ready; it says nothing about PayPal's real responses.

## Payee verification approach
From the official Orders v2 / Payments v2 OpenAPI schemas (read Nov 8, 2026):
- `purchase_units[].payee` (`merchant_id`, `email_address`) is an accepted Create Order request field and is returned in the order representation when `Prefer: return=representation` is sent.
- `GET /v2/payments/authorizations/{id}` includes a read-only `payee` object.

So the contractor is named explicitly at order creation and then re-verified on the order, on the authorization, and again immediately before capture or void. If an authorization response omits `payee`, the client GETs its parent order (from `supplementary_data.related_ids.order_id`, which must match the stored order) and verifies the payee there; the path used is recorded as `payeeVerifiedVia`. If neither source names the contractor, the operation fails. The payee check is never skipped.

## Observed results
_To be completed from real `sandbox:verify` output. Client secrets and buyer personal data are omitted._

| Field | Paint ($30) | Tile ($20) |
| --- | --- | --- |
| Order ID | | |
| Authorization ID | | |
| Capture ID | | n/a |
| Final status (GET) | | |
| Payee merchant ID (GET) | | |
| Timestamp (UTC) | | |
