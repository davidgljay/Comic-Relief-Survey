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

## Quick start

```bash
npm install
npm run deploy
```

`npm run deploy` is interactive: it walks you through setting each value in `.env`
(where to find it is printed for each one — paste a Sheet's URL or its bare ID,
either works), inserts the header row into both Google Sheets, runs the test suite,
deploys the Functions, and creates or updates the Studio Flow to match — substituting
in the real deployed domain automatically. `APPS_SCRIPT_SECRET`/`TRIGGER_SEND_SECRET`
are never prompted for — they're generated automatically and printed afterward in
case you need to copy them. It doesn't deploy the Google side — `apps-script/Code.gs`
is a one-time copy/paste into the Apps Script editor, done once by whoever owns the
Sheets, **before** running `npm run deploy` (see
[`docs/twilio-setup.md`](docs/twilio-setup.md) §3 for the full walkthrough, including
what to set up in the Twilio console beforehand).

Changed the wording in `survey-content.yaml`? Run `npm run generate:flow` to rebuild
`studio-flow.json`, then `npm run deploy` (with `--skip-env` if `.env` is already set)
to push it.

## Testing it live

After deploying, just **text the Twilio number** — no API call needed. The flow
starts on any inbound text and walks the same survey logic, saving to `event="test"`
rows in both Sheets so it never mixes with real event data. `npm run deploy` offers to
watch the Contacts sheet for that row automatically once you've sent your first reply.

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
