const path = require('path');
const { execFileSync } = require('child_process');

const ROOT = path.join(__dirname, '..', '..');
const SCRIPT = path.join(ROOT, 'scripts', 'simulate-survey.js');

function run(replies, extraArgs = []) {
  return execFileSync('node', [SCRIPT, ...extraArgs, '--replies', replies], { cwd: ROOT, encoding: 'utf8' });
}

function sheetJson(output, heading) {
  const start = output.indexOf(heading) + heading.length;
  const jsonText = output.slice(start).split(/=== Would write/)[0].trim();
  return JSON.parse(jsonText);
}

describe('scripts/simulate-survey.js', () => {
  it('asks Q4 and saves it when Q3 is answered "1"', () => {
    const output = run('3,4,1,2,It was great meeting new people');

    expect(output).toContain('How likely would you have been to meet or get to know this person');

    const [contactsRow] = sheetJson(output, '=== Would write to the Contacts & Results sheet ===');
    expect(contactsRow).toMatchObject({ q1: '3', q2: '4', q3: '1', q4: '2', q5: 'It was great meeting new people' });

    const [anonRow] = sheetJson(output, '=== Would write to the Anonymous Results sheet (no PII) ===');
    expect(anonRow).not.toHaveProperty('phone');
    expect(anonRow).toMatchObject({ q3: '1', q4: '2' });
  });

  it('skips Q4 and always asks Q5 when Q3 is not "1" or "2"', () => {
    const output = run('2,1,3,Nice event overall');

    expect(output).not.toContain('How likely would you have been to meet or get to know this person');
    expect(output).toContain('what moment are you most likely to share');

    const [contactsRow] = sheetJson(output, '=== Would write to the Contacts & Results sheet ===');
    expect(contactsRow).not.toHaveProperty('q4');
    expect(contactsRow.q5).toBe('Nice event overall');
  });

  it('still asks Q4 when Q3 leads with "1" but includes extra text', () => {
    const output = run("3,4,1 - Here's a description of why,2,Loved it");

    const [contactsRow] = sheetJson(output, '=== Would write to the Contacts & Results sheet ===');
    expect(contactsRow.q3).toBe("1 - Here's a description of why");
    expect(contactsRow.q4).toBe('2');
  });

  it('never writes phone/name/email/consent to the Anonymous Results sheet', () => {
    const output = run('3,4,1,2,Loved it');

    const [anonRow] = sheetJson(output, '=== Would write to the Anonymous Results sheet (no PII) ===');
    expect(anonRow).not.toHaveProperty('phone');
    expect(anonRow).not.toHaveProperty('name');
    expect(anonRow).not.toHaveProperty('email');
    expect(anonRow).not.toHaveProperty('consent');
  });

  it('errors clearly when it runs out of scripted replies', () => {
    expect(() => run('3')).toThrow();
  });

  describe('--from-trigger-send', () => {
    const output = () => run('3,4,1,2,Loved it', ['--from-trigger-send', '--event', 'Gala']);

    it('starts the execution from the Messaging Service, as production does', () => {
      expect(output()).toMatch(/started an execution: to \+15550001234, from MG/);
    });

    it('greets the contact by name and saves under their real event, despite empty trigger.parameters', () => {
      const out = output();
      expect(out).toContain('Hi Ada!');

      const [contactsRow] = sheetJson(out, '=== Would write to the Contacts & Results sheet ===');
      expect(contactsRow).toMatchObject({ phone: '+15550001234', event: 'Gala', q1: '3', q5: 'Loved it' });
      expect(contactsRow.sent_at).toEqual(expect.any(String));
    });

    it('writes the same respondent_id to both sheets, and none of it is blank', () => {
      const out = output();
      const [contactsRow] = sheetJson(out, '=== Would write to the Contacts & Results sheet ===');
      const [anonRow] = sheetJson(out, '=== Would write to the Anonymous Results sheet (no PII) ===');

      expect(contactsRow.respondent_id).toBeTruthy();
      expect(anonRow.respondent_id).toBe(contactsRow.respondent_id);
      expect(anonRow).not.toHaveProperty('phone');
    });
  });
});
