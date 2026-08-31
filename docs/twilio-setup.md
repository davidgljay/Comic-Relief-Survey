# Setup & Handoff Runbook

This is the pre-event checklist for standing up the survey, and the handoff sequence
that keeps attendee PII (name, phone number) inside Comic Relief's own systems. See
[`comic-relief-sms-survey-plan.md`](../comic-relief-sms-survey-plan.md) for the full
architecture rationale.

## 1. Things to set up with Twilio well ahead of any event

These have the longest lead time — start them first, before scheduling a pilot event.

- **Create the Twilio account under Comic Relief's own ownership.** David is added as a
  collaborator to build the flow, but the account itself — billing, credentials — belongs
  to Comic Relief from day one.
- **Start A2P 10DLC brand + campaign registration immediately.** Budget 5–10 business
  days. Do not schedule a pilot event before this clears.
  - Classify the campaign use-case as **business-initiated, consent-based survey
    messages**, not conversational/user-initiated. Registration explicitly collects a
    phone number and an opt-in checkbox for this exact survey, which is what justifies
    texting first without a prior inbound message, QR code, or keyword opt-in — that's
    the non-standard part carriers scrutinize most in review. Get the campaign
    description to say this plainly, or messages risk aggressive carrier filtering.
  - A toll-free number with toll-free verification is a faster-to-provision alternative
    to 10DLC if the timeline is tight — worth asking Twilio support which fits better.
- **Provision the sending phone number** once registration is underway.
- **Enable the Messaging Service's Advanced Opt-Out** (STOP/START/HELP auto-handling).
  The Studio flow intentionally does not implement its own STOP logic — it relies on
  this being on.

## 2. Deploying the survey

1. `npm install`
2. `npm run deploy` — this is the whole process, interactively:
   - Prompts for each `.env` value one at a time, printing where to find it (the
     Twilio/Google console page) and defaulting to whatever's already in `.env`.
     Leave `STUDIO_FLOW_SID` blank the first time; the script fills it in for you.
     Leave `TRIGGER_SEND_SECRET` blank to have it generate one.
   - Runs `npm test`.
   - Asks for a final confirmation before touching the real Twilio account or Google
     Sheets, showing which account/sheet IDs it's about to act on.
   - Runs `twilio serverless:deploy`, reads the real deployed domain out of its
     output, and substitutes it into `studio-flow.json` in memory (the tracked file
     on disk is untouched — it keeps the `REPLACE_WITH_DEPLOYED_DOMAIN` placeholder).
   - Creates the Studio Flow via the API on first run (or updates it in place on
     later runs), publishes it, and writes the resulting `STUDIO_FLOW_SID` back into
     `.env`.
   - Redeploys the Functions once more if the Flow SID changed, so `trigger-send.js`
     has the right one.
   - Offers to watch the Contacts sheet for the row a live test text produces (see
     §7).
   - Re-run any time with `npm run deploy` — it's idempotent (updates the existing
     Flow rather than creating a new one) as long as `.env` still has
     `STUDIO_FLOW_SID` set. Flags: `--skip-env` reuses the existing `.env` without
     re-prompting; `--skip-tests` skips the `npm test` gate.

To change the survey's wording, edit the question/message text in
`scripts/generate-studio-flow.js` (not `studio-flow.json` directly — it's generated
and gets overwritten), run `npm run generate:flow` to rebuild `studio-flow.json`, then
`npm run deploy` to push it.

## 3. Google Sheets

- Create two Sheets, **owned by Comic Relief** (not David):
  1. **Contacts & Results** — header row: `phone, name, email, consent, event,
     registered_at, sent_at, respondent_id, q1, q2, q3, q4, q5, completed_at`
  2. **Anonymous Results** — header row: `respondent_id, event, q1, q2, q3, q4, q5,
     completed_at`
- Create a Google Cloud project + service account (also Comic Relief-owned), enable the
  Sheets API, and share **both** Sheets with the service account's email as an Editor.
- Put the service account's email and private key into `.env` /the deployed Function's
  environment variables. Never commit the real `.env`.
- David should only ever be shared the **Anonymous Results** sheet. Comic Relief keeps
  sole ownership of the Contacts & Results sheet, since it holds PII.

