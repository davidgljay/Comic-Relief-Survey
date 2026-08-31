#!/usr/bin/env node
// Interactive deploy: walks through setting .env locally, runs the test
// suite, deploys the Twilio Functions, creates/updates the Studio Flow with
// the real deployed domain, and offers to watch the Contacts sheet for the
// row a live test text produces. See docs/twilio-setup.md for the full
// walkthrough this automates.
const fs = require('fs');
const path = require('path');
const readline = require('readline/promises');
const { spawn } = require('child_process');
const { parseEnvValues, renderEnvFile, resolveValue } = require('./_lib/env-file.js');
const { extractDomain, substituteDomain } = require('./_lib/flow-domain.js');
const { extractSheetId } = require('./_lib/sheet-id.js');

const ROOT = path.join(__dirname, '..');
const ENV_PATH = path.join(ROOT, '.env');
const FLOW_PATH = path.join(ROOT, 'studio-flow.json');

// ACCOUNT_SID/AUTH_TOKEN need FULL account access — they're used both to run
// `twilio-run deploy` (create/update the Serverless Service, Functions,
// Assets, Environment, Build, and Deployment) and to create/update the Studio
// Flow via the REST API. Twilio has no Restricted API Key permission grant
// that cleanly covers both of those together, so there's no narrower scope to
// hand out here — whatever credential is used, it has full access to the
// account. (A Standard API Key SID+Secret pair carries that same full scope
// and could replace the Auth Token below for independent revocability, but
// it authenticates as a *different* username/password pair — API Key SID as
// username, API Key Secret as password, not paired with the Account SID — so
// it isn't a drop-in swap for this field; this script only supports Account
// SID + Auth Token today.) Per docs/twilio-setup.md §8: this should be a
// Comic Relief-owned account, and this Auth Token should be rotated once
// David's collaborator access is revoked at handoff.
const ENV_VARS = [
  {
    key: 'ACCOUNT_SID',
    prompt: 'Twilio Account SID',
    help: 'Twilio Console home page, top left — NOT the "API keys & tokens" page (that page\'s API Key SIDs start with SK and won\'t work here). Starts with AC. Needs full account access — see note above.',
    validate: (v) => (/^AC[0-9a-f]{32}$/i.test(v) ? null : 'must start with "AC" followed by 32 hex characters (this is the Account SID, not an API Key SID)'),
  },
  { key: 'AUTH_TOKEN', prompt: 'Twilio Auth Token', help: 'Twilio Console home page, next to Account SID — click "view" to reveal it. Needs full account access — see note above.', secret: true },
  {
    key: 'TWILIO_PHONE_NUMBER',
    prompt: 'Twilio phone number (E.164)',
    help: 'Twilio Console > Phone Numbers > Manage > Active Numbers, e.g. +15551234567.',
    validate: (v) => (/^\+[1-9]\d{1,14}$/.test(v) ? null : 'must be E.164 format, e.g. +15551234567'),
  },
  {
    key: 'STUDIO_FLOW_SID',
    prompt: 'Studio Flow SID',
    help: 'Leave blank the first time you run this — the script creates the flow and fills this in for you on later runs.',
    optional: true,
    validate: (v) => (/^FW[0-9a-f]{32}$/i.test(v) ? null : 'must start with "FW" followed by 32 hex characters'),
  },
  {
    key: 'CONTACTS_SHEET_ID',
    prompt: 'Contacts & Results Google Sheet',
    help: 'Create a new blank Google Sheet now, in Comic Relief\'s Drive (not David\'s) — this one will hold name/phone/consent plus every answer. Paste its URL or just the id segment. The script will insert the header row for you once the Apps Script Web App below is set up.',
    parse: extractSheetId,
    validate: (v) => (/^[a-zA-Z0-9-_]{20,}$/.test(v) ? null : "doesn't look like a valid Google Sheet ID/URL"),
  },
  {
    key: 'ANONYMOUS_SHEET_ID',
    prompt: 'Anonymous Results Google Sheet',
    help: 'Create a second, separate blank Google Sheet for answers only (no name/phone) — same Drive as above. Paste its URL or id segment.',
    parse: extractSheetId,
    validate: (v) => (/^[a-zA-Z0-9-_]{20,}$/.test(v) ? null : "doesn't look like a valid Google Sheet ID/URL"),
  },
  {
    key: 'APPS_SCRIPT_URL',
    prompt: 'Google Apps Script Web App URL',
    help: 'Full walkthrough in docs/twilio-setup.md §3. Briefly: paste apps-script/Code.gs into either Sheet\'s Extensions > Apps Script, fill in CONFIG with the two Sheet IDs above plus a SHARED_SECRET, Deploy > New deployment > Web app (Execute as: Me; Access: Anyone) — you\'ll hit a one-time "Google hasn\'t verified this app" screen, click Advanced > Go to [project] (unsafe) > Allow, that\'s expected for your own script — then paste the /exec URL here.',
    validate: (v) => (/^https:\/\/script\.google\.com\/macros\/s\/.+\/exec$/.test(v) ? null : 'must be a Web App URL ending in /exec, e.g. https://script.google.com/macros/s/.../exec'),
  },
  {
    key: 'APPS_SCRIPT_SECRET',
    prompt: 'Shared secret for the Apps Script Web App',
    help: 'Must match the SHARED_SECRET constant set at the top of apps-script/Code.gs. Leave blank to auto-generate one (then copy it into Code.gs).',
    secret: true,
    autoGenerate: true,
  },
  {
    key: 'TRIGGER_SEND_SECRET',
    prompt: 'Shared secret for /trigger-send',
    help: 'Gates the endpoint your external cron job calls. Leave blank to auto-generate one.',
    secret: true,
    autoGenerate: true,
  },
];

