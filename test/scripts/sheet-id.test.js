const { extractSheetId } = require('../../scripts/_lib/sheet-id.js');

describe('extractSheetId', () => {
  it('pulls the ID out of a full Sheets URL', () => {
    expect(extractSheetId('https://docs.google.com/spreadsheets/d/1AbC-XyZ_123/edit#gid=0')).toBe('1AbC-XyZ_123');
  });

  it('passes a bare ID through unchanged', () => {
    expect(extractSheetId('1AbC-XyZ_123')).toBe('1AbC-XyZ_123');
  });

  it('trims surrounding whitespace', () => {
    expect(extractSheetId('  1AbC-XyZ_123  ')).toBe('1AbC-XyZ_123');
  });

  it('handles a missing/empty input without throwing', () => {
    expect(extractSheetId('')).toBe('');
    expect(extractSheetId(undefined)).toBe('');
  });
});
