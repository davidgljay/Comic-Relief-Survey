// Private helper module — the .private.js suffix is what actually keeps the
// Twilio Serverless Toolkit from deploying this as its own invokable public
// route (a leading underscore on the directory/file name, used here before,
// does nothing — this file was live at /lib/apps-script-client until fixed).
//
// Talks to the Google Apps Script Web App (apps-script/Code.gs) that owns
// both Google Sheets. Using Apps Script instead of the Sheets REST API means
// no Google Cloud project, service account, or private key to create/store —
// auth is implicit in who deployed the script, gated further by a shared
// secret sent with every call.
const https = require('https');
const { URLSearchParams } = require('url');

// DEBUG is opt-in (APPS_SCRIPT_DEBUG=1) so normal Twilio Function logs stay
// quiet, but easy to turn on locally: `APPS_SCRIPT_DEBUG=1 npm run deploy`.
const DEBUG = process.env.APPS_SCRIPT_DEBUG === '1';
function debugLog(...args) {
  if (DEBUG) console.error('[apps-script-client]', ...args);
}

function request(urlString, method) {
  return new Promise((resolve, reject) => {
    debugLog(method, urlString);
    const req = https.request(urlString, { method }, (res) => {
      let data = '';
      res.on('data', (chunk) => {
        data += chunk;
      });
      res.on('end', () => {
        debugLog('  ->', res.statusCode, res.headers.location ? `location: ${res.headers.location}` : '');
        resolve({ statusCode: res.statusCode, headers: res.headers, body: data });
      });
    });
    req.on('error', reject);
    req.end();
  });
}

function postForm(urlString, body) {
  return new Promise((resolve, reject) => {
    debugLog('POST', urlString);
    const req = https.request(
      urlString,
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded',
          'Content-Length': Buffer.byteLength(body),
        },
      },
      (res) => {
        let data = '';
        res.on('data', (chunk) => {
          data += chunk;
        });
        res.on('end', () => {
          debugLog('  ->', res.statusCode, res.headers.location ? `location: ${res.headers.location}` : '');
          resolve({ statusCode: res.statusCode, headers: res.headers, body: data });
        });
      }
    );
    req.on('error', reject);
    req.write(body);
    req.end();
  });
}

// Calls one action on the deployed Apps Script Web App. context needs
// APPS_SCRIPT_URL and APPS_SCRIPT_SECRET.
async function callAppsScript(context, action, params) {
  const body = new URLSearchParams({ ...params, action, secret: context.APPS_SCRIPT_SECRET }).toString();

  let response = await postForm(context.APPS_SCRIPT_URL, body);
  let step = 'POST ' + context.APPS_SCRIPT_URL;

  // Apps Script Web Apps route POST results through a redirect to a
  // content host — most HTTP clients don't follow redirects on POST
  // automatically, so this is followed explicitly (as a GET, per Apps
  // Script's own behavior: the redirect target already has the full result).
  if ([301, 302, 303].includes(response.statusCode) && response.headers.location) {
    step = 'GET (redirect) ' + response.headers.location;
    response = await request(response.headers.location, 'GET');
  }

  if (response.statusCode < 200 || response.statusCode >= 300) {
    throw new Error(
      `Apps Script call failed at ${step} -> ${response.statusCode}: ${response.body.slice(0, 200)}`
    );
  }

  let parsed;
  try {
    parsed = JSON.parse(response.body);
  } catch (err) {
    throw new Error(`Apps Script returned a non-JSON response: ${response.body.slice(0, 200)}`);
  }
  if (parsed.error) {
    throw new Error(`Apps Script error: ${parsed.error}`);
  }
  return parsed;
}

module.exports = { callAppsScript };
