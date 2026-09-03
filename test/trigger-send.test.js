const mockCallAppsScript = jest.fn();

jest.mock('../functions/lib/apps-script-client.private.js', () => ({
  callAppsScript: (...args) => mockCallAppsScript(...args),
}));

const { handler } = require('../functions/trigger-send.js');
const { silenceConsoleError } = require('./helpers/silence-console-error.js');

silenceConsoleError();

const mockExecutionsCreate = jest.fn();

function makeContext(overrides = {}) {
  return {
    APPS_SCRIPT_URL: 'https://script.google.com/x/exec',
    APPS_SCRIPT_SECRET: 'apps-script-shh',
    STUDIO_FLOW_SID: 'FWxxxx',
    TWILIO_PHONE_NUMBER: '+15550000000',
    TRIGGER_SEND_SECRET: 'shh',
    getTwilioClient: () => ({
      studio: {
        v2: {
          flows: () => ({ executions: { create: mockExecutionsCreate } }),
        },
      },
    }),
    ...overrides,
  };
}

function invoke(context, event) {
  return new Promise((resolve, reject) => {
    handler(context, event, (err, response) => (err ? reject(err) : resolve(response)));
  });
}

beforeEach(() => {
  mockCallAppsScript.mockReset();
  mockExecutionsCreate.mockReset();
  mockExecutionsCreate.mockResolvedValue({});
  mockCallAppsScript.mockResolvedValue({ ok: true });
});

describe('POST /trigger-send', () => {
  it('rejects requests with a missing or wrong secret', async () => {
    const response = await invoke(makeContext(), { secret: 'wrong', event: 'Gala' });

    expect(response.statusCode).toBe(403);
    expect(mockCallAppsScript).not.toHaveBeenCalled();
  });

  it('rejects requests missing the event name', async () => {
    const response = await invoke(makeContext(), { secret: 'shh' });

    expect(response.statusCode).toBe(400);
  });

  it('only starts executions for consenting, not-yet-sent contacts matching the event', async () => {
    mockCallAppsScript.mockResolvedValueOnce({
      rows: [
        { values: { phone: '+1', event: 'Gala', consent: 'true', sent_at: '' } },
        { values: { phone: '+2', event: 'Gala', consent: 'true', sent_at: '2026-01-01' } }, // already sent
        { values: { phone: '+3', event: 'Gala', consent: 'false', sent_at: '' } }, // no consent
        { values: { phone: '+4', event: 'OtherEvent', consent: 'true', sent_at: '' } }, // wrong event
      ],
    });

    const response = await invoke(makeContext(), { secret: 'shh', event: 'Gala' });

    expect(response.statusCode).toBe(200);
    expect(response.body.started).toBe(1);
    expect(mockExecutionsCreate).toHaveBeenCalledTimes(1);
    expect(mockExecutionsCreate).toHaveBeenCalledWith(
      expect.objectContaining({ to: '+1', from: '+15550000000' })
    );
    // marks the contact as sent so a second call won't double-send
    expect(mockCallAppsScript).toHaveBeenCalledWith(
      expect.anything(),
      'upsert_contact',
      expect.objectContaining({ phone: '+1', sent_at: expect.any(String) })
    );
  });

  it('collects per-contact failures without aborting the batch', async () => {
    mockCallAppsScript.mockResolvedValueOnce({
      rows: [
        { values: { phone: '+1', event: 'Gala', consent: 'true', sent_at: '' } },
        { values: { phone: '+2', event: 'Gala', consent: 'true', sent_at: '' } },
      ],
    });
    mockExecutionsCreate
      .mockResolvedValueOnce({})
      .mockRejectedValueOnce(new Error('carrier rejected'));

    const response = await invoke(makeContext(), { secret: 'shh', event: 'Gala' });

    expect(response.body.started).toBe(1);
    expect(response.body.failed).toEqual(['+2']);
  });

  it('returns 500 if the contacts sheet cannot be read', async () => {
    mockCallAppsScript.mockRejectedValueOnce(new Error('apps script down'));

    const response = await invoke(makeContext(), { secret: 'shh', event: 'Gala' });

    expect(response.statusCode).toBe(500);
  });
});
