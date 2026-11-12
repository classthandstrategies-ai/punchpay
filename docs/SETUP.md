# Environment setup

Everything below is **sandbox only**. PunchPay's PayPal client can only reach `api-m.sandbox.paypal.com`; no live host is configurable.

## 0. Requirements
- Node.js 22+ (tested on 24.21), npm.
- PostgreSQL 16 client tools (`initdb`, `pg_ctl`, `psql`) for `npm run test:db` only. Docker is not needed.
- Google Chrome for `npm run test:e2e`. Playwright drives the installed Chrome, so no browser download is needed.

```bash
npm install
npm run typecheck && npm test && npm run test:db
npm run build && npm run test:e2e
npm run dev            # http://localhost:3000 (live) · http://localhost:3000/simulation (offline)
```

With no credentials, `/` is a labeled design preview and `/simulation` is fully interactive.

## 1. `.env.local` (never commit; `.gitignore` covers `.env*`)
Copy `.env.example` and fill in:

| Variable | Where it comes from | Notes |
| --- | --- | --- |
| `PAYPAL_CLIENT_ID`, `PAYPAL_CLIENT_SECRET` | developer.paypal.com → Apps & Credentials (**Sandbox**) → a REST app owned by the contractor's sandbox **Business** account | The client ID is public: the server hands it to the JS SDK. The secret stays on the server. |
| `PAYPAL_MERCHANT_ID` | Sandbox accounts → the contractor **Business** account → Account (merchant) ID | Every order names this as `payee.merchant_id`, and every response is checked against it. |
| `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY` | A **new, dedicated** Supabase project → Project settings → API | Server only. Browsers never talk to Supabase. |
| `ANTHROPIC_API_KEY` | console.anthropic.com | Optional. Without it, live review is disabled and no sample report is substituted. |
| `PUNCHPAY_PROTOTYPE_REVIEW` | set to `1` only when there is **no** key | Credential-free demo path. See §3a. Ignored whenever `ANTHROPIC_API_KEY` is set. |
| `ANTHROPIC_MODEL` | default `claude-opus-5-5` | |
| `HOMEOWNER_PASSCODE`, `CONTRACTOR_PASSCODE` | choose, 8+ characters each | Server-enforced roles: homeowner = hold + decision, contractor = photos + review. |
| `DEMO_PASSCODE` | choose, 8+ characters | Presenter passcode that acts as both roles, for a single-screen demo. |
| `NEXT_PUBLIC_APP_URL` | `http://localhost:3000` or the deployed origin | |

Passcodes are a hackathon sandbox gate, **not** authentication.

## 2. Database (dedicated Supabase project)
Apply the migrations **in order**, then the seed. In the SQL editor, paste each file; or run `supabase link` then `supabase db push`.

1. `supabase/migrations/20261108000000_init.sql`: tables, state-machine trigger, append-only audit, private bucket.
2. `supabase/migrations/20261108120000_hardening.sql`: `hold_ended`, final decisions, request nonce, TRUNCATE guards, safe reset.
3. `supabase/seed.sql`: the two items ($30 paint, $20 tile). Idempotent.

To verify the same SQL locally against plain PostgreSQL 16: `npm run test:db`. Its data and temp files stay inside the project folder.

To reset between demo runs, run `select public.punchpay_reset_demo();` as the service role. It archives the run into `demo_runs` first. It refuses while a capture or void is unconfirmed, and while holds are open unless you call `punchpay_reset_demo(true)`. Evidence files stay in the bucket; their paths are kept in the archive.

## 3. PayPal sandbox proof (before any UI demo)
```bash
npm run sandbox:create   # two AUTHORIZE orders; prints two approval links
#   open both links, log in as the sandbox PERSONAL buyer, approve each
npm run sandbox:settle   # authorize both, capture paint $30, void tile $20
npm run sandbox:verify   # GET-only: capture COMPLETED, tile VOIDED, payee = PAYPAL_MERCHANT_ID
```
The same three commands are rehearsed offline against the simulator in `tests/proof-rehearsal.test.mjs` (part of `npm test`). That proves the script's logic, not PayPal's behavior. Without `.env.local`, the commands stop with `node: .env.local: not found`. With missing variables, they stop with `SANDBOX GATE BLOCKED`, before any network call.
Copy the redacted IDs, statuses and timestamps into `docs/PROOF-SANDBOX.md`. **This was done on Nov 12, 2026 and the gate passed** — that file now holds the observed results.

## 3a. Reviewing without an Anthropic key (prototype path)
This submission ships without an Anthropic API key, so **no live AI review exists**. To demonstrate
the complete PayPal flow anyway, set `PUNCHPAY_PROTOTYPE_REVIEW=1` (and leave `ANTHROPIC_API_KEY`
empty). "Request advisory review" then records a report that:

- makes **no model call** and never opens the images, so it cannot describe them;
- marks every acceptance criterion `uncertain`, with the reason "no model examined this photo";
- is always `insufficient_evidence` — it can never say the work appears satisfied;
- carries `source: "prototype_no_model"`, which the report banner, the source line and the audit
  trail all show;
- changes nothing about the money: `decide()` never reads the review.

If `ANTHROPIC_API_KEY` is present, the flag is ignored and the real model call is made. With
neither the key nor the flag, review stays disabled and returns `503` — no fixture is ever
substituted silently.

## 4. Low-disk machines
If the system disk is short on space, point temp files, the npm cache and Playwright output at a roomier volume:
```bash
export TMPDIR="/path/to/roomy-volume/punchpay-runtime/tmp"
export npm_config_cache="/path/to/roomy-volume/punchpay-runtime/npm-cache"
export PUNCHPAY_E2E_OUT="/path/to/roomy-volume/punchpay-runtime/e2e-out"
```
