# Comic-Relief-Survey

A brief SMS survey to be administered by the organization Comic Relief, run natively
over SMS (no link-out) via Twilio Studio.

- [`comic-relief-sms-survey-plan.md`](comic-relief-sms-survey-plan.md) — architecture
  and PII-avoidance plan.
- [`survey-questions.md`](survey-questions.md) — the survey questions and the rationale
  behind each one.
- [`docs/twilio-setup.md`](docs/twilio-setup.md) — setup checklist, deployment steps,
  and the handoff sequence to Comic Relief.
- [`studio-flow.json`](studio-flow.json) — importable Twilio Studio flow implementing
  the survey logic.
- [`functions/`](functions/) — Twilio Functions backend: contact intake (single +
  CSV), the post-event send trigger, and the per-reply Google Sheets writer.

## Quick start

See [`docs/twilio-setup.md`](docs/twilio-setup.md) for the full walkthrough. In short:

```bash
npm install
cp .env.example .env   # fill in real values
npx twilio serverless:deploy
```

Then import `studio-flow.json` into a new Studio Flow in Comic Relief's Twilio console.

## Tests

```bash
npm test
```

Unit tests (Jest) cover the four Functions' request validation and branching logic
against a mocked Google Sheets client, plus a structural validator for
`studio-flow.json` (no dangling/unwired/unreachable states, gates wired correctly,
every save posts to `/save-response` with no PII in the URL). These don't call live
Twilio or Google APIs — see [`docs/twilio-setup.md`](docs/twilio-setup.md) §7 for the
manual end-to-end test pass required before any real contact data is loaded.
