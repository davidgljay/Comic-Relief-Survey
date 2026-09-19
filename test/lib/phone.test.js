const { normalizePhone } = require('../../functions/lib/phone.private.js');

describe('normalizePhone', () => {
  it.each([
    ['(314) 210-7659', '+13142107659'],
    ['(314)210-7659', '+13142107659'],
    ['314.210.7659', '+13142107659'],
    ['314-210-7659', '+13142107659'],
    ['3142107659', '+13142107659'],
    ['1-314-210-7659', '+13142107659'],
    ['13142107659', '+13142107659'],
    ['+1 314 210 7659', '+13142107659'],
    ['+13142107659', '+13142107659'],
    [13142107659, '+13142107659'],
    ['  314 210 7659  ext.', '+13142107659'],
  ])('reads %p as %p', (input, expected) => {
    expect(normalizePhone(input)).toBe(expected);
  });

  it('ignores invisible Unicode direction marks copied from a contacts app', () => {
    expect(normalizePhone('+1‭3142107659‬')).toBe('+13142107659');
    expect(normalizePhone('‭(314) 210-7659‬')).toBe('+13142107659');
  });

  it('keeps an international number that includes its + and country code', () => {
    expect(normalizePhone('+44 20 7946 0958')).toBe('+442079460958');
    expect(normalizePhone('+52 55 1234 5678')).toBe('+525512345678');
  });

  it.each([
    [undefined], [null], [''], ['not a number'], ['555'], ['12345'], ['031-210-7659'],
    ['442079460958'], // international without a "+" is ambiguous, so it is rejected, not guessed
    ['+1'], ['+123'], ['+1234567890123456'],
  ])('rejects %p', (input) => {
    expect(normalizePhone(input)).toBeNull();
  });
});
