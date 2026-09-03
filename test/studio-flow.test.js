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

  it('gates Question 4 on Question 3 being 1 or 2', () => {
    const gate = flow.states.find((s) => s.name === 'Split_Q3Gate');
    expect(gate.properties.input).toContain('q3');
    const match = gate.transitions.find((t) => t.event === 'match');
    expect(match.next).toBe('Q4_Send');
    expect(match.conditions[0].value).toBe('^[1-2]$');
  });

  it('gates Question 5 on Question 1 being 1 or 2', () => {
    const gate = flow.states.find((s) => s.name === 'Split_Q1Gate');
    expect(gate.properties.input).toContain('q1');
    const match = gate.transitions.find((t) => t.event === 'match');
    expect(match.next).toBe('Q5_Send');
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
