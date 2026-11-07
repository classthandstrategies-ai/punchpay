# 3-person delivery plan | Nov 8–12, 2026

## Single critical path, not three competing UIs
**Person A: Payments/integration.** Own PayPal sandbox Business + Personal accounts, backend state transitions, idempotency, transaction verification, audit/reconciliation, and redacted proof. Start here. This blocks the entire demo.

**Person B: App/database.** Own dedicated Supabase project and storage, SQL seed, upload/test photos, Claude live vision report, secure passcode and eventual role validation, frontend API integration. Cannot mark AI as verified until image model returns real results.

**Person C: Product/presentation.** Own excellent UI polish, mobile and desktop browser checks, coherent two-item story, sourced/staged demo images, README judge run instructions, Devpost copy, screenshots, and a 2m30s video. No generic dashboard aesthetics.

## Stop/go checkpoints
- Nov 8: Node tests, install/build clean, PayPal two-order buyer approval + verified capture and void; record merchant payee. If not proven, prioritize fixing API flow.
- Nov 9: Supabase seeded, uploads persist, Claude live report validates criteria; hardened server route guards.
- Nov 10: Whole story through web UI using sandbox API, role switch demo, status persistence, no double-actions.
- Nov 11: UI polish freeze, screen recordings, YouTube publish, public MIT-licensed GitHub repo and setup instructions.
- Nov 12 (early IST): final smoke and Devpost submission well before 13 Nov 1:30 AM IST.

## Scope discipline
Do NOT build chat, marketplace, contract negotiation, retainage accounting, escrow, embedded scheduling, invoice generators, 3D renovation previews or multi-company onboarding. One completed proof-bearing flow beats five shallow features.
