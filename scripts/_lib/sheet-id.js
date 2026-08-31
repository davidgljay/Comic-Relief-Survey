// Accepts either a full Google Sheets URL or a bare ID and returns the ID,
// so users can just paste whatever's in their browser's address bar.
function extractSheetId(input) {
  const trimmed = (input || '').trim();
  const match = trimmed.match(/\/spreadsheets\/d\/([a-zA-Z0-9-_]+)/);
  return match ? match[1] : trimmed;
}

module.exports = { extractSheetId };
