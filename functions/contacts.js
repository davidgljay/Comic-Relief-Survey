// POST /contacts
// Adds (or updates) a single consenting contact, collected at event registration.
// Body (JSON or form-encoded): phone, name, email (optional), consent, event, registered_at (optional)
const { callAppsScript } = require('./lib/apps-script-client.private.js');

const E164 = /^\+[1-9]\d{1,14}$/;

exports.handler = async function (context, event, callback) {
  const response = new Twilio.Response();
  response.appendHeader('Content-Type', 'application/json');

  const { phone, name, email, consent, event: eventName, registered_at } = event;

  if (!phone || !E164.test(phone)) {
    response.setStatusCode(400);
    response.setBody({ error: 'phone is required and must be in E.164 format, e.g. +15551234567' });
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
