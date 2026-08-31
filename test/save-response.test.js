const mockUpsertRow = jest.fn();

jest.mock('../functions/_lib/sheets.js', () => ({
  upsertRow: (...args) => mockUpsertRow(...args),
}));

const { handler } = require('../functions/save-response.js');

const context = { CONTACTS_SHEET_ID: 'contacts-sheet', ANONYMOUS_SHEET_ID: 'anon-sheet' };

function invoke(event) {
  return new Promise((resolve, reject) => {
    handler(context, event, (err, response) => (err ? reject(err) : resolve(response)));
  });
}

beforeEach(() => {
  mockUpsertRow.mockReset();
  mockUpsertRow.mockResolvedValue(undefined);
});

describe('POST /save-response', () => {
  it('rejects a request missing respondent_id, phone, or event', async () => {
    const response = await invoke({ phone: '+1', event: 'Gala' });

    expect(response.statusCode).toBe(400);
    expect(mockUpsertRow).not.toHaveBeenCalled();
  });

  it('writes the same answers to both sheets, with phone only in the contacts sheet', async () => {
    const response = await invoke({
      respondent_id: 'uuid-1',
      phone: '+15551112222',
      event: 'Gala',
      q1: '2',
    });

    expect(response.statusCode).toBe(200);
    expect(response.body).toEqual({ ok: true, q1: '2' });

    expect(mockUpsertRow).toHaveBeenNthCalledWith(
      1,
      context,
      'contacts-sheet',
      'phone',
      expect.objectContaining({ phone: '+15551112222', respondent_id: 'uuid-1', q1: '2' })
    );

    const anonCall = mockUpsertRow.mock.calls[1];
    expect(anonCall[1]).toBe('anon-sheet');
    expect(anonCall[2]).toBe('respondent_id');
    expect(anonCall[3]).not.toHaveProperty('phone');
    expect(anonCall[3]).not.toHaveProperty('name');
    expect(anonCall[3]).toEqual({ respondent_id: 'uuid-1', event: 'Gala', q1: '2' });
  });

  it('ignores empty-string answer fields rather than blanking existing cells', async () => {
    await invoke({ respondent_id: 'uuid-1', phone: '+1', event: 'Gala', q1: '3', q2: '' });

    const rowObj = mockUpsertRow.mock.calls[0][3];
    expect(rowObj).not.toHaveProperty('q2');
  });

  it('stamps completed_at only when completed is explicitly true', async () => {
    const response = await invoke({
      respondent_id: 'uuid-1',
      phone: '+1',
      event: 'Gala',
      completed: 'true',
    });

    expect(response.body.ok).toBe(true);
    const rowObj = mockUpsertRow.mock.calls[0][3];
    expect(typeof rowObj.completed_at).toBe('string');
  });

  it('returns 500 if a sheet write fails', async () => {
    mockUpsertRow.mockRejectedValue(new Error('boom'));

    const response = await invoke({ respondent_id: 'uuid-1', phone: '+1', event: 'Gala', q1: '1' });

    expect(response.statusCode).toBe(500);
  });
});
