const mockGet = jest.fn();
const mockAppend = jest.fn();
const mockBatchUpdate = jest.fn();

jest.mock('googleapis', () => ({
  google: {
    auth: { JWT: jest.fn().mockImplementation(() => ({})) },
    sheets: jest.fn().mockImplementation(() => ({
      spreadsheets: {
        values: {
          get: mockGet,
          append: mockAppend,
          batchUpdate: mockBatchUpdate,
        },
      },
    })),
  },
}));

const {
  readRows,
  appendRow,
  updateRow,
  findRowByColumn,
  upsertRow,
} = require('../../functions/_lib/sheets.js');

const context = {
  GOOGLE_SERVICE_ACCOUNT_EMAIL: 'bot@example.iam.gserviceaccount.com',
  GOOGLE_PRIVATE_KEY: '-----BEGIN PRIVATE KEY-----\\nabc\\n-----END PRIVATE KEY-----\\n',
};

beforeEach(() => {
  mockGet.mockReset();
  mockAppend.mockReset();
  mockBatchUpdate.mockReset();
});

describe('readRows', () => {
  it('maps the header row onto each data row', async () => {
    mockGet.mockResolvedValue({
      data: { values: [['phone', 'name'], ['+15551112222', 'Ada']] },
    });

    const { header, rows } = await readRows(context, 'sheet-id');

    expect(header).toEqual(['phone', 'name']);
    expect(rows).toEqual([
      { rowNumber: 2, values: { phone: '+15551112222', name: 'Ada' } },
    ]);
  });

  it('returns an empty result for a sheet with no header', async () => {
    mockGet.mockResolvedValue({ data: {} });

    const { header, rows } = await readRows(context, 'sheet-id');

    expect(header).toEqual([]);
    expect(rows).toEqual([]);
  });
});

describe('appendRow', () => {
  it('writes values in header-column order, blanking missing fields', async () => {
    mockAppend.mockResolvedValue({});

    await appendRow(context, 'sheet-id', ['phone', 'name', 'email'], {
      phone: '+15551112222',
      name: 'Ada',
    });

    expect(mockAppend).toHaveBeenCalledWith(
      expect.objectContaining({
        spreadsheetId: 'sheet-id',
        requestBody: { values: [['+15551112222', 'Ada', '']] },
      })
    );
  });
});

describe('updateRow', () => {
  it('only touches the columns present in the update, as individual cell ranges', async () => {
    mockBatchUpdate.mockResolvedValue({});

    await updateRow(context, 'sheet-id', ['phone', 'name', 'q1'], 5, { q1: '3' });

    expect(mockBatchUpdate).toHaveBeenCalledWith({
      spreadsheetId: 'sheet-id',
      requestBody: {
        valueInputOption: 'USER_ENTERED',
        data: [{ range: 'Sheet1!C5', values: [['3']] }],
      },
    });
  });

  it('is a no-op when nothing in the update matches a known column', async () => {
    await updateRow(context, 'sheet-id', ['phone', 'name'], 5, { unrelated: 'x' });

    expect(mockBatchUpdate).not.toHaveBeenCalled();
  });
});

describe('findRowByColumn', () => {
  it('finds the matching row by column value', async () => {
    mockGet.mockResolvedValue({
      data: { values: [['phone', 'name'], ['+1', 'A'], ['+2', 'B']] },
    });

    const result = await findRowByColumn(context, 'sheet-id', 'phone', '+2');

    expect(result).toEqual({ header: ['phone', 'name'], rowNumber: 3, values: { phone: '+2', name: 'B' } });
  });

  it('returns a null rowNumber when nothing matches', async () => {
    mockGet.mockResolvedValue({ data: { values: [['phone', 'name'], ['+1', 'A']] } });

    const result = await findRowByColumn(context, 'sheet-id', 'phone', '+missing');

    expect(result.rowNumber).toBeNull();
  });
});

describe('upsertRow', () => {
  it('appends a new row when the key is not found', async () => {
    mockGet.mockResolvedValue({ data: { values: [['phone', 'name']] } });
    mockAppend.mockResolvedValue({});

    await upsertRow(context, 'sheet-id', 'phone', { phone: '+15551112222', name: 'Ada' });

    expect(mockAppend).toHaveBeenCalled();
    expect(mockBatchUpdate).not.toHaveBeenCalled();
  });

  it('updates the existing row when the key is found', async () => {
    mockGet.mockResolvedValue({
      data: { values: [['phone', 'name'], ['+15551112222', 'Ada']] },
    });
    mockBatchUpdate.mockResolvedValue({});

    await upsertRow(context, 'sheet-id', 'phone', { phone: '+15551112222', name: 'Ada Lovelace' });

    expect(mockBatchUpdate).toHaveBeenCalled();
    expect(mockAppend).not.toHaveBeenCalled();
  });
});
