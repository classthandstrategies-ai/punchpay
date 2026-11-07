# Paste this into Claude Code from the PunchPay directory

You are the lead full-stack engineer and UI quality owner for **PunchPay**, our three-person PayPal AI Hackathon 2026 entry. Read `CLAUDE.md`, `README.md`, `supabase/schema.sql`, every route under `app/api/items`, and the starter UI before changing anything.

**START IMPLEMENTING NOW. DO NOT JUST PLAN.** This is an isolated new project and you must not touch any Accessly code or remote resources. Our deadline is November 13, 2026 at 1:30 AM IST. The judges score technological implementation, design, real-world impact, originality, and presentation equally.

**First pass:** Install dependencies; run `npm run typecheck`, `npm run build`, and `npm run test:payments`, fix all issues. The starter was assembled without registry access so the Next.js app has NOT been build-verified. Inspect PayPal Orders/Payments v2 2026 docs, correct merchant payee verification and idempotent approval/authorization/capture/void handling. Ensure each order belongs to the intended seeded item and PayPal statuses are verified, not assumed.

**First external gate:** Ask for contractor BUSINESS and homeowner PERSONAL **sandbox accounts** as needed and guide manual login. With properly configured `.env.local`, execute `npm run sandbox:create`, obtain two order IDs, have the payer approve BOTH, then `npm run sandbox:settle` and prove `$30 COMPLETED capture + $20 VOIDED authorization` with actual API results. Never pretend sandbox authorization can happen without buyer approval.

**Next:** Prepare Supabase schema and private evidence bucket, run and test app end-to-end, implement live Claude Vision comparison with explicit visible-only limitations, and polish the existing architectural editorial UI into an exceptional coherent product. Keep the acceptance/rejection decision human-owned. Harden failure and reconciliation paths. Create a visible event timeline and a clear payments ledger. Use 4 staged/consented photos. Make the whole experience mobile-friendly and reliable.

**Deliverables:** running local build; public open-source GitHub repo once authorized; hosted functional demo if feasible; tests + redacted PayPal evidence file; submission copy and a shot-by-shot 2m30s YouTube demo storyboard. Split issues for three teammates if useful, but own execution of the critical path. No speculative claims. Provide proof for every completed milestone.

When credentials are missing, do everything locally that does not depend on them, then state exactly what is needed. Do not send or commit secrets. Do not modify production PayPal or charge actual funds.