const REQUIRED_KEYS = ENV_VARS.filter((v) => !v.optional).map((v) => v.key);

async function promptEnvVars(rl) {
  const existing = fs.existsSync(ENV_PATH) ? parseEnvValues(fs.readFileSync(ENV_PATH, 'utf8')) : {};
  const values = { ...existing };
  const autoGenerated = [];

  console.log('\n--- Configure .env (written locally, never committed) ---');
  for (const def of ENV_VARS) {
    if (def.autoGenerate) {
      // No prompt for these — always auto-generate (or keep the existing
      // value) without waiting on input, then surface the value afterward.
      values[def.key] = resolveValue(def, existing[def.key], '');
      autoGenerated.push(def);
      continue;
    }

    const currentNote = existing[def.key]
      ? ` [current: ${def.secret ? '••••••' : existing[def.key]}]`
      : def.optional
        ? ' [optional]'
        : '';
    console.log(`\n${def.prompt}${currentNote}`);
    if (def.help) console.log(`  ${def.help}`);

    let answer;
    let resolved;
    // eslint-disable-next-line no-constant-condition
    while (true) {
      // eslint-disable-next-line no-await-in-loop
      answer = await rl.question('> ');
      const candidate = def.parse && answer.trim() ? def.parse(answer) : answer;
      resolved = resolveValue(def, existing[def.key], candidate);
      const problem = resolved && def.validate ? def.validate(resolved) : null;
      if (!problem) break;
      console.log(`  Doesn't look right: ${problem}. Try again${def.optional ? ' (or leave blank to skip)' : ''}.`);
      if (def.optional && !answer.trim()) break;
    }
    values[def.key] = resolved;
  }

  fs.writeFileSync(ENV_PATH, renderEnvFile(ENV_VARS, values));
  console.log(`\nWrote ${ENV_PATH}`);

  console.log('\n--- Auto-generated values (saved in .env — shown here in case you need to copy them) ---');
  for (const def of autoGenerated) {
    console.log(`\n${def.prompt}:`);
    console.log(`  ${values[def.key]}`);
  }
  console.log(
    '\nAPPS_SCRIPT_SECRET (above) must be pasted into the SHARED_SECRET constant at the top of apps-script/Code.gs ' +
      '(in the Apps Script editor), then Deploy > Manage deployments > edit (pencil) > New version, before ' +
      'continuing. The Web App will reject every call with "invalid secret" until that matches.'
  );
  console.log(
    'TRIGGER_SEND_SECRET (above) will be needed later as the ?secret= value when you set up the external cron ' +
      'job that calls /trigger-send (see docs/twilio-setup.md §5).'
  );

  return values;
}

