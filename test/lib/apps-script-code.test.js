// apps-script/Code.gs runs in Google's Apps Script runtime (no Node module
// system, globals like SpreadsheetApp/ContentService instead), so it can't be
// required as-is. Registering .gs against Node's own .js loader lets us pull
// in just the pure helper functions it exports for testing (guarded by a
// `typeof module !== 'undefined'` check that's a no-op inside Apps Script).
require.extensions['.gs'] = require.extensions['.js'];
const { paramsToRow_, rowsFromValues_ } = require('../../apps-script/Code.gs');

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
