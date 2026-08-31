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

function doPost(e) {
  try {
    const params = (e && e.parameter) || {};
    if (params.secret !== CONFIG.SHARED_SECRET) {
      return jsonResponse({ error: 'invalid secret' });
    }

    switch (params.action) {
      case 'list_rows':
        return jsonResponse(listRows_(getSheet_(CONFIG.CONTACTS_SHEET_ID)));
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
  return { header, rowNumber: match ? match.rowNumber : null };
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
      sheet.getRange(rowNumber, colIndex + 1).setValue(rowObj[col]);
    }
    return;
  }

  const newRow = header.map((col) => rowObj[col] ?? '');
  sheet.appendRow(newRow);
}

// Apps Script's runtime has no `module` global, so this is a no-op there —
// it only exists to let plain Node (Jest) require the pure helper functions
// above for testing, without needing to mock SpreadsheetApp/ContentService.
if (typeof module !== 'undefined' && module.exports) {
  module.exports = { paramsToRow_, rowsFromValues_ };
}
