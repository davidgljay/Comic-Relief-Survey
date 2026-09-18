// Private helper — see functions/lib/apps-script-client.private.js for the
// .private.js/Runtime.getFunctions() explanation.
//
// Mirrors the question order, the Q3->Q4 gate, and the message wording from
// scripts/generate-studio-flow.js / survey-content.yaml. Duplicated here
// (rather than read from studio-flow.json or survey-content.yaml, neither of
// which is deployed — only files under functions/ and assets/ are) so
// functions/simulate-response.js can answer "what gets sent next" with no
// extra deploy step. test/lib/flow-steps.test.js cross-checks both the
// topology and the wording against the real generated studio-flow.json, so
// a change to the survey that isn't reflected here fails a test instead of
// silently drifting.
const GATE_PATTERN = '^\\s*[12](\\D|$)';

const QUESTIONS = {
  1: "How likely are you to discuss the work being done by an organization present at this event with people in your life? Reply 1 for Very Likely .... 5 for Very Unlikely",
  2: "How likely are you to volunteer with or donate to an organization that was present at this event in the next three months? Reply 1 for Very Likely .... 5 for Very Unlikely",
  3: "How likely are you to have a followup conversation with someone that you met at this event? Reply 1 for Very Likely .... 5 for Very Unlikely",
  4: "How likely would you have been to meet or get to know this person if not for today's event? Reply 1 for Very Likely .... 5 for Very Unlikely",
  5: "When you tell others about this event, what moment are you most likely to share? (Feel free to describe it in your own words.)",
};

const CLOSING_MESSAGE = "That's it! Thanks so much for taking the time to complete this survey and for attending.";

// Given the question number just answered (1-5) and its reply text, returns
// the text of whatever the flow would actually send next (or CLOSING_MESSAGE
// if the survey is complete — there's no "end" sentinel, the closing message
// itself is the last thing sent).
function nextMessage(question, replyText) {
  if (question === 1) return QUESTIONS[2];
  if (question === 2) return QUESTIONS[3];
  if (question === 3) return new RegExp(GATE_PATTERN).test(replyText || '') ? QUESTIONS[4] : QUESTIONS[5];
  if (question === 4) return QUESTIONS[5];
  if (question === 5) return CLOSING_MESSAGE;
  throw new Error(`question must be an integer from 1 to 5, got ${question}`);
}

module.exports = { nextMessage, GATE_PATTERN, QUESTIONS, CLOSING_MESSAGE };
