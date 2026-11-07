# Credentials-pending integration plan

The application is complete against its interfaces. Each external service plugs in through environment variables and one migration step. No restructuring is needed. Work through the gates **in order**: each one produces evidence that the next relies on.

| # | Service | Owner action (needs a human or an account) | Then run | Done when |
| --- | --- | --- | --- | --- |
| 1 | **PayPal sandbox** | Create, in a dedicated developer account, a sandbox **Business** (contractor) and a **Personal** (homeowner) account, plus a REST app under the Business account. Put `PAYPAL_CLIENT_ID`, `PAYPAL_CLIENT_SECRET` and `PAYPAL_MERCHANT_ID` in `.env.local`. | `npm run sandbox:create` → approve both links as the Personal buyer → `npm run sandbox:settle` → `npm run sandbox:verify` | `verify` prints capture `COMPLETED`, tile `VOIDED`, payee = merchant ID. Results are copied, redacted, into `docs/PROOF-SANDBOX.md`. |
| 2 | **Supabase** | Create a **new** project in a dedicated account (the old org has an unpaid-invoice block). Put `SUPABASE_URL` and `SUPABASE_SERVICE_ROLE_KEY` in `.env.local`. | Apply both migrations, then the seed (`docs/SETUP.md` §2). Set the passcodes. `npm run dev` → unlock. | Both items load. A photo upload appears with a signed URL. A refresh keeps state. Table Editor shows audit rows. |
| 3 | **Anthropic** | Put `ANTHROPIC_API_KEY` in `.env.local`. | Upload the four staged photos; request a review on each item. | Each report shows "Live analysis · `<model>`" with per-criterion evidence and a non-empty "cannot show" list. |
| 4 | **End-to-end** | Have the Personal buyer logged in in a second window. | Follow the web walkthrough in `README.md`: approve both holds, upload, review, accept paint, reject tile, refresh. | Ledger shows the paint capture `COMPLETED` and the tile authorization `VOIDED`. A second accept says "Already recorded". Reconcile re-checks by GET only. Mobile and desktop screenshots are taken. |
| 5 | **GitHub** | Create an **empty** repository in the new dedicated account: no README, license or .gitignore, so history stays linear. Decide the commit-author question (below). | See "Publishing from the new GitHub account" below | README, LICENSE and docs are visible. The new repo's history matches local `main` commit for commit. |
| 6 | **Hosting** (optional) | Pick a host. Set the same env vars there. Set `NEXT_PUBLIC_APP_URL`. | Deploy, then repeat gate 4 against the URL. | The judge URL works with the presenter passcode, and `/simulation` works with no passcode. |
| 7 | **Submission** | Record a video under 3 minutes (`DEMO-SCRIPT.md`). Upload it to YouTube as public. Submit on Devpost. | Fill `docs/SUBMISSION.md` → Technical proof from `docs/PROOF-SANDBOX.md` only. | Submitted before **Nov 12, 2026, 12:00 PM PST**. |

## Publishing from the new GitHub account
The local repository is prepared:
- The old remote is renamed `legacy-origin`, and its push URL is disabled.
- `main` has no upstream, so a bare `git push` cannot reach the old account.

When the new empty repository exists:
```bash
# 1. Pre-push checks (each must print nothing / pass)
git status --short                                    # clean tree
git ls-files | grep -E '^\.env' | grep -v '^\.env\.example$'   # no env files tracked
git log --all --name-only --format= | grep -E '\.env\.local|paypal-sandbox-state' # never in history
npm run typecheck && npm test && npm run test:db && npm run build && npm run test:e2e
# 2. Point at the new account and push the full history
git remote add origin https://github.com/<new-account>/punchpay.git
git push -u origin main
# 3. Optional, once the push is confirmed
git remote remove legacy-origin
```
**Commit-author decision (owner only).** All 9 existing commits record the author email used by the previous account. Pushing them publishes that email under the new repository. There are two options:
- **(a)** Push as is. This preserves history exactly, and is the default.
- **(b)** Before the first push, rewrite the author identity to the new account's noreply email (`git filter-repo --mailmap`). This changes every commit hash, so the old hashes in docs and the old remote no longer match.

Do not do (b) without an explicit decision. Either way, set the new identity for future commits with `git config user.name` / `git config user.email`.

Optional before going public: `CLAUDE.md`, `CLAUDE-KICKOFF-PROMPT.md`, `AGENTS.md` and `TEAM-PLAN.md` are internal working notes. They contain no secrets, but they mention an unrelated project by name. Keep them (transparent process) or remove them in a normal commit (history keeps them).

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
