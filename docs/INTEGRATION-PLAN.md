# Credentials-pending integration plan

The application is complete against its interfaces. Each external service plugs in through environment variables and one migration step. No restructuring is needed. Work through the gates **in order**: each one produces evidence that the next relies on.

| # | Service | Owner action (needs a human or an account) | Then run | Done when |
| --- | --- | --- | --- | --- |
| 1 | **PayPal sandbox** | Create, in a dedicated developer account, a sandbox **Business** (contractor) and a **Personal** (homeowner) account, plus a REST app under the Business account. Put `PAYPAL_CLIENT_ID`, `PAYPAL_CLIENT_SECRET` and `PAYPAL_MERCHANT_ID` in `.env.local`. | `npm run sandbox:create` → approve both links as the Personal buyer → `npm run sandbox:settle` → `npm run sandbox:verify` | `verify` prints capture `COMPLETED`, tile `VOIDED`, payee = merchant ID. Results are copied, redacted, into `docs/PROOF-SANDBOX.md`. |
| 2 | **Supabase** | Create a **new** project in a dedicated account (the old org has an unpaid-invoice block). Put `SUPABASE_URL` and `SUPABASE_SERVICE_ROLE_KEY` in `.env.local`. | Apply both migrations, then the seed (`docs/SETUP.md` §2). Set the passcodes. `npm run dev` → unlock. | Both items load. A photo upload appears with a signed URL. A refresh keeps state. Table Editor shows audit rows. |
| 3 | **Anthropic** | Put `ANTHROPIC_API_KEY` in `.env.local`. | Upload the four staged photos; request a review on each item. | Each report shows "Live analysis · `<model>`" with per-criterion evidence and a non-empty "cannot show" list. |
| 4 | **End-to-end** | Have the Personal buyer logged in in a second window. | Follow the web walkthrough in `README.md`: approve both holds, upload, review, accept paint, reject tile, refresh. | Ledger shows the paint capture `COMPLETED` and the tile authorization `VOIDED`. A second accept says "Already recorded". Reconcile re-checks by GET only. Mobile and desktop screenshots are taken. |
| 5 | **GitHub** | Configure the new dedicated GitHub account and repository (public, MIT). | `git remote add origin …` then `git push -u origin main` | README, LICENSE and docs are visible. No `.env*` files are in history (`git log --all -- .env.local` is empty). |
| 6 | **Hosting** (optional) | Pick a host. Set the same env vars there. Set `NEXT_PUBLIC_APP_URL`. | Deploy, then repeat gate 4 against the URL. | The judge URL works with the presenter passcode, and `/simulation` works with no passcode. |
| 7 | **Submission** | Record a video under 3 minutes (`DEMO-SCRIPT.md`). Upload it to YouTube as public. Submit on Devpost. | Fill `docs/SUBMISSION.md` → Technical proof from `docs/PROOF-SANDBOX.md` only. | Submitted before **Nov 12, 2026, 12:00 PM PST**. |

## Things to verify against the live sandbox (not provable offline)
- Whether the create-order response includes `purchase_units[0].payee.merchant_id` with `Prefer: return=representation`. If it doesn't, the code already falls back to a GET of the order.
- Whether `GET /v2/payments/authorizations/{id}` reports `payee` and `supplementary_data.related_ids.order_id`. Both paths are handled; record in PROOF which one was used.
- Whether `GET /v2/payments/captures/{id}` reports `supplementary_data.related_ids.authorization_id`. The link is checked when present.
- How long PayPal keeps `PayPal-Request-Id` for capture and void replay. Check this in PayPal's documentation before claiming a retry window.
- The sandbox JS SDK popup completes approval and returns to the page (`onApprove` → `/authorize`).

## What must not change during integration
- No live PayPal host, no live credentials.
- Do not bypass the payee check if a field is missing. Adapt verification to the documented field, and record why in `docs/PROOF-SANDBOX.md`.
- Simulated `SIM-` references and fixture reviews never go into the proof, the video's "real" segment, or the Devpost technical-proof section.
