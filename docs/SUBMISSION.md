# Devpost submission: PunchPay

> Every claim under **Technical proof** is taken from `docs/PROOF-SANDBOX.md`, which holds only values returned by the PayPal sandbox API. Nothing below claims more than was run.

## Tagline
Every fix reviewed. Every payment decided.

## Inspiration
At the end of a renovation the last one percent causes most of the friction. Small leftover fixes (a scuff, a cracked tile) hold up the whole final payment. Homeowners don't want to pay for work they can't verify. Contractors don't want finished work held hostage by one unresolved item.

## What it does
PunchPay turns each leftover fix into its own small, independent payment decision:
1. **A separate hold per fix.** The homeowner approves a PayPal authorization for each item: $30 for paint, $20 for tile. Funds are held, not paid.
2. **Evidence.** The contractor uploads before-and-after photos to private storage. They are re-encoded server-side with camera and location metadata stripped, and shown only through short-lived signed links.
3. **An advisory review that never decides.** The review slot reports, per pre-agreed criterion, whether the photos support it, and lists what the photos cannot show. It is advisory only: the payment code never reads it.
4. **A human decision.** The homeowner accepts, which captures that item's authorization, or rejects, which voids it. One rejection never touches the other item's money.

## What is real in this submission, and what is not
Three things look alike on screen and are not alike. We label each one in the UI, in the audit log and here.

| | What it is | Where you see it |
| --- | --- | --- |
| **Genuine PayPal sandbox integration** | Real Orders v2 `AUTHORIZE` orders, a real buyer approval in PayPal's own sandbox checkout, real Payments v2 capture and void, every outcome re-read by an independent GET. Sandbox only; no real money. | The live app (passcode-gated), badge "Sandbox", ledger references, `docs/PROOF-SANDBOX.md` |
| **Offline simulator** | An in-browser stand-in for PayPal that runs the same decision and reconcile code with no network. References begin `SIM-` and are never PayPal transactions. | `/simulation`, badge "Simulation", six labeled scenarios |
| **Review without a model (`prototype_no_model`)** | We did not purchase an Anthropic API key for this submission, so **no Claude or other vision model analysed the demo photographs.** With `PUNCHPAY_PROTOTYPE_REVIEW=1` the app records a review that says exactly that: no model call, every criterion "uncertain — not assessed", assessment always "insufficient evidence". It can never say the work looks satisfactory. | A red banner on the report, the source line "Prototype path · no model call was made · not analysis", audit actor "Prototype review (no model)" |

The real vision path (`lib/ai.ts`) now supports Gemini 2.5 Flash (free API tier where available) or Claude, using two images, structured criterion-by-criterion output, server-side validation and uncertainty guards. The original certified demo used no model. **Do not claim Gemini or Claude was exercised unless a genuine model response has subsequently been recorded, with timestamps and screenshots.** A configured Claude key takes precedence over a Gemini key.

**The demo photographs are synthetic illustrations, not photographs.** They are SVG drawings rasterised to PNG; each carries the stamp "SYNTHETIC ILLUSTRATION · NOT A PHOTO" in the image itself, and the dashed ring on the "before" image is drawn into the artwork to mark the defect. It is not AI detection.

## How we built it
- **Next.js 16 + TypeScript.** Every money-moving call runs server-side.
- **PayPal Orders v2** (`intent: AUTHORIZE`, the contractor named explicitly as `payee.merchant_id`) and **Payments v2** (capture, void, GET verification), plus the PayPal JS SDK for buyer approval in the browser. A stable `PayPal-Request-Id` is keyed to each PayPal resource, so a retry inside PayPal's retention window replays instead of moving money twice. That window is short and PayPal does not signal when it lapses, so the authoritative guard is a GET of the authorization before every capture or void: PunchPay never relies on replay alone.
- **Supabase Postgres + private Storage.** A database trigger enforces the item state machine and makes PayPal IDs and decisions immutable once recorded; the audit log is append-only; browsers have no direct table or storage access. We verified the guards on the live project by attempting illegal updates: all refused.
- **Review slot.** `lib/ai.ts` (Claude vision, structured output, guardrails) when a key exists; `lib/ai-prototype.ts` (no model, labeled) when it does not. The decision code reads neither.
- **Tests.** 50 Node tests (payment flows, PayPal client, image checks, simulator scenarios, proof-script rehearsal, prototype-path safety), SQL guard tests on PostgreSQL 16, and 28 Playwright runs with axe accessibility scans on desktop and Pixel 7.

## Challenges
- **Lost responses.** If a capture times out, did PayPal capture? PunchPay parks the item as "needs reconciliation" and resolves it only by GET. It never retries money movement blindly. A capture PayPal settles *after* the app gave up is still recorded on the next reconcile.
- **Verifying who gets paid.** The contractor merchant ID is checked on the order, on the authorization, and again right before capture or void.
- **Stale and racing decisions.** Before claiming an item, the hold is checked by GET. An expired or denied hold ends cleanly as "hold ended". A decision is final once recorded, so a second tab can only replay the same decision, never flip it.
- **Untrusted uploads.** Every photo is fully decoded and re-encoded server-side, which checks the real format, caps the pixel count and strips EXIF/GPS.
- **Not pretending.** When there is no model, the honest thing is a review that says so, not a plausible-sounding fixture. That is what ships.

## What's next
Real accounts in place of the sandbox passcodes (today each passcode maps to a server-enforced homeowner or contractor role), PayPal webhooks with signature verification, partial captures for partly completed work, and running the live-model review once a key is in place.

## Technical proof
From `docs/PROOF-SANDBOX.md`. Contractor merchant (payee) `F8MFAQQFR7JKA`, returned on every authorization and verified before every capture and void.

**Run 1 — CLI proof (`npm run sandbox:create` / `settle` / `verify`), Nov 12, 2026**
- Paint: order `9T461067HF380173V`, authorization `8KY824692F2241736` → **CAPTURED**, capture `27X98859PG133501W` → **COMPLETED**, USD 30.00
- Tile: order `7SA994956R697914G`, authorization `8US079184H1917233` → **VOIDED**, USD 20.00

**Run 2 — through the web app in a browser, Nov 12, 2026** (new orders; nothing reused)
- Paint: order `8UH8678723976961K`, authorization `09R969356M704910B` → **CAPTURED**, capture `137441455G861562T` → **COMPLETED**, USD 30.00, `final_capture: true`, exactly one capture on the order
- Tile: order `6G652729U10026153`, authorization `34202835AN046440U` → **VOIDED**, zero captures on the order

Both runs were confirmed afterwards by independent `GET` calls to the capture and authorization resources, including after a deliberate duplicate "accept" and a reconcile, which moved nothing.

## Honest limits
Sandbox only. Not escrow. No vision model analysed the demo photographs; the review shown is the labeled no-model path, and the photographs are labeled synthetic illustrations. Passcodes are not real authentication. The offline simulation is labeled as such and is not evidence of PayPal behavior.
