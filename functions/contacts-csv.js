// POST /contacts-csv
// Bulk-adds consenting contacts from a CSV upload.
// Accepts either a multipart file field named "file", or a raw CSV string in
// a "csv" field. Required columns: phone, name, event, consent. Optional: email, registered_at.
const { parse } = require('csv-parse/sync');
const { callAppsScript } = require('./_lib/apps-script-client.js');

const E164 = /^\+[1-9]\d{1,14}$/;

exports.handler = async function (context, event, callback) {
  const response = new Twilio.Response();
  response.appendHeader('Content-Type', 'application/json');

  let csvText = event.csv;
  if (!csvText && event.file) {
    // Twilio Functions exposes multipart file uploads with a buffer/content field.
    csvText = Buffer.isBuffer(event.file) ? event.file.toString('utf8') : String(event.file);
  }

  if (!csvText) {
    response.setStatusCode(400);
    response.setBody({ error: 'provide CSV content in a "csv" field or as a "file" upload' });
    return callback(null, response);
  }

  let records;
  try {
    records = parse(csvText, { columns: true, skip_empty_lines: true, trim: true });
  } catch (err) {
    response.setStatusCode(400);
    response.setBody({ error: `could not parse CSV: ${err.message}` });
    return callback(null, response);
  }

  const results = { added: 0, skipped: [] };

  for (const [i, row] of records.entries()) {
    const phone = row.phone;
    const consentGiven = row.consent === 'true' || row.consent === '1' || row.consent === 'TRUE';
    if (!phone || !E164.test(phone) || !row.name || !row.event || !consentGiven) {
      results.skipped.push({ row: i + 2, reason: 'missing/invalid phone, name, event, or consent' });
      continue;
    }
    try {
      await callAppsScript(context, 'upsert_contact', {
        phone,
        name: row.name,
        email: row.email || '',
        consent: 'true',
        event: row.event,
        registered_at: row.registered_at || new Date().toISOString(),
      });
      results.added += 1;
    } catch (err) {
      console.error(err);
      results.skipped.push({ row: i + 2, reason: 'write failed' });
    }
  }

  response.setStatusCode(200);
  response.setBody(results);
  return callback(null, response);
};
