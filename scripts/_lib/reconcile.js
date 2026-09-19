// Rebuilds survey answers that never reached the Google Sheets. Every reply is
// also kept in its Studio execution's context, so a save that failed silently
// (a slow or erroring Apps Script call) can be recovered from Twilio and
// written again. All writes go through Apps Script's save_response, which is an
// upsert, so re-running is safe.
const ANSWER_KEYS = ['q1', 'q2', 'q3', 'q4', 'q5'];

const isBlank = (v) => v === undefined || v === null || String(v).trim() === '';
const digitsOf = (v) => String(v === undefined || v === null ? '' : v).replace(/\D/g, '');
const iso = (d) => new Date(d).toISOString();

// What a finished or in-progress execution knows, read the same way the flow
// itself reads it: flow.data for a REST-started (trigger-send) execution,
// widgets.Lookup_Contact for a text-in one.
function fromContext(execution, context) {
  const widgets = context.widgets || {};
  const flowData = (context.flow && context.flow.data) || {};
  const lookup = (widgets.Lookup_Contact && widgets.Lookup_Contact.parsed) || {};

  const answers = {};
  for (const key of ANSWER_KEYS) {
    const send = widgets[`${key.toUpperCase()}_Send`];
    const body = send && send.inbound && send.inbound.Body;
    if (!isBlank(body)) answers[key] = String(body);
  }

  return {
    executionSid: execution.sid,
    respondentId: flowData.respondent_id || lookup.respondent_id || '',
    phone:
      flowData.phone ||
      lookup.phone ||
      (context.contact && context.contact.channel && context.contact.channel.address) ||
      execution.contactChannelAddress ||
      '',
    event: flowData.event || lookup.event || '',
    answers,
    completed: Boolean(widgets.Closing_Save),
    lastActivity: execution.dateUpdated,
  };
}

// The Contacts row for a phone: the exact stored string if there is one,
// otherwise the same number in a different format (invisible characters, a
// missing country code, spaces...), compared on the last ten digits.
function findRow(rows, phone) {
  const exact = rows.find((r) => r.phone === phone);
  if (exact) return exact;
  const wanted = digitsOf(phone).slice(-10);
  if (wanted.length < 10) return undefined;
  return rows.find((r) => digitsOf(r.phone).slice(-10) === wanted);
}

// Decides what, if anything, to write for one execution, given the sheet's
// current row for that phone. Returns { skip: reason } or { params, ... }.
function planWrite(record, row, { all = false } = {}) {
  if (!record.respondentId) return { skip: 'no respondent_id (an execution from before the flow passed one)' };
  if (!record.phone) return { skip: 'no phone number' };
  if (Object.keys(record.answers).length === 0) return { skip: 'no answers yet' };

  // The row already belongs to a different survey send (a later one, since
  // newest executions are planned first). Writing this one would overwrite
  // its respondent_id, so leave it alone.
  if (row && !isBlank(row.respondent_id) && row.respondent_id !== record.respondentId) {
    return { skip: 'the contact row belongs to a newer send (different respondent_id)' };
  }

  const missing = [];
  const conflicts = [];
  for (const [key, value] of Object.entries(record.answers)) {
    const existing = row && row[key];
    if (isBlank(existing)) missing.push(key);
    else if (existing !== value) conflicts.push(key);
  }
  const needsCompleted = record.completed && (!row || isBlank(row.completed_at));

  if (!all && missing.length === 0 && !needsCompleted) {
    return { skip: conflicts.length > 0 ? 'answers differ from the sheet (left as is)' : 'already complete', conflicts };
  }

  // All of this execution's answers are sent (not just the missing ones),
  // because the anonymous sheet can't be read back to see what it lacks and
  // the write is an idempotent upsert. A value someone changed by hand in the
  // Contacts sheet is never overwritten.
  const params = {
    phone: row ? row.phone : record.phone,
    respondent_id: record.respondentId,
  };
  if (record.event) params.event = record.event;
  for (const [key, value] of Object.entries(record.answers)) {
    if (!conflicts.includes(key)) params[key] = value;
  }
  if (!row || isBlank(row.last_updated_at)) params.last_updated_at = iso(record.lastActivity);
  if (needsCompleted) params.completed_at = iso(record.lastActivity);

  return { params, missing, conflicts, completed: needsCompleted };
}

async function withRetries(fn, { attempts = 3, sleep = (ms) => new Promise((r) => setTimeout(r, ms)) } = {}) {
  let lastError;
  for (let i = 1; i <= attempts; i += 1) {
    try {
      // eslint-disable-next-line no-await-in-loop
      return await fn();
    } catch (err) {
      lastError = err;
      // eslint-disable-next-line no-await-in-loop
      if (i < attempts) await sleep(2000 * i);
    }
  }
  throw lastError;
}

async function reconcile({ client, flowSid, callAppsScript, appsScriptContext, since, apply = false, all = false, sleep, log = () => {} }) {
  const flow = client.studio.v2.flows(flowSid);
  const options = { limit: 1000 };
  if (since) options.dateCreatedFrom = new Date(since);

  const executions = await flow.executions.list(options); // newest first
  const { rows: sheetRows } = await withRetries(() => callAppsScript(appsScriptContext, 'list_rows', {}), { sleep });
  const rows = sheetRows.map((r) => ({ ...r.values }));

  const summary = { scanned: executions.length, written: [], skipped: [], conflicts: [], failed: [] };

  for (const execution of executions) {
    // eslint-disable-next-line no-await-in-loop
    const { context } = await flow.executions(execution.sid).executionContext().fetch();
    const record = fromContext(execution, context);
    const row = findRow(rows, record.phone);
    const plan = planWrite(record, row, { all });

    if (plan.skip) {
      summary.skipped.push({ executionSid: execution.sid, phone: record.phone, reason: plan.skip });
      continue;
    }
    if (plan.conflicts.length > 0) {
      summary.conflicts.push({ executionSid: execution.sid, phone: record.phone, questions: plan.conflicts });
    }

    // Keep the local copy of the sheet current, so a second execution for the
    // same contact is judged against what this run is about to write.
    if (row) Object.assign(row, plan.params);
    else rows.push({ ...plan.params });

    const entry = { executionSid: execution.sid, phone: record.phone, filled: plan.missing, completed: plan.completed };
    if (!apply) {
      summary.written.push(entry);
      continue;
    }
    try {
      // eslint-disable-next-line no-await-in-loop
      await withRetries(() => callAppsScript(appsScriptContext, 'save_response', plan.params), { sleep });
      summary.written.push(entry);
      log(`wrote ${entry.executionSid}`);
    } catch (err) {
      summary.failed.push({ ...entry, error: String((err && err.message) || err) });
    }
  }

  return summary;
}

module.exports = { fromContext, findRow, planWrite, reconcile, withRetries };
