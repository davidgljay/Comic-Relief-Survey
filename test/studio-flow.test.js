const flow = require('../studio-flow.json');
const { validateFlow } = require('./lib/validate-flow.js');

describe('studio-flow.json', () => {
  it('has no dangling, unwired, unreachable, or mistyped states', () => {
    const errors = validateFlow(flow);
    expect(errors).toEqual([]);
  });

  it('sends a REST-started execution straight to Q1, and a text-in through Lookup_Contact first', () => {
    // A REST-started execution already carries everything (phone, name, event,
    // respondent_id, passed by trigger-send.js), so it must not wait on a
    // lookup against Apps Script, which can be slow. A text-in has no
    // parameters, so it looks the sender up.
    const trigger = flow.states.find((s) => s.name === flow.initial_state);
    expect(trigger.transitions.find((t) => t.event === 'incomingRequest').next).toBe('Q1_Send');
    expect(trigger.transitions.find((t) => t.event === 'incomingMessage').next).toBe('Lookup_Contact');

    const lookup = flow.states.find((s) => s.name === 'Lookup_Contact');
    expect(lookup.type).toBe('make-http-request');
    expect(lookup.properties.url).toMatch(/\/resolve-trigger-context$/);
    expect(lookup.transitions.find((t) => t.event === 'success').next).toBe('Q1_Send');
    expect(lookup.transitions.find((t) => t.event === 'failed').next).toBe('Q1_Send');
  });

  it('reads REST parameters from flow.data, the variable Studio actually sets — there is no trigger.parameters', () => {
    // Confirmed against real execution contexts: REST-started executions expose
    // their parameters as flow.data.* (and trigger.request.parameters). A
    // {{trigger.parameters.*}} reference always renders blank.
    expect(JSON.stringify(flow)).not.toContain('trigger.parameters');

    const q1Save = flow.states.find((s) => s.name === 'Q1_Save');
    const params = Object.fromEntries(q1Save.properties.parameters.map((p) => [p.key, p.value]));
    expect(params.respondent_id).toMatch(/^\{\{flow\.data\.respondent_id \| default: widgets\.Lookup_Contact\.parsed\.respondent_id\}\}$/);
    expect(params.event).toMatch(/^\{\{flow\.data\.event \| default: widgets\.Lookup_Contact\.parsed\.event\}\}$/);
    // The phone is the sheet's own stored string (flow.data.phone, or the row the
    // lookup found), falling back to Studio's cleaned number only as a last resort.
    expect(params.phone).toBe(
      '{{flow.data.phone | default: widgets.Lookup_Contact.parsed.phone | default: contact.channel.address}}'
    );

    const q1Send = flow.states.find((s) => s.name === 'Q1_Send');
    expect(q1Send.properties.body).toContain('{{flow.data.name | default: widgets.Lookup_Contact.parsed.name}}');
  });

  it('gates Question 4 on Question 3 being 1 or 2, testing the actual reply (not the pattern) as "value"', () => {
    const gate = flow.states.find((s) => s.name === 'Split_Q3Gate');
    // Tests the reply itself, not the save call's echo of it: the save can be
    // slow or fail, and the survey must still route correctly.
    expect(gate.properties.input).toBe('{{widgets.Q3_Send.inbound.Body}}');
    const match = gate.transitions.find((t) => t.event === 'match');
    expect(match.next).toBe('Q4_Send');
    // A real bug this guards against: "value" must be the Liquid expression
    // being tested (matching properties.input) — the actual reply — not the
    // regex pattern itself. Studio's schema validator doesn't catch that
    // (value is just a generic string to it), but the condition then always
    // evaluates false at runtime: it ends up testing whether the pattern
    // string matches itself, never whether the reply does.
    expect(match.conditions[0].value).toBe(gate.properties.input);
    expect(Array.isArray(match.conditions[0].arguments)).toBe(true);
    expect(match.conditions[0].arguments[0]).not.toBe(match.conditions[0].value);
  });

  describe('the Q3->Q4 gate\'s regex, simulating how Twilio evaluates it against a reply', () => {
    // Twilio's "regex" condition type runs a standard regex match of
    // arguments[0] against "value" (the resolved reply). This reconstructs
    // that regex from the actual deployed pattern and drives it with
    // representative replies, so a change to the pattern that breaks
    // matching is caught here instead of only live, on a real text.
    const gate = flow.states.find((s) => s.name === 'Split_Q3Gate');
    const pattern = new RegExp(gate.transitions.find((t) => t.event === 'match').conditions[0].arguments[0]);

    it.each([
      ['1', true],
      ['2', true],
      [' 1', true],
      ["1 - Here's a description of why", true],
      ['2 because it was fun', true],
      ['1.', true],
      ['1,', true],
    ])('treats %j as a "1 or 2" answer (asks Q4)', (reply, expected) => {
      expect(pattern.test(reply)).toBe(expected);
    });

    it.each([
      ['3', false],
      ['4', false],
      ['5', false],
      ['12', false],
      ['15 minutes', false],
      ['21', false],
      ['no', false],
      ['', false],
      ['I think 1', false],
    ])('treats %j as not a "1 or 2" answer (skips Q4)', (reply, expected) => {
      expect(pattern.test(reply)).toBe(expected);
    });
  });

  it('always asks Question 5 (the final open-text question), regardless of Question 1', () => {
    // Whichever path Q4 took (asked or skipped), everything converges on Q5.
    const q4 = flow.states.find((s) => s.name === 'Q4_Save');
    expect(q4.transitions.find((t) => t.event === 'success').next).toBe('Q5_Send');
    const gate = flow.states.find((s) => s.name === 'Split_Q3Gate');
    expect(gate.transitions.find((t) => t.event === 'noMatch').next).toBe('Q5_Send');
    expect(flow.states.some((s) => s.name === 'Split_Q1Gate')).toBe(false);
  });

  it('ends the flow silently on timeout/deliveryFailure (no transition defined)', () => {
    const sendAndWaitStates = flow.states.filter((s) => s.type === 'send-and-wait-for-reply');
    expect(sendAndWaitStates.length).toBeGreaterThan(0);
    for (const state of sendAndWaitStates) {
      const events = state.transitions.map((t) => t.event);
      expect(events).not.toContain('timeout');
      expect(events).not.toContain('deliveryFailure');
    }
  });

  it('sets "from" on every widget that sends an SMS (required by the Studio API — error 81022 if missing)', () => {
    const sendingStates = flow.states.filter(
      (s) => s.type === 'send-and-wait-for-reply' || s.type === 'send-message'
    );
    expect(sendingStates.length).toBeGreaterThan(0);
    for (const state of sendingStates) {
      expect(state.properties.from).toBe('{{flow.channel.address}}');
    }
  });

  it('uses Studio\'s actual "regex" condition type, not "matches_regex" (a real Twilio API 81022 rejection)', () => {
    const splitStates = flow.states.filter((s) => s.type === 'split-based-on');
    expect(splitStates.length).toBeGreaterThan(0);
    for (const state of splitStates) {
      const matchTransition = state.transitions.find((t) => t.event === 'match');
      for (const condition of matchTransition.conditions) {
        expect(condition.type).toBe('regex');
      }
    }
  });

  it('sets a non-empty "arguments" array on every condition (required — 81022 "must not be null" if missing)', () => {
    const splitStates = flow.states.filter((s) => s.type === 'split-based-on');
    expect(splitStates.length).toBeGreaterThan(0);
    for (const state of splitStates) {
      const matchTransition = state.transitions.find((t) => t.event === 'match');
      for (const condition of matchTransition.conditions) {
        expect(Array.isArray(condition.arguments)).toBe(true);
        expect(condition.arguments.length).toBeGreaterThan(0);
        // "arguments" is the regex pattern (the operand); "value" is the
        // reply being tested — they're deliberately NOT the same string
        // (see the Split_Q3Gate test above for why conflating them is a bug).
        expect(condition.value).not.toEqual(condition.arguments[0]);
      }
    }
  });

  it('uses a content_type Twilio actually accepts on every make-http-request widget', () => {
    const httpStates = flow.states.filter((s) => s.type === 'make-http-request');
    expect(httpStates.length).toBeGreaterThan(0);
    for (const state of httpStates) {
      expect(state.properties.content_type).toBe('application/x-www-form-urlencoded');
    }
  });

  it('never sends a final message after the closing message (terminal state)', () => {
    const closing = flow.states.find((s) => s.name === 'Closing_Message');
    expect(closing.transitions).toEqual([]);
  });

  it('every make-http-request widget posts to a known Functions endpoint with no PII in the URL', () => {
    const httpStates = flow.states.filter((s) => s.type === 'make-http-request');
    expect(httpStates.length).toBeGreaterThan(0);
    for (const state of httpStates) {
      const expectedEndpoint = state.name === 'Lookup_Contact' ? '/resolve-trigger-context' : '/save-response';
      expect(state.properties.url.endsWith(expectedEndpoint)).toBe(true);
      expect(state.properties.method).toBe('POST');
    }
  });
});

describe('validateFlow', () => {
  it('flags a dangling transition', () => {
    const errors = validateFlow({
      initial_state: 'Trigger',
      states: [
        { name: 'Trigger', type: 'trigger', transitions: [{ event: 'incomingRequest', next: 'Nowhere' }] },
      ],
    });
    expect(errors).toEqual(['state "Trigger" transitions on "incomingRequest" to unknown state "Nowhere"']);
  });

  it('flags an unreachable state', () => {
    const errors = validateFlow({
      initial_state: 'Trigger',
      states: [
        { name: 'Trigger', type: 'trigger', transitions: [] },
        { name: 'Orphan', type: 'send-message', transitions: [] },
      ],
    });
    expect(errors).toContain('state "Orphan" is unreachable from initial_state');
  });

  it('flags more than one trigger state', () => {
    const errors = validateFlow({
      initial_state: 'A',
      states: [
        { name: 'A', type: 'trigger', transitions: [] },
        { name: 'B', type: 'trigger', transitions: [] },
      ],
    });
    expect(errors).toContain('expected exactly one trigger state, found 2');
  });
});
