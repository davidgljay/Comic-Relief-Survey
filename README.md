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
