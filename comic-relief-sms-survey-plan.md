# Comic Relief SMS Survey Plan

*Drafted August 2026*

## 1. Goal

Support Comic Relief in sending post-event SMS surveys to attendees who consent to being texted during event registration — while I (David) never see or hold attendee PII (name, phone number), and Comic Relief's staff effort is minimized.

Key constraint: surveys must run as a native SMS conversation (business texts a question, attendee replies by text, next question follows) rather than a text-with-a-link-to-a-web-survey. Native SMS conversations produce meaningfully higher response rates than link-based surveys.

## 2. End-to-End Flow

1. **Survey design & approval** — I draft the survey questions; Comic Relief approves them.
2. **Consent at registration** — Comic Relief adds a checkbox to their event registration form: "Can we text you a brief survey at the end of the event?" (checked by default), and collects a phone number. This PII stays in Comic Relief's registration system; I never see it.
3. **Survey tool setup** — I build the survey as a Twilio Studio flow (see build plan below), plus the automation that moves data between systems.
4. **Access handoff** — Once tested, Comic Relief removes my access to anything that touches PII (the Twilio console/account and any Zapier workspace that connects to their registration system). I retain access only to a PII-scrubbed Google Sheet of responses.
5. **Post-event** — Survey sends automatically at a set time after the event; responses land in the Sheet; I run analysis from there.

## 3. PII-Avoidance Architecture

The core risk in any SMS survey workflow is that the survey/SMS platform inherently ties phone numbers to responses (especially for native SMS-thread tools). Two things have to be true to keep PII away from me:

**A. Account and Zap ownership matter, not just "not logging in."**
Twilio's console logs every message send/reply, including phone numbers, on every account. Zapier similarly logs the full input/output payload of every step, on every plan, retained 7–30+ days. Whoever owns the account/Zap can see that history regardless of whether they use the dashboard. So:

- **Twilio account:** must be created and owned by **Comic Relief**, not me, from day one. I'm added as a collaborator to build the flow; I don't hold the account credentials once real messages are flowing.
- **Trigger mechanism (whatever calls the Twilio API to start a Studio execution per consenting attendee, carries PII):** must live inside **Comic Relief's own Zapier workspace** (or a script/webhook they own), not mine. I can design/spec it, but the credentials and task history need to stay on their side.
- **Answers-out step (Studio flow → Google Sheet, answers only):** can be built and triggered from my side, since — if mapped correctly — it never carries phone/name.

**B. "Credentials removed" needs to be real and complete, before any real PII flows.**
- Test the full flow first with dummy registrations and fake phone numbers, to confirm the answers-out step actually excludes phone number, that skip logic and opt-out (STOP) work, and that timeout/no-response behavior is correct.
- Only after that's verified does Comic Relief remove me from: the Twilio console, and their Zapier workspace (if the trigger step lives there).
- The Google Sheet should be owned by/shared to me independently, so it keeps working after my other access is revoked.

**Residual risk:** open-text/free-response questions could let a respondent voluntarily type identifying info. Worth avoiding open-text fields, or having Comic Relief spot-check before sharing the Sheet with me.

**Paperwork note:** Comic Relief should have this workflow reflected in their DPA/data processing documentation with the SMS vendor, and clarify my role (or lack of one) as a processor once access is revoked — a legal/compliance item, not just a technical one.

## 4. Platform Decision: Twilio Studio

Most "SMS survey" tools actually text a **link** to a web survey rather than running the conversation natively in SMS — this fails the "no link, higher response rate" requirement. SimpleTexting and Sakari were evaluated first (see prior comparison below) but neither supports multi-message flows with skip logic. Twilio Studio does, via a visual no-code/low-code flow builder, and is the most proven option for this specific use case — the tradeoff is that more of the survey logic, response handling, and reporting has to be built rather than coming pre-packaged.

**Build plan:**

