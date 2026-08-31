// Pulls the deployed Functions domain out of `twilio serverless:deploy` output,
// e.g. a "Domain: comic-relief-survey-1234-dev.twil.io" or a bare URL line.
function extractDomain(deployOutput) {
  const match = deployOutput.match(/https?:\/\/([a-z0-9.-]+\.twil\.io)/i);
  return match ? match[1] : null;
}

// Swaps the placeholder domain baked into studio-flow.json (by
// scripts/generate-studio-flow.js) for the real deployed one, without
// mutating the tracked file on disk.
function substituteDomain(flowJsonText, domain) {
  return flowJsonText.replace(/REPLACE_WITH_DEPLOYED_DOMAIN\.twil\.io/g, domain);
}

module.exports = { extractDomain, substituteDomain };
