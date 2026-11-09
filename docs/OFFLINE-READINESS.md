# Offline readiness report (Nov 8, 2026; follow-up review Nov 9, 2026)

Scope: offline development only. No cloud provisioning, deployment, GitHub/Supabase account or external payment was attempted. **The real PayPal and Claude flows have not been run and are not certified.**

## Test results (rerun on Nov 8, 2026; Node 24.21.0, Next 16.4.5, PostgreSQL 16.15)
| Check | Command | Result |
| --- | --- | --- |
| Typecheck | `npm run typecheck` | Clean |
| Production build | `npm run build` | Succeeds |
| Unit / flow tests | `npm test` | **48 / 48 pass** (rerun Nov 9, 2026): flows 19, paypal-core 13, scenarios 7, image 5, proof rehearsal 4 |
| Database guards | `npm run test:db` | `DB GUARD TESTS PASSED` (standalone PostgreSQL 16.15, both migrations + seed; no Docker) |
| Browser + accessibility | `npm run test:e2e` | **22 pass** (11 tests × desktop 1440×900 + Pixel 7), axe with no violations; 2 screenshot tests skipped unless `SCREENSHOTS=1` |
| Screenshots | `SCREENSHOTS=1 npx playwright test e2e/screenshots.spec.ts` | 7 desktop + 7 mobile in `docs/screenshots/` |

## Completed work
1. **Environment recovered.** Temp, npm cache and test output were moved to an external volume. The project files and every earlier commit are intact.
2. **Security review.** It was done in two rounds, including an independent review. All findings are fixed and covered by regression tests; see the table below.
3. **Shared flow module.** `lib/flows.ts` is the one place where money-moving decisions are made. The API routes, the offline simulation and the tests all run it. Routes are thin wrappers around it.
4. **Dossier polish.** The existing design was kept. Additions:
   - role-aware workspace
   - loading, preview and error-recovery states
   - before/after evidence comparison (side-by-side and wipe)
   - missing-evidence and uncertainty presentation
   - inline decision confirmation with focus moved to the outcome
   - hold-expiry and "hold ended" outcomes
   - payment ledger
   - contrast fixes and labeled marks to meet WCAG AA
5. **Fixture demos at `/simulation`.** They are completely separate from live records: in-tab memory only, no network, and `SIM-` references. Sample reviews are labeled `sample_fixture`, and the illustrations carry a "SYNTHETIC ILLUSTRATION · NOT A PHOTO" stamp. Six scenarios:
   - accepted $30 paint
   - rejected $20 tile
   - missing evidence
   - inconclusive review
   - capture failure → reconcile
   - duplicate accept → refused, with a single capture
6. **Proof commands ready.** `sandbox:create`, `sandbox:settle` and `sandbox:verify` are reviewed and refactored into testable commands. The CLI behaves the same. `verify` now also requires the paint authorization to be `CAPTURED`, and the capture to belong to it. The commands are rehearsed offline (`tests/proof-rehearsal.test.mjs`), which is not proof. Missing credentials stop the commands with `SANDBOX GATE BLOCKED` before any network call.
7. **Publishing prepared.**
   - `git fsck` is clean.
   - No `.env*` file other than `.env.example` has ever been tracked.
   - A scan of every file version, path and commit message found no keys, tokens, private paths or personal data.
   - Internal planning and agent notes are kept out of the repository.
   - Playwright output is gitignored.
   - Push steps are in INTEGRATION-PLAN gate 5.
8. **Docs.** README, [ARCHITECTURE](ARCHITECTURE.md), [SETUP](SETUP.md), [INTEGRATION-PLAN](INTEGRATION-PLAN.md), DEMO-SCRIPT and SUBMISSION were all updated.

