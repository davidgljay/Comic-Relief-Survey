#!/usr/bin/env node
// Runs a full survey conversation against the REAL studio-flow.json and the
// REAL functions/save-response.js and functions/resolve-trigger-context.js
// handlers — no live Twilio account, no live Google Sheet, no network calls
// at all — and prints exactly what would have been written to each Google
// Sheet. Useful for quickly checking the flow's logic (question order, the
// Q3->Q4 skip gate, unknown-number tagging, partial-save behavior) after
// editing survey-content.yaml or generate-studio-flow.js, without a deploy.
//
// Usage:
//   node scripts/simulate-survey.js                       interactive — type each reply
//   node scripts/simulate-survey.js --replies "1,2,3,4,It was great"
//   npm run simulate                                      interactive
//   npm run simulate -- --replies "1,2,3,4,It was great"  scripted (note the extra --)
//
// A scripted reply list only needs to cover what actually gets asked — once
// Q4 is skipped (or the flow ends), remaining replies are simply unused.
const fs = require('fs');
const path = require('path');
const readline = require('readline/promises');

const ROOT = path.join(__dirname, '..');
const FLOW_PATH = path.join(ROOT, 'studio-flow.json');

require('../test/helpers/twilio-runtime.js'); // defines global.Twilio, as the real runtime would

require.extensions['.gs'] = require.extensions['.js'];
const { paramsToRow_ } = require(path.join(ROOT, 'apps-script', 'Code.gs'));

// Same exclude list as apps-script/Code.gs's own "save_response" case — kept
// in sync manually since Code.gs can't export a shared constant across the
// Apps Script/Node boundary; if that list changes there, change it here too.
const ANONYMOUS_EXCLUDE = ['phone', 'name', 'email', 'consent', 'registered_at', 'sent_at'];

const contactsSheet = new Map(); // keyed by phone
const anonymousSheet = new Map(); // keyed by respondent_id

function upsert(map, key, fields) {
  if (!key) return;
  map.set(key, { ...(map.get(key) || {}), ...fields });
}

// Stub out the Apps Script HTTP client *before* requiring save-response.js,
// so the real handler's own validation/echo logic runs unmodified, but the
// network call becomes an in-memory upsert instead.
const appsScriptClientPath = require.resolve(path.join(ROOT, 'functions', 'lib', 'apps-script-client.private.js'));
require.cache[appsScriptClientPath] = {
  id: appsScriptClientPath,
  filename: appsScriptClientPath,
  loaded: true,
  exports: {
    async callAppsScript(context, action, params) {
      if (action === 'get_contact') {
        const existing = contactsSheet.get(params.phone);
        return existing
          ? { found: true, event: existing.event || '', name: existing.name || '', respondent_id: existing.respondent_id || '' }
          : { found: false };
      }
      if (action !== 'save_response') {
        throw new Error(`simulate-survey.js only expects "save_response" or "get_contact", got "${action}"`);
      }
      upsert(contactsSheet, params.phone, paramsToRow_(params));
      upsert(anonymousSheet, params.respondent_id, paramsToRow_(params, ANONYMOUS_EXCLUDE));
      return { ok: true };
    },
  },
};

// Also requires functions/lib/contact-context.private.js (which requires
// apps-script-client.private.js — already stubbed above).
const { handler: saveResponseHandler } = require(path.join(ROOT, 'functions', 'save-response.js'));
const { handler: lookupContactHandler } = require(path.join(ROOT, 'functions', 'resolve-trigger-context.js'));

function callHandler(handler, params) {
  return new Promise((resolve, reject) => {
    handler({}, params, (err, response) => (err ? reject(err) : resolve(response)));
  });
}

// make-http-request widgets in studio-flow.json target different endpoints
// (only /save-response and /resolve-trigger-context exist today) — route
// each to the matching real handler, by the same URL path Twilio would use.
const ENDPOINT_HANDLERS = {
  '/save-response': saveResponseHandler,
  '/resolve-trigger-context': lookupContactHandler,
};

function handlerForWidget(state) {
  const endpoint = new URL(state.properties.url).pathname;
  const handler = ENDPOINT_HANDLERS[endpoint];
  if (!handler) throw new Error(`simulate-survey.js doesn't know how to simulate a call to "${endpoint}"`);
  return handler;
}

// ---- A tiny Liquid-lite resolver for exactly the patterns generate-studio-flow.js produces ----
function getPath(obj, dottedPath) {
  return dottedPath.split('.').reduce((acc, key) => (acc == null ? undefined : acc[key]), obj);
}

