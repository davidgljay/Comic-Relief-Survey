// POST /trigger-send?secret=...&event=...[&limit=N]
// Called by an external cron job (owned by Comic Relief) at the planned post-event
// send time. Starts a Studio Flow execution for every consenting, not-yet-sent
// contact for the given event, then marks them sent so retries don't double-send.
//
// Twilio Functions are killed after 10 seconds, and each contact costs a few
// slow Apps Script round trips, so a big event can't be sent in one call.
// Pass `limit` to start at most that many contacts per call; the response's
// `remaining` is how many pending contacts were left untouched, so the cron
// job can simply call again until `remaining` is 0. Contacts that fail stay
// pending (no sent_at) but are not counted in `remaining`, so a failing
// contact can't keep the loop going forever.
const BATCH_SIZE = 10;
const crypto = require('crypto');

// What Twilio should be given as the recipient: "+" and digits only. A phone
// typed or pasted into the sheet by hand can carry invisible Unicode direction
// marks (copied from a contacts app), spaces or dashes, which Twilio rejects
// as an invalid number. The sheet's own string is still what the sheet writes
// key on, so the row is found again exactly as stored.
function toE164(phone) {
  return `+${String(phone).replace(/\D/g, '')}`;
}

exports.handler = async function (context, event, callback) {
  // Required inside the handler, not at module top level — see the comment
  // in functions/save-response.js for why a plain relative require breaks
  // once actually deployed (works fine locally, which is why this was easy
  // to miss until a real deploy hit it).
  const { callAppsScript } = require(Runtime.getFunctions()['lib/apps-script-client'].path);

  const response = new Twilio.Response();
  response.appendHeader('Content-Type', 'application/json');

  if (!event.secret || event.secret !== context.TRIGGER_SEND_SECRET) {
    response.setStatusCode(403);
    response.setBody({ error: 'invalid or missing secret' });
    return callback(null, response);
  }
  const eventName = event.event;
  if (!eventName) {
    response.setStatusCode(400);
    response.setBody({ error: 'event (name) is required' });
    return callback(null, response);
  }

  let limit = Infinity;
  if (event.limit !== undefined && event.limit !== '') {
    limit = Number(event.limit);
    if (!Number.isInteger(limit) || limit < 1) {
      response.setStatusCode(400);
      response.setBody({ error: 'limit must be a positive integer' });
      return callback(null, response);
    }
  }

  let rows;
  try {
    ({ rows } = await callAppsScript(context, 'list_rows', {}));
  } catch (err) {
    console.error(err);
    response.setStatusCode(500);
    response.setBody({ error: 'failed to read contacts sheet' });
    return callback(null, response);
  }

  const pending = rows.filter(
    (r) =>
      r.values.event === eventName &&
      r.values.consent === 'true' &&
      !r.values.sent_at
  );

  const batch = pending.slice(0, limit);
  const client = context.getTwilioClient();
  const results = { started: 0, failed: [], remaining: pending.length - batch.length };
  const errors = [];

  const startOne = async (row) => {
    try {
      await client.studio.v2
        .flows(context.STUDIO_FLOW_SID)
        .executions.create({
          to: toE164(row.values.phone),
          // If the number is in a Messaging Service, its inbound routing is
          // delegated there (see attachFlowToMessagingService in
          // scripts/deploy.js), which scopes the reply to the Messaging
          // Service's own channel identity. Starting the execution with the
          // bare phone number as `from` instead anchors it to a *different*
          // channel identity, so Twilio can't correlate a reply back to this
          // execution and starts a brand-new one per reply instead of
          // continuing the conversation — confirmed live, twice.
          from: context.MESSAGING_SERVICE_SID || context.TWILIO_PHONE_NUMBER,
          // Reaches the flow as {{flow.data.*}}, so the flow needs no lookup:
          // `phone` is the sheet's own string, which every save keys on.
          parameters: JSON.stringify({
            phone: row.values.phone,
            name: row.values.name,
            event: eventName,
            respondent_id: crypto.randomUUID(),
          }),
        });

      // sent_at is only written now, after the execution actually started —
      // if executions.create() above throws, this contact must NOT be marked
      // sent, so a retry still picks it up instead of silently skipping it.
      await callAppsScript(context, 'upsert_contact', {
        phone: row.values.phone,
        sent_at: new Date().toISOString(),
      });
      results.started += 1;
    } catch (err) {
      console.error(err);
      results.failed.push(row.values.phone);
      errors.push({ phone: row.values.phone, error: String((err && err.message) || err) });
    }
  };

  // Contacts are processed concurrently, in small batches: each contact costs
  // two Apps Script round trips plus a Studio call, and Twilio Functions are
  // killed after 10 seconds, so a sequential loop times out with only a
  // handful of contacts. Batches keep concurrent Apps Script executions
  // bounded (it caps simultaneous executions per script).
  for (let i = 0; i < batch.length; i += BATCH_SIZE) {
    // eslint-disable-next-line no-await-in-loop
    await Promise.all(batch.slice(i, i + BATCH_SIZE).map(startOne));
  }

  // Only present when something failed, so a failure is diagnosable from the
  // response itself (this endpoint is secret-gated) instead of needing logs.
  if (errors.length > 0) results.errors = errors;

  response.setStatusCode(200);
  response.setBody(results);
  return callback(null, response);
};
