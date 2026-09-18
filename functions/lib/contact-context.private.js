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
  const crypto = require('crypto');

  const contact = await callAppsScript(context, 'get_contact', { phone });

  if (contact.found) {
    return {
      event: contact.event || 'unknown',
      name: contact.name || 'there',
      respondentId: contact.respondent_id || crypto.randomUUID(),
    };
  }

  // A genuinely unregistered number — no prior row, so no real event/consent
  // on file. Tagged "unknown" (never "test") so it's distinguishable from
  // deliberate manual testing in the Sheets, and a fresh respondent_id is
  // minted so repeat texts from the same unknown number still accumulate
  // into one Anonymous-sheet row rather than a new one each time.
  return { event: 'unknown', name: 'there', respondentId: crypto.randomUUID() };
}

module.exports = { resolveContactContext };
