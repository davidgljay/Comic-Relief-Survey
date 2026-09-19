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

  // Matched by digits only, in the Function rather than in Apps Script's exact
  // string comparison: a phone typed or pasted into the sheet by hand often
  // differs from what Twilio reports for the same number (invisible Unicode
  // direction marks from a contacts app, a dropped leading "+", spaces or
  // dashes), and an exact match then reports "unknown" and the answers land on
  // a brand-new row. The row's own stored phone is returned as `phone` so the
  // caller can save under that exact string and hit the original row.
  let contact = { found: false };
  try {
    const { rows } = await callAppsScript(context, 'list_rows', {});
    const wanted = digitsOf(phone);
    const matches = wanted ? rows.filter((r) => digitsOf(r.values.phone) === wanted) : [];
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
      respondentId: contact.respondent_id || respondentIdFor(context, contact.phone, contact.event || 'unknown'),
    };
  }

  // A genuinely unregistered number — no prior row, so no real event/consent
  // on file. Tagged "unknown" (never "test") so it's distinguishable from
  // deliberate manual testing in the Sheets. respondent_id is derived (see
  // respondentIdFor), not random, so repeat calls land on the same row.
  return { phone, event: 'unknown', name: 'there', respondentId: respondentIdFor(context, phone, 'unknown') };
}

function digitsOf(value) {
  return String(value === undefined || value === null ? '' : value).replace(/\D/g, '');
}

// A stable id for a (contact, event) pair, so nothing has to be written to the
// sheet ahead of time for the flow to know it: trigger-send.js starts the
// execution without a pre-write (a slow Apps Script call that, together with
// the rest of its work, pushed it past Twilio's 10-second limit), and the
// first save then records the id on the contact's row. Repeat calls for the
// same contact and event — e.g. successive /simulate-response calls, which each
// resolve context independently — land on the same Anonymous-sheet row.
//
// Keyed with a server-side secret (HMAC), not a bare hash: the Anonymous sheet
// is meant to hold no PII, and an unkeyed hash of a phone number can be
// reversed by hashing every possible number.
function respondentIdFor(context, phone, event) {
  const crypto = require('crypto');
  const key = context.TRIGGER_SEND_SECRET || context.APPS_SCRIPT_SECRET || '';
  const lastTenDigits = String(phone).replace(/\D/g, '').slice(-10);
  return crypto.createHmac('sha256', key).update(`${lastTenDigits}|${event}`).digest('hex');
}

module.exports = { resolveContactContext };
