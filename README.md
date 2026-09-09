# Comic-Relief-Survey

A brief SMS survey to be administered by the organization Comic Relief, run natively
over SMS (no link-out) via Twilio Studio.

- [`comic-relief-sms-survey-plan.md`](comic-relief-sms-survey-plan.md) — architecture
  and PII-avoidance plan.
- [`survey-questions.md`](survey-questions.md) — the survey questions and the rationale
  behind each one.
- [`survey-content.yaml`](survey-content.yaml) — the actual message wording sent over
  SMS. Edit this, not `studio-flow.json`, to change copy.
- [`docs/twilio-setup.md`](docs/twilio-setup.md) — setup checklist, deployment steps,
  and the handoff sequence to Comic Relief.
- [`studio-flow.json`](studio-flow.json) — generated Twilio Studio flow implementing
  the survey logic. Don't hand-edit — see below.
- [`functions/`](functions/) — Twilio Functions backend: contact intake (single +
  CSV), the post-event send trigger, and the per-reply save (calls `apps-script/`).
- [`apps-script/Code.gs`](apps-script/Code.gs) — Google Apps Script Web App that owns
  both Sheets. No Google Cloud project or service account needed — see below.
- [`scripts/`](scripts/) — `generate-studio-flow.js` (builds `studio-flow.json` from
  `survey-content.yaml`) and `deploy.js` (interactive deploy, see below).

## Setup walkthrough

```bash
npm install
npm run deploy
```

### 0. Before you run it

`npm run deploy` can't do everything — two things have to exist first, or its prompts
have nothing to point at:

1. **A Twilio account owned by Comic Relief**, with A2P 10DLC brand + campaign
   registration already started (5–10 business days — the longest lead time in the
   whole setup, start it before anything else). Full detail:
   [`docs/twilio-setup.md`](docs/twilio-setup.md) §1.
2. **Two blank Google Sheets**, and [`apps-script/Code.gs`](apps-script/Code.gs)
   deployed as a Web App against them. Briefly: create the Sheets, copy their IDs from
   the URL, open either one's **Extensions > Apps Script**, paste in `Code.gs`, fill in
   its `CONFIG` (a placeholder `SHARED_SECRET` is fine for now — step 3 below replaces
   it), then **Deploy > New deployment > Web app** (Execute as: Me; Access: Anyone) and
   copy the `/exec` URL it gives you. Full click-by-click detail, including the
   one-time "Google hasn't verified this app" screen you'll hit:
   [`docs/twilio-setup.md`](docs/twilio-setup.md) §3.

### 1. Run `npm run deploy` and answer its prompts

It asks for these values in order, printing where to find each one and defaulting to
whatever's already in `.env` if you re-run it:

1. **Twilio Account SID** — console home page (starts `AC`; *not* the API keys page,
   whose SIDs start `SK` and won't work here).
2. **Twilio Auth Token** — same console page, "view" to reveal it.
3. **Twilio phone number** — E.164 format, e.g. `+15551234567`.
4. **Studio Flow SID** — leave blank on a first run; the script creates the flow and
   fills this in itself.
5. **Contacts & Results Google Sheet** and **Anonymous Results Google Sheet** — paste
   either Sheet's full URL or just its ID, from step 0.2.
6. **Apps Script Web App URL** — the `/exec` URL from step 0.2.

`APPS_SCRIPT_SECRET` and `TRIGGER_SEND_SECRET` are **not** prompted for at all — the
script generates both automatically and prints them right after, labeled, so you can
copy them if needed.

### 2. Copy the generated Apps Script secret into `Code.gs`

Take the `APPS_SCRIPT_SECRET` value just printed, paste it into `Code.gs`'s
`CONFIG.SHARED_SECRET` (replacing the placeholder from step 0.2), save, then **Deploy
> Manage deployments > pencil icon > Version: New version > Deploy** — saving the file
alone doesn't update the live URL.

**On a genuinely first run, expect the next part to fail once here** — the script
already moved on using the secret it just generated, but `Code.gs` was still running
the placeholder when it did. That's normal, not a bug: finish this step, then re-run
`npm run deploy --skip-env` (reuses the `.env` it already wrote, no re-prompting) to
pick up where it left off.

### 3. What it does after you answer the prompts

In order, automatically:

- Runs `npm test`.
- Asks for a final "about to deploy" confirmation, naming the account and Apps Script
  URL it's about to touch.
- Inserts the header row into both Sheets (skipped if already present; refuses to
  touch a sheet whose row 1 holds something else).
- Deploys the Twilio Functions (`twilio-run deploy`).
- Validates, then creates or updates, the Studio Flow — substituting the real deployed
  domain into `studio-flow.json` in the process (the tracked file on disk keeps the
  `REPLACE_WITH_DEPLOYED_DOMAIN` placeholder; nothing to commit here).
- Redeploys the Functions once more if the Flow SID just changed, so the trigger
  endpoint has the right one.
- **Attaches the Studio Flow to the phone number's "A message comes in" webhook** —
  easy to miss if done by hand, since creating a Flow doesn't attach it to any number
  by itself; texting the number does nothing at all until this step runs.
- Offers to watch the Contacts sheet for the row your first live test text produces.

Re-running later is safe and idempotent — it updates the existing Studio Flow rather
than creating a new one, skips already-correct Sheet headers, and just re-confirms the
phone number webhook.

Changed the wording in `survey-content.yaml`? Run `npm run generate:flow` to rebuild
`studio-flow.json`, then `npm run deploy` (with `--skip-env` if `.env` is already set)
to push it.

## Testing it live

After deploying, just **text the Twilio number** — no API call needed. The flow
starts on any inbound text and walks the same survey logic, saving to `event="test"`
rows in both Sheets so it never mixes with real event data. `npm run deploy` offers to
watch the Contacts sheet for that row automatically once you've sent your first reply.

**No reply at all, no error anywhere?** Check the number's status in Console > Phone
Numbers > Manage > Active Numbers: if it says **"Messaging disabled — Complete A2P
registration,"** that's the cause, not the code — Twilio blocks all SMS on the number,
both directions, until A2P 10DLC registration clears (§0 above). Nothing to fix here;
just wait it out or finish that registration. You can still sanity-check the survey
logic itself in the meantime via Studio's own **Simulator** (Console > Studio > open
the flow > Simulator), which doesn't touch the phone number at all.

## Tests

```bash
npm test
```

Unit tests (Jest) cover: the four Functions' request validation and branching logic
against a mocked Apps Script client; the Apps Script client's redirect-following and
error handling against a mocked `https`; the pure PII-separation, row-mapping, and
idempotent header-writing logic in `apps-script/Code.gs` itself (Node can `require` it
directly — see `test/lib/apps-script-code.test.js`); a structural validator for
`studio-flow.json` (no dangling/unwired/unreachable states, gates wired correctly,
every save posts to `/save-response` with no PII in the URL); the deploy script's
`.env` read/write, Sheet-URL-to-ID parsing, and field validators (including the exact
API-Key-SID-vs-Account-SID mistake that motivated them); domain-substitution logic;
and that the flow generator actually reads `survey-content.yaml` rather than a
hardcoded copy. None of this calls a live Twilio account, a live Apps Script
deployment, or a real Google Sheet — see [`docs/twilio-setup.md`](docs/twilio-setup.md)
§7 for the manual end-to-end pass required before any real contact data is loaded.
