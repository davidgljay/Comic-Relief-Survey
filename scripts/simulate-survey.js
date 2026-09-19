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
//   npm run simulate -- --from-trigger-send [--event Gala] [--replies "..."]
//
// --from-trigger-send starts the conversation the way production does: a
// registered, consenting contact is seeded into the in-memory Contacts sheet,
// the real functions/trigger-send.js handler runs against a fake Twilio
// client (so it "starts a Studio execution" without sending anything), and
// the flow is then walked from the REST trigger (incomingRequest) instead of
// the text-in trigger. The fake execution deliberately hands the flow EMPTY
// {{trigger.parameters.*}}, mimicking what Twilio does when an execution is
// started with a Messaging Service SID as `from` (see trigger-send.js) — so
// this proves the flow gets respondent_id/event/name from Lookup_Contact
// alone. It also fails loudly if trigger-send.js ever starts the execution
// before writing respondent_id to the Contacts sheet, which would let
// Lookup_Contact read a stale value in production.
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
      if (action === 'list_rows') {
        const rows = [...contactsSheet.values()].map((values, i) => ({
          rowNumber: i + 2,
          values: Object.fromEntries(Object.entries(values).map(([k, v]) => [k, String(v)])),
        }));
        return { header: [], rows };
      }
      if (action === 'upsert_contact') {
        upsert(contactsSheet, params.phone, paramsToRow_(params));
        return { ok: true };
      }
      if (action !== 'save_response') {
        throw new Error(`simulate-survey.js doesn't simulate the Apps Script action "${action}"`);
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
const { handler: triggerSendHandler } = require(path.join(ROOT, 'functions', 'trigger-send.js'));

function callHandler(handler, params, context = {}) {
  return new Promise((resolve, reject) => {
    handler(context, params, (err, response) => (err ? reject(err) : resolve(response)));
  });
}

// Stored the way a number pasted in from a phone's contacts app ends up: with
// invisible Unicode direction marks around the digits. Twilio strips these, so
// the flow sees a clean number that no longer string-matches the sheet.
const SIM_CONTACT = { phone: '+1\u202D5550001234\u202C', name: 'Ada', consent: 'true' };
const SIM_FROM = { messagingServiceSid: 'MG00000000000000000000000000000000', phoneNumber: '+15559998888' };

function cleanedByTwilio(phone) {
  return `+${phone.replace(/\D/g, '')}`;
}

// Runs the real trigger-send.js against a fake Twilio client that records the
// execution it "starts" instead of sending anything.
async function runTriggerSend(eventName) {
  upsert(contactsSheet, SIM_CONTACT.phone, { ...SIM_CONTACT, event: eventName });

  const executions = [];
  const context = {
    TRIGGER_SEND_SECRET: 'sim',
    STUDIO_FLOW_SID: 'FW00000000000000000000000000000000',
    TWILIO_PHONE_NUMBER: SIM_FROM.phoneNumber,
    MESSAGING_SERVICE_SID: SIM_FROM.messagingServiceSid,
    getTwilioClient: () => ({
      studio: {
        v2: {
          flows: () => ({
            executions: {
              async create(args) {
                // In production, Studio's Lookup_Contact reads this row as
                // soon as the execution starts — so respondent_id has to be
                // there already.
                if (!contactsSheet.get(args.to)?.respondent_id) {
                  throw new Error(
                    'trigger-send.js started the execution before writing respondent_id to the Contacts sheet — ' +
                      "Lookup_Contact would read a stale value in production"
                  );
                }
                executions.push({ ...args, to: cleanedByTwilio(args.to) });
                return {};
              },
            },
          }),
        },
      },
    }),
  };

  const response = await callHandler(triggerSendHandler, { secret: 'sim', event: eventName }, context);
  if (response.statusCode !== 200 || response.body.started !== 1) {
    throw new Error(`trigger-send.js did not start exactly one execution: ${JSON.stringify(response.body)}`);
  }
  console.log(`trigger-send.js started an execution: to ${executions[0].to}, from ${executions[0].from}`);
  return executions[0];
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

  const fromTriggerSend = args.includes('--from-trigger-send');
  const eventFlagIndex = args.indexOf('--event');
  const eventName = eventFlagIndex !== -1 ? args[eventFlagIndex + 1] : 'Gala';

  let ctx;
  let startEvent;
  if (fromTriggerSend) {
    const execution = await runTriggerSend(eventName);
    // Empty on purpose: see the header comment above.
    ctx = {
      trigger: { parameters: {} },
      contact: { channel: { address: execution.to } },
      flow: { channel: { address: execution.from } },
      widgets: {},
    };
    startEvent = 'incomingRequest';
  } else {
    // Mirrors the text-in path (see studio-flow.json's Trigger widget).
    ctx = {
      trigger: {
        parameters: {},
        message: { MessageSid: 'SMsimulated00000000000000000000000', From: '+15550001234' },
      },
      contact: { channel: { address: '+15550001234' } },
      flow: { channel: { address: '+15559998888' } },
      widgets: {},
    };
    startEvent = 'incomingMessage';
  }

  let current = statesByName[flow.initial_state];
  current = statesByName[current.transitions.find((t) => t.event === startEvent).next];

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