## 4. Collecting contacts

- Single contact: `POST /contacts` with JSON `{ phone, name, email, consent, event,
  registered_at }`. `phone` must be E.164 (`+15551234567`); `consent` must be explicitly
  true; requests missing either are rejected.
- Bulk import: `POST /contacts-csv` with a CSV body (columns: `phone, name, email,
  consent, event, registered_at`) either as a `csv` form field or a `file` upload. Rows
  missing phone/name/event/consent are skipped and reported back, not silently dropped.
- Wire whichever of these Comic Relief's registration platform (Eventbrite, RegFox,
  etc.) supports — directly, or via a Zapier step **that Comic Relief owns**, per the
  PII-avoidance architecture in the main plan doc.

## 5. Sending the survey

- At the planned post-event time, an **external cron job that Comic Relief owns** (e.g.
  a free account on cron-job.org) calls:
  `POST https://<deployed-domain>.twil.io/trigger-send?secret=<TRIGGER_SEND_SECRET>&event=<event-name>`
- This starts one Studio execution per consenting, not-yet-sent contact for that event,
  and marks each as sent so a retry or a second cron fire won't double-message anyone.
- Every inbound reply during the survey triggers a save to both Sheets immediately (via
  the flow's "Make HTTP Request" widgets), so a partially-completed survey still leaves
  partial answers on record — nothing waits until the flow finishes.

## 6. Known behaviors worth testing explicitly

- **Invalid answer**: one re-prompt is sent for numeric questions (1–5); a second
  invalid reply skips that question (recorded as blank) and the survey continues.
- **No reply / timeout**: 24 hours after a question is sent with no reply, the
  execution ends silently — whatever was already answered (and already saved after
  each prior question) stays on record; no further texts are sent.
- **Opt-out**: STOP/START/HELP is handled entirely by Twilio's Messaging Service
  opt-out feature, ahead of the Studio flow — confirm it's enabled (§1) and test it
  actually stops the conversation.
- **Open-text residual PII risk**: Question 5 ("what moment are you most likely to
  share?") is open text and could contain a name or other identifying detail a
  respondent volunteers. It's still written to the Anonymous Results sheet as-is —
  Comic Relief should spot-check Q5 responses before that sheet is shared onward.
- **Texting the number also starts the survey.** The flow's trigger fires on both a
  REST-started execution (the real `/trigger-send` path) and a plain inbound text —
  this is deliberate, so anyone can test the whole flow by just texting the number,
  with no API call needed (see §7). Text-triggered runs use `respondent_id` = the
  inbound message SID, `phone`/`name` from the message itself (name defaults to
  "there"), and always save under `event="test"`, so they can't be mistaken for real
  event data. **Decide before a number goes live for a real campaign** whether to
  leave this on (harmless — it just produces more `event="test"` rows if a stranger
  texts in) or remove the `incomingMessage` trigger from `studio-flow.json` /
  `scripts/generate-studio-flow.js` for a stricter "only REST-started executions run
  the survey" policy.

## 7. Test before any real data flows

- **Fastest check**: after `npm run deploy`, just text the Twilio number from your
  own phone — the survey starts immediately (see §6). Reply through a few branches,
  then check both Google Sheets for an `event="test"` row. `npm run deploy` can watch
  the Contacts sheet for you and confirm the row lands.
- Walk every branch (each valid path, invalid-then-retry, invalid-twice-skip, timeout,
  STOP) with dummy contacts and real test phone numbers.
- Also exercise the real `/trigger-send` path at least once with a dummy contact added
  via `/contacts`, not just the text-in shortcut — it's the one that runs for real
  events.
- Confirm the Anonymous Results sheet never contains a phone number or name in any
  column, including Q5.
- Confirm `/trigger-send` doesn't double-send when called twice for the same event.

## 8. Handoff

Once the above is verified with dummy data:

1. Comic Relief revokes David's access to the Twilio console.
2. Comic Relief revokes David's access to their Zapier workspace, if one was used for
   the registration-to-`/contacts` step.
3. David retains access only to the **Anonymous Results** Google Sheet going forward.
4. Keep an exported copy of `studio-flow.json` (already in this repo) as Comic Relief's
   audit trail of what was deployed.
