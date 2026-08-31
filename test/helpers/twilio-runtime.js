// Twilio Functions inject a global `Twilio` object at runtime (Twilio.Response,
// Twilio.twiml, etc.) without requiring it. Handlers reference `Twilio.Response`
// as a bare global, so tests need the same global defined before handlers load.
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
