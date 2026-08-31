// Private helper module (functions/_lib/) — the leading underscore keeps the
// Twilio Serverless Toolkit from deploying this as its own invokable route.
//
// Talks to the Google Apps Script Web App (apps-script/Code.gs) that owns
// both Google Sheets. Using Apps Script instead of the Sheets REST API means
// no Google Cloud project, service account, or private key to create/store —
// auth is implicit in who deployed the script, gated further by a shared
// secret sent with every call.
const https = require('https');
const { URLSearchParams } = require('url');

function request(urlString, method) {
  return new Promise((resolve, reject) => {
    const req = https.request(urlString, { method }, (res) => {
      let data = '';
      res.on('data', (chunk) => {
        data += chunk;
      });
      res.on('end', () => resolve({ statusCode: res.statusCode, headers: res.headers, body: data }));
    });
    req.on('error', reject);
    req.end();
  });
}

function postForm(urlString, body) {
  return new Promise((resolve, reject) => {
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
        res.on('end', () => resolve({ statusCode: res.statusCode, headers: res.headers, body: data }));
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

  // Apps Script Web Apps route POST results through a redirect to a
  // content host — most HTTP clients don't follow redirects on POST
  // automatically, so this is followed explicitly (as a GET, per Apps
  // Script's own behavior: the redirect target already has the full result).
  if ([301, 302, 303].includes(response.statusCode) && response.headers.location) {
    response = await request(response.headers.location, 'GET');
  }

  if (response.statusCode < 200 || response.statusCode >= 300) {
    throw new Error(`Apps Script call failed (${response.statusCode}): ${response.body.slice(0, 200)}`);
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
