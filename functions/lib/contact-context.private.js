// Private helper — see functions/lib/apps-script-client.private.js for why
// this needs the .private.js suffix (and Runtime.getFunctions() to require
// it, not a plain relative path).
//
// Looks up whether a phone number already has a Contacts row (e.g. someone
// who registered with consent for a real event) and resolves what a new or
// ongoing conversation with that number should use for event/name/
// respondent_id — used by both the Studio flow's text-in path (via
// resolve-trigger-context.js) and the simulate-response.js test endpoint.
async function resolveContactContext(context, phone) {
  const { callAppsScript } = require(Runtime.getFunctions()['lib/apps-script-client'].path);
  const { normalizePhone } = require(Runtime.getFunctions()['lib/phone'].path);

  // Matched as normalized E.164 numbers (see phone.private.js), in the Function rather than in Apps Script's exact
  // string comparison: a phone typed or pasted into the sheet by hand often
  // differs from what Twilio reports for the same number (invisible Unicode
  // direction marks from a contacts app, a dropped leading "+", spaces or
  // dashes), and an exact match then reports "unknown" and the answers land on
  // a brand-new row. The row's own stored phone is returned as `phone` so the
  // caller can save under that exact string and hit the original row.
  let contact = { found: false };
  try {
    const { rows } = await callAppsScript(context, 'list_rows', {});
    const wanted = normalizePhone(phone);
    const matches = wanted ? rows.filter((r) => normalizePhone(r.values.phone) === wanted) : [];
    const row = matches.find((r) => r.values.respondent_id) || matches[0];
    if (row) contact = { found: true, ...row.values };
  } catch (err) {
    // Apps Script errors must never block a caller — fall through to the same
    // genuinely-unknown-number defaults below.
    console.error(err);
  }

  if (contact.found) {
    return {
      phone: contact.phone,
      event: contact.event || 'unknown',
      name: contact.name || 'there',
      respondentId: contact.respondent_id || unknownRespondentId(phone),
    };
  }

  // A genuinely unregistered number — no prior row, so no real event/consent
  // on file. Tagged "unknown" (never "test") so it's distinguishable from
  // deliberate manual testing in the Sheets. respondent_id is derived
  // deterministically from the phone number (not crypto.randomUUID()) so
  // repeat calls for the same number — e.g. successive /simulate-response
  // calls for Q1, Q2, Q3..., which each resolve contact context independently
  // with no Studio execution state tying them together — land on the same
  // Anonymous-sheet row instead of a new one every time.
  return { phone, event: 'unknown', name: 'there', respondentId: unknownRespondentId(phone) };
}

function unknownRespondentId(phone) {
  const crypto = require('crypto');
  return crypto.createHash('sha256').update(phone).digest('hex');
}

module.exports = { resolveContactContext };
