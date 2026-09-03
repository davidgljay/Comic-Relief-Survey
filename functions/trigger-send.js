// POST /trigger-send?secret=...&event=...
// Called by an external cron job (owned by Comic Relief) at the planned post-event
// send time. Starts a Studio Flow execution for every consenting, not-yet-sent
// contact for the given event, then marks them sent so retries don't double-send.
const crypto = require('crypto');
const { callAppsScript } = require('./lib/apps-script-client.private.js');

exports.handler = async function (context, event, callback) {
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

  const client = context.getTwilioClient();
  const results = { started: 0, failed: [] };

  for (const row of pending) {
    const respondentId = crypto.randomUUID();
    try {
      await client.studio.v2
        .flows(context.STUDIO_FLOW_SID)
        .executions.create({
          to: row.values.phone,
          from: context.TWILIO_PHONE_NUMBER,
          parameters: JSON.stringify({
            phone: row.values.phone,
            name: row.values.name,
            event: eventName,
            respondent_id: respondentId,
          }),
        });
      await callAppsScript(context, 'upsert_contact', {
        phone: row.values.phone,
        respondent_id: respondentId,
        sent_at: new Date().toISOString(),
      });
      results.started += 1;
    } catch (err) {
      console.error(err);
      results.failed.push(row.values.phone);
    }
  }

  response.setStatusCode(200);
  response.setBody(results);
  return callback(null, response);
};
