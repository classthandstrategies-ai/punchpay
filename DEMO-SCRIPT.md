# PunchPay demo video: shot list (target 2:30, hard limit 2:59)

Every shot must be real app footage against the PayPal sandbox and the live Claude API. No mock screens, no pre-written AI text. Film after `docs/PROOF-SANDBOX.md` is complete.

**Prep before recording**
- Run the demo reset (`select public.punchpay_reset_demo();` as service role). This archives the previous run. It refuses while a capture or void is unconfirmed (reconcile first). It also refuses while PayPal holds are still open; void or let them end, or knowingly pass `punchpay_reset_demo(true)` to leave them open in the sandbox.
- Log in with `DEMO_PASSCODE` (the presenter, both roles) so the role switch works on one screen.
- Have the four photos ready: paint before/after, tile before/after.
- Browser at 1440×900, 100% zoom.
- A second window logged in to the sandbox Personal buyer.
- Hide the bookmarks bar and any personal accounts.

| Time | Shot | On screen | Narration (approx.) |
| --- | --- | --- | --- |
| 0:00–0:14 | Hook | Cover: "Every fix reviewed. Every payment decided." Tally shows $50.00 under contract. | "A renovation is ninety-nine percent done. Two small fixes are left. Why should one unresolved tile hold up payment for a finished paint repair?" |
| 0:14–0:32 | Two separate holds | Homeowner role, Paint, PayPal button, sandbox checkout popup, approve. Back in the app: "Funds held", authorization ID visible. Repeat quickly for Tile (cut the popup). | "Each fix gets its own PayPal authorization. The money is held, not paid. Two fixes, two independent holds." |
| 0:32–0:58 | Contractor evidence | Click "Switch to contractor". Upload paint before/after, then tile before/after. Record shows each upload. | "The contractor submits before-and-after photos. They're stored privately and shown only through short-lived links." |
| 0:58–1:28 | Advisory AI | "Request advisory review" on Paint: the live report shows the per-criterion results. Then Tile: visible concern, with the "What these photos cannot show" box. Pause on the model name and timestamp. | "Claude compares the photos against the agreed criteria. It describes only what's visible and says plainly what it can't see. It's advice, not a certification. It never decides." |
| 1:28–1:58 | Two human decisions | Switch to homeowner. Paint: "Accept and pay $30.00", inline confirm, green outcome with capture ID and COMPLETED. Tile: "Reject and release", confirm, stone outcome with VOIDED. | "The homeowner decides. Accept captures thirty dollars from that hold only. Reject voids the other hold, and the homeowner isn't charged." |
| 1:58–2:16 | Proof | Tally: $30 paid, $20 released. Scroll to the Payments ledger (order, auth, capture IDs, payee) and the Project record. Refresh the page: everything persists. | "Every status here came back from PayPal and was checked with a follow-up GET. Refresh, and it's all still there. No double charges on retry." |
| 2:16–2:30 | Close | Optional 3-second split with the `npm run sandbox:verify` output. End on the wordmark. | "PayPal Orders and Payments v2, Claude vision, and a decision that stays human. PunchPay." |

**If the sandbox or the AI is down on recording day**
Record the `/simulation` page instead, and say so on screen and in the narration: "This is the offline simulation; nothing here touched PayPal." It is labeled "Simulation" throughout, and its references start with `SIM-`. Never cut simulation footage into the real segment, and never put it in the Devpost technical proof.

**Narration note:** the Claude report narrates against the seeded criteria. Paint: scuff no longer visibly apparent, uniform finish, same wall area. Tile: uncracked, flush and aligned, continuous grout. Quote what the live report actually says, not this list.

**Do not**
- Say "escrow", "guaranteed", "certified" or "inspected".
- Show client secrets, the `.env.local` file, or buyer personal data.
- Speed-ramp the PayPal popup so it looks instant. Cut it instead.
