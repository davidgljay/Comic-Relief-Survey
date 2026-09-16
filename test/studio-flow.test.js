const flow = require('../studio-flow.json');
const { validateFlow } = require('./lib/validate-flow.js');

describe('studio-flow.json', () => {
  it('has no dangling, unwired, unreachable, or mistyped states', () => {
    const errors = validateFlow(flow);
    expect(errors).toEqual([]);
  });

  it('starts at a trigger state that fires on incomingRequest (REST-started executions)', () => {
    const trigger = flow.states.find((s) => s.name === flow.initial_state);
    const event = trigger.transitions.find((t) => t.event === 'incomingRequest');
    expect(event).toBeDefined();
    expect(event.next).toBe('Q1_Send');
  });

  it('also starts on incomingMessage, so texting the number is enough to manually test it', () => {
    const trigger = flow.states.find((s) => s.name === flow.initial_state);
    const event = trigger.transitions.find((t) => t.event === 'incomingMessage');
    expect(event).toBeDefined();
    expect(event.next).toBe('Q1_Send');
  });

  it('falls back to message-derived values when trigger.parameters is empty (the text-in path)', () => {
    const q1Save = flow.states.find((s) => s.name === 'Q1_Save');
    const params = Object.fromEntries(q1Save.properties.parameters.map((p) => [p.key, p.value]));
    expect(params.respondent_id).toContain('trigger.message.MessageSid');
    expect(params.phone).toContain('trigger.message.From');
    expect(params.event).toContain("default: 'test'");
  });

  it('gates Question 4 on Question 3 being 1 or 2, testing the actual reply (not the pattern) as "value"', () => {
    const gate = flow.states.find((s) => s.name === 'Split_Q3Gate');
    expect(gate.properties.input).toContain('q3');
    const match = gate.transitions.find((t) => t.event === 'match');
    expect(match.next).toBe('Q4_Send');
    // A real bug this guards against: "value" must be the Liquid expression
    // being tested (matching properties.input) — the actual reply — not the
    // regex pattern itself. Studio's schema validator doesn't catch that
    // (value is just a generic string to it), but the condition then always
    // evaluates false at runtime: it ends up testing whether the pattern
    // string matches itself, never whether the reply does.
    expect(match.conditions[0].value).toBe(gate.properties.input);
    expect(match.conditions[0].arguments).toEqual(['^[1-2]$']);
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
        expect(condition.arguments).toEqual(['^[1-2]$']);
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

  it('every make-http-request widget posts to the save-response endpoint with no PII in the URL', () => {
    const httpStates = flow.states.filter((s) => s.type === 'make-http-request');
    expect(httpStates.length).toBeGreaterThan(0);
    for (const state of httpStates) {
      expect(state.properties.url).toMatch(/\/save-response$/);
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
