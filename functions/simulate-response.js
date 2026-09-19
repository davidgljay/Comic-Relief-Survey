// POST /simulate-response?secret=...   TEST ONLY — see docs/twilio-setup.md.
//
// Simulates receiving a specific reply to a specific question from a
// specific phone number, WITHOUT a real SMS round trip, a live test number,
// or A2P 10DLC clearance. Saves the answer for real (the exact same
// save-response.js code path a live reply takes — same Sheets, same PII
// split), then responds with the next step's message as plain text.
//
// Body: { number: "+15551234567", question: 1, answer: "1 - loved it" }
// Response (plain text): the next question, or the closing message if
// question 5 was just answered.
//
// Gated by the same shared secret as /trigger-send (TRIGGER_SEND_SECRET) —
// this can write real rows into both Sheets, so it's not something to leave
// open to anyone who finds the URL.
exports.handler = async function (context, event, callback) {
  const { resolveContactContext } = require(Runtime.getFunctions()['lib/contact-context'].path);
  const { handler: saveResponseHandler } = require(Runtime.getFunctions()['save-response'].path);
  const { nextMessage } = require(Runtime.getFunctions()['lib/flow-steps'].path);
  const { normalizePhone } = require(Runtime.getFunctions()['lib/phone'].path);

  const response = new Twilio.Response();
  response.appendHeader('Content-Type', 'text/plain');

  if (!event.secret || event.secret !== context.TRIGGER_SEND_SECRET) {
    response.setStatusCode(403);
    response.setBody('invalid or missing secret');
    return callback(null, response);
  }

  const { answer } = event;
  const number = normalizePhone(event.number);
  const question = Number(event.question);

  if (!number) {
    response.setStatusCode(400);
    response.setBody('number is required and must be a valid phone number, e.g. (555) 123-4567 or +15551234567');
    return callback(null, response);
  }
  if (!Number.isInteger(question) || question < 1 || question > 5) {
    response.setStatusCode(400);
    response.setBody('question is required and must be an integer from 1 to 5');
    return callback(null, response);
  }
  if (!answer) {
    response.setStatusCode(400);
    response.setBody('answer is required');
    return callback(null, response);
  }

  const contact = await resolveContactContext(context, number);

  const saveParams = {
    respondent_id: contact.respondentId,
    phone: contact.phone,
    event: contact.event,
    [`q${question}`]: answer,
  };
  if (question === 5) saveParams.completed = 'true';

  const saveResult = await new Promise((resolve, reject) => {
    saveResponseHandler(context, saveParams, (err, res) => (err ? reject(err) : resolve(res)));
  });

  if (saveResult.statusCode >= 400) {
    response.setStatusCode(500);
    response.setBody(`failed to save the simulated answer: ${JSON.stringify(saveResult.body)}`);
    return callback(null, response);
  }

  response.setStatusCode(200);
  response.setBody(nextMessage(question, answer));
  return callback(null, response);
};
