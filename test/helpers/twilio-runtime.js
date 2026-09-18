// Twilio Functions inject `Twilio` and `Runtime` as globals without requiring
// them. Handlers reference `Twilio.Response` and (to resolve private helper
// Functions — see functions/save-response.js) `Runtime.getFunctions()` as
// bare globals, so tests need the same globals defined before handlers load.
const path = require('path');

class FakeTwilioResponse {
  constructor() {
    this.statusCode = 200;
    this.headers = {};
    this.body = undefined;
  }

  appendHeader(key, value) {
    this.headers[key] = value;
  }

  setStatusCode(code) {
    this.statusCode = code;
  }

  setBody(body) {
    this.body = body;
  }
}

global.Twilio = { Response: FakeTwilioResponse };

// Mirrors what Twilio's real Runtime.getFunctions() returns for a private
// Function: a map from its path (relative to functions/, no .private, no
// .js) to { path: <absolute file path> }, suitable for require(...).
const PRIVATE_FUNCTIONS = {
  'lib/apps-script-client': path.join(__dirname, '..', '..', 'functions', 'lib', 'apps-script-client.private.js'),
};

global.Runtime = {
  getFunctions() {
    return Object.fromEntries(Object.entries(PRIVATE_FUNCTIONS).map(([key, filePath]) => [key, { path: filePath }]));
  },
};