function resolveTemplate(str, ctx) {
  return String(str).replace(/\{\{\s*(.+?)\s*\}\}/g, (_, expr) => {
    const [pathPart, defaultPart] = expr.split(/\s*\|\s*default:\s*/);
    let value = getPath(ctx, pathPart.trim());
    if ((value === undefined || value === '') && defaultPart !== undefined) {
      const trimmed = defaultPart.trim();
      const literal = trimmed.match(/^['"](.*)['"]$/);
      value = literal ? literal[1] : getPath(ctx, trimmed);
    }
    return value === undefined ? '' : String(value);
  });
}

async function main() {
  const args = process.argv.slice(2);
  const repliesFlagIndex = args.indexOf('--replies');
  const scriptedReplies = repliesFlagIndex !== -1 ? args[repliesFlagIndex + 1].split(',').map((s) => s.trim()) : null;

  const flow = JSON.parse(fs.readFileSync(FLOW_PATH, 'utf8'));
  const statesByName = Object.fromEntries(flow.states.map((s) => [s.name, s]));

  const rl = scriptedReplies ? null : readline.createInterface({ input: process.stdin, output: process.stdout });
  let replyIndex = 0;
  async function getReply() {
    if (!scriptedReplies) return rl.question('> ');
    const reply = scriptedReplies[replyIndex++];
    if (reply === undefined) {
      throw new Error(`Ran out of scripted replies after ${replyIndex - 1} — pass more with --replies "..."`);
    }
    console.log(`> ${reply}`);
    return reply;
  }

  // Mirrors the text-in path (see studio-flow.json's Trigger widget): no REST
  // parameters, so name/respondent_id/event fall back to message-derived values.
  const ctx = {
    trigger: {
      parameters: {},
      message: { MessageSid: 'SMsimulated00000000000000000000000', From: '+15550001234' },
    },
    contact: { channel: { address: '+15550001234' } },
    flow: { channel: { address: '+15559998888' } },
    widgets: {},
  };

  let current = statesByName[flow.initial_state];
  current = statesByName[current.transitions.find((t) => t.event === 'incomingMessage').next];

  while (current) {
    if (current.transitions.length === 0) {
      // A terminal widget (e.g. Closing_Message) — the execution ends here,
      // same as it would in a real Studio flow.
      if (current.type === 'send-message') {
        console.log(`\n${resolveTemplate(current.properties.body, ctx)}`);
      }
      break;
    }

    if (current.type === 'send-and-wait-for-reply') {
      console.log(`\n${resolveTemplate(current.properties.body, ctx)}`);
      const reply = await getReply();
      ctx.widgets[current.name] = { inbound: { Body: reply } };
      current = statesByName[current.transitions.find((t) => t.event === 'incomingMessage').next];
    } else if (current.type === 'send-message') {
      console.log(`\n${resolveTemplate(current.properties.body, ctx)}`);
      current = statesByName[current.transitions.find((t) => t.event === 'sent').next];
    } else if (current.type === 'split-based-on') {
      const input = resolveTemplate(current.properties.input, ctx);
      const matchTransition = current.transitions.find((t) => t.event === 'match');
      const isMatch = matchTransition.conditions.every((cond) => {
        if (cond.type !== 'regex') throw new Error(`simulate-survey.js doesn't support condition type "${cond.type}"`);
        return new RegExp(cond.arguments[0]).test(input);
      });
      current = statesByName[
        isMatch ? matchTransition.next : current.transitions.find((t) => t.event === 'noMatch').next
      ];
    } else if (current.type === 'make-http-request') {
      const params = Object.fromEntries(
        current.properties.parameters.map((p) => [p.key, resolveTemplate(p.value, ctx)])
      );
      const response = await callHandler(handlerForWidget(current), params);
      ctx.widgets[current.name] = { parsed: response.body || {} };
      const event = response.statusCode < 300 ? 'success' : 'failed';
      current = statesByName[current.transitions.find((t) => t.event === event).next];
    } else {
      throw new Error(`simulate-survey.js doesn't support widget type "${current.type}"`);
    }
  }

  if (rl) rl.close();

  console.log('\n=== Would write to the Contacts & Results sheet ===');
  console.log(JSON.stringify([...contactsSheet.values()], null, 2));
  console.log('\n=== Would write to the Anonymous Results sheet (no PII) ===');
  console.log(JSON.stringify([...anonymousSheet.values()], null, 2));
}

if (require.main === module) {
  main().catch((err) => {
    console.error('\nSimulation failed:', err.message);
    process.exit(1);
  });
}
