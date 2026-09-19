#!/usr/bin/env node
// Recovers survey answers that never reached the Google Sheets. Every reply is
// also stored in its Studio execution, so anything a failed save dropped can be
// rebuilt from Twilio and written again.
//
//   npm run reconcile                           dry run: shows what it WOULD write
//   npm run reconcile -- --apply                writes it
//   npm run reconcile -- --since 2026-09-01     only executions created on/after that date
//   npm run reconcile -- --all                  also re-send executions that look complete
//                                               (the anonymous sheet can't be read back,
//                                               so this is how to repair it)
//
// Dry run by default: nothing is written without --apply. Safe to re-run — the
// write is an upsert, values someone edited by hand in the Contacts sheet are
// never overwritten, and an execution superseded by a newer send is skipped.
// Uses the credentials in .env (ACCOUNT_SID, AUTH_TOKEN, STUDIO_FLOW_SID,
// APPS_SCRIPT_URL, APPS_SCRIPT_SECRET).
const fs = require('fs');
const path = require('path');
const { parseEnvValues } = require('./_lib/env-file.js');
const { reconcile } = require('./_lib/reconcile.js');

const ROOT = path.join(__dirname, '..');

const mask = (phone) => `…${String(phone).replace(/\D/g, '').slice(-4)}`;

function parseArgs(argv) {
  const args = { apply: argv.includes('--apply'), all: argv.includes('--all') };
  const i = argv.indexOf('--since');
  if (i !== -1) {
    args.since = argv[i + 1];
    if (!args.since || Number.isNaN(new Date(args.since).getTime())) {
      throw new Error('--since needs a date, e.g. --since 2026-09-01');
    }
  }
  return args;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const env = parseEnvValues(fs.readFileSync(path.join(ROOT, '.env'), 'utf8'));
  for (const key of ['ACCOUNT_SID', 'AUTH_TOKEN', 'STUDIO_FLOW_SID', 'APPS_SCRIPT_URL', 'APPS_SCRIPT_SECRET']) {
    if (!env[key]) throw new Error(`${key} is missing from .env`);
  }

  const client = require('twilio')(env.ACCOUNT_SID, env.AUTH_TOKEN);
  const { callAppsScript } = require('../functions/lib/apps-script-client.private.js');

  console.log(args.apply ? 'Reconciling (WRITING to the sheets)...' : 'Reconciling (dry run — nothing will be written)...');
  const summary = await reconcile({
    client,
    flowSid: env.STUDIO_FLOW_SID,
    callAppsScript,
    appsScriptContext: { APPS_SCRIPT_URL: env.APPS_SCRIPT_URL, APPS_SCRIPT_SECRET: env.APPS_SCRIPT_SECRET },
    since: args.since,
    apply: args.apply,
    all: args.all,
    log: (line) => console.log(`  ${line}`),
  });

  console.log(`\nScanned ${summary.scanned} execution(s).`);

  const verb = args.apply ? 'Wrote' : 'Would write';
  console.log(`${verb}: ${summary.written.length}`);
  for (const w of summary.written) {
    const what = [w.filled.length ? `answers ${w.filled.join(', ')}` : null, w.completed ? 'completed' : null]
      .filter(Boolean)
      .join(' + ');
    console.log(`  ${mask(w.phone)}  ${w.executionSid.slice(0, 10)}…  ${what || 're-sent as is'}`);
  }

  if (summary.conflicts.length) {
    console.log(`\nLeft alone because the sheet holds a different value (edited by hand?): ${summary.conflicts.length}`);
    for (const c of summary.conflicts) console.log(`  ${mask(c.phone)}  ${c.questions.join(', ')}`);
  }
  if (summary.failed.length) {
    console.log(`\nFAILED to write: ${summary.failed.length} (re-run to retry)`);
    for (const f of summary.failed) console.log(`  ${mask(f.phone)}  ${f.error.slice(0, 120)}`);
  }

  const reasons = {};
  for (const s of summary.skipped) reasons[s.reason] = (reasons[s.reason] || 0) + 1;
  console.log(`\nSkipped: ${summary.skipped.length}`);
  for (const [reason, n] of Object.entries(reasons)) console.log(`  ${n} × ${reason}`);

  if (!args.apply && summary.written.length) console.log('\nDry run only. Re-run with --apply to write these.');
  if (summary.failed.length) process.exitCode = 1;
}

if (require.main === module) {
  main().catch((err) => {
    console.error('\nReconcile failed:', err.message);
    process.exit(1);
  });
}

module.exports = { parseArgs, mask };
