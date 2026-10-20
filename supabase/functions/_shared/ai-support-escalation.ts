export type AiEscalationInput = {
  message: string;
  answer: string;
  degraded: boolean;
};

/** Only a deliberate request to talk to a human should escalate immediately. */
export function isExplicitHumanSupportRequest(message: string): boolean {
  const q = String(message || "").trim().toLowerCase();
  if (!q) return false;
  const directEnglish =
    /\b(?:talk|speak|chat|connect|contact|reach|transfer|escalate|call)\b.{0,55}\b(?:human|live agent|agent|representative|customer support|support team|master admin)\b/i;
  const requestEnglish =
    /\b(?:i need|i want|please get|please send|request)\b.{0,40}\b(?:a human|a live agent|an agent|a representative|customer support|support team|master admin)\b/i;
  const directRomanUrdu =
    /\b(?:representative|human agent|live agent|support team|master admin|admin)\b.{0,45}\b(?:se baat|se rabta|ko contact|ko notify|ko bata|chahiye|chahye|connect|call|bulwa|bhej|please|kindly)\b/i;
  const reverseRomanUrdu =
    /\b(?:mujhe|please|kindly)\b.{0,45}\b(?:representative|human agent|live agent|support team|master admin|admin)\b.{0,35}\b(?:se baat|se connect|se rabta|contact|chahiye|chahye|bhej|bulwa|notify)\b/i;
  return directEnglish.test(q) || requestEnglish.test(q) ||
    directRomanUrdu.test(q) || reverseRomanUrdu.test(q);
}

/**
 * Escalate only when there's evidence the client issue remains unresolved,
 * the AI cannot answer it, or the user explicitly asks for a human.
 * Generic negation ("available nahi", "I don't know") is deliberately not
 * an issue signal by itself.
 */
export function shouldEscalateUnresolvedIssue(input: AiEscalationInput): boolean {
  const q = String(input.message || "").trim().toLowerCase();
  const a = String(input.answer || "").trim().toLowerCase();
  if (!q) return false;
  if (isExplicitHumanSupportRequest(q)) return true;

  const concreteIssue =
    /\b(?:problem|issue|complaint|not working|doesn't work|does not work|can't login|cannot login|unable to login|failed|failure|stuck|missing|disappeared|error|bug|wrong amount|incorrect amount|pending too long|not showing|not appear|not received|not credited|not updated|not reflected|rejected|blocked|suspended|keeps failing|still failing|transaction failed|deposit failed|withdrawal failed|duplicate charge|unexpected debit|not processed|not completed)\b/i.test(q) ||
    /\b(?:masla|maslay|galat|galt|kaam nahi kar raha|kaam nahi kar rahi|show nahi ho raha|show nahi ho rahi|credit nahi hua|credit nahi hui|receive nahi hua|receive nahi hui|deposit nahi aya|deposit nahi aaya|payment nahi mili|transaction nahi hui|abhi tak nahi mila|pending hi hai)\b/i.test(q);

  const repeatedUnresolved =
    /\b(?:still|again|same problem|keeps failing|already tried|does not help|did not help|after checking|tried again|still not|still failing|already checked|phir bhi|abhi tak|dobara|pehle bhi|check kar liya|try kar liya|phir se)\b/i.test(q);

  const answerCannotResolve =
    /\b(?:please contact (?:the )?(?:support|support team|customer support)|contact support for (?:a )?(?:manual )?(?:review|investigation)|i (?:cannot|can't|could not|couldn't) (?:verify|confirm|resolve|check|access|find|determine)|unable to (?:verify|confirm|resolve|check|access|find|determine)|not able to (?:verify|confirm|resolve|check)|manual investigation is required|requires? (?:a )?(?:manual|human) review|needs? (?:a )?(?:manual|human) review|i do not have enough information to resolve|i don't have enough information to resolve|i cannot resolve this issue|i can't resolve this issue)\b/i.test(a);

  const accountSpecificQuestion =
    /\b(?:my|my account|mera|meri|mere|latest|actual|exact|txid|transaction|deposit|withdrawal|balance|kyc|referral|referrals|reward|fee|net amount|pending task|account status)\b/i.test(q);

  // A temporary provider failure alone is not enough for routine chat. But if
  // an account-specific question cannot be verified from the available data,
  // open a case so Admin can investigate instead of pretending it was resolved.
  return (concreteIssue && (input.degraded || answerCannotResolve || repeatedUnresolved)) ||
    (accountSpecificQuestion && answerCannotResolve);
}
