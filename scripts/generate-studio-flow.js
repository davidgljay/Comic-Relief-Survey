// Regenerates studio-flow.json from a small set of question definitions below.
// Run with `npm run generate:flow` after editing a question's text or logic here.
// Writing the flow programmatically (instead of hand-editing exported JSON) keeps
// ~35 widgets internally consistent — every transition target is checked to exist
// before the file is written.
const fs = require('fs');
const path = require('path');
const outPath = path.join(__dirname, '..', 'studio-flow.json');

let y = 0;
function offset(x) {
  y += 150;
  return { x, y };
}

const states = [];

// Swapped for the real deployed domain by scripts/deploy.js after `twilio serverless:deploy`.
const FUNCTIONS_URL = 'https://REPLACE_WITH_DEPLOYED_DOMAIN.twil.io/save-response';

function sendAndWait(name, body, x, timeout) {
  states.push({
    name,
    type: 'send-and-wait-for-reply',
    transitions: [{ event: 'incomingMessage', next: `${name}_next_placeholder` }],
    properties: {
      offset: offset(x),
      body,
      timeout: String(timeout || 86400),
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

function splitValidate(name, inputWidget, x) {
  states.push({
    name,
    type: 'split-based-on',
    transitions: [
      { event: 'noMatch', next: `${name}_nomatch_placeholder` },
      {
        event: 'match',
        next: `${name}_match_placeholder`,
        conditions: [
          { friendly_name: 'If value matches_regex ^[1-5]$', type: 'matches_regex', value: '^[1-5]$' },
        ],
      },
    ],
    properties: {
      offset: offset(x),
      input: `{{widgets.${inputWidget}.inbound.Body}}`,
    },
  });
}

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
          { friendly_name: 'If value matches_regex ^[1-2]$', type: 'matches_regex', value: '^[1-2]$' },
        ],
      },
    ],
    properties: {
      offset: offset(x),
      input: inputExpr,
    },
  });
}

