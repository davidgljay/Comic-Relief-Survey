// apps-script/Code.gs runs in Google's Apps Script runtime (no Node module
// system, globals like SpreadsheetApp/ContentService instead), so it can't be
// required as-is. Registering .gs against Node's own .js loader lets us pull
// in just the pure helper functions it exports for testing (guarded by a
// `typeof module !== 'undefined'` check that's a no-op inside Apps Script).
require.extensions['.gs'] = require.extensions['.js'];
const { paramsToRow_, rowsFromValues_, initHeaders_, CONTACTS_HEADER, ANONYMOUS_HEADER } = require('../../apps-script/Code.gs');

// Minimal fake standing in for a Sheet object's getRange(...).getValues()/setValues() API.
function fakeSheet(firstRowValues) {
  const state = { firstRow: firstRowValues };
  return {
    getRange(rowNum, colNum, numRows, numCols) {
      if (rowNum !== 1 || colNum !== 1 || numRows !== 1) throw new Error('unexpected getRange call');
      const padded = state.firstRow
        .slice(0, numCols)
        .concat(Array(Math.max(0, numCols - state.firstRow.length)).fill(''));
      return {
        getValues: () => [padded],
        setValues: ([newRow]) => {
          state.firstRow = newRow;
        },
      };
    },
    _state: state,
  };
}

describe('paramsToRow_', () => {
  it('drops the framing params (action, secret) and empty-string values', () => {
    const row = paramsToRow_({ action: 'upsert_contact', secret: 'shh', phone: '+1', name: '' });

    expect(row).toEqual({ phone: '+1' });
  });

  it('excludes any additional keys passed in, e.g. keeping PII off the Anonymous sheet', () => {
    const row = paramsToRow_(
      { action: 'save_response', secret: 'shh', phone: '+1', name: 'Ada', respondent_id: 'uuid-1', q1: '2' },
      ['phone', 'name']
    );

    expect(row).toEqual({ respondent_id: 'uuid-1', q1: '2' });
  });
});

describe('rowsFromValues_', () => {
  it('maps the header row onto each data row, stringifying values', () => {
    const { header, rows } = rowsFromValues_([
      ['phone', 'name', 'q1'],
      ['+1', 'Ada', 3],
    ]);

    expect(header).toEqual(['phone', 'name', 'q1']);
    expect(rows).toEqual([{ rowNumber: 2, values: { phone: '+1', name: 'Ada', q1: '3' } }]);
  });

  it('renders missing cells as an empty string rather than undefined/null', () => {
    const { rows } = rowsFromValues_([
      ['phone', 'name'],
      ['+1', null],
    ]);

    expect(rows[0].values.name).toBe('');
  });

  it('returns an empty result for a sheet with only a header row', () => {
    const { header, rows } = rowsFromValues_([['phone', 'name']]);

    expect(header).toEqual(['phone', 'name']);
    expect(rows).toEqual([]);
  });
});

describe('header constants', () => {
  it('Contacts header matches the documented columns (docs/twilio-setup.md §3)', () => {
    expect(CONTACTS_HEADER).toEqual([
      'phone', 'name', 'email', 'consent', 'event', 'registered_at',
      'sent_at', 'respondent_id', 'q1', 'q2', 'q3', 'q4', 'q5', 'completed_at',
    ]);
  });

  it('Anonymous header matches the documented columns and excludes any PII column', () => {
    expect(ANONYMOUS_HEADER).toEqual(['respondent_id', 'event', 'q1', 'q2', 'q3', 'q4', 'q5', 'completed_at']);
    expect(ANONYMOUS_HEADER).not.toEqual(expect.arrayContaining(['phone', 'name', 'email']));
  });
});

describe('initHeaders_', () => {
  it('writes the header into a genuinely blank sheet', () => {
    const sheet = fakeSheet(['', '']);

    const result = initHeaders_(sheet, ['phone', 'name']);

    expect(result).toBe('written');
    expect(sheet._state.firstRow).toEqual(['phone', 'name']);
  });

  it('is a no-op when the header is already exactly present', () => {
    const sheet = fakeSheet(['phone', 'name']);

    const result = initHeaders_(sheet, ['phone', 'name']);

    expect(result).toBe('already-present');
    expect(sheet._state.firstRow).toEqual(['phone', 'name']);
  });

  it('refuses to overwrite row 1 if it holds something else', () => {
    const sheet = fakeSheet(['some', 'other', 'data']);

    const result = initHeaders_(sheet, ['phone', 'name']);

    expect(result).toBe('skipped-existing-different-content');
    expect(sheet._state.firstRow).toEqual(['some', 'other', 'data']);
  });
});
