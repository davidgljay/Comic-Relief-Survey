// POST /trigger-send?secret=...&event=...
// Called by an external cron job (owned by Comic Relief) at the planned post-event
// send time. Starts a Studio Flow execution for every consenting, not-yet-sent
// contact for the given event, then marks them sent so retries don't double-send.
const crypto = require('crypto');

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
      // Written *before* starting the execution, not after: the flow's
      // Lookup_Contact widget (see scripts/generate-studio-flow.js) reads
      // this contact's row right at the start of every execution, REST-
      // triggered ones included — {{trigger.parameters.*}} isn't reliable
      // here (see the `from` comment below), so this is the real source of
      // truth for respondent_id/event. Writing it first means Lookup_Contact
      // can never race ahead of it and read a stale/missing value.
      await callAppsScript(context, 'upsert_contact', {
        phone: row.values.phone,
        respondent_id: respondentId,
      });

      await client.studio.v2
        .flows(context.STUDIO_FLOW_SID)
        .executions.create({
          to: row.values.phone,
          // If the number is in a Messaging Service, its inbound routing is
          // delegated there (see attachFlowToMessagingService in
          // scripts/deploy.js), which scopes the reply to the Messaging
          // Service's own channel identity. Starting the execution with the
          // bare phone number as `from` instead anchors it to a *different*
          // channel identity, so Twilio can't correlate a reply back to this
          // execution and starts a brand-new one per reply instead of
          // continuing the conversation — confirmed live, twice now (this is
          // the fix that actually stops the repeat-Q1/duplicate-execution
          // bug). Confirmed separately live that this breaks
          // {{trigger.parameters.*}} from resolving in the started execution
          // — worked around above/below by having the flow read
          // respondent_id/event/phone back via Lookup_Contact instead of
          // trusting trigger.parameters, rather than by touching `from`.
          from: context.MESSAGING_SERVICE_SID || context.TWILIO_PHONE_NUMBER,
          parameters: JSON.stringify({
            phone: row.values.phone,
            name: row.values.name,
            event: eventName,
            respondent_id: respondentId,
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
    }
  }

  response.setStatusCode(200);
  response.setBody(results);
  return callback(null, response);
};
