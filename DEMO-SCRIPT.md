# PunchPay demo video: shot list (target 2:30, hard limit 2:59)

Every shot must be real app footage against the PayPal sandbox. No mock screens. **This submission has no Anthropic key:** the review on screen is the labeled `prototype_no_model` path, and the narration must say so — never describe it as Claude analysing the photos. The photos are labeled synthetic illustrations. `docs/PROOF-SANDBOX.md` is complete (two passed runs).

**Optional genuinely AI-powered recording, only after certification:** To show actual image analysis rather than the honest prototype review, configure `GEMINI_API_KEY` in the protected staging environment, redeploy, run two real vision reviews on the labelled synthetic images, and verify the report source is `live_model` and model is Gemini. Replace the prototype narration at 0:58–1:28 with the actual findings visible on screen. Do not invent confidence percentages. Confirm no payment decisions consume model output. If no key or no successful test, keep this original no-model script exactly as written.

**Prep before recording**
- Run the demo reset (`select public.punchpay_reset_demo();` as service role). This archives the previous run. It refuses while a capture or void is unconfirmed (reconcile first). It also refuses while PayPal holds are still open; void or let them end, or knowingly pass `punchpay_reset_demo(true)` to leave them open in the sandbox.
- Log in with `DEMO_PASSCODE` (the presenter, both roles) so the role switch works on one screen.
- Have the four images ready: paint before/after, tile before/after (the project's synthetic illustrations, each stamped "NOT A PHOTO").
- Browser at 1440×900, 100% zoom.
- A second window logged in to the sandbox Personal buyer.
- Hide the bookmarks bar and any personal accounts.

| Time | Shot | On screen | Narration (approx.) |
| --- | --- | --- | --- |
| 0:00–0:14 | Hook | Cover: "Every fix reviewed. Every payment decided." Tally shows $50.00 under contract. | "A renovation is ninety-nine percent done. Two small fixes are left. Why should one unresolved tile hold up payment for a finished paint repair?" |
| 0:14–0:32 | Two separate holds | Homeowner role, Paint, PayPal button, sandbox checkout popup, approve. Back in the app: "Funds held", authorization ID visible. Repeat quickly for Tile (cut the popup). | "Each fix gets its own PayPal authorization. The money is held, not paid. Two fixes, two independent holds." |
| 0:32–0:58 | Contractor evidence | Click "Switch to contractor". Upload paint before/after, then tile before/after. Record shows each upload. | "The contractor submits before-and-after photos. They're stored privately and shown only through short-lived links." |
| 0:58–1:28 | Advisory review | "Request advisory review" on Paint, then Tile. The red banner reads "Prototype path — no AI ran"; each criterion shows "Not assessed". Pause on the banner and the source line. | "The review slot is advisory and never decides. In this build we ran it without a model, and it says exactly that: nothing examined these photos, every criterion is unassessed. With a key, Claude describes what's visible against each criterion — same slot, same rule: it never moves money." |
| 1:28–1:58 | Two human decisions | Switch to homeowner. Paint: "Accept and pay $30.00", inline confirm, green outcome with capture ID and COMPLETED. Tile: "Reject and release", confirm, stone outcome with VOIDED. | "The homeowner decides. Accept captures thirty dollars from that hold only. Reject voids the other hold, and the homeowner isn't charged." |
| 1:58–2:16 | Proof | Tally: $30 paid, $20 released. Scroll to the Payments ledger (order, auth, capture IDs, payee) and the Project record. Refresh the page: everything persists. | "Every status here came back from PayPal and was checked with a follow-up GET. Refresh, and it's all still there. No double charges on retry." |
| 2:16–2:30 | Close | Optional 3-second split with the `npm run sandbox:verify` output. End on the wordmark. | "PayPal Orders and Payments v2, an advisory review that never decides, and a decision that stays human. PunchPay." |

**If the sandbox or the AI is down on recording day**
Record the `/simulation` page instead, and say so on screen and in the narration: "This is the offline simulation; nothing here touched PayPal." It is labeled "Simulation" throughout, and its references start with `SIM-`. Never cut simulation footage into the real segment, and never put it in the Devpost technical proof.

**Narration note:** quote what the report on screen actually says. On the no-model path that is "Not assessed: no model examined this photo" for every criterion. Do not narrate findings the report does not contain.

**Do not**
- Say "escrow", "guaranteed", "certified" or "inspected".
- Show client secrets, the `.env.local` file, or buyer personal data.
- Speed-ramp the PayPal popup so it looks instant. Cut it instead.
