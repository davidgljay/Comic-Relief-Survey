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

// Mirrors what Twilio's real Runtime.getFunctions() returns: a map from a
// Function's path (relative to functions/, no .private, no .js) to
// { path: <absolute file path> }, suitable for require(...). Twilio's real
// implementation includes every deployed Function, public or private — see
// functions/simulate-response.js, which resolves the public save-response.js
// this same way to call it directly rather than over HTTP.
const FUNCTIONS = {
  'lib/apps-script-client': path.join(__dirname, '..', '..', 'functions', 'lib', 'apps-script-client.private.js'),
  'lib/contact-context': path.join(__dirname, '..', '..', 'functions', 'lib', 'contact-context.private.js'),
  'lib/phone': path.join(__dirname, '..', '..', 'functions', 'lib', 'phone.private.js'),
  'lib/flow-steps': path.join(__dirname, '..', '..', 'functions', 'lib', 'flow-steps.private.js'),
  'save-response': path.join(__dirname, '..', '..', 'functions', 'save-response.js'),
};

global.Runtime = {
  getFunctions() {
    return Object.fromEntries(Object.entries(FUNCTIONS).map(([key, filePath]) => [key, { path: filePath }]));
  },
};
