# PayPal sandbox proof (Milestone A)

**Status: PASSED — verified against the live PayPal sandbox on November 12, 2026, twice: once by the CLI proof (Gate 1) and once through the web application in a browser (Gate 4).** Every value below was returned by the PayPal sandbox REST API and re-read by an independent GET. Nothing here is a placeholder, a simulated reference or a reconstruction: simulated runs use `SIM-` prefixed references and never appear in this file.

Sandbox only. No live PayPal credentials were ever configured, and no real money moved.

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

**Observed on Nov 12, 2026:** `GET /v2/payments/authorizations/{id}` returned `payee` directly for both authorizations, so `payeeVerifiedVia` was `authorization` in each case and the parent-order fallback was not needed. The fallback remains in the client and is exercised by `tests/paypal-core.test.mjs`.

## Observed results
Taken from `npm run sandbox:verify` output and the resumable run state. Client ID and secret, the buyer's sandbox login and any buyer personal data are deliberately omitted; order, authorization and capture identifiers are sandbox references and are not secrets.

**Contractor merchant (payee): `F8MFAQQFR7JKA`** — the sandbox Business account. The same value was returned on both authorizations.

| Field | Paint ($30.00) | Tile ($20.00) |
| --- | --- | --- |
| Order ID | `9T461067HF380173V` | `7SA994956R697914G` |
| Authorization ID | `8KY824692F2241736` | `8US079184H1917233` |
| Capture ID | `27X98859PG133501W` | n/a — voided, never captured |
| Final status (GET) | authorization `CAPTURED`, capture `COMPLETED` | authorization `VOIDED` |
| Amount confirmed by GET | `USD 30.00` | `USD 20.00` |
| Payee merchant ID (GET) | `F8MFAQQFR7JKA` | `F8MFAQQFR7JKA` |
| Payee verified via | `authorization` | `authorization` |
| Order created (UTC) | 2026-11-12T10:08:28.991Z | 2026-11-12T10:08:29.866Z |
| Authorized (UTC) | 2026-11-12T10:15:33.191Z | 2026-11-12T10:15:36.073Z |
| Settled (UTC) | captured 2026-11-12T10:15:41.199Z | voided 2026-11-12T10:15:43.609Z |

Run `c9c6209b`, started 2026-11-12T10:08:27.261Z.

### Gate output
`npm run sandbox:verify` performs GETs only and moves no money. It was run more than once; the
run recorded at `verifiedAt: 2026-11-12T10:19:25.462Z` printed:

```
PASS  paint capture COMPLETED for $30.00
PASS  paint capture belongs to the paint authorization
PASS  paint authorization CAPTURED
PASS  tile authorization VOIDED

GATE PASSED: $30 capture COMPLETED, $20 authorization VOIDED, payee = contractor merchant.
```

Re-running `verify` reproduces the same statuses, because the two authorizations are now terminal
(`CAPTURED` and `VOIDED`) and PayPal keeps returning those states.

## Gate 4 — browser-driven run (November 12, 2026)
A second, independent run through the **web application** against the same sandbox merchant: a fresh
dedicated Supabase project, the PayPal JS SDK in the browser, a human buyer approval in PayPal's own
checkout, and the app's own capture and void paths. None of the Gate 1 identifiers above were reused;
every reference below is new and was returned by PayPal to the running application.

