/**
 * Comic Relief SMS Survey — Google Sheets write endpoint.
 *
 * Deploy as a Web App (Deploy > New deployment > Web app; Execute as: Me;
 * Who has access: Anyone) and paste the resulting /exec URL, plus the
 * SHARED_SECRET below, into this project's .env as APPS_SCRIPT_URL /
 * APPS_SCRIPT_SECRET. See docs/twilio-setup.md for the full walkthrough.
 *
 * One deployment serves both sheets: this script only needs to be bound to
 * one of them (open that sheet's Extensions > Apps Script to paste this in);
 * the other is opened by ID via openById below.
 */

// ---- EDIT THESE THREE VALUES BEFORE DEPLOYING ----
const CONFIG = {
  SHARED_SECRET: 'REPLACE_WITH_A_LONG_RANDOM_STRING',
  CONTACTS_SHEET_ID: 'REPLACE_WITH_CONTACTS_SHEET_ID',
  ANONYMOUS_SHEET_ID: 'REPLACE_WITH_ANONYMOUS_SHEET_ID',
};
// ----------------------------------------------------

const TAB_NAME = 'Sheet1';

const CONTACTS_HEADER = [
  'phone', 'name', 'email', 'consent', 'event', 'registered_at',
  'sent_at', 'respondent_id', 'q1', 'q2', 'q3', 'q4', 'q5', 'last_updated_at', 'completed_at',
];
const ANONYMOUS_HEADER = [
  'respondent_id', 'event', 'q1', 'q2', 'q3', 'q4', 'q5', 'last_updated_at', 'completed_at',
];

function doPost(e) {
  try {
    const params = (e && e.parameter) || {};
    if (params.secret !== CONFIG.SHARED_SECRET) {
      return jsonResponse({ error: 'invalid secret' });
    }

    switch (params.action) {
      case 'init_headers':
        return jsonResponse(initHeadersAction_(params));
      case 'list_rows':
        return jsonResponse(listRows_(getSheet_(CONFIG.CONTACTS_SHEET_ID)));
      case 'get_contact':
        return jsonResponse(getContactAction_(params));
      case 'upsert_contact':
        upsertRow_(getSheet_(CONFIG.CONTACTS_SHEET_ID), 'phone', paramsToRow_(params));
        return jsonResponse({ ok: true });
      case 'save_response':
        upsertRow_(getSheet_(CONFIG.CONTACTS_SHEET_ID), 'phone', paramsToRow_(params));
        upsertRow_(getSheet_(CONFIG.ANONYMOUS_SHEET_ID), 'respondent_id', paramsToRow_(params, ['phone', 'name', 'email', 'consent', 'registered_at', 'sent_at']));
        return jsonResponse({ ok: true });
      default:
        return jsonResponse({ error: `unknown action "${params.action}"` });
    }
  } catch (err) {
    return jsonResponse({ error: String(err && err.message ? err.message : err) });
  }
}

// Looks up an existing Contacts row by phone, for callers that need to know
// whether a number is already known before deciding how to treat it (e.g.
// tagging a genuinely new number's event as "unknown" rather than whatever
// this call happens to be for). Read-only.
function getContactAction_(params) {
  const { values } = findRow_(getSheet_(CONFIG.CONTACTS_SHEET_ID), 'phone', params.phone);
  return values
    ? { found: true, event: values.event || '', name: values.name || '', respondent_id: values.respondent_id || '' }
    : { found: false };
}

// Writes the header row into both sheets if they're currently blank, and
// verifies the sheet IDs the caller thinks it's targeting actually match this
// deployment's CONFIG — deliberately does NOT accept caller-supplied sheet
// IDs to write to, so a leaked secret can only ever touch the two sheets this
// deployment was configured for, not an arbitrary sheet.
function initHeadersAction_(params) {
  if (params.contacts_sheet_id && params.contacts_sheet_id !== CONFIG.CONTACTS_SHEET_ID) {
    throw new Error('contacts_sheet_id does not match CONFIG.CONTACTS_SHEET_ID in this deployment — redeploy Code.gs after fixing CONFIG, or fix the ID you entered.');
  }
  if (params.anonymous_sheet_id && params.anonymous_sheet_id !== CONFIG.ANONYMOUS_SHEET_ID) {
    throw new Error('anonymous_sheet_id does not match CONFIG.ANONYMOUS_SHEET_ID in this deployment — redeploy Code.gs after fixing CONFIG, or fix the ID you entered.');
  }
  return {
    ok: true,
    contacts: initHeaders_(getSheet_(CONFIG.CONTACTS_SHEET_ID), CONTACTS_HEADER),
    anonymous: initHeaders_(getSheet_(CONFIG.ANONYMOUS_SHEET_ID), ANONYMOUS_HEADER),
  };
}

