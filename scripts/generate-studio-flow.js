// Regenerates studio-flow.json: wording comes from survey-content.yaml, question
// order/branching/retry logic lives below. Run `npm run generate:flow` after
// editing either. Writing the flow programmatically (instead of hand-editing
// exported JSON) keeps ~35 widgets internally consistent — every transition
// target is checked to exist before the file is written.
const fs = require('fs');
const path = require('path');
const yaml = require('js-yaml');

const outPath = path.join(__dirname, '..', 'studio-flow.json');
const contentPath = path.join(__dirname, '..', 'survey-content.yaml');
const content = yaml.load(fs.readFileSync(contentPath, 'utf8'));

for (const key of ['preamble', 'closing_message', 'questions']) {
  if (content[key] === undefined) {
    throw new Error(`survey-content.yaml is missing required key "${key}"`);
  }
}
for (const q of ['q1', 'q2', 'q3', 'q4', 'q5']) {
  if (!content.questions[q]) {
    throw new Error(`survey-content.yaml is missing questions.${q}`);
  }
}

let y = 0;
function offset(x) {
  y += 150;
  return { x, y };
}

const states = [];

function sendAndWait(name, body, x, timeout) {
  states.push({
    name,
    type: 'send-and-wait-for-reply',
    transitions: [{ event: 'incomingMessage', next: `${name}_next_placeholder` }],
    properties: {
      offset: offset(x),
      body,
      timeout: String(timeout || 86400),
      from: '{{flow.channel.address}}',
    },
  });
}

function sendMessage(name, body, x) {
  states.push({
    name,
    type: 'send-message',
    transitions: [
      { event: 'sent', next: `${name}_next_placeholder` },
      { event: 'failed', next: `${name}_next_placeholder` },
    ],
    properties: {
      offset: offset(x),
      body,
      to: '{{contact.channel.address}}',
      from: '{{flow.channel.address}}',
    },
  });
}

// Matches a reply that STARTS with "1" or "2", whether that's the whole
// reply or the digit is followed by more text ("1 - here's why", "2 because
// ...", "1."). The digit must be immediately followed by a non-digit or the
// end of the string, so "12" or "15 minutes" don't false-positive as "1".
const GATE_PATTERN = '^\\s*[12](\\D|$)';

function splitGate(name, inputExpr, x) {
  states.push({
    name,
    type: 'split-based-on',
    transitions: [
      { event: 'noMatch', next: `${name}_nomatch_placeholder` },
      {
        event: 'match',
        next: `${name}_match_placeholder`,
        conditions: [
          { friendly_name: 'If value starts with 1 or 2', type: 'regex', value: inputExpr, arguments: [GATE_PATTERN] },
        ],
      },
    ],
    properties: {
      offset: offset(x),
      input: inputExpr,
    },
  });
}

function httpSave(name, params, x, path = '/save-response') {
  states.push({
    name,
    type: 'make-http-request',
    transitions: [
      { event: 'success', next: `${name}_next_placeholder` },
      { event: 'failed', next: `${name}_next_placeholder` },
    ],
    properties: {
      offset: offset(x),
      url: `https://REPLACE_WITH_DEPLOYED_DOMAIN.twil.io${path}`,
      method: 'POST',
      content_type: 'application/x-www-form-urlencoded',
      parameters: params,
    },
  });
}

function wire(name, event, next) {
  const state = states.find((s) => s.name === name);
  const t = state.transitions.find((tr) => tr.event === event);
  t.next = next;
}

// ---- Trigger ----
// Two ways to start an execution, both routed through Lookup_Contact:
//  - incomingRequest: the real path. trigger-send.js starts one execution per
//    consenting contact via the REST API.
//  - incomingMessage: anyone texting the number with no active execution —
//    either a deliberate test, or a genuinely new/unregistered number
//    reaching out first.
// Both paths look the phone up in the Contacts sheet via Lookup_Contact: if
// it's already a known contact, its real event/name/respondent_id are
// reused (a respondent_id is derived for one that has none yet, see
// functions/lib/contact-context.private.js); otherwise it's tagged event="unknown" (never "test" — that stays
// reserved for deliberate manual testing) with a freshly minted
// respondent_id. See functions/resolve-trigger-context.js.
//
// Both paths go through this HTTP lookup rather than trusting
// {{trigger.parameters.*}} directly, because confirmed live: starting an
// execution with `from` set to a Messaging Service SID (required to fix a
// separate reply-routing bug — see trigger-send.js) breaks
// {{trigger.parameters.*}} from resolving at all in that execution.
states.push({
  name: 'Trigger',
  type: 'trigger',
  transitions: [
    { event: 'incomingRequest', next: 'Lookup_Contact' },
    { event: 'incomingMessage', next: 'Lookup_Contact' },
  ],
  properties: { offset: offset(0) },
});

