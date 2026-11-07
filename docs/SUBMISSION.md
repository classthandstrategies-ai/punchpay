# Devpost submission draft: PunchPay

> Draft copy. Every claim in **Technical proof** must be checked against `docs/PROOF-SANDBOX.md` before submitting. Remove anything not yet proven.

## Tagline
Every fix reviewed. Every payment decided.

## Inspiration
At the end of a renovation the last one percent causes most of the friction. Small leftover fixes (a scuff, a cracked tile) hold up the whole final payment. Homeowners don't want to pay for work they can't verify. Contractors don't want finished work held hostage by one unresolved item.

## What it does
PunchPay turns each leftover fix into its own small, independent payment decision:
1. **A separate hold per fix.** The homeowner approves a PayPal authorization for each item: $30 for paint, $20 for tile. Funds are held, not paid.
2. **Evidence.** The contractor uploads before-and-after photos to private storage.
3. **Advisory AI review.** Claude compares the photos against each pre-agreed acceptance criterion. For each one it reports supported, uncertain or not supported, and says what the photos cannot show. It never recommends paying.
4. **A human decision.** The homeowner accepts, which captures that item's authorization, or rejects, which voids it. One rejection never touches the other item's money.

## How we built it
- **Next.js 16 + TypeScript**, deployed as a single app. Every money-moving call runs server-side.
- **PayPal Orders v2** (`intent: AUTHORIZE`, contractor explicitly named as `payee.merchant_id`) and **Payments v2** (capture, void, GET verification). A stable `PayPal-Request-Id` is keyed to each PayPal resource, so a retry replays the request instead of moving money twice.
- **Claude** (`claude-opus-5-5`, vision, structured JSON output). Server-side rules stop the label from ever being stronger than the per-criterion evidence.
- **Supabase Postgres + private Storage.**
  - A database trigger enforces the item state machine and makes PayPal IDs and decisions immutable once recorded.
  - The audit log is append-only.
  - Browsers have no direct table or storage access.

- **Offline simulation (`/simulation`).** It runs the same decision and reconcile code against an in-tab store and a simulated PayPal. That covers six labeled scenarios: accepted paint, rejected tile, missing evidence, inconclusive review, capture failure, and a duplicate accept. It never touches the network.
- **Tests.**
  - 42 Node tests for flows, payment core, image checks and scenarios.
  - SQL guard tests on PostgreSQL 16.
  - 22 Playwright runs with axe accessibility scans on desktop and mobile.

## Challenges
- **Lost responses.** If a capture times out, did PayPal capture? PunchPay parks the item as "needs reconciliation" and resolves it only by GET. It never retries money movement blindly.
- **Verifying who gets paid.** The contractor merchant ID is checked on the order, on the authorization, and again right before capture or void.
- **Stale and racing decisions.** Before claiming an item, the hold is checked by GET. An expired or denied hold ends cleanly as "hold ended". A decision is final once recorded, so a second tab can only replay the same decision with the same request ID, never flip it.
- **Untrusted uploads.** Every photo is fully decoded and re-encoded server-side. That checks the real format, caps the pixel count and strips EXIF/GPS.
- **Keeping the AI honest.** It has to report mismatched angles and blurry shots rather than guess.

## What's next
Real accounts in place of the sandbox passcodes (today each passcode maps to a server-enforced homeowner or contractor role), PayPal webhooks with signature verification, and partial captures for partly completed work.

## Technical proof
_(fill from docs/PROOF-SANDBOX.md: paint capture ID + COMPLETED, tile authorization ID + VOIDED, payee merchant verified)_

## Honest limits
Sandbox only. Not escrow. AI output is advisory and is not an inspection or certification. Passcodes are not real authentication. The offline simulation is labeled as such and is not evidence of PayPal behavior.
