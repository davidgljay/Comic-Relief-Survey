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
2. Copy `.env.example` to `.env` and fill in real values (Twilio credentials, Studio
   flow SID once created, the two Google Sheet IDs, the Google service-account
   credentials, and a random `TRIGGER_SEND_SECRET`).
3. `npx twilio serverless:deploy` — deploys `functions/*.js` under Comic Relief's Twilio
   account. Note the deployed domain it prints (e.g. `comic-relief-survey-1234-dev.twil.io`).
4. Open `studio-flow.json`, find-and-replace every occurrence of
   `REPLACE_WITH_DEPLOYED_DOMAIN.twil.io` with the real deployed domain from step 3.
5. In the Twilio Console, create a new Studio Flow, and use the flow editor's **Import
   from JSON** option (⋮ menu) to import `studio-flow.json`. Publish it, then copy its
   Flow SID into `STUDIO_FLOW_SID` in `.env`, and re-run `twilio serverless:deploy` so
   `trigger-send.js` has the right SID.
   - After import, open each "Make HTTP Request" widget once in the UI — Studio
     sometimes needs a manual save on imported widgets to fully register them, even
     though the URL is already correct.

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

## 7. Test before any real data flows

- Walk every branch (each valid path, invalid-then-retry, invalid-twice-skip, timeout,
  STOP) with dummy contacts and real test phone numbers.
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