function httpSave(name, params, x) {
  states.push({
    name,
    type: 'make-http-request',
    transitions: [
      { event: 'success', next: `${name}_next_placeholder` },
      { event: 'failed', next: `${name}_next_placeholder` },
    ],
    properties: {
      offset: offset(x),
      url: FUNCTIONS_URL,
      method: 'POST',
      content_type: 'application/x-www-form-urlencoded;charset=utf-8',
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
// Two ways to start an execution:
//  - incomingRequest: the real path. trigger-send.js starts one execution per
//    consenting contact via the REST API, passing phone/name/event/respondent_id.
//  - incomingMessage: a dev/test convenience so anyone can just text the Twilio
//    number to manually walk the flow, with no API call needed. Every reference
//    to trigger.parameters.* below falls back to a value derived from the inbound
//    message itself (respondent_id -> the message SID, phone -> the From number,
//    name -> "there", event -> "test") so both paths share one flow definition.
//    Responses from this path land in event="test" rows, kept separate from real
//    event data by event name alone — see docs/twilio-setup.md for whether to
//    disable this trigger before a number goes live for a real campaign.
states.push({
  name: 'Trigger',
  type: 'trigger',
  transitions: [
    { event: 'incomingRequest', next: 'Q1_Send' },
    { event: 'incomingMessage', next: 'Q1_Send' },
  ],
  properties: { offset: offset(0) },
});

const baseParams = () => [
  { key: 'respondent_id', value: "{{trigger.parameters.respondent_id | default: trigger.message.MessageSid}}" },
  { key: 'phone', value: '{{trigger.parameters.phone | default: trigger.message.From}}' },
  { key: 'event', value: "{{trigger.parameters.event | default: 'test'}}" },
];

// ---- Generic numeric question block (Q1-Q4) ----
function numericQuestionBlock(qkey, questionText, opts) {
  const P = qkey.toUpperCase();
  const sendBody = opts.withPreamble
    ? `Hi {{trigger.parameters.name | default: 'there'}}! ${opts.preamble}\n\n${questionText}`
    : questionText;

  sendAndWait(`${P}_Send`, sendBody, opts.x);
  splitValidate(`${P}_Validate`, `${P}_Send`, opts.x);
  sendAndWait(`${P}_Reprompt`, "Sorry, I didn't quite catch that — please reply with just a number from 1 to 5.", opts.x + 300);
  splitValidate(`${P}_ValidateRetry`, `${P}_Reprompt`, opts.x + 300);
  httpSave(`${P}_Save`, [...baseParams(), { key: qkey, value: `{{widgets.${P}_Send.inbound.Body}}` }], opts.x);
  httpSave(`${P}_SaveRetry`, [...baseParams(), { key: qkey, value: `{{widgets.${P}_Reprompt.inbound.Body}}` }], opts.x + 300);
  sendMessage(`${P}_Skip`, "No worries — I'll skip that one.", opts.x + 600);

  wire(`${P}_Send`, 'incomingMessage', `${P}_Validate`);
  wire(`${P}_Validate`, 'match', `${P}_Save`);
  wire(`${P}_Validate`, 'noMatch', `${P}_Reprompt`);
  wire(`${P}_Reprompt`, 'incomingMessage', `${P}_ValidateRetry`);
  wire(`${P}_ValidateRetry`, 'match', `${P}_SaveRetry`);
  wire(`${P}_ValidateRetry`, 'noMatch', `${P}_Skip`);
  wire(`${P}_Save`, 'success', opts.next);
  wire(`${P}_Save`, 'failed', opts.next);
  wire(`${P}_SaveRetry`, 'success', opts.next);
  wire(`${P}_SaveRetry`, 'failed', opts.next);
  wire(`${P}_Skip`, 'sent', opts.next);
  wire(`${P}_Skip`, 'failed', opts.next);
}

numericQuestionBlock('q1', 'How likely are you to discuss the work being done by an organization present at this event with people in your life? Reply 1 for Very Likely .... 5 for Very Unlikely', {
  x: 0,
  withPreamble: true,
  preamble: "We're trying to learn whether events like these are a helpful tool to address child poverty, and would like to ask you 3-5 quick questions. We'd appreciate it if you could take the time to answer. We won't text you again once the survey is complete. You can also text STOP at any time to opt out.",
  next: 'Q2_Send',
});

numericQuestionBlock('q2', 'How likely are you to volunteer with or donate to an organization that was present at this event in the next three months? Reply 1 for Very Likely .... 5 for Very Unlikely', {
  x: 1200,
  withPreamble: false,
  next: 'Q3_Send',
});

numericQuestionBlock('q3', 'How likely are you to have a followup conversation with someone that you met at this event? Reply 1 for Very Likely .... 5 for Very Unlikely', {
  x: 2400,
  withPreamble: false,
  next: 'Split_Q3Gate',
});

// ---- Gate on Q3 -> Q4 ----
splitGate('Split_Q3Gate', '{{widgets.Q3_Save.parsed.q3}}{{widgets.Q3_SaveRetry.parsed.q3}}', 2400);
wire('Split_Q3Gate', 'match', 'Q4_Send');
wire('Split_Q3Gate', 'noMatch', 'Split_Q1Gate');

numericQuestionBlock('q4', "How likely would you have been to meet or get to know this person if not for tonight's event? Reply 1 for Very Likely .... 5 for Very Unlikely", {
  x: 3600,
  withPreamble: false,
  next: 'Split_Q1Gate',
});

// ---- Gate on Q1 -> Q5 ----
splitGate('Split_Q1Gate', '{{widgets.Q1_Save.parsed.q1}}{{widgets.Q1_SaveRetry.parsed.q1}}', 4800);
wire('Split_Q1Gate', 'match', 'Q5_Send');
wire('Split_Q1Gate', 'noMatch', 'Closing_Save');

// ---- Q5 (open text, no retry) ----
sendAndWait('Q5_Send', 'When you tell others about this event, what moment are you most likely to share? (Feel free to describe it in your own words.)', 6000);
httpSave('Q5_Save', [...baseParams(), { key: 'q5', value: '{{widgets.Q5_Send.inbound.Body}}' }], 6000);
wire('Q5_Send', 'incomingMessage', 'Q5_Save');
wire('Q5_Save', 'success', 'Closing_Save');
wire('Q5_Save', 'failed', 'Closing_Save');

// ---- Closing ----
httpSave('Closing_Save', [...baseParams(), { key: 'completed', value: 'true' }], 7200);
sendMessage('Closing_Message', "That's it! Thanks so much for taking the time to complete this survey and for attending.", 7200);
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

const flow = {
  description: 'Comic Relief post-event SMS survey',
  states,
  initial_state: 'Trigger',
  flags: { allow_concurrent_calls: true },
};

fs.writeFileSync(outPath, JSON.stringify(flow, null, 2) + '\n');
console.log('wrote studio-flow.json with', states.length, 'states');
