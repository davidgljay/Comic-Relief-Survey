const mockCallAppsScript = jest.fn();

jest.mock('../../functions/lib/apps-script-client.private.js', () => ({
  callAppsScript: (...args) => mockCallAppsScript(...args),
}));

const { resolveContactContext } = require('../../functions/lib/contact-context.private.js');

const context = { APPS_SCRIPT_URL: 'https://script.google.com/x/exec', APPS_SCRIPT_SECRET: 'shh' };

beforeEach(() => {
  mockCallAppsScript.mockReset();
});

describe('resolveContactContext', () => {
  it('reuses an existing contact\'s real event/name/respondent_id when found', async () => {
    mockCallAppsScript.mockResolvedValue({
      found: true,
      event: 'fall-gala-2026',
      name: 'Ada',
      respondent_id: 'uuid-existing',
    });

    const result = await resolveContactContext(context, '+15551112222');

    expect(mockCallAppsScript).toHaveBeenCalledWith(context, 'get_contact', { phone: '+15551112222' });
    expect(result).toEqual({ event: 'fall-gala-2026', name: 'Ada', respondentId: 'uuid-existing' });
  });

  it('tags a genuinely unknown number as event "unknown" with a fresh respondent_id', async () => {
    mockCallAppsScript.mockResolvedValue({ found: false });

    const result = await resolveContactContext(context, '+15559998888');

    expect(result.event).toBe('unknown');
    expect(result.name).toBe('there');
    expect(typeof result.respondentId).toBe('string');
    expect(result.respondentId.length).toBeGreaterThan(0);
  });

  it('mints a fresh respondent_id even for a found contact with no respondent_id on file yet', async () => {
    mockCallAppsScript.mockResolvedValue({ found: true, event: 'fall-gala-2026', name: 'Ada', respondent_id: '' });

    const result = await resolveContactContext(context, '+15551112222');

    expect(result.event).toBe('fall-gala-2026');
    expect(typeof result.respondentId).toBe('string');
    expect(result.respondentId.length).toBeGreaterThan(0);
  });

  it('gives two unknown numbers different respondent_ids', async () => {
    mockCallAppsScript.mockResolvedValue({ found: false });

    const a = await resolveContactContext(context, '+15551110000');
    const b = await resolveContactContext(context, '+15552220000');

    expect(a.respondentId).not.toBe(b.respondentId);
  });
});
