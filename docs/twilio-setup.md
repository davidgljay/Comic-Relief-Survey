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
- **The `ACCOUNT_SID`/`AUTH_TOKEN` used by `npm run deploy` need full account access** —
  they run `twilio-run deploy` and create/update the Studio Flow via the REST
  API, and Twilio has no Restricted API Key grant that covers both together. There's no
  way to hand these out more narrowly; the mitigation is procedural, not technical —
  rotate this Auth Token once David's collaborator access is revoked (§8).
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

Required order, since `npm run deploy` needs both Sheet IDs and a live Apps Script
URL to even get through its prompts: create the two Sheets first (§3 step 1), then do
the rest of §3 (paste `Code.gs` in, fill in `CONFIG` with a placeholder
`SHARED_SECRET` for now, deploy it as a Web App, copy the `/exec` URL) — *then* run
the deploy script below.

Expect the **first** `npm run deploy` run to fail partway through, at "Initializing
Google Sheet headers" — that's expected, not a bug. It auto-generates
`APPS_SCRIPT_SECRET` and prints it before that step, but `Code.gs` is still running
with the placeholder secret you put in during §3, so the call is rejected with
`"invalid secret"`. Copy the printed secret into `Code.gs`'s `CONFIG.SHARED_SECRET`,
cut a new deployment version (§3 step 12), then re-run `npm run deploy --skip-env`
(reuses the `.env` it already wrote, no re-prompting) to finish.

