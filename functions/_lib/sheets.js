// Private helper module (functions/_lib/) — the leading underscore keeps the
// Twilio Serverless Toolkit from deploying this as its own invokable route.
const { google } = require('googleapis');

function getAuth(context) {
  return new google.auth.JWT(
    context.GOOGLE_SERVICE_ACCOUNT_EMAIL,
    null,
    context.GOOGLE_PRIVATE_KEY.replace(/\\n/g, '\n'),
    ['https://www.googleapis.com/auth/spreadsheets']
  );
}

function getSheetsClient(context) {
  return google.sheets({ version: 'v4', auth: getAuth(context) });
}

const SHEET_NAME = 'Sheet1';

// Reads all rows of a sheet as objects keyed by the header row.
async function readRows(context, spreadsheetId) {
  const sheets = getSheetsClient(context);
  const res = await sheets.spreadsheets.values.get({
    spreadsheetId,
    range: `${SHEET_NAME}!A:Z`,
  });
  const [header, ...rows] = res.data.values || [[]];
  if (!header) return { header: [], rows: [] };
  return {
    header,
    rows: rows.map((row, i) => ({
      rowNumber: i + 2, // 1-indexed, +1 for header row
      values: header.reduce((obj, col, idx) => {
        obj[col] = row[idx] || '';
        return obj;
      }, {}),
    })),
  };
}

// Appends a single row, writing values in header-column order (missing columns left blank).
async function appendRow(context, spreadsheetId, header, rowObj) {
  const sheets = getSheetsClient(context);
  const values = [header.map((col) => rowObj[col] ?? '')];
  await sheets.spreadsheets.values.append({
    spreadsheetId,
    range: `${SHEET_NAME}!A:Z`,
    valueInputOption: 'USER_ENTERED',
    insertDataOption: 'INSERT_ROWS',
    requestBody: { values },
  });
}

// Overwrites specific cells in an existing row (1-indexed rowNumber, header defines columns).
async function updateRow(context, spreadsheetId, header, rowNumber, rowObj) {
  const sheets = getSheetsClient(context);
  // Write only the columns present in rowObj, as individual cell ranges, so
  // columns not included in rowObj keep their existing values untouched.
  const data = Object.keys(rowObj)
    .filter((col) => header.includes(col))
    .map((col) => {
      const colIndex = header.indexOf(col);
      const colLetter = columnToLetter(colIndex + 1);
      return {
        range: `${SHEET_NAME}!${colLetter}${rowNumber}`,
        values: [[rowObj[col]]],
      };
    });
  if (data.length === 0) return;
  await sheets.spreadsheets.values.batchUpdate({
    spreadsheetId,
    requestBody: { valueInputOption: 'USER_ENTERED', data },
  });
}

function columnToLetter(column) {
  let temp = '';
  let letter = '';
  while (column > 0) {
    temp = (column - 1) % 26;
    letter = String.fromCharCode(temp + 65) + letter;
    column = (column - temp - 2) / 26;
  }
  return letter;
}

// Finds a row by matching value in a given column; returns { rowNumber, values } or null.
async function findRowByColumn(context, spreadsheetId, columnName, value) {
  const { header, rows } = await readRows(context, spreadsheetId);
  const match = rows.find((r) => r.values[columnName] === value);
  return match ? { header, rowNumber: match.rowNumber, values: match.values } : { header, rowNumber: null, values: null };
}

// Upserts a row matched by key column: updates present columns if found, else appends a full row.
async function upsertRow(context, spreadsheetId, keyColumn, rowObj) {
  const { header, rowNumber } = await findRowByColumn(context, spreadsheetId, keyColumn, rowObj[keyColumn]);
  if (rowNumber) {
    await updateRow(context, spreadsheetId, header, rowNumber, rowObj);
  } else {
    await appendRow(context, spreadsheetId, header, rowObj);
  }
}

module.exports = {
  readRows,
  appendRow,
  updateRow,
  findRowByColumn,
  upsertRow,
};
