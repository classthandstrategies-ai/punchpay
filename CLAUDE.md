# PunchPay | Claude Code Operating Brief

You are the lead engineer and design-quality reviewer for PunchPay, a 3-person team project for the PayPal AI Hackathon 2026. PunchPay is a standalone project: keep all work, credentials and assets within this repository and its dedicated sandbox accounts.

## Nonnegotiable outcome
Build and test a polished, functional Next.js + TypeScript + Supabase/Postgres + Claude Vision + PayPal sandbox application by the submission deadline: **November 12, 2026 at 12:00 PM PST (November 13, 2026 at 1:30 AM IST)**.

**The concept:** contractor submits before/after photos for two small renovation fixes. AI gives a visually grounded, explicitly uncertain evidence report against criteria. The homeowner personally decides to accept or reject each item. Each item owns an independent PayPal Orders v2 AUTHORIZE order; accepted item is captured through Payments v2; rejected item is voided through Payments v2. Never treat the AI as a payment approver or claim escrow.

## First: audit existing starter
The repository contains a substantial starter, not a finished and tested application. Inspect every file. Run `npm install`, `npm run typecheck`, `npm run build`, `npm run test:payments`; repair all failures before new scope. Use official PayPal documentation to verify behavior, especially merchant payee identity and sandbox checkout redirect. The environment that produced this starter had no npm registry access, so the Next app has not yet been built or browser-tested. Node-only PayPal mocks passed 5 tests.

## Milestone A | Payment gate (must finish first)
1. Use separate sandbox PERSONAL payer and contractor BUSINESS merchant. Never use live credentials.
2. Configure `.env.local` (never commit). Confirm `PAYPAL_MERCHANT_ID` matches contractor business account.
3. Run `npm run sandbox:create`, then approve both returned links from the sandbox personal buyer.
4. Run `npm run sandbox:settle` to AUTHORIZE both, CAPTURE $30 paint, VOID $20 tile. Independently GET capture/authorization details and confirm statuses. No approval may be programmatically forged.
5. Save redacted transaction IDs, actual outcomes, timestamps, and payee assertion in `docs/PROOF-SANDBOX.md` (no secret keys). If the API reports a missing `payee`, inspect Orders v2 official contract, adapt verification using correct explicit merchant payee, and document why. Do not bypass verification.

## Milestone B | Application correctness
The frontend is at `components/Dashboard.tsx`; app routes are `app/api/items/**`. SQL seed is `supabase/schema.sql`. Core security boundary is sandbox-only. Audit/fix:
- TypeScript and Next.js 16 build compatibility, SDK rendering lifecycle, PayPal approval re-entry, order status reconciliation.
- Persistent Postgres lifecycle; atomic state transitions; transactions cannot be captured twice; idempotency request IDs must be stable across retries.
- Initial order creation error states, stuck pending after network interruption, terminal PayPal status reconciled by GET.
- Strict server-side amount, merchant ID, authorization ID and item ID checks. No arbitrary payment IDs from browser.
- Demo access is only a sandbox passcode; implement real authentication and proper homeowner/contractor authorization before any production claims. Hackathon scope is sandbox only.
- Private evidence bucket, bounded upload size, image magic bytes, signed URLs, passcode-protected reads.
- AI output must not hallucinate evidence. If only one image is present or angle mismatched, report uncertainty. `AIReport.source` distinguishes fixture from live model. Never fabricate completed PayPal states.
- Make audit events resilient: if logging fails after a successful API call, do not re-issue money-moving operations.
- Ensure smooth role switching, responsive mobile UI, accessible focus and polished typography.

## Milestone C | Deliberate design
Do not generate a generic SaaS UI. Adopt a calm high-end home renovation field-report aesthetic, akin to a sophisticated architectural completion dossier: warm off-white, pine green, soft sage, sharp typography, editorial serif headings, subtle grid lines, restrained micro-interactions. The existing CSS/React is an initial art direction to refine. Make accepted and rejected outcomes emotionally satisfying without decorative noise. No stock-dashboard charts. Avoid excessive gradients, purple/blue AI clichés, fake stats, meaningless animations, dark cyberpunk.

## Milestone D | End-to-end demo & public judge readiness
Test the exact two-item story through real sandbox API responses:
- both buyer approvals, both AUTHORIZE IDs persisted, contractor merchant verified;
- contractor uploads 4 demo photos, Claude produces 2 live evidence reports;
- homeowner accepts paint ($30 captured, GET verifies status COMPLETED), rejects tile ($20 authorization VOIDED, GET verifies status VOIDED);
- refresh retains statuses, records visible audit trail, no phantom payment on retries;
- mobile and desktop screenshots, playthrough under 3 minutes.
Use staged/owned/consented evidence photos; label synthetic evidence if generated. Do not present AI assessments as certifications.

## Definition of done
- `npm run typecheck`, `npm run build`, and tests pass; no console errors.
- Verified PayPal sandbox merchant and two separate terminal payment outcomes; no secrets committed.
- Working live AI review (if key available), evidence reports clearly advisory.
- Responsive stable page, fully demonstrable roles and data persistence.
- Public repo with an open source LICENSE, README judge instructions, public YouTube demo under 3 minutes, Devpost application submitted.
- A plain-language blockers report for anything impossible without credentials or user interaction. Never claim deployment, capture, void, or external account action without evidence.

## Work discipline
Do not wait for clarifications if a safe local choice can be made. Implement, run tests, inspect, fix. Keep changes small, commit coherent milestones, and record evidence. Do not ask team members to expose secrets in chat. When blocked by credentials, finish offline tests and route UI, then identify exact missing input. No scope creep: no chat, marketplace, multi-merchant onboarding, or elaborate project management. Cut features, not core correctness.

## Source docs
- https://developer.paypal.com/checkout/delay-capture/
- https://developer.paypal.com/api/payments/v2/authorizations-void/
- https://developer.paypal.com/api/payments/v2/
- https://paypalaihackathon.devpost.com/rules
