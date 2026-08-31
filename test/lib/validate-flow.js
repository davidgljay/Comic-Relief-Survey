const ALLOWED_TYPES = new Set([
  'trigger',
  'send-and-wait-for-reply',
  'send-message',
  'split-based-on',
  'make-http-request',
]);

// Structural checks for a Twilio Studio Flow JSON export. Does not call Twilio —
// this just catches the kind of authoring mistakes that would only otherwise
// surface after importing into Studio (or worse, at runtime on a real reply).
function validateFlow(flow) {
  const errors = [];

  if (!Array.isArray(flow.states) || flow.states.length === 0) {
    return ['flow.states must be a non-empty array'];
  }

  const names = new Set();
  for (const state of flow.states) {
    if (names.has(state.name)) {
      errors.push(`duplicate state name: ${state.name}`);
    }
    names.add(state.name);
    if (!ALLOWED_TYPES.has(state.type)) {
      errors.push(`state "${state.name}" has unrecognized type "${state.type}"`);
    }
  }

  if (!names.has(flow.initial_state)) {
    errors.push(`initial_state "${flow.initial_state}" is not a defined state`);
  }

  const triggerStates = flow.states.filter((s) => s.type === 'trigger');
  if (triggerStates.length !== 1) {
    errors.push(`expected exactly one trigger state, found ${triggerStates.length}`);
  } else if (triggerStates[0].name !== flow.initial_state) {
    errors.push('the trigger state must be the initial_state');
  }

  const reachable = new Set();
  const queue = [flow.initial_state];
  while (queue.length) {
    const current = queue.shift();
    if (reachable.has(current)) continue;
    reachable.add(current);
    const state = flow.states.find((s) => s.name === current);
    if (!state) continue;
    for (const t of state.transitions || []) {
      if (t.next === undefined || t.next === null) continue;
      if (typeof t.next !== 'string' || t.next.includes('placeholder')) {
        errors.push(`state "${state.name}" has an unwired transition on event "${t.event}"`);
        continue;
      }
      if (!names.has(t.next)) {
        errors.push(`state "${state.name}" transitions on "${t.event}" to unknown state "${t.next}"`);
        continue;
      }
      queue.push(t.next);
    }
  }

  for (const state of flow.states) {
    if (!reachable.has(state.name)) {
      errors.push(`state "${state.name}" is unreachable from initial_state`);
    }
  }

  return errors;
}

module.exports = { validateFlow };
