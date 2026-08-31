const mockUpsertRow = jest.fn();

jest.mock('../functions/_lib/sheets.js', () => ({
  upsertRow: (...args) => mockUpsertRow(...args),
}));

const { handler } = require('../functions/contacts.js');

const context = { CONTACTS_SHEET_ID: 'contacts-sheet' };

function invoke(event) {
  return new Promise((resolve, reject) => {
    handler(context, event, (err, response) => (err ? reject(err) : resolve(response)));
  });
}

beforeEach(() => {
  mockUpsertRow.mockReset();
  mockUpsertRow.mockResolvedValue(undefined);
});

describe('POST /contacts', () => {
  it('rejects a missing/invalid phone number', async () => {
    const response = await invoke({ phone: '5551112222', name: 'Ada', event: 'Gala', consent: true });

    expect(response.statusCode).toBe(400);
    expect(response.body.error).toMatch(/E\.164/);
    expect(mockUpsertRow).not.toHaveBeenCalled();
  });

  it('rejects a missing name or event', async () => {
    const response = await invoke({ phone: '+15551112222', consent: true });

    expect(response.statusCode).toBe(400);
    expect(mockUpsertRow).not.toHaveBeenCalled();
  });

  it('rejects when consent is not explicitly true', async () => {
    const response = await invoke({ phone: '+15551112222', name: 'Ada', event: 'Gala', consent: false });

    expect(response.statusCode).toBe(400);
    expect(response.body.error).toMatch(/consent/);
    expect(mockUpsertRow).not.toHaveBeenCalled();
  });

  it('accepts consent passed as the string "true"', async () => {
    const response = await invoke({ phone: '+15551112222', name: 'Ada', event: 'Gala', consent: 'true' });

    expect(response.statusCode).toBe(201);
    expect(mockUpsertRow).toHaveBeenCalledWith(
      context,
      'contacts-sheet',
      'phone',
      expect.objectContaining({ phone: '+15551112222', name: 'Ada', event: 'Gala', consent: 'true' })
    );
  });

  it('saves a valid contact and defaults registered_at', async () => {
    const response = await invoke({ phone: '+15551112222', name: 'Ada', event: 'Gala', consent: true, email: 'ada@example.com' });

    expect(response.statusCode).toBe(201);
    expect(response.body).toEqual({ ok: true });
    const [, , , rowObj] = mockUpsertRow.mock.calls[0];
    expect(rowObj.email).toBe('ada@example.com');
    expect(typeof rowObj.registered_at).toBe('string');
  });

  it('returns a 500 if the sheet write fails', async () => {
    mockUpsertRow.mockRejectedValue(new Error('boom'));

    const response = await invoke({ phone: '+15551112222', name: 'Ada', event: 'Gala', consent: true });

    expect(response.statusCode).toBe(500);
  });
});