function run(cmd, args) {
  return new Promise((resolve, reject) => {
    const child = spawn(cmd, args, { cwd: ROOT, shell: process.platform === 'win32' });
    let output = '';
    child.stdout.on('data', (d) => {
      process.stdout.write(d);
      output += d.toString();
    });
    child.stderr.on('data', (d) => {
      process.stderr.write(d);
      output += d.toString();
    });
    child.on('error', reject);
    child.on('close', (code) => (code === 0 ? resolve(output) : reject(new Error(`${cmd} ${args.join(' ')} exited with code ${code}`))));
  });
}

async function deployFunctions(values) {
  console.log('\n--- Deploying Twilio Functions (npx twilio-run deploy) ---\n');
  // `twilio-run` (the Serverless Toolkit, in devDependencies) has its own
  // standalone CLI — this is NOT the full Twilio CLI's `serverless:deploy`
  // plugin command, which isn't installed here and `npx twilio ...` would
  // otherwise silently try (and fail) to fetch the unrelated `twilio` npm
  // package (the Node SDK library, which has no CLI at all). --username/
  // --password are twilio-run's own documented flags (`twilio-run deploy
  // --help`) for passing credentials explicitly instead of relying on a
  // separately-configured Twilio CLI profile.
  const output = await run('npx', [
    'twilio-run',
    'deploy',
    '--username',
    values.ACCOUNT_SID,
    '--password',
    values.AUTH_TOKEN,
  ]);
  const domain = extractDomain(output);
  if (!domain) {
    throw new Error('Could not find the deployed domain in the deploy output — check it above and re-run.');
  }
  console.log(`\nDeployed domain: ${domain}`);
  return domain;
}

async function syncStudioFlow(values, domain) {
  const twilio = require('twilio');
  const client = twilio(values.ACCOUNT_SID, values.AUTH_TOKEN);
  const flowJson = substituteDomain(fs.readFileSync(FLOW_PATH, 'utf8'), domain);

  if (values.STUDIO_FLOW_SID) {
    console.log(`\n--- Updating existing Studio Flow ${values.STUDIO_FLOW_SID} ---\n`);
    await client.studio.v2.flows(values.STUDIO_FLOW_SID).update({ status: 'published', definition: flowJson });
    return { sid: values.STUDIO_FLOW_SID, created: false };
  }

  console.log('\n--- Creating new Studio Flow ---\n');
  const flow = await client.studio.v2.flows.create({
    friendlyName: 'Comic Relief Post-Event Survey',
    status: 'published',
    definition: flowJson,
  });
  console.log(`Created Studio Flow ${flow.sid}`);
  return { sid: flow.sid, created: true };
}

function appsScriptContext(values) {
  return { APPS_SCRIPT_URL: values.APPS_SCRIPT_URL, APPS_SCRIPT_SECRET: values.APPS_SCRIPT_SECRET };
}

// Calls the init_headers action so brand-new Sheets get their header row
// without anyone having to type it in by hand. Safe to call on every deploy:
// Code.gs only writes when row 1 is blank, and leaves anything else alone.
async function initializeSheetHeaders(values) {
  const { callAppsScript } = require('../functions/_lib/apps-script-client.js');
  console.log('\n--- Initializing Google Sheet headers ---\n');
  const result = await callAppsScript(appsScriptContext(values), 'init_headers', {
    contacts_sheet_id: values.CONTACTS_SHEET_ID,
    anonymous_sheet_id: values.ANONYMOUS_SHEET_ID,
  });
  console.log(`Contacts & Results sheet: ${result.contacts}`);
  console.log(`Anonymous Results sheet: ${result.anonymous}`);
  if (result.contacts === 'skipped-existing-different-content' || result.anonymous === 'skipped-existing-different-content') {
    console.log(
      'One of the sheets already has content in row 1 that doesn\'t match the expected header — left untouched. ' +
        'Check it manually against docs/twilio-setup.md §3 if that sheet isn\'t working as expected.'
    );
  }
}

