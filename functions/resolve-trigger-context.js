// POST /resolve-trigger-context
// Called by the Studio flow's Lookup_Contact widget, right after Trigger, on
// the text-in path only (a REST-started execution already has phone/name/
// event/respondent_id from trigger-send.js and skips this entirely).
//
// Resolves what to use for this conversation: if the phone already has a
// Contacts row (e.g. registered for a real event with consent, but texted in
// before ever being sent a survey), reuse its real event/name/respondent_id;
// otherwise this is a genuinely unknown number, tagged event="unknown".
exports.handler = async function (context, event, callback) {
  const { resolveContactContext } = require(Runtime.getFunctions()['lib/contact-context'].path);

  const response = new Twilio.Response();
  response.appendHeader('Content-Type', 'application/json');

  const { phone } = event;
  if (!phone) {
    response.setStatusCode(400);
    response.setBody({ error: 'phone is required' });
    return callback(null, response);
  }

  try {
    const { event: resolvedEvent, name, respondentId } = await resolveContactContext(context, phone);
    response.setStatusCode(200);
    response.setBody({ event: resolvedEvent, name, respondent_id: respondentId });
  } catch (err) {
    // Graceful degradation, matching the rest of this flow: never block the
    // conversation on this lookup failing. Same defaults resolveContactContext
    // would use for a genuinely unknown number.
    console.error(err);
    response.setStatusCode(200);
    response.setBody({ event: 'unknown', name: 'there', respondent_id: require('crypto').randomUUID() });
  }
  return callback(null, response);
};
