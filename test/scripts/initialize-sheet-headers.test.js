const mockCallAppsScript = jest.fn();

jest.mock('../../functions/_lib/apps-script-client.js', () => ({
  callAppsScript: (...args) => mockCallAppsScript(...args),
}));

const { initializeSheetHeaders } = require('../../scripts/deploy.js');

const values = {
  APPS_SCRIPT_URL: 'https://script.google.com/x/exec',
  APPS_SCRIPT_SECRET: 'the-real-secret',
  CONTACTS_SHEET_ID: 'contacts-id',
  ANONYMOUS_SHEET_ID: 'anon-id',
};

beforeEach(() => {
  mockCallAppsScript.mockReset();
});

describe('initializeSheetHeaders', () => {
  it('reports what happened to each sheet on success', async () => {
    mockCallAppsScript.mockResolvedValue({ ok: true, contacts: 'written', anonymous: 'already-present' });

    await expect(initializeSheetHeaders(values)).resolves.toBeUndefined();
    expect(mockCallAppsScript).toHaveBeenCalledWith(
      { APPS_SCRIPT_URL: values.APPS_SCRIPT_URL, APPS_SCRIPT_SECRET: values.APPS_SCRIPT_SECRET },
      'init_headers',
      { contacts_sheet_id: 'contacts-id', anonymous_sheet_id: 'anon-id' }
    );
  });

  it('turns an "invalid secret" failure into actionable remediation steps, including the real secret', async () => {
    mockCallAppsScript.mockRejectedValue(new Error('Apps Script error: invalid secret'));

    await expect(initializeSheetHeaders(values)).rejects.toThrow(/CONFIG\.SHARED_SECRET/);
    await expect(initializeSheetHeaders(values)).rejects.toThrow('the-real-secret');
    await expect(initializeSheetHeaders(values)).rejects.toThrow('New version');
    await expect(initializeSheetHeaders(values)).rejects.toThrow('--skip-env');
  });

  it('passes through an unrelated failure unchanged', async () => {
    mockCallAppsScript.mockRejectedValue(new Error('network timeout'));

    await expect(initializeSheetHeaders(values)).rejects.toThrow('network timeout');
  });
});
