const { parseEnvValues, renderEnvFile, resolveValue } = require('../../scripts/_lib/env-file.js');

describe('parseEnvValues', () => {
  it('parses KEY=VALUE lines, ignoring comments and blank lines', () => {
    const text = [
      '# a comment',
      '',
      'ACCOUNT_SID=ACxxxx',
      'AUTH_TOKEN=abc123',
    ].join('\n');

    expect(parseEnvValues(text)).toEqual({ ACCOUNT_SID: 'ACxxxx', AUTH_TOKEN: 'abc123' });
  });

  it('strips matching surrounding quotes, leaving \\n escapes untouched', () => {
    const text = 'MULTILINE_SECRET="-----BEGIN KEY-----\\nabc\\n-----END KEY-----\\n"\nPLAIN=\'unquoted-ish\'\n';

    const values = parseEnvValues(text);
    expect(values.MULTILINE_SECRET).toBe('-----BEGIN KEY-----\\nabc\\n-----END KEY-----\\n');
    expect(values.PLAIN).toBe('unquoted-ish');
  });

  it('is a round trip with renderEnvFile, including a value with leading/trailing whitespace', () => {
    const defs = [
      { key: 'A', prompt: 'A value' },
      { key: 'B', prompt: 'B value', help: 'some help text' },
    ];
    const original = { A: 'hello', B: '  padded value  ' };

    const rendered = renderEnvFile(defs, original);
    const parsed = parseEnvValues(rendered);

    expect(parsed).toEqual(original);
  });
});

describe('renderEnvFile', () => {
  it('includes each var\'s prompt and help as comments', () => {
    const defs = [{ key: 'FOO', prompt: 'Foo value', help: 'Find it in the Foo console' }];
    const rendered = renderEnvFile(defs, { FOO: 'bar' });

    expect(rendered).toContain('# Foo value');
    expect(rendered).toContain('# Find it in the Foo console');
    expect(rendered).toContain('FOO=bar');
  });

  it('defaults a missing value to an empty string rather than "undefined"', () => {
    const defs = [{ key: 'FOO', prompt: 'Foo value' }];
    const rendered = renderEnvFile(defs, {});

    expect(rendered).toContain('FOO=\n');
  });
});

describe('resolveValue', () => {
  const def = { key: 'X', prompt: 'X' };

  it('uses the trimmed answer when one is given', () => {
    expect(resolveValue(def, 'old', '  new-value  ')).toBe('new-value');
  });

  it('falls back to the existing value when the answer is blank', () => {
    expect(resolveValue(def, 'old', '')).toBe('old');
    expect(resolveValue(def, 'old', '   ')).toBe('old');
  });

  it('generates a random value when autoGenerate is set and nothing else is available', () => {
    const autoDef = { key: 'SECRET', prompt: 'Secret', autoGenerate: true };
    const value = resolveValue(autoDef, undefined, '');

    expect(value).toMatch(/^[a-f0-9]{48}$/);
  });

  it('prefers an existing value over auto-generating a new one', () => {
    const autoDef = { key: 'SECRET', prompt: 'Secret', autoGenerate: true };
    expect(resolveValue(autoDef, 'already-set', '')).toBe('already-set');
  });

  it('returns an empty string for an optional var with nothing given', () => {
    expect(resolveValue(def, undefined, '')).toBe('');
  });
});
