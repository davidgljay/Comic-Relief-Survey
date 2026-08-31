# Comic-Relief-Survey

A brief SMS survey to be administered by the organization Comic Relief, run natively
over SMS (no link-out) via Twilio Studio.

- [`comic-relief-sms-survey-plan.md`](comic-relief-sms-survey-plan.md) — architecture
  and PII-avoidance plan.
- [`survey-questions.md`](survey-questions.md) — the survey questions and the rationale
  behind each one.
- [`docs/twilio-setup.md`](docs/twilio-setup.md) — setup checklist, deployment steps,
  and the handoff sequence to Comic Relief.
- [`studio-flow.json`](studio-flow.json) — generated Twilio Studio flow implementing
  the survey logic. Regenerate with `npm run generate:flow`, don't hand-edit.
- [`functions/`](functions/) — Twilio Functions backend: contact intake (single +
  CSV), the post-event send trigger, and the per-reply Google Sheets writer.
- [`scripts/`](scripts/) — `generate-studio-flow.js` (builds `studio-flow.json`) and
  `deploy.js` (interactive deploy, see below).

## Quick start

```bash
npm install
npm run deploy
```

`npm run deploy` is interactive: it walks you through setting each value in `.env`
(where to find it in the Twilio/Google consoles is printed for each one), runs the
test suite, deploys the Functions, and creates or updates the Studio Flow to match —
substituting in the real deployed domain automatically. Full walkthrough, including
what to set up in the Twilio/Google consoles beforehand, in
[`docs/twilio-setup.md`](docs/twilio-setup.md).

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
against a mocked Google Sheets client; a structural validator for `studio-flow.json`
(no dangling/unwired/unreachable states, gates wired correctly, every save posts to
`/save-response` with no PII in the URL); and the deploy script's `.env` read/write and
domain-substitution logic. These don't call live Twilio or Google APIs — see
[`docs/twilio-setup.md`](docs/twilio-setup.md) §7 for the manual end-to-end pass
required before any real contact data is loaded.
