// Private helper — see functions/lib/apps-script-client.private.js for why
// this needs the .private.js suffix (and Runtime.getFunctions() to require
// it, not a plain relative path).
//
// Turns a phone number in whatever form it was typed or pasted — "(314)
// 210-7659", "314.210.7659", "1-314-210-7659", "+1 314 210 7659", or with
// invisible Unicode direction marks copied from a contacts app — into E.164
// ("+13142107659"), or null if it can't be read as a real number.
//
//  - A leading "+" means the country code is included: any 8-15 digit number
//    is accepted as-is (international).
//  - Without a "+", the number is treated as US/Canada: exactly 10 digits
//    (area code starting 2-9), or 11 digits with a leading 1.
//  - Anything else is rejected rather than guessed at.
function normalizePhone(raw) {
  if (raw === undefined || raw === null) return null;

  const kept = String(raw).replace(/[^\d+]/g, '');
  const digits = kept.replace(/\+/g, '');

  if (kept.startsWith('+')) {
    return /^[1-9]\d{7,14}$/.test(digits) ? `+${digits}` : null;
  }
  if (/^[2-9]\d{9}$/.test(digits)) return `+1${digits}`;
  if (/^1[2-9]\d{9}$/.test(digits)) return `+${digits}`;
  return null;
}

module.exports = { normalizePhone };
