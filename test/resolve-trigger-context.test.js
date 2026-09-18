const mockResolveContactContext = jest.fn();

jest.mock('../functions/lib/contact-context.private.js', () => ({
  resolveContactContext: (...args) => mockResolveContactContext(...args),
}));

const { handler } = require('../functions/resolve-trigger-context.js');
const { silenceConsoleError } = require('./helpers/silence-console-error.js');

silenceConsoleError();

const context = {};

function invoke(event) {
  return new Promise((resolve, reject) => {
    handler(context, event, (err, response) => (err ? reject(err) : resolve(response)));
  });
}

beforeEach(() => {
  mockResolveContactContext.mockReset();
});

describe('POST /resolve-trigger-context', () => {
  it('rejects a request missing phone', async () => {
    const response = await invoke({});

    expect(response.statusCode).toBe(400);
    expect(mockResolveContactContext).not.toHaveBeenCalled();
  });

  it('returns the resolved event/name/respondent_id as snake_case JSON for Liquid to read', async () => {
    mockResolveContactContext.mockResolvedValue({ event: 'fall-gala', name: 'Ada', respondentId: 'uuid-1' });

    const response = await invoke({ phone: '+15551112222' });

    expect(response.statusCode).toBe(200);
    expect(response.body).toEqual({ event: 'fall-gala', name: 'Ada', respondent_id: 'uuid-1' });
  });

  it('degrades gracefully to "unknown" if the lookup itself fails, never blocking the conversation', async () => {
    mockResolveContactContext.mockRejectedValue(new Error('Apps Script down'));

    const response = await invoke({ phone: '+15551112222' });

    expect(response.statusCode).toBe(200);
    expect(response.body.event).toBe('unknown');
    expect(response.body.name).toBe('there');
    expect(typeof response.body.respondent_id).toBe('string');
    expect(response.body.respondent_id.length).toBeGreaterThan(0);
  });
});