| Field | Paint ($30.00) | Tile ($20.00) |
| --- | --- | --- |
| Order (created by the app, `intent: AUTHORIZE`) | `8UH8678723976961K` | `6G652729U10026153` |
| Buyer approval | sandbox Personal account, in PayPal's checkout, by a human | same |
| Authorization (via SDK `onApprove` → `/authorize`) | `09R969356M704910B` | `34202835AN046440U` |
| Capture (via homeowner **Accept**) | `137441455G861562T` · **COMPLETED** · USD 30.00 · `final_capture: true` | n/a — homeowner **Reject** |
| Final authorization status (GET) | **CAPTURED** | **VOIDED** |
| Payee merchant ID (GET, via `authorization`) | `F8MFAQQFR7JKA` | `F8MFAQQFR7JKA` |
| Captures on the order (GET) | **exactly 1** | **0** |
| Order created (UTC) | 2026-11-12T10:45:40Z | 2026-11-12T10:45:41Z |
| Authorized (UTC) | 2026-11-12T10:56:25Z | 2026-11-12T10:57:30Z |
| Decided / settled (UTC) | accepted 11:00:16 · capture 11:00:18 · verified 11:00:21 | rejected 11:00:25 · void verified 11:00:30 |

Independent re-reads after everything settled, including after a deliberate duplicate "accept" and a
reconcile: `GET /v2/payments/captures/137441455G861562T` → `COMPLETED`, linked to authorization
`09R969356M704910B` and order `8UH8678723976961K`; the paint order still lists **one** capture; the tile
order lists **zero** captures and one `VOIDED` authorization.

Also verified in this run:
- **Persistence.** Supabase `punch_items` ends at `captured` / `voided` with the IDs above, `payee_merchant_id`
  recorded, `last_error` null. The append-only `audit_events` log holds 14 events in order: two
  `order_created`, two `authorization_verified`, four evidence uploads, two `evidence_reviewed`,
  `decision_accepted`, `capture_verified`, `decision_rejected`, `void_verified`. The audit carries exactly
  one distinct capture ID, which is what the closeout's "0 duplicate captures" is measured from.
- **Refresh.** A full page reload keeps both outcomes and the $50 / $30 / $20 / 0 closeout.
- **Reconcile is GET-only.** `/sync` on both items re-read PayPal and reported the existing states; nothing moved.
- **Duplicate and flipped decisions.** A second "accept" on paint was answered from the record
  (`already: true`, same capture ID, no PayPal call); an attempt to flip it to "reject" was refused (409).
- **Evidence.** Four images uploaded through the browser, re-encoded server-side with metadata stripped,
  stored under UUID names in the private bucket and shown through short-lived signed URLs. They are the
  project's **labelled synthetic illustrations** (each stamped "SYNTHETIC ILLUSTRATION · NOT A PHOTO"),
  not photographs.
- **No AI analysis occurred.** Both reviews were recorded on the credential-free prototype path with
  `source: prototype_no_model`, assessment `insufficient_evidence`, every criterion `uncertain`, and the
  report itself states that no model examined the photos. The audit records that source. The decisions
  and the money were unaffected: `decide()` never reads the review.
- **Authorization.** Against the live server: 401 without a passcode, 403 when the contractor tries to
  decide or the homeowner tries to review, 404 for unknown or malformed item IDs, and browser-supplied
  `capture_id` / `authorization_id` / `amount_cents` are ignored.

### What this does and does not prove
Proven against the live sandbox API:
- two independent Orders v2 `AUTHORIZE` orders, each naming the contractor as `payee.merchant_id`;
- a human approved each order in PayPal's own sandbox checkout — this step cannot be automated or forged, and `settle` refuses to run until PayPal reports both orders `APPROVED`;
- one Payments v2 capture of exactly $30.00, `COMPLETED`, linked by PayPal to the paint authorization;
- one Payments v2 void, leaving the tile authorization `VOIDED` with nothing charged;
- both outcomes re-read by independent GETs, with the payee re-verified from the authorization resource itself.

Not proven here, and not claimed anywhere in this repository:
- no live-environment PayPal behaviour (sandbox only);
- no statement about `PayPal-Request-Id` retention beyond what PayPal documents — see [INTEGRATION-PLAN](INTEGRATION-PLAN.md);
- no AI involvement in any payment outcome. The advisory review is never read by `decide()`, and at the time of this run no Anthropic key was configured, so no live model review exists.
