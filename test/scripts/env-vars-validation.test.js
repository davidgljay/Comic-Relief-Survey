const { ENV_VARS } = require('../../scripts/deploy.js');

function defFor(key) {
  return ENV_VARS.find((v) => v.key === key);
}

describe('ACCOUNT_SID validation', () => {
  const { validate } = defFor('ACCOUNT_SID');

  it('accepts a real Account SID', () => {
    expect(validate('AC' + '0'.repeat(32))).toBeNull();
  });

  it('rejects an API Key SID (the actual mistake this guards against)', () => {
    // API Key SIDs start with SK, not AC — pasting one here silently breaks
    // both `twilio-run deploy` and the Studio Flow API calls.
    expect(validate('SK' + '0'.repeat(32))).not.toBeNull();
  });

  it('rejects a Studio Flow SID (FW...) or other non-AC value', () => {
    expect(validate('FW' + '0'.repeat(32))).not.toBeNull();
    expect(validate('not-a-sid')).not.toBeNull();
  });
});

describe('TWILIO_PHONE_NUMBER validation', () => {
  const { validate } = defFor('TWILIO_PHONE_NUMBER');

  it('accepts E.164', () => {
    expect(validate('+15551234567')).toBeNull();
  });

  it('rejects a number missing the +', () => {
    expect(validate('15551234567')).not.toBeNull();
  });
});

describe('STUDIO_FLOW_SID validation', () => {
  const { validate } = defFor('STUDIO_FLOW_SID');

  it('accepts a real Flow SID', () => {
    expect(validate('FW' + '0'.repeat(32))).toBeNull();
  });

  it('rejects an Account SID typed into the wrong field', () => {
    expect(validate('AC' + '0'.repeat(32))).not.toBeNull();
  });
});

describe('CONTACTS_SHEET_ID / ANONYMOUS_SHEET_ID validation and parsing', () => {
  for (const key of ['CONTACTS_SHEET_ID', 'ANONYMOUS_SHEET_ID']) {
    describe(key, () => {
      const { validate, parse } = defFor(key);

      it('accepts a plausible Sheet ID', () => {
        expect(validate('1AbC-XyZ_1234567890123456')).toBeNull();
      });

      it('rejects something too short to be a real Sheet ID', () => {
        expect(validate('abc')).not.toBeNull();
      });

      it('parses a pasted URL down to the ID before validation', () => {
        expect(parse('https://docs.google.com/spreadsheets/d/1AbC-XyZ_1234567890123456/edit')).toBe(
          '1AbC-XyZ_1234567890123456'
        );
      });
    });
  }
});

describe('APPS_SCRIPT_URL validation', () => {
  const { validate } = defFor('APPS_SCRIPT_URL');

  it('accepts a real Apps Script Web App /exec URL', () => {
    expect(validate('https://script.google.com/macros/s/AKfycb.../exec')).toBeNull();
  });

  it('rejects the Apps Script editor URL (a common mix-up)', () => {
    expect(validate('https://script.google.com/home/projects/AKfycb.../edit')).not.toBeNull();
  });

  it('rejects a non-Google URL', () => {
    expect(validate('https://example.com/exec')).not.toBeNull();
  });
});