// Writes `header` into row 1 only if row 1 is currently blank; if row 1
// already holds the exact same header, it's a no-op; if it holds something
// else, refuses to touch it rather than risk destroying real data.
function initHeaders_(sheet, header) {
  const firstRow = sheet.getRange(1, 1, 1, header.length).getValues()[0];
  if (firstRow.every((cell) => cell === '')) {
    sheet.getRange(1, 1, 1, header.length).setValues([header]);
    return 'written';
  }
  if (header.every((col, i) => firstRow[i] === col)) {
    return 'already-present';
  }
  return 'skipped-existing-different-content';
}

function jsonResponse(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj)).setMimeType(ContentService.MimeType.JSON);
}

function getSheet_(sheetId) {
  return SpreadsheetApp.openById(sheetId).getSheetByName(TAB_NAME);
}

// Everything except the framing params (action/secret) becomes a row field,
// minus anything explicitly excluded (used to keep phone/name off the
// Anonymous sheet even if a caller sent them alongside a save_response call).
function paramsToRow_(params, exclude) {
  const skip = new Set(['action', 'secret', ...(exclude || [])]);
  const row = {};
  for (const key of Object.keys(params)) {
    if (!skip.has(key) && params[key] !== '') {
      row[key] = params[key];
    }
  }
  return row;
}

function listRows_(sheet) {
  return rowsFromValues_(sheet.getDataRange().getValues());
}

// Pure transform of a raw getValues() grid into {header, rows}, split out
// from listRows_ so it's testable under plain Node (see
// test/lib/apps-script-code.test.js) without mocking the Sheet API.
function rowsFromValues_(values) {
  const header = values[0] || [];
  const rows = values.slice(1).map((row, i) => ({
    rowNumber: i + 2,
    values: header.reduce((obj, col, idx) => {
      obj[col] = row[idx] === undefined || row[idx] === null ? '' : String(row[idx]);
      return obj;
    }, {}),
  }));
  return { header, rows };
}

function findRow_(sheet, keyColumn, keyValue) {
  const { header, rows } = listRows_(sheet);
  const match = rows.find((r) => r.values[keyColumn] === keyValue);
  return { header, rowNumber: match ? match.rowNumber : null, values: match ? match.values : null };
}

// Upserts by key column, writing only the columns present in rowObj so
// existing cells for other columns are left untouched (a partially-completed
// survey should only ever add answers, never blank out earlier ones).
function upsertRow_(sheet, keyColumn, rowObj) {
  if (!rowObj[keyColumn]) {
    throw new Error(`upsert requires "${keyColumn}"`);
  }
  const { header, rowNumber } = findRow_(sheet, keyColumn, rowObj[keyColumn]);

  if (rowNumber) {
    for (const col of Object.keys(rowObj)) {
      const colIndex = header.indexOf(col);
      if (colIndex === -1) continue;
      // setNumberFormat('@') first: without it, Sheets silently reinterprets
      // a numeric-looking string (a phone number's leading "+15551234567",
      // or even a hex respondent_id) as a number on write, which then reads
      // back different from the key we're matching on and breaks every
      // future upsert for that row.
      sheet.getRange(rowNumber, colIndex + 1).setNumberFormat('@').setValue(rowObj[col]);
    }
    SpreadsheetApp.flush();
    return;
  }

  const newRow = header.map((col) => rowObj[col] ?? '');
  const newRowNumber = sheet.getLastRow() + 1;
  sheet.getRange(newRowNumber, 1, 1, newRow.length).setNumberFormat('@').setValues([newRow]);
  // Without this, a write from one doPost execution isn't guaranteed visible
  // to findRow_'s read in the very next execution — back-to-back calls for
  // the same key (e.g. successive /simulate-response calls, or two replies
  // arriving close together) could each see "not found" and both append,
  // producing duplicate rows for what should be one upserted row.
  SpreadsheetApp.flush();
}

// Apps Script's runtime has no `module` global, so this is a no-op there —
// it only exists to let plain Node (Jest) require the pure helper functions
// above for testing, without needing to mock SpreadsheetApp/ContentService.
if (typeof module !== 'undefined' && module.exports) {
  module.exports = { paramsToRow_, rowsFromValues_, initHeaders_, findRow_, CONTACTS_HEADER, ANONYMOUS_HEADER };
}
