# PunchPay
**Every fix reviewed. Every payment decided.**

PunchPay is an AI-assisted renovation closeout app made for the [PayPal AI Hackathon 2026](https://paypalaihackathon.devpost.com/). Contractors attach before-and-after evidence to independently authorized small fixes; a vision model reports visible support and uncertainty against pre-agreed criteria; homeowners choose whether a specific item is paid (capture) or released (void). All payments in this demo use the **PayPal sandbox**. This is not escrow, construction certification, or a guaranteed payment.

## Project state (Nov 8, 2026)
| Area | Status | Evidence |
| --- | --- | --- |
| Typecheck, production build | Passing | `npm run typecheck`, `npm run build` |
| Payment flows, image checks, scenarios | 42 offline tests passing | `npm test` |
| Database guards (state machine, audit, reset) | Passing on PostgreSQL 16 | `npm run test:db` |
| Browser tests incl. axe accessibility, desktop + mobile | 22 passing | `npm run test:e2e` |
| Offline simulation of six payment scenarios | Working, labeled "Simulation" | `/simulation` |
| PayPal sandbox proof | **Not run: needs sandbox credentials** | `docs/PROOF-SANDBOX.md` |
| Supabase persistence, uploads | **Not run: needs a dedicated Supabase project** | |
| Live Claude review | **Not run: needs `ANTHROPIC_API_KEY`** | |

Nothing marked "not run" should be described as working. Full status: [`docs/OFFLINE-READINESS.md`](docs/OFFLINE-READINESS.md).

## Docs
- [Architecture and guarantees](docs/ARCHITECTURE.md)
- [Environment setup](docs/SETUP.md)
- [Credentials-pending integration plan](docs/INTEGRATION-PLAN.md)
- [Demo video script](DEMO-SCRIPT.md) · [Devpost copy](docs/SUBMISSION.md)

## Stack
Next.js 16 App Router + TypeScript + custom CSS; Supabase Postgres and private Storage; Claude vision; PayPal Orders v2 and Payments v2 sandbox APIs. The app is deliberately small: two items, no broad project management.

## Start
1. Use Node.js 22+. From the project root: `npm install`.
2. With no credentials at all, `npm run dev` and open http://localhost:3000/simulation. It is a fully interactive, clearly labeled offline simulation: no network, simulated `SIM-` references, sample reviews.
3. For the live sandbox app, follow [`docs/SETUP.md`](docs/SETUP.md):
   - copy `.env.example` to `.env.local`
   - fill in the PayPal sandbox contractor Business app and `PAYPAL_MERCHANT_ID`
   - fill in a **new dedicated** Supabase project (apply `supabase/migrations/*` in order, then `supabase/seed.sql`)
   - add `ANTHROPIC_API_KEY`
   - set `HOMEOWNER_PASSCODE`, `CONTRACTOR_PASSCODE` and `DEMO_PASSCODE` (presenter, both roles)
4. Run `npm run typecheck && npm test && npm run test:db && npm run build && npm run test:e2e`.
5. Run `npm run dev` and visit http://localhost:3000. Unlock with a passcode. Without credentials or data, `/` is explicitly a **design preview** and payment actions are inactive.

## Critical PayPal sandbox proof, outside the web app
**This is the first milestone.** Use a PayPal sandbox **Business account as contractor/payee** and a separate sandbox **Personal account as homeowner/payer**.

```bash
npm run sandbox:create
# Open BOTH buyer approval URLs in a browser and approve with sandbox Personal account.
npm run sandbox:settle   # authorize both, capture paint, void tile
npm run sandbox:verify   # independent GETs only; never moves money
# npm run sandbox:create -- --fresh   starts a brand-new proof run
```

The CLI should verify `purchase_units[0].payee.merchant_id` is exactly `PAYPAL_MERCHANT_ID`, AUTHORIZE both separately, then CAPTURE the paint $30 authorization and VOID the tile $20 authorization. It GETs the final resources to verify status, writes resumable state to the gitignored `.paypal-sandbox-state.json`, and never uses the live PayPal API. **Do not mark this gate as passed until the real IDs and statuses have been observed.** If the sandbox Orders v2 response omits payee, investigate and verify through PayPal's supported response/merchant identification method; do not silently skip checking who gets paid.

## Web walkthrough
1. **Homeowner**, select paint → PayPal authorize $30, then tile → PayPal authorize $20 (separate approvals).
2. **Contractor**, upload before and after JPEG/PNG/WebP photos for each item; run live Claude evidence review separately for each item.
3. **Homeowner**, read Claude's uncertainty, then independently accept paint and reject tile. The server sends capture or void using the PayPal authorization ID saved for the item.
4. Inspect the two terminal payment statuses and PayPal IDs. Use the Reconcile button after any ambiguous network result instead of retrying money movement.

## App routes
| Route | Action |
| --- | --- |
| `GET /api/items` | Item listing with signed image URLs and the caller's roles |
| `POST /api/items/{id}/create-order` | One PayPal Orders v2 AUTHORIZE intent order at server-defined amount |
| `POST /api/items/{id}/authorize` | Require buyer-approved PayPal order, then authorize it and save auth ID |
| `POST /api/items/{id}/upload` | Private evidence upload (stage before/after) |
| `POST /api/items/{id}/review` | Live Claude vision evidence report |
| `POST /api/items/{id}/decision` | Homeowner decision then capture or void; audit response |
| `POST /api/items/{id}/sync` | GET-only reconcile of an unconfirmed outcome or a stale hold; never moves money |

Every request requires `x-demo-passcode`. The server maps the passcode to roles: homeowner for create-order, authorize and decision; contractor for upload and review; either role for listing and sync. This is a **hackathon sandbox gate, not real identity**. Production would need real accounts (e.g. Supabase Auth) with per-project membership, plus PayPal webhook signature verification. Never run this with live money.

## Judge delivery checklist
- [ ] Both PayPal sandbox orders approved by sandbox buyer and authorized as contractor merchant.
- [ ] Paint `$30`: verified `COMPLETED` capture ID.
- [ ] Tile `$20`: verified `VOIDED` authorization ID.
- [ ] Two independently generated live AI reviews over real or clearly labeled staged photos.
- [ ] Responsive, working web demo with persisted audit/payment records.
- [ ] Public repository with visible `LICENSE` and complete instructions.
- [ ] Public YouTube video strictly under three minutes; clear actual app footage.
- [ ] Final Devpost submission by **Nov 12, 2026 12 PM PST / Nov 13 1:30 AM IST**.

## License
MIT. See [LICENSE](LICENSE).

