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

  it('starts executions from the Messaging Service, not the bare number, when one is configured', async () => {
    mockCallAppsScript.mockResolvedValueOnce({
      rows: [{ values: { phone: '+1', event: 'Gala', consent: 'true', sent_at: '' } }],
    });

    await invoke(makeContext({ MESSAGING_SERVICE_SID: 'MGxxxx' }), { secret: 'shh', event: 'Gala' });

    // Inbound routing for a number in a Messaging Service is delegated to the
    // service (see attachFlowToMessagingService in scripts/deploy.js), which
    // scopes replies to the service's channel identity — starting the
    // execution with the bare number instead would anchor it to a different
    // channel, breaking Twilio's "route this reply to the active execution"
    // matching (confirmed live, twice).
    expect(mockExecutionsCreate).toHaveBeenCalledWith(expect.objectContaining({ to: '+1', from: 'MGxxxx' }));
  });

  it('makes exactly one Apps Script write per contact, and only after the execution has started', async () => {
    // Twilio Functions are killed after 10 seconds and each Apps Script write
    // is slow, so nothing is written ahead of starting the execution: the
    // execution's parameters carry everything the flow needs.
    mockCallAppsScript.mockResolvedValueOnce({
      rows: [{ values: { phone: '+15550000001', event: 'Gala', consent: 'true', sent_at: '' } }],
    });

    await invoke(makeContext(), { secret: 'shh', event: 'Gala' });

    const upserts = mockCallAppsScript.mock.calls.filter((c) => c[1] === 'upsert_contact');
    expect(upserts).toHaveLength(1);
    expect(upserts[0][2]).toEqual({ phone: '+15550000001', sent_at: expect.any(String) });
    expect(mockCallAppsScript.mock.invocationCallOrder[mockCallAppsScript.mock.calls.indexOf(upserts[0])]).toBeGreaterThan(
      mockExecutionsCreate.mock.invocationCallOrder[0]
    );
  });

  it('passes the flow everything it needs as parameters (they arrive as flow.data.*), phone as stored', async () => {
    const stored = '+1\u202D5550000001\u202C';
    mockCallAppsScript.mockResolvedValueOnce({
      rows: [{ values: { phone: stored, event: 'Gala', name: 'Ada', consent: 'true', sent_at: '' } }],
    });

    await invoke(makeContext(), { secret: 'shh', event: 'Gala' });

    const params = JSON.parse(mockExecutionsCreate.mock.calls[0][0].parameters);
    expect(params).toEqual({
      phone: stored, // the sheet's own string: every save keys on it to hit the original row
      name: 'Ada',
      event: 'Gala',
      respondent_id: expect.stringMatching(/^[0-9a-f-]{36}$/),
    });
  });

  it('gives each contact their own fresh respondent_id', async () => {
    mockCallAppsScript.mockResolvedValueOnce({
      rows: [
        { values: { phone: '+15550000001', event: 'Gala', consent: 'true', sent_at: '' } },
        { values: { phone: '+15550000002', event: 'Gala', consent: 'true', sent_at: '' } },
      ],
    });

    await invoke(makeContext(), { secret: 'shh', event: 'Gala' });

    const ids = mockExecutionsCreate.mock.calls.map((c) => JSON.parse(c[0].parameters).respondent_id);
    expect(new Set(ids).size).toBe(2);
  });

  it('starts every pending contact when there are more than one batch of them', async () => {
    const rows = Array.from({ length: 23 }, (_, i) => ({
      values: { phone: `+1555000${String(i).padStart(4, '0')}`, event: 'Gala', consent: 'true', sent_at: '' },
    }));
    mockCallAppsScript.mockResolvedValueOnce({ rows });

    const response = await invoke(makeContext(), { secret: 'shh', event: 'Gala' });

    expect(response.body).toEqual({ started: 23, failed: [], remaining: 0 });
    expect(mockExecutionsCreate).toHaveBeenCalledTimes(23);
  });

  it('starts at most `limit` contacts and reports how many are left', async () => {
    const rows = Array.from({ length: 5 }, (_, i) => ({
      values: { phone: `+1555000${i}`, event: 'Gala', consent: 'true', sent_at: '' },
    }));
    mockCallAppsScript.mockResolvedValueOnce({ rows });

    const response = await invoke(makeContext(), { secret: 'shh', event: 'Gala', limit: '2' });

    expect(response.body).toEqual({ started: 2, failed: [], remaining: 3 });
    expect(mockExecutionsCreate).toHaveBeenCalledTimes(2);
  });

  it('rejects a limit that is not a positive integer', async () => {
    for (const limit of ['0', '-1', 'abc', '1.5']) {
      const response = await invoke(makeContext(), { secret: 'shh', event: 'Gala', limit });
      expect(response.statusCode).toBe(400);
    }
    expect(mockCallAppsScript).not.toHaveBeenCalled();
  });

  it('sends Twilio a cleaned +digits number but keys the sheet writes on the stored string', async () => {
    const stored = '+1\u202D3142107659\u202C'; // invisible direction marks, pasted from a contacts app
    mockCallAppsScript.mockResolvedValueOnce({
      rows: [{ values: { phone: stored, event: 'Gala', consent: 'true', sent_at: '' } }],
    });

    const response = await invoke(makeContext(), { secret: 'shh', event: 'Gala' });

    expect(response.body).toEqual({ started: 1, failed: [], remaining: 0 });
    expect(mockExecutionsCreate).toHaveBeenCalledWith(expect.objectContaining({ to: '+13142107659' }));
    const upserts = mockCallAppsScript.mock.calls.filter((c) => c[1] === 'upsert_contact');
    expect(upserts.map((c) => c[2].phone)).toEqual([stored]);
  });

  it('reports why a contact failed, not just which one', async () => {
    mockCallAppsScript.mockResolvedValueOnce({
      rows: [{ values: { phone: '+1', event: 'Gala', consent: 'true', sent_at: '' } }],
    });
    mockExecutionsCreate.mockRejectedValueOnce(new Error("The 'To' number +1 is not a valid phone number"));

    const response = await invoke(makeContext(), { secret: 'shh', event: 'Gala' });

    expect(response.body.failed).toEqual(['+1']);
    expect(response.body.errors).toEqual([{ phone: '+1', error: "The 'To' number +1 is not a valid phone number" }]);
  });

  it('does not mark a contact sent if starting their execution fails', async () => {
    mockCallAppsScript.mockResolvedValueOnce({
      rows: [{ values: { phone: '+1', event: 'Gala', consent: 'true', sent_at: '' } }],
    });
    mockExecutionsCreate.mockRejectedValueOnce(new Error('boom'));

    await invoke(makeContext(), { secret: 'shh', event: 'Gala' });

    const sentAtCalls = mockCallAppsScript.mock.calls.filter(
      (c) => c[1] === 'upsert_contact' && 'sent_at' in c[2]
    );
    expect(sentAtCalls).toHaveLength(0);
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