1. `npm install`
2. `npm run deploy` — this is the whole process, interactively:
   - Prompts for each `.env` value one at a time, printing where to find it (the
     Twilio/Google console page) and defaulting to whatever's already in `.env`.
     Leave `STUDIO_FLOW_SID` blank the first time; the script fills it in for you.
     Sheet URLs can be pasted in full — it extracts the ID itself.
   - `APPS_SCRIPT_SECRET` and `TRIGGER_SEND_SECRET` are **not** prompted for at all —
     the script generates them automatically (reusing whatever's already in `.env` on
     a later run) and prints both values afterward so you can copy them if needed:
     `APPS_SCRIPT_SECRET` has to be pasted into `Code.gs`'s `CONFIG` (see §3 step 4);
     `TRIGGER_SEND_SECRET` is needed later for the cron job (§5).
   - Runs `npm test`.
   - Asks for a final confirmation before touching the real Twilio account, Sheets, or
     Apps Script, showing which account/URL it's about to act on.
   - Calls the Apps Script Web App's `init_headers` action, which writes the header
     row into each Sheet if it's currently blank (§3's headers, so you never have to
     type them in by hand) — a no-op if they're already there, and it refuses to
     touch a sheet whose row 1 has different content rather than risk overwriting
     real data.
   - Runs `twilio-run deploy` (the Serverless Toolkit's own standalone CLI — not the
     full Twilio CLI, which isn't required here), passing `ACCOUNT_SID`/`AUTH_TOKEN`
     from `.env` directly via `--username`/`--password` (no `twilio login` needed) and
     `--override-existing-project` (always deploys to the one Service this project
     uses, named from `package.json`, rather than erroring "Service already exists" —
     `twilio-run`'s own way of tracking that is a local, gitignored cache file that
     won't exist on a fresh clone or another machine), reads the real deployed domain
     out of its output, and substitutes it into `studio-flow.json` in memory (the
     tracked file on disk is untouched — it keeps the `REPLACE_WITH_DEPLOYED_DOMAIN`
     placeholder).
   - Creates the Studio Flow via the API on first run (or updates it in place on
     later runs), publishes it, and writes the resulting `STUDIO_FLOW_SID` back into
     `.env`.
   - Redeploys the Functions once more if the Flow SID changed, so `trigger-send.js`
     has the right one.
   - Sets `TWILIO_PHONE_NUMBER`'s **"A message comes in" webhook** to point at the
     Studio Flow. Creating a Flow doesn't attach it to any number by itself — without
     this step, texting the number does nothing at all, and it's easy to miss since
     the deploy otherwise looks fully successful. Safe to re-run: it just re-sets the
     same webhook.
   - Offers to watch the Contacts sheet for the row a live test text produces (see
     §7).
   - Re-run any time with `npm run deploy` — it's idempotent (updates the existing
     Flow rather than creating a new one, and skips already-initialized headers) as
     long as `.env` still has the same values. Flags: `--skip-env` reuses the
     existing `.env` without re-prompting; `--skip-tests` skips the `npm test` gate.

To change the survey's wording, edit [`survey-content.yaml`](../survey-content.yaml)
(not `studio-flow.json` directly — it's generated and gets overwritten), run
`npm run generate:flow` to rebuild `studio-flow.json`, then `npm run deploy` to push
it. Question order, branching, and timeout logic live in
`scripts/generate-studio-flow.js` instead — that file is code, not copy.

## 3. Google Sheets

Sheets are written via a small Google Apps Script Web App
([`apps-script/Code.gs`](../apps-script/Code.gs)) instead of the Sheets REST API — no
Google Cloud project, service account, or private key required, and auth is implicit
in whoever deploys the script.

1. In Comic Relief's Google Drive (not David's), create two **blank** Sheets — leave
   `Sheet1` empty, don't type in headers by hand:
   - **Contacts & Results** — will hold name/phone/consent plus every answer.
   - **Anonymous Results** — will hold answers only, no name/phone.
   - Copy each sheet's ID from its URL: `docs.google.com/spreadsheets/d/`**`<this
     part>`**`/edit`. `npm run deploy` (§2) inserts the correct header row into each
     automatically once Apps Script is deployed (steps below) — that's what its
     `init_headers` call does.
2. Open the **Contacts & Results** sheet (doesn't matter which one, but pick one).
   Top menu: **Extensions > Apps Script**. This opens a new tab at script.google.com
   with a blank project containing one file, `Code.gs`, with a placeholder
   `function myFunction() {}`.
3. Click into that placeholder code, **select all** (Cmd/Ctrl+A) and delete it. Open
   [`apps-script/Code.gs`](../apps-script/Code.gs) from this repo, select all its
   contents, copy, and paste into the now-empty Apps Script editor.
4. Near the top of the pasted code, fill in the `CONFIG` object's three placeholder
   values:
   - `SHARED_SECRET`: leave the placeholder as-is for now, or put in anything — you'll
     replace it with `npm run deploy`'s auto-generated value in a moment (§2). This
     must eventually be **identical** to `.env`'s `APPS_SCRIPT_SECRET`, or every call
     gets rejected with `"invalid secret"`.
   - `CONTACTS_SHEET_ID` and `ANONYMOUS_SHEET_ID`: from step 1.
5. Save the project: the floppy-disk icon in the toolbar, or Cmd/Ctrl+S. If prompted
   to name the project, any name works (e.g. "Comic Relief Survey Sheets API").
6. Click the blue **Deploy** button (top right) **> New deployment**.
7. Next to "Select type," click the **gear/cog icon** and choose **Web app** (it's not
   selected by default).
8. Fill in the Web app form:
   - Description: optional, e.g. "v1".
   - Execute as: **Me** (your own Google account — this is what makes the script run
     with your Sheets access, not the caller's).
   - Who has access: **Anyone**.
9. Click **Deploy**.
10. **First deploy only:** Google will interrupt with an "Authorize access" prompt.
    Click **Authorize access** > choose your Google account > you'll land on a
    "Google hasn't verified this app" warning screen. This is expected — it's *your*
    private script, not a publicly published one, and there is no way to skip this
    for a self-authored script. Click **Advanced** (small text, easy to miss) > **Go
    to [project name] (unsafe)** > **Allow**. You'll then return to the deploy dialog.
11. The deploy dialog now shows a **Web app URL** ending in `/exec`. Click **Copy**,
    then **Done**. That URL is `APPS_SCRIPT_URL`.
12. Whenever you edit `Code.gs` later (e.g. pasting in a different `SHARED_SECRET`),
    the `/exec` URL does **not** automatically pick up the change — you must cut a new
    version: **Deploy > Manage deployments** > click the **pencil/edit icon** next to
    the existing deployment > Version dropdown > **New version** > **Deploy**. Until
    you do, it keeps serving the old code.

David never needs Google Cloud Console access, and never holds a service-account
credential — only whoever runs this one-time Apps Script setup needs edit access to
the Sheets, and that should be someone at Comic Relief. David is still shared the
**Anonymous Results** sheet directly (view access is enough) to do the actual survey
analysis — see handoff, §8.

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

- **Any reply is accepted, verbatim, for every question** — including free text on
  the 1–5 questions. There's no reprompt or validation step; whatever's typed gets
  saved as that question's answer. The Q3→Q4 and Q1→Q5 gates still specifically look
  for a bare "1" or "2" to decide whether to ask the follow-up — a free-text reply to
  Q1/Q3 simply doesn't match either, so the follow-up is skipped, same as any other
  non-1/2 answer.
- **No reply / timeout**: 24 hours after a question is sent with no reply, the
  execution ends silently — whatever was already answered (and already saved after
  each prior question) stays on record; no further texts are sent.
- **Opt-out**: STOP/START/HELP is handled entirely by Twilio's Messaging Service
  opt-out feature, ahead of the Studio flow — confirm it's enabled (§1) and test it
  actually stops the conversation.
- **Open-text residual PII risk, on every question, not just Q5**: since any reply is
  accepted verbatim, a respondent could type a name or other identifying detail into
  the reply to *any* question, not only Q5 (the intentionally open-ended one). Every
  answer is still written to the Anonymous Results sheet as typed — Comic Relief
  should spot-check responses before that sheet is shared onward.
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
- Walk every branch (a numeric reply, a free-text reply, timeout, STOP) with dummy
  contacts and real test phone numbers.
- Also exercise the real `/trigger-send` path at least once with a dummy contact added
  via `/contacts`, not just the text-in shortcut — it's the one that runs for real
  events.
- Confirm the Anonymous Results sheet never contains a phone number or name in any
  column, including Q5.
- Confirm `/trigger-send` doesn't double-send when called twice for the same event.

## 8. Handoff

David never holds Twilio account credentials, a Google service-account key, or Google
Cloud Console access at any point — the only thing to revoke is Twilio console
collaborator access. Once the above is verified with dummy data:

1. Comic Relief revokes David's collaborator access to the Twilio console.
2. Comic Relief revokes David's access to their Zapier workspace, if one was used for
   the registration-to-`/contacts` step.
3. David keeps (or is newly given) view access to the **Anonymous Results** Google
   Sheet for analysis — that's the only Google access David has, ever.
4. Keep an exported copy of `studio-flow.json` and `apps-script/Code.gs` (both already
   in this repo) as Comic Relief's audit trail of what was deployed.
