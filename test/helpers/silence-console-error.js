// A few tests deliberately trigger a handler's catch block (to assert it
// returns a 500), which logs via console.error — expected noise that can
// read as a real failure to someone unfamiliar with the code even though
// the test passes. Call this at the top of a describe block to mute it for
// that file only; assertions still fail normally if something's actually wrong.
function silenceConsoleError() {
  let spy;
  beforeEach(() => {
    spy = jest.spyOn(console, 'error').mockImplementation(() => {});
  });
  afterEach(() => {
    spy.mockRestore();
  });
}

module.exports = { silenceConsoleError };
