const mockCallAppsScript = jest.fn();

jest.mock('../../functions/lib/apps-script-client.private.js', () => ({
  callAppsScript: (...args) => mockCallAppsScript(...args),
}));

const { resolveContactContext } = require('../../functions/lib/contact-context.private.js');
const { silenceConsoleError } = require('../helpers/silence-console-error.js');

silenceConsoleError();

const context = { APPS_SCRIPT_URL: 'https://script.google.com/x/exec', APPS_SCRIPT_SECRET: 'shh' };

// What Apps Script's list_rows action returns for the Contacts sheet.
function sheet(...rows) {
  return { header: [], rows: rows.map((values, i) => ({ rowNumber: i + 2, values })) };
}

beforeEach(() => {
  mockCallAppsScript.mockReset();
});

describe('resolveContactContext', () => {
  it('reuses an existing contact\'s real event/name/respondent_id when found', async () => {
    mockCallAppsScript.mockResolvedValue(
      sheet({ phone: '+15551112222', event: 'fall-gala-2026', name: 'Ada', respondent_id: 'uuid-existing' })
    );

    const result = await resolveContactContext(context, '+15551112222');

    expect(mockCallAppsScript).toHaveBeenCalledWith(context, 'list_rows', {});
    expect(result).toEqual({
      phone: '+15551112222',
      event: 'fall-gala-2026',
      name: 'Ada',
      respondentId: 'uuid-existing',
    });
  });

  it('tags a genuinely unknown number as event "unknown" with a derived respondent_id', async () => {
    mockCallAppsScript.mockResolvedValue(sheet());

    const result = await resolveContactContext(context, '+15559998888');

    expect(result.event).toBe('unknown');
    expect(result.name).toBe('there');
    expect(typeof result.respondentId).toBe('string');
    expect(result.respondentId.length).toBeGreaterThan(0);
  });

  it('gives the same unknown number the same respondent_id across separate calls, so repeat calls (e.g. successive /simulate-response calls with no shared execution state) land on one row', async () => {
    mockCallAppsScript.mockResolvedValue(sheet());

    const a = await resolveContactContext(context, '+15559998888');
    const b = await resolveContactContext(context, '+15559998888');

    expect(a.respondentId).toBe(b.respondentId);
  });

  it('mints a derived respondent_id even for a found contact with no respondent_id on file yet', async () => {
    mockCallAppsScript.mockResolvedValue(sheet({ phone: '+15551112222', event: 'fall-gala-2026', name: 'Ada' }));

    const result = await resolveContactContext(context, '+15551112222');

    expect(result.event).toBe('fall-gala-2026');
    expect(typeof result.respondentId).toBe('string');
    expect(result.respondentId.length).toBeGreaterThan(0);
  });

  it('gives two different unknown numbers different respondent_ids', async () => {
    mockCallAppsScript.mockResolvedValue(sheet());

    const a = await resolveContactContext(context, '+15551110000');
    const b = await resolveContactContext(context, '+15552220000');

    expect(a.respondentId).not.toBe(b.respondentId);
  });

  it('degrades to the same unknown-number defaults if the Apps Script call itself throws', async () => {
    mockCallAppsScript.mockRejectedValue(new Error('Apps Script error: boom'));

    const result = await resolveContactContext(context, '+15551112222');

    expect(result.event).toBe('unknown');
    expect(result.name).toBe('there');
    expect(typeof result.respondentId).toBe('string');
    expect(result.respondentId.length).toBeGreaterThan(0);
  });

  describe('matching the phone against what is stored in the sheet', () => {
    it('finds a contact whose stored phone has invisible direction marks, and returns the stored string', async () => {
      const stored = '+1\u202D3142107659\u202C';
      mockCallAppsScript.mockResolvedValue(
        sheet({ phone: stored, event: 'fall-gala-2026', name: 'Ada', respondent_id: 'uuid-existing' })
      );

      const result = await resolveContactContext(context, '+13142107659');

      expect(result).toEqual({ phone: stored, event: 'fall-gala-2026', name: 'Ada', respondentId: 'uuid-existing' });
    });

    it('finds a contact whose stored phone lost its leading +, or has spaces and dashes', async () => {
      mockCallAppsScript.mockResolvedValue(
        sheet(
          { phone: '15553334444', event: 'a', name: 'Grace', respondent_id: 'u2' },
          { phone: '+1 (555) 777-8888', event: 'b', name: 'Lin', respondent_id: 'u3' }
        )
      );

      expect((await resolveContactContext(context, '+15553334444')).name).toBe('Grace');
      expect((await resolveContactContext(context, '+15557778888')).name).toBe('Lin');
    });

    it('prefers the duplicate row that already has a respondent_id', async () => {
      mockCallAppsScript.mockResolvedValue(
        sheet(
          { phone: '+15551112222', event: 'unknown', name: 'there' },
          { phone: '+15551112222', event: 'fall-gala-2026', name: 'Ada', respondent_id: 'uuid-real' }
        )
      );

      expect((await resolveContactContext(context, '+15551112222')).respondentId).toBe('uuid-real');
    });

    it('returns the phone as given for a number that is not on the sheet', async () => {
      mockCallAppsScript.mockResolvedValue(sheet({ phone: '+15550000000', event: 'x', name: 'Other' }));

      const result = await resolveContactContext(context, '+15559998888');

      expect(result.phone).toBe('+15559998888');
      expect(result.event).toBe('unknown');
    });
  });
});
