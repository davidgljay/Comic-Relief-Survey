const mockCallAppsScript = jest.fn();

jest.mock('../functions/_lib/apps-script-client.js', () => ({
  callAppsScript: (...args) => mockCallAppsScript(...args),
}));

const { handler } = require('../functions/save-response.js');
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

describe('POST /save-response', () => {
  it('rejects a request missing respondent_id, phone, or event', async () => {
    const response = await invoke({ phone: '+1', event: 'Gala' });

    expect(response.statusCode).toBe(400);
    expect(mockCallAppsScript).not.toHaveBeenCalled();
  });

  it('makes a single save_response call carrying phone, respondent_id, event, and the answer', async () => {
    const response = await invoke({
      respondent_id: 'uuid-1',
      phone: '+15551112222',
      event: 'Gala',
      q1: '2',
    });

    expect(response.statusCode).toBe(200);
    expect(response.body).toEqual({ ok: true, q1: '2' });

    // Splitting this one call's fields across the Contacts vs Anonymous
    // sheet (never writing phone/name to Anonymous) is Apps Script's job —
    // see apps-script/Code.gs and test/lib/apps-script-code.test.js.
    expect(mockCallAppsScript).toHaveBeenCalledTimes(1);
    expect(mockCallAppsScript).toHaveBeenCalledWith(
      context,
      'save_response',
      expect.objectContaining({ phone: '+15551112222', respondent_id: 'uuid-1', event: 'Gala', q1: '2' })
    );
  });

  it('ignores empty-string answer fields rather than blanking existing cells', async () => {
    await invoke({ respondent_id: 'uuid-1', phone: '+1', event: 'Gala', q1: '3', q2: '' });

    const params = mockCallAppsScript.mock.calls[0][2];
    expect(params).not.toHaveProperty('q2');
  });

  it('stamps completed_at only when completed is explicitly true', async () => {
    const response = await invoke({
      respondent_id: 'uuid-1',
      phone: '+1',
      event: 'Gala',
      completed: 'true',
    });

    expect(response.body.ok).toBe(true);
    const params = mockCallAppsScript.mock.calls[0][2];
    expect(typeof params.completed_at).toBe('string');
  });

  it('returns 500 if the Apps Script call fails', async () => {
    mockCallAppsScript.mockRejectedValue(new Error('boom'));

    const response = await invoke({ respondent_id: 'uuid-1', phone: '+1', event: 'Gala', q1: '1' });

    expect(response.statusCode).toBe(500);
  });
});
