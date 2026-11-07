# PunchPay
**Every fix reviewed. Every payment decided.**

PunchPay is an AI-assisted renovation closeout app made for the [PayPal AI Hackathon 2026](https://paypalaihackathon.devpost.com/). Contractors attach before-and-after evidence to independently authorized small fixes; a vision model reports visible support and uncertainty against pre-agreed criteria; homeowners choose whether a specific item is paid (capture) or released (void). All payments in this demo use the **PayPal sandbox**. This is not escrow, construction certification, or a guaranteed payment.

## Project state (Nov 8, 2026)
| Area | Status | Evidence |
| --- | --- | --- |
| Install, typecheck, production build | Passing | `npm run typecheck`, `npm run build` |
| Payment core (shared by app + CLI) | 11 offline tests passing | `npm run test:payments` |
| UI (design preview, desktop + mobile) | Browser-tested, no console errors | `docs/screenshots/` |
| PayPal sandbox proof | **Not run: needs sandbox credentials** | `docs/PROOF-SANDBOX.md` |
| Supabase persistence, uploads | **Not run: needs a dedicated Supabase project** | |
| Live Claude review | **Not run: needs `ANTHROPIC_API_KEY`** | |

Nothing marked "not run" should be described as working.

## Stack
Next.js 16 App Router + TypeScript + Tailwind 4/custom CSS; Supabase Postgres and private Storage; Claude image analysis API; PayPal Orders v2 and Payments v2 sandbox APIs. This starter is intentionally a small two-item app without broad project management features.

## Start
1. Use Node.js 22+. From project root: `npm install`.
2. Copy `.env.example` to `.env.local` and fill the sandbox **contractor Business** app's `PAYPAL_CLIENT_ID`, `PAYPAL_CLIENT_SECRET`, and that business account's `PAYPAL_MERCHANT_ID`. The server hands the (public) client ID to the PayPal JS SDK, so browser and server always use the same REST app. Set `DEMO_PASSCODE` to 8+ characters. Set `NEXT_PUBLIC_APP_URL=http://localhost:3000`.
3. Create a **new dedicated** Supabase project; paste `supabase/schema.sql` into SQL Editor. Configure `SUPABASE_URL` and `SUPABASE_SERVICE_ROLE_KEY` in `.env.local` only. Add `ANTHROPIC_API_KEY` for live AI analysis.
4. Run `npm run typecheck`, `npm run test:payments`, `npm run build`. Fix any issues before demoing.
5. Run `npm run dev`; visit http://localhost:3000. Enter the demo passcode in the band under the header and unlock. Without credentials/data, the UI is explicitly a **design preview** and payment actions are inactive.

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
| `GET /api/items` | Passcode-protected item listing with signed image URLs |
| `POST /api/items/{id}/create-order` | One PayPal Orders v2 AUTHORIZE intent order at server-defined amount |
| `POST /api/items/{id}/authorize` | Require buyer-approved PayPal order, then authorize it and save auth ID |
| `POST /api/items/{id}/upload` | Private evidence upload (stage before/after) |
| `POST /api/items/{id}/review` | Live Claude vision evidence report |
| `POST /api/items/{id}/decision` | Homeowner decision then capture or void; audit response |
| `POST /api/items/{id}/sync` | Verify post-action PayPal outcome; can recover ambiguous network state |

Every POST requires `x-demo-passcode`. This is a **hackathon sandbox gate, not real identity/role authorization**. The client-side role toggle is presentational, not secure authentication. Never promote this starter into production with live money. Implement Supabase Auth / server-enforced roles, webhook signature verification, and stronger concurrency/error recovery for production.

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

