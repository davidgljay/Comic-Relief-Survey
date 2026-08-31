const { extractDomain, substituteDomain } = require('../../scripts/_lib/flow-domain.js');

describe('extractDomain', () => {
  it('pulls the *.twil.io domain out of deploy output', () => {
    const output = [
      'Deploying...',
      'Functions:',
      '   https://comic-relief-survey-1234-dev.twil.io/contacts',
      '   https://comic-relief-survey-1234-dev.twil.io/save-response',
      'Deployment successful',
    ].join('\n');

    expect(extractDomain(output)).toBe('comic-relief-survey-1234-dev.twil.io');
  });

  it('returns null when no twil.io URL is present', () => {
    expect(extractDomain('nothing relevant here')).toBeNull();
  });
});

describe('substituteDomain', () => {
  it('replaces every placeholder occurrence with the real domain', () => {
    const flowJson = JSON.stringify({
      a: 'https://REPLACE_WITH_DEPLOYED_DOMAIN.twil.io/save-response',
      b: 'https://REPLACE_WITH_DEPLOYED_DOMAIN.twil.io/save-response',
    });

    const result = substituteDomain(flowJson, 'comic-relief-survey-1234-dev.twil.io');

    expect(result).not.toContain('REPLACE_WITH_DEPLOYED_DOMAIN');
    expect(JSON.parse(result).a).toBe('https://comic-relief-survey-1234-dev.twil.io/save-response');
    expect(JSON.parse(result).b).toBe('https://comic-relief-survey-1234-dev.twil.io/save-response');
  });
});