## Security findings and resolutions
| Area | Finding | Resolution | Regression test |
| --- | --- | --- | --- |
| Payment idempotency | Order request IDs could replay an old PayPal order after a DB re-seed | Per-row `request_nonce` in the order key; capture/void keys derive from the authorization ID | flows, guards (nonce distinct + immutable) |
| Payment idempotency | Capture had no timeout; reconcile could race an in-flight capture | 15s fetch timeout; reconcile waits out a 60s in-flight window before concluding nothing moved | flows, e2e scenario V |
| Merchant identity | The create response might omit the payee | Falls back to a GET of the order; never skipped | paypal-core |
| Merchant identity | The authorization might omit the payee | Verified via its parent order, whose ID must match the stored one | paypal-core |
| Order ownership | A capture or authorization was not tied to its parent | auth→order and capture→auth links checked; `reference_id` = item ID | paypal-core, flows |
| Stale authorization | An expired or denied hold left the item stuck in `payment_error` | Preflight GET; new terminal `hold_ended` that carries PayPal's status | flows, guards |
| Stale authorization | A COMPLETED order with a dead hold was stuck | The order is abandoned and a new attempt starts with a new request ID | flows |
| Stale authorization | A capture DECLINED or FAILED by PayPal had no terminal state | Mapped to `hold_ended` | flows |
| Concurrent decisions | A second tab could flip accept to reject mid-flight | The decision is immutable once recorded (DB trigger); only the same decision is retried, with the same request ID | flows, guards, e2e VI |
| Concurrent decisions | Reconcile could record a capture the homeowner did not accept | Refused | flows |
| Image upload | Only MIME/magic checks; EXIF/GPS was kept; decompression bombs were possible | sharp full decode, 40M-pixel limit, re-encode with metadata stripped, 2400 px max edge, 4 MB cap | image |
| Server-side access | One shared passcode covered every role | Homeowner and contractor passcodes map to server-enforced roles (401/403); timing-safe compare; 8+ characters | e2e (API 401), flows |
| Error leaks | Raw PayPal and storage bodies reached the browser | Only `HttpError`/`VerificationError` messages are shown; the rest map to generic 500/502/504 | paypal-core |
| Audit integrity | TRUNCATE and the bypass GUC were usable by `service_role` | TRUNCATE blocked and revoked; bypass only inside the reset function's owner context; `demo_runs` append-only | guards |
| Audit integrity | An audit failure after money moved | Never throws or re-sends | flows (`failAudit`) |
| Demo reset safety | Reset could wipe in-flight or open payments | Locks rows; refuses capture/void pending and `payment_error`; refuses open holds unless `punchpay_reset_demo(true)`; archives first | guards |

## Follow-up review (Nov 9, 2026)
`PayPal-Request-Id` retention was the one open question answerable without credentials, so it was checked against PayPal's documentation. The docs conflict: **6 hours** by default (Orders v2 use cases; Payments v1 → v2 upgrade guide), extendable to 72 hours by arrangement, against up to 45 days on the general "API requests" page, with the idempotency reference deferring to each API's own page. The upgrade guide warns that past the window a retry is processed as a **new** transaction and **nothing signals it**.

Reviewing PunchPay against that worst case found, and fixed, a real defect:

| Area | Finding | Resolution | Regression test |
| --- | --- | --- | --- |
| Reconciliation | A capture or void PayPal processed *after* reconcile had already returned the item to `reviewed` could never be recorded: `reviewed → captured` and `reviewed → voided` were missing from the transition whitelist. The money had moved, the item stuck in `reviewed`, reconcile failed with a generic "the database refused this change", and retrying the decision answered "use Reconcile to record PayPal's state" — which then failed too. | Both transitions allowed, in the trigger and in the in-memory store. `punch_items_captured_has_id` and `punch_items_voided_is_rejection` still require the matching homeowner decision (and, for a capture, a capture ID), so only a GET-verified outcome the homeowner actually chose can be recorded. | flows ("PayPal-Request-Id lapsed…", late void), guards (both transitions, and a capture still refused on a rejected item) |

The window itself is **not** what protects against a double capture. A retry is only reachable from `reviewed`, and both `decide` and `sync` GET the authorization first, so a hold PayPal already captured reports `CAPTURED` and the retry is refused before any POST. Replay is a second layer covering the ~60 s lost-response window.

**Open (documented, not fixed):**
- PayPal's documented retention figure for `PayPal-Request-Id` is self-contradictory (above). Treat 6 hours as the floor and confirm with PayPal for the account in use; PunchPay's correctness does not rest on it.
- Reset does not delete evidence files from storage; their paths are archived.
- Passcodes are not accounts.
- There are no webhooks.

## Remaining blockers
- **No PayPal sandbox credentials.** So:
  - `docs/PROOF-SANDBOX.md` is still **NOT YET RUN**
  - the JS SDK popup approval has never been exercised
- **No Supabase project.** Real Postgres over the Supabase API and the Storage signed-URL paths have never been exercised. The SQL itself is tested on plain PostgreSQL 16.
- **No `ANTHROPIC_API_KEY`.** No live Claude report has been produced.
- **GitHub:** waiting for the dedicated account and an empty repository. Nothing has been pushed.

## Credentials still required (put in `.env.local`, never in chat or git)
`PAYPAL_CLIENT_ID`, `PAYPAL_CLIENT_SECRET`, `PAYPAL_MERCHANT_ID` (sandbox Business), plus a sandbox Personal buyer login (used in the browser only) · `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY` · `ANTHROPIC_API_KEY` · chosen `HOMEOWNER_PASSCODE`, `CONTRACTOR_PASSCODE`, `DEMO_PASSCODE`.

## Steps to live demo certification
Follow [INTEGRATION-PLAN.md](INTEGRATION-PLAN.md) gates 1–7, in order:
1. CLI sandbox proof
2. Supabase migrations + seed
3. live Claude reports
4. end-to-end two-item story
5. GitHub push
6. optional hosting
7. video + Devpost

Only after gate 1's `sandbox:verify` passes may anything say that a capture or void happened.
