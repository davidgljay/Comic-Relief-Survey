// POST /save-response
// Called by the Studio flow's "Run Function" widget after every inbound reply,
// so a partially-completed survey still leaves partial answers on record.
//
// Body: respondent_id, phone, event, and any of q1..q5 that are known so far,
// plus completed ("true") on the final call.
//
// Writes to BOTH sheets in one Apps Script call (see apps-script/Code.gs
// action "save_response"):
//   - Contacts sheet (keyed by phone): full record, includes name/phone.
//   - Anonymous sheet (keyed by respondent_id): answers only, never phone/name.
const { callAppsScript } = require('./lib/apps-script-client.private.js');

const ANSWER_FIELDS = ['q1', 'q2', 'q3', 'q4', 'q5'];

exports.handler = async function (context, event, callback) {
  const response = new Twilio.Response();
  response.appendHeader('Content-Type', 'application/json');

  const { respondent_id: respondentId, phone, event: eventName, completed } = event;

  if (!respondentId || !phone || !eventName) {
    response.setStatusCode(400);
    response.setBody({ error: 'respondent_id, phone, and event are required' });
    return callback(null, response);
  }

  const answers = {};
  for (const field of ANSWER_FIELDS) {
    if (event[field] !== undefined && event[field] !== '') {
      answers[field] = event[field];
    }
  }
  const completedAt = completed === 'true' || completed === true ? new Date().toISOString() : undefined;

  try {
    await callAppsScript(context, 'save_response', {
      phone,
      respondent_id: respondentId,
      event: eventName,
      ...answers,
      ...(completedAt ? { completed_at: completedAt } : {}),
    });
    // Echo back the answers this call received (never phone/name) so the Studio
    // flow's gate splits (Q3 -> Q4, Q1 -> Q5) can read the validated value back
    // via {{widgets.SOME_SAVE_WIDGET.parsed.qN}} without re-deriving it from
    // raw inbound SMS text, which could still hold an earlier invalid reply.
    response.setStatusCode(200);
    response.setBody({ ok: true, ...answers });
  } catch (err) {
    console.error(err);
    response.setStatusCode(500);
    response.setBody({ error: 'failed to save response' });
  }
  return callback(null, response);
};
