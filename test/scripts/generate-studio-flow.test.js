const fs = require('fs');
const path = require('path');
const yaml = require('js-yaml');
const { execFileSync } = require('child_process');

const ROOT = path.join(__dirname, '..', '..');
const CONTENT_PATH = path.join(ROOT, 'survey-content.yaml');
const FLOW_PATH = path.join(ROOT, 'studio-flow.json');

// Regenerating is the one thing that actually proves the generator reads
// survey-content.yaml rather than a hardcoded copy: change the YAML, run the
// generator, and check the new wording shows up in the output — then put
// everything back so this test doesn't leave the tracked flow file dirty.
describe('scripts/generate-studio-flow.js', () => {
  const originalContent = fs.readFileSync(CONTENT_PATH, 'utf8');
  const originalFlow = fs.readFileSync(FLOW_PATH, 'utf8');

  afterEach(() => {
    fs.writeFileSync(CONTENT_PATH, originalContent);
    fs.writeFileSync(FLOW_PATH, originalFlow);
  });

  it('writes edited YAML question text into studio-flow.json', () => {
    const parsed = yaml.load(originalContent);
    const marker = `UNIQUE_MARKER_${Date.now()}`;
    parsed.questions.q1 = marker;
    fs.writeFileSync(CONTENT_PATH, yaml.dump(parsed));

    execFileSync('node', [path.join(ROOT, 'scripts', 'generate-studio-flow.js')], { cwd: ROOT });

    const flow = JSON.parse(fs.readFileSync(FLOW_PATH, 'utf8'));
    const q1Send = flow.states.find((s) => s.name === 'Q1_Send');
    expect(q1Send.properties.body).toContain(marker);
  });

  it('fails loudly when a required key is missing from the YAML', () => {
    const parsed = yaml.load(originalContent);
    delete parsed.closing_message;
    fs.writeFileSync(CONTENT_PATH, yaml.dump(parsed));

    expect(() =>
      execFileSync('node', [path.join(ROOT, 'scripts', 'generate-studio-flow.js')], {
        cwd: ROOT,
        stdio: 'pipe',
      })
    ).toThrow();
  });
});
