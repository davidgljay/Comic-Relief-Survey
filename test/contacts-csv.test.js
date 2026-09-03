const mockCallAppsScript = jest.fn();

jest.mock('../functions/lib/apps-script-client.private.js', () => ({
  callAppsScript: (...args) => mockCallAppsScript(...args),
}));

const { handler } = require('../functions/contacts-csv.js');
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

describe('POST /contacts-csv', () => {
  it('rejects when neither csv nor file is provided', async () => {
    const response = await invoke({});

    expect(response.statusCode).toBe(400);
    expect(mockCallAppsScript).not.toHaveBeenCalled();
  });

  it('rejects unparseable CSV', async () => {
    const response = await invoke({ csv: '"unterminated quote' });

    expect(response.statusCode).toBe(400);
    expect(response.body.error).toMatch(/could not parse CSV/);
  });

  it('imports valid rows and skips invalid ones, reporting both', async () => {
    const csv = [
      'phone,name,event,consent,email',
      '+15551112222,Ada,Gala,true,ada@example.com',
      'not-a-phone,Bad Phone,Gala,true,',
      '+15553334444,No Consent,Gala,false,',
      ',Missing Phone,Gala,true,',
    ].join('\n');

    const response = await invoke({ csv });

    expect(response.statusCode).toBe(200);
    expect(response.body.added).toBe(1);
    expect(response.body.skipped).toHaveLength(3);
    expect(mockCallAppsScript).toHaveBeenCalledTimes(1);
    expect(mockCallAppsScript).toHaveBeenCalledWith(
      context,
      'upsert_contact',
      expect.objectContaining({ phone: '+15551112222', name: 'Ada', event: 'Gala' })
    );
  });

  it('accepts CSV supplied via a file upload buffer', async () => {
    const csv = 'phone,name,event,consent\n+15551112222,Ada,Gala,true\n';
    const response = await invoke({ file: Buffer.from(csv, 'utf8') });

    expect(response.statusCode).toBe(200);
    expect(response.body.added).toBe(1);
  });

  it('records per-row failures without aborting the whole batch', async () => {
    mockCallAppsScript
      .mockResolvedValueOnce({ ok: true })
      .mockRejectedValueOnce(new Error('boom'));

    const csv = [
      'phone,name,event,consent',
      '+15551112222,Ada,Gala,true',
      '+15553334444,Grace,Gala,true',
    ].join('\n');

    const response = await invoke({ csv });

    expect(response.body.added).toBe(1);
    expect(response.body.skipped).toEqual([{ row: 3, reason: 'write failed' }]);
  });
});
