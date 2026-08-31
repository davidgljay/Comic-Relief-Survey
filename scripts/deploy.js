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

const ROOT = path.join(__dirname, '..');
const ENV_PATH = path.join(ROOT, '.env');
const FLOW_PATH = path.join(ROOT, 'studio-flow.json');

// ACCOUNT_SID/AUTH_TOKEN need FULL account access — they're used both to run
// `twilio serverless:deploy` (create/update the Serverless Service, Functions,
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
  { key: 'ACCOUNT_SID', prompt: 'Twilio Account SID', help: 'Twilio Console home, or Account > API keys & tokens. Starts with AC. Needs full account access — see note above.' },
  { key: 'AUTH_TOKEN', prompt: 'Twilio Auth Token', help: 'Same console page as Account SID — click "view" to reveal it. Needs full account access — see note above.', secret: true },
  { key: 'TWILIO_PHONE_NUMBER', prompt: 'Twilio phone number (E.164)', help: 'Twilio Console > Phone Numbers > Manage > Active Numbers, e.g. +15551234567.' },
  {
    key: 'STUDIO_FLOW_SID',
    prompt: 'Studio Flow SID',
    help: 'Leave blank the first time you run this — the script creates the flow and fills this in for you on later runs.',
    optional: true,
  },
  {
    key: 'APPS_SCRIPT_URL',
    prompt: 'Google Apps Script Web App URL',
    help: 'Full walkthrough in docs/twilio-setup.md §3. Briefly: paste apps-script/Code.gs into a Sheet\'s Extensions > Apps Script, fill in CONFIG, Deploy > New deployment > Web app (Execute as: Me; Access: Anyone) — you\'ll hit a one-time "Google hasn\'t verified this app" screen, click Advanced > Go to [project] (unsafe) > Allow, that\'s expected for your own script — then paste the /exec URL here.',
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
  const generated = [];

  console.log('\n--- Configure .env (written locally, never committed) ---');
  for (const def of ENV_VARS) {
    const currentNote = existing[def.key]
      ? ` [current: ${def.secret ? '••••••' : existing[def.key]}]`
      : def.autoGenerate
        ? ' [blank = auto-generate]'
        : def.optional
          ? ' [optional]'
          : '';
    console.log(`\n${def.prompt}${currentNote}`);
    if (def.help) console.log(`  ${def.help}`);
    // eslint-disable-next-line no-await-in-loop
    const answer = await rl.question('> ');
    values[def.key] = resolveValue(def, existing[def.key], answer);
    if (def.autoGenerate && !existing[def.key] && !answer.trim()) {
      generated.push(def);
    }
  }

  fs.writeFileSync(ENV_PATH, renderEnvFile(ENV_VARS, values));
  console.log(`\nWrote ${ENV_PATH}`);

  if (generated.length > 0) {
    console.log('\n--- Auto-generated values (also saved in .env, shown here so you can copy them now) ---');
    for (const def of generated) {
      console.log(`\n${def.prompt}:`);
      console.log(`  ${values[def.key]}`);
    }
    if (generated.some((def) => def.key === 'APPS_SCRIPT_SECRET')) {
      console.log(
        '\nAPPS_SCRIPT_SECRET was just generated above — paste it into the SHARED_SECRET constant at the top of ' +
          'apps-script/Code.gs (in the Apps Script editor), then Deploy > Manage deployments > edit (pencil) > ' +
          'New version, before continuing. The Web App will reject every call with "invalid secret" until that ' +
          'matches.'
      );
    }
    if (generated.some((def) => def.key === 'TRIGGER_SEND_SECRET')) {
      console.log(
        '\nTRIGGER_SEND_SECRET was just generated above — you\'ll need it later as the ?secret= value when you ' +
          'set up the external cron job that calls /trigger-send (see docs/twilio-setup.md §5).'
      );
    }
  }

  return values;
}

function run(cmd, args, extraEnv) {
  return new Promise((resolve, reject) => {
    const child = spawn(cmd, args, {
      cwd: ROOT,
      shell: process.platform === 'win32',
      env: { ...process.env, ...extraEnv },
    });
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
  console.log('\n--- Deploying Twilio Functions (npx twilio serverless:deploy) ---\n');
  // Passed explicitly rather than relying on a prior `twilio login` session —
  // these are the credentials from .env, not read from any Twilio CLI profile.
  const output = await run('npx', ['twilio', 'serverless:deploy'], {
    TWILIO_ACCOUNT_SID: values.ACCOUNT_SID,
    TWILIO_AUTH_TOKEN: values.AUTH_TOKEN,
  });
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

async function watchForTestRow(values) {
  const { callAppsScript } = require('../functions/_lib/apps-script-client.js');
  const context = {
    APPS_SCRIPT_URL: values.APPS_SCRIPT_URL,
    APPS_SCRIPT_SECRET: values.APPS_SCRIPT_SECRET,
  };

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
      `\nAbout to deploy to Twilio account ${values.ACCOUNT_SID} and write via the Apps Script Web App ` +
        `at ${values.APPS_SCRIPT_URL}. Continue? (y/N) `
    );
    if (proceed.trim().toLowerCase() !== 'y') {
      console.log('Aborted — no changes made to Twilio or Google Sheets.');
      return;
    }

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