async function watchForTestRow(values) {
  const { callAppsScript } = require('../functions/_lib/apps-script-client.js');
  const context = appsScriptContext(values);

  console.log('\nWatching the Contacts sheet for a new "test" row (checking every 5s, up to 5 minutes).');
  console.log(`Text ${values.TWILIO_PHONE_NUMBER} now if you haven't yet.`);

  const { rows: before } = await callAppsScript(context, 'list_rows', {});
  const seenPhones = new Set(before.map((r) => r.values.phone));

  const deadline = Date.now() + 5 * 60 * 1000;
  while (Date.now() < deadline) {
    // eslint-disable-next-line no-await-in-loop
    await new Promise((resolve) => setTimeout(resolve, 5000));
    // eslint-disable-next-line no-await-in-loop
    const { rows } = await callAppsScript(context, 'list_rows', {});
    const newRow = rows.find((r) => r.values.event === 'test' && !seenPhones.has(r.values.phone));
    if (newRow) {
      console.log('\nFound it:', newRow.values);
      return true;
    }
  }
  console.log('\nNo new test row seen within 5 minutes. Check the sheet manually — the flow only writes a row');
  console.log('after your first reply is validated, so make sure you replied "1"-"5" to the first question.');
  return false;
}

async function main() {
  const args = process.argv.slice(2);
  const skipTests = args.includes('--skip-tests');
  const skipEnv = args.includes('--skip-env');

  console.log('Comic Relief SMS Survey — deploy');

  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  try {
    const values = skipEnv
      ? parseEnvValues(fs.readFileSync(ENV_PATH, 'utf8'))
      : await promptEnvVars(rl);

    const missing = REQUIRED_KEYS.filter((key) => !values[key]);
    if (missing.length > 0) {
      throw new Error(`Missing required value(s): ${missing.join(', ')}. Re-run and provide them.`);
    }

    if (!skipTests) {
      console.log('\n--- Running npm test ---\n');
      await run('npm', ['test']);
    }

    const proceed = await rl.question(
      `\nAbout to deploy to Twilio account ${values.ACCOUNT_SID}, initialize headers via the Apps Script Web App ` +
        `at ${values.APPS_SCRIPT_URL}, and deploy the Functions. Continue? (y/N) `
    );
    if (proceed.trim().toLowerCase() !== 'y') {
      console.log('Aborted — no changes made to Twilio or Google Sheets.');
      return;
    }

    await initializeSheetHeaders(values);

    const domain = await deployFunctions(values);
    const { sid, created } = await syncStudioFlow(values, domain);

    if (created || values.STUDIO_FLOW_SID !== sid) {
      values.STUDIO_FLOW_SID = sid;
      fs.writeFileSync(ENV_PATH, renderEnvFile(ENV_VARS, values));
      console.log('\n--- Redeploying Functions so trigger-send.js has the new STUDIO_FLOW_SID ---');
      await deployFunctions(values);
    }

    console.log('\n=== Deployed ===');
    console.log(`Text ${values.TWILIO_PHONE_NUMBER} from your phone to manually walk the survey — no API call`);
    console.log('needed, it starts automatically and saves as event="test" so it stays separate from real data.');
    console.log('Then check both Google Sheets for a new row.');

    const watch = await rl.question('\nWatch the Contacts sheet for that new test row now? (y/N) ');
    if (watch.trim().toLowerCase() === 'y') {
      await watchForTestRow(values);
    }
  } finally {
    rl.close();
  }
}

if (require.main === module) {
  main().catch((err) => {
    console.error('\nDeploy failed:', err.message);
    process.exit(1);
  });
}

module.exports = { ENV_VARS, REQUIRED_KEYS };
