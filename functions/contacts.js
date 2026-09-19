// POST /contacts
// Adds (or updates) a single consenting contact, collected at event registration.
// Body (JSON or form-encoded): phone (any common format — stored as E.164), name, email (optional), consent, event, registered_at (optional)
exports.handler = async function (context, event, callback) {
  // Required inside the handler, not at module top level — see the comment
  // in functions/save-response.js for why a plain relative require breaks
  // once actually deployed (works fine locally, which is why this was easy
  // to miss until a real deploy hit it).
  const { callAppsScript } = require(Runtime.getFunctions()['lib/apps-script-client'].path);
  const { normalizePhone } = require(Runtime.getFunctions()['lib/phone'].path);

  const response = new Twilio.Response();
  response.appendHeader('Content-Type', 'application/json');

  const { name, email, consent, event: eventName, registered_at } = event;
  const phone = normalizePhone(event.phone);

  if (!phone) {
    response.setStatusCode(400);
    response.setBody({
      error: 'phone is required and must be a valid number, e.g. (555) 123-4567 or +15551234567 (include the + and country code outside the US/Canada)',
    });
    return callback(null, response);
  }
  if (!name || !eventName) {
    response.setStatusCode(400);
    response.setBody({ error: 'name and event are required' });
    return callback(null, response);
  }
  const consentGiven = consent === true || consent === 'true' || consent === '1';
  if (!consentGiven) {
    response.setStatusCode(400);
    response.setBody({ error: 'consent must be explicitly true to store a contact' });
    return callback(null, response);
  }

  try {
    await callAppsScript(context, 'upsert_contact', {
      phone,
      name,
      email: email || '',
      consent: 'true',
      event: eventName,
      registered_at: registered_at || new Date().toISOString(),
    });
    response.setStatusCode(201);
    response.setBody({ ok: true });
  } catch (err) {
    console.error(err);
    response.setStatusCode(500);
    response.setBody({ error: 'failed to save contact' });
  }
  return callback(null, response);
};