1. **Account and 10DLC registration (longest lead time — start first).**
   - Twilio account created and owned by Comic Relief (see PII architecture above); I'm added as a collaborator.
   - Start A2P 10DLC brand + campaign registration under Comic Relief's account immediately — budget 5–10 business days. Don't schedule a pilot event before this clears.
   - Provision the phone number once registration is underway.

2. **Design the flow before building.**
   - Map every question, branch condition, and exit path (flowchart or written spec) before touching Studio: what triggers a skip, what happens on no-reply/timeout, what happens on an invalid answer, where opt-out (STOP) sends someone.
   - Confirm Twilio's default STOP/opt-out compliance handling is active.
   - Decide timeout/no-response behavior explicitly — easy to miss until testing.

3. **Build in Twilio Studio.**
   - "Send & Wait for Reply" widgets for each question; "Split Based On..." widgets for branching; "Set Variables" to capture responses.
   - End-of-flow Function or HTTP Request widget pushes answers only (never phone number) to a Zapier Catch Hook or similar, feeding the Google Sheet.

4. **Trigger mechanism.**
   - Something calls the Twilio API to start a Studio execution per consenting attendee at the right post-event time — this lives in Comic Relief's Zapier workspace or a script/webhook they own (see PII architecture above).

5. **Test with dummy data.**
   - Walk every branch with test numbers; confirm the answers-out step excludes phone number; confirm opt-out and timeout behavior.

6. **Handoff.**
   - Comic Relief removes my access to the Twilio console once verified; I retain only the Google Sheet.
   - Keep an exported copy of the Studio flow JSON for records and Comic Relief's audit trail.

**Prior comparison (SimpleTexting / Sakari — ruled out for lack of skip logic):**

| Tool | Pricing | Notes |
|---|---|---|
| SimpleTexting | $39–$909/mo across 9 credit tiers; ~$0.078 → $0.018/msg at scale | No multi-message skip logic. G2: 4.7/5 across 642 reviews. |
| Sakari | From ~$25/mo; billed per segment | No multi-message skip logic. G2: 4.4/5, only 18 reviews. |

Also ruled out: **SurveyMonkey** (link-based SMS collector), **Alchemer** (no native two-way SMS), **Zonka Feedback / SurveySparrow** (likely link-based), **Bird** (has a Flow Builder with branching, but feature availability by plan and UI consistency post-rebrand were unconfirmed enough to deprioritize versus Twilio's maturity for this use case).

## 5. Open Questions for Comic Relief

- Do they already use Zapier? If so, what plan/tier (affects task history retention and whether I can be added as a temporary collaborator)?
- What platform runs their event registration (Eventbrite, RegFox, Cvent, Classy, etc.), and does it have a native or Zapier/Make integration path to SMS tools?
- Who on their side can act as workspace admin to grant and later revoke my access?
- Rough expected respondent volume per event, to inform Twilio account/number setup and 10DLC campaign details.
- Who owns the DPA/data-processing relationship with Twilio, and who on Comic Relief's side will own the Twilio account long-term (billing, number renewal, compliance) once I'm off it.

## 6. Next Steps

1. Send Comic Relief the open questions above.
2. Have Comic Relief create the Twilio account and start 10DLC brand + campaign registration (longest lead time — start immediately).
3. Draft survey questions and flow/skip-logic spec for their approval, avoiding open-text fields where possible.
4. Build the Studio flow once the account and number are ready.
5. Build the trigger step inside Comic Relief's Zapier workspace (or a script/webhook they own).
6. Build and test the answers-out step (Studio → Google Sheet, answers-only) with dummy data.
7. Test the full flow end-to-end with dummy registrations and fake numbers — branches, opt-out, timeout behavior.
8. Once validated, have Comic Relief revoke my access to the Twilio console and their Zapier workspace, retaining only my Google Sheet access.
9. Run first live survey at a pilot event; review results and refine before scaling to additional events.