// {{contact.channel.address}} is Studio's own reference to the current
// execution's contact phone number — populated for both trigger types
// (unlike {{trigger.message.From}}, which only exists for incomingMessage).
httpSave(
  'Lookup_Contact',
  [{ key: 'phone', value: '{{contact.channel.address}}' }],
  0,
  '/resolve-trigger-context'
);
wire('Lookup_Contact', 'success', 'Q1_Send');
wire('Lookup_Contact', 'failed', 'Q1_Send');

const baseParams = () => [
  {
    key: 'respondent_id',
    value: '{{trigger.parameters.respondent_id | default: widgets.Lookup_Contact.parsed.respondent_id}}',
  },
  // The Contacts row's own stored phone, as found by Lookup_Contact — saves must use
  // that exact string to land on the original row, not Studio's cleaned-up number.
  { key: 'phone', value: '{{widgets.Lookup_Contact.parsed.phone | default: contact.channel.address}}' },
  { key: 'event', value: '{{trigger.parameters.event | default: widgets.Lookup_Contact.parsed.event}}' },
];

// ---- Generic question block ----
// Whatever the respondent replies is accepted and saved as-is — no format is
// enforced (a full sentence is just as valid an answer as a single digit).
// The Q3->Q4 gate below still looks for a plain "1" or "2" reply to Q3 to
// decide whether to ask the follow-up; a free-text reply simply doesn't
// match and the gate falls through as if that answer weren't 1/2. Q5 (the
// final open-text question) is always asked, unconditionally.
function questionBlock(qkey, questionText, opts) {
  const P = qkey.toUpperCase();
  const sendBody = opts.withPreamble
    ? `Hi {{trigger.parameters.name | default: widgets.Lookup_Contact.parsed.name}}! ${content.preamble}\n\n${questionText}`
    : questionText;

  sendAndWait(`${P}_Send`, sendBody, opts.x);
  httpSave(`${P}_Save`, [...baseParams(), { key: qkey, value: `{{widgets.${P}_Send.inbound.Body}}` }], opts.x);

  wire(`${P}_Send`, 'incomingMessage', `${P}_Save`);
  wire(`${P}_Save`, 'success', opts.next);
  wire(`${P}_Save`, 'failed', opts.next);
}

questionBlock('q1', content.questions.q1, {
  x: 0,
  withPreamble: true,
  next: 'Q2_Send',
});

questionBlock('q2', content.questions.q2, {
  x: 1200,
  withPreamble: false,
  next: 'Q3_Send',
});

questionBlock('q3', content.questions.q3, {
  x: 2400,
  withPreamble: false,
  next: 'Split_Q3Gate',
});

// ---- Gate on Q3 -> Q4 ----
splitGate('Split_Q3Gate', '{{widgets.Q3_Save.parsed.q3}}', 2400);
wire('Split_Q3Gate', 'match', 'Q4_Send');
wire('Split_Q3Gate', 'noMatch', 'Q5_Send');

questionBlock('q4', content.questions.q4, {
  x: 3600,
  withPreamble: false,
  next: 'Q5_Send',
});

// ---- Q5 (open text) — always asked, not gated on Q1 ----
questionBlock('q5', content.questions.q5, {
  x: 6000,
  withPreamble: false,
  next: 'Closing_Save',
});

// ---- Closing ----
httpSave('Closing_Save', [...baseParams(), { key: 'completed', value: 'true' }], 7200);
sendMessage('Closing_Message', content.closing_message, 7200);
wire('Closing_Save', 'success', 'Closing_Message');
wire('Closing_Save', 'failed', 'Closing_Message');
// Closing_Message is terminal: remove its transitions (execution ends after send)
const closingMsg = states.find((s) => s.name === 'Closing_Message');
closingMsg.transitions = [];

// sanity check: no placeholder transitions remain
for (const s of states) {
  for (const t of s.transitions) {
    if (String(t.next).includes('placeholder')) {
      throw new Error(`Unwired transition: ${s.name} -> ${t.event}`);
    }
  }
}
// sanity check: every "next" target exists
const names = new Set(states.map((s) => s.name));
for (const s of states) {
  for (const t of s.transitions) {
    if (!names.has(t.next)) {
      throw new Error(`Dangling transition: ${s.name} -> ${t.event} -> ${t.next} (no such state)`);
    }
  }
}

// `flags: { allow_concurrent_calls: true }` was removed from here: Twilio's
// Studio Flow API rejected the definition with a generic "validation failed"
// (code 81022) and an empty errors/warnings array once every other issue was
// fixed — pointing at this being the one remaining untested top-level key
// (states/widgets are otherwise now proven valid by prior, itemized 81022
// errors that named specific widgets). Documented as valid in places, but
// evidently rejected in practice for this account/API version; add it back
// only after confirming a real deploy succeeds without it, then test it in
// isolation if it's needed (it only affects whether one contact texting
// mid-flow can start a second concurrent execution — not required for the
// survey to work).
const flow = {
  description: 'Comic Relief post-event SMS survey',
  states,
  initial_state: 'Trigger',
};

fs.writeFileSync(outPath, JSON.stringify(flow, null, 2) + '\n');
console.log('wrote studio-flow.json with', states.length, 'states');
