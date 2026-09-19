const mockCallAppsScript = jest.fn();

jest.mock('../functions/lib/apps-script-client.private.js', () => ({
  callAppsScript: (...args) => mockCallAppsScript(...args),
}));

const { handler } = require('../functions/contacts.js');
const { silenceConsoleError } = require('./helpers/silence-console-error.js');

silenceConsoleError();

const context = { APPS_SCRIPT_URL: 'https://script.google.com/x/exec', APPS_SCRIPT_SECRET: 'shh' };

function invoke(event) {
  return new Promise((resolve, reject) => {
    handler(context, event, (err, response) => (err ? reject(err) : resolve(response)));
  });
}

beforeEach(() => {
  mockCallAppsScript.mockReset();
  mockCallAppsScript.mockResolvedValue({ ok: true });
});

describe('POST /contacts', () => {
  it('rejects a missing/invalid phone number', async () => {
    const response = await invoke({ phone: '5551112222', name: 'Ada', event: 'Gala', consent: true });

    expect(response.statusCode).toBe(400);
    expect(response.body.error).toMatch(/E\.164/);
    expect(mockCallAppsScript).not.toHaveBeenCalled();
  });

  it('rejects a missing name or event', async () => {
    const response = await invoke({ phone: '+15551112222', consent: true });

    expect(response.statusCode).toBe(400);
    expect(mockCallAppsScript).not.toHaveBeenCalled();
  });

  it('rejects when consent is not explicitly true', async () => {
    const response = await invoke({ phone: '+15551112222', name: 'Ada', event: 'Gala', consent: false });

    expect(response.statusCode).toBe(400);
    expect(response.body.error).toMatch(/consent/);
    expect(mockCallAppsScript).not.toHaveBeenCalled();
  });

  it('accepts consent passed as the string "true"', async () => {
    const response = await invoke({ phone: '+15551112222', name: 'Ada', event: 'Gala', consent: 'true' });

    expect(response.statusCode).toBe(201);
    expect(mockCallAppsScript).toHaveBeenCalledWith(
      context,
      'upsert_contact',
      expect.objectContaining({ phone: '+15551112222', name: 'Ada', event: 'Gala', consent: 'true' })
    );
  });

  it('saves a valid contact and defaults registered_at', async () => {
    const response = await invoke({ phone: '+15551112222', name: 'Ada', event: 'Gala', consent: true, email: 'ada@example.com' });

    expect(response.statusCode).toBe(201);
    expect(response.body).toEqual({ ok: true });
    const [, , rowObj] = mockCallAppsScript.mock.calls[0];
    expect(rowObj.email).toBe('ada@example.com');
    expect(typeof rowObj.registered_at).toBe('string');
  });

  it('returns a 500 if the Apps Script call fails', async () => {
    mockCallAppsScript.mockRejectedValue(new Error('boom'));

    const response = await invoke({ phone: '+15551112222', name: 'Ada', event: 'Gala', consent: true });

    expect(response.statusCode).toBe(500);
  });
});
