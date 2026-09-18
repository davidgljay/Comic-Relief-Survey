const flow = require('../../studio-flow.json');
const { nextMessage, GATE_PATTERN, QUESTIONS, CLOSING_MESSAGE } = require('../../functions/lib/flow-steps.private.js');

function bodyOf(widgetName) {
  return flow.states.find((s) => s.name === widgetName).properties.body;
}

describe('flow-steps.private.js drift check against the real generated studio-flow.json', () => {
  it('QUESTIONS text matches each *_Send widget\'s actual body', () => {
    // Q1's body also has the preamble/greeting prefix, so only check it ends
    // with the question text rather than an exact match.
    expect(bodyOf('Q1_Send').endsWith(QUESTIONS[1])).toBe(true);
    expect(bodyOf('Q2_Send')).toBe(QUESTIONS[2]);
    expect(bodyOf('Q3_Send')).toBe(QUESTIONS[3]);
    expect(bodyOf('Q4_Send')).toBe(QUESTIONS[4]);
    expect(bodyOf('Q5_Send')).toBe(QUESTIONS[5]);
  });

  it('CLOSING_MESSAGE matches the real Closing_Message body', () => {
    expect(bodyOf('Closing_Message')).toBe(CLOSING_MESSAGE);
  });

  it('GATE_PATTERN matches the real Split_Q3Gate condition', () => {
    const gate = flow.states.find((s) => s.name === 'Split_Q3Gate');
    const condition = gate.transitions.find((t) => t.event === 'match').conditions[0];
    expect(condition.arguments[0]).toBe(GATE_PATTERN);
  });
});

describe('nextMessage', () => {
  it('walks Q1 -> Q2 -> Q3 unconditionally', () => {
    expect(nextMessage(1, 'anything')).toBe(QUESTIONS[2]);
    expect(nextMessage(2, 'anything')).toBe(QUESTIONS[3]);
  });

  it('gates Q4 on Q3\'s answer, same as the real Split_Q3Gate', () => {
    expect(nextMessage(3, '1')).toBe(QUESTIONS[4]);
    expect(nextMessage(3, '2 because it was fun')).toBe(QUESTIONS[4]);
    expect(nextMessage(3, '3')).toBe(QUESTIONS[5]);
    expect(nextMessage(3, 'not a number')).toBe(QUESTIONS[5]);
  });

  it('always goes Q4 -> Q5, and Q5 -> the closing message', () => {
    expect(nextMessage(4, 'anything')).toBe(QUESTIONS[5]);
    expect(nextMessage(5, 'anything')).toBe(CLOSING_MESSAGE);
  });

  it('rejects an out-of-range question number', () => {
    expect(() => nextMessage(0, 'x')).toThrow();
    expect(() => nextMessage(6, 'x')).toThrow();
  });
});
