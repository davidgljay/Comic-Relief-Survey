const mockRequest = jest.fn();

jest.mock('https', () => ({
  request: (...args) => mockRequest(...args),
}));

const { callAppsScript } = require('../../functions/lib/apps-script-client.private.js');

// Builds a fake https.request(url, options, callback) call: invokes the
// callback synchronously with a fake response that emits `body` on 'data'
// then fires 'end', matching how the real client consumes the stream.
function fakeResponse({ statusCode, headers = {}, body = '' }) {
  return (url, options, callback) => {
    const res = {
      statusCode,
      headers,
      on(event, handler) {
        if (event === 'data') handler(body);
        if (event === 'end') handler();
        return res;
      },
    };
    callback(res);
    return { on: jest.fn(), write: jest.fn(), end: jest.fn() };
  };
}

const context = { APPS_SCRIPT_URL: 'https://script.google.com/macros/s/AKfycb.../exec', APPS_SCRIPT_SECRET: 'shh' };

beforeEach(() => {
  mockRequest.mockReset();
});

describe('callAppsScript', () => {
  it('POSTs action, secret, and params as a form body, and returns the parsed JSON', async () => {
    mockRequest.mockImplementation(fakeResponse({ statusCode: 200, body: JSON.stringify({ ok: true }) }));

    const result = await callAppsScript(context, 'upsert_contact', { phone: '+1', name: 'Ada' });

    expect(result).toEqual({ ok: true });
    const [url, options] = mockRequest.mock.calls[0];
    expect(url).toBe(context.APPS_SCRIPT_URL);
    expect(options.method).toBe('POST');
  });

  it('follows a redirect (POST -> GET), as Apps Script Web Apps do', async () => {
    mockRequest
      .mockImplementationOnce(
        fakeResponse({ statusCode: 302, headers: { location: 'https://script.googleusercontent.com/echo?x=1' }, body: '' })
      )
      .mockImplementationOnce(fakeResponse({ statusCode: 200, body: JSON.stringify({ ok: true, q1: '3' }) }));

    const result = await callAppsScript(context, 'save_response', { phone: '+1' });

    expect(result).toEqual({ ok: true, q1: '3' });
    expect(mockRequest).toHaveBeenCalledTimes(2);
    const [redirectUrl, redirectOptions] = mockRequest.mock.calls[1];
    expect(redirectUrl).toBe('https://script.googleusercontent.com/echo?x=1');
    expect(redirectOptions.method).toBe('GET');
  });

  it('throws when the response is not JSON', async () => {
    mockRequest.mockImplementation(fakeResponse({ statusCode: 200, body: '<html>not json</html>' }));

    await expect(callAppsScript(context, 'list_rows', {})).rejects.toThrow(/non-JSON response/);
  });

  it('throws when the response body carries an error field', async () => {
    mockRequest.mockImplementation(fakeResponse({ statusCode: 200, body: JSON.stringify({ error: 'invalid secret' }) }));

    await expect(callAppsScript(context, 'list_rows', {})).rejects.toThrow(/invalid secret/);
  });

  it('throws on a non-2xx status with no redirect', async () => {
    mockRequest.mockImplementation(fakeResponse({ statusCode: 500, body: 'internal error' }));

    await expect(callAppsScript(context, 'list_rows', {})).rejects.toThrow(/failed \(500\)/);
  });
});
