const mockResolveContactContext = jest.fn();
const mockSaveResponseHandler = jest.fn();
const mockNextMessage = jest.fn();

jest.mock('../functions/lib/contact-context.private.js', () => ({
  resolveContactContext: (...args) => mockResolveContactContext(...args),
}));
jest.mock('../functions/save-response.js', () => ({
  handler: (...args) => mockSaveResponseHandler(...args),
}));
jest.mock('../functions/lib/flow-steps.private.js', () => ({
  nextMessage: (...args) => mockNextMessage(...args),
}));

const { handler } = require('../functions/simulate-response.js');
const { silenceConsoleError } = require('./helpers/silence-console-error.js');

silenceConsoleError();

const context = { TRIGGER_SEND_SECRET: 'shh' };

function invoke(event) {
  return new Promise((resolve, reject) => {
    handler(context, event, (err, response) => (err ? reject(err) : resolve(response)));
  });
}

beforeEach(() => {
  mockResolveContactContext.mockReset();
  mockSaveResponseHandler.mockReset();
  mockNextMessage.mockReset();

  mockResolveContactContext.mockResolvedValue({ phone: '+15551112222', event: 'test', name: 'Ada', respondentId: 'uuid-1' });
  mockSaveResponseHandler.mockImplementation((ctx, params, callback) => {
    callback(null, { statusCode: 200, body: { ok: true } });
  });
  mockNextMessage.mockReturnValue('next question text');
});

describe('POST /simulate-response', () => {
  it('rejects a missing or wrong secret before doing anything else', async () => {
    const response = await invoke({ secret: 'wrong', number: '+15551112222', question: 1, answer: '1' });

    expect(response.statusCode).toBe(403);
    expect(mockResolveContactContext).not.toHaveBeenCalled();
  });

  it('rejects an invalid phone number', async () => {
    const response = await invoke({ secret: 'shh', number: '555', question: 1, answer: '1' });

    expect(response.statusCode).toBe(400);
    expect(mockSaveResponseHandler).not.toHaveBeenCalled();
  });

  it('accepts the number in any common format', async () => {
    await invoke({ secret: 'shh', number: '(555) 111-2222', question: 1, answer: '1' });

    expect(mockResolveContactContext).toHaveBeenCalledWith(context, '+15551112222');
  });

  it('rejects a question outside 1-5', async () => {
    const response = await invoke({ secret: 'shh', number: '+15551112222', question: 6, answer: '1' });

    expect(response.statusCode).toBe(400);
  });

  it('rejects a missing answer', async () => {
    const response = await invoke({ secret: 'shh', number: '+15551112222', question: 1 });

    expect(response.statusCode).toBe(400);
  });

  it('saves the answer under the resolved contact context and returns the next step as plain text', async () => {
    const response = await invoke({
      secret: 'shh',
      number: '+15551112222',
      question: 3,
      answer: "1 - I really enjoyed the event!",
    });

    expect(response.statusCode).toBe(200);
    expect(response.body).toBe('next question text');

    const [, saveParams] = mockSaveResponseHandler.mock.calls[0];
    expect(saveParams).toEqual({
      respondent_id: 'uuid-1',
      phone: '+15551112222',
      event: 'test',
      q3: "1 - I really enjoyed the event!",
    });
    expect(mockNextMessage).toHaveBeenCalledWith(3, "1 - I really enjoyed the event!");
  });

  it('marks the response completed when question 5 is answered', async () => {
    await invoke({ secret: 'shh', number: '+15551112222', question: 5, answer: 'Loved it' });

    const [, saveParams] = mockSaveResponseHandler.mock.calls[0];
    expect(saveParams.completed).toBe('true');
  });

  it('does not mark completed for questions other than 5', async () => {
    await invoke({ secret: 'shh', number: '+15551112222', question: 1, answer: '3' });

    const [, saveParams] = mockSaveResponseHandler.mock.calls[0];
    expect(saveParams).not.toHaveProperty('completed');
  });

  it('returns 500 if the underlying save actually fails', async () => {
    mockSaveResponseHandler.mockImplementation((ctx, params, callback) => {
      callback(null, { statusCode: 400, body: { error: 'respondent_id, phone, and event are required' } });
    });

    const response = await invoke({ secret: 'shh', number: '+15551112222', question: 1, answer: '3' });

    expect(response.statusCode).toBe(500);
    expect(mockNextMessage).not.toHaveBeenCalled();
  });
});
