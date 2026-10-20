import {
  isExplicitHumanSupportRequest,
  shouldEscalateUnresolvedIssue,
} from "./ai-support-escalation.ts";

Deno.test("routine account questions do not notify Admin", () => {
  const cases = [
    {
      message: "Mere latest deposit ka actual status, amount aur TXID batao. Agar tumhare paas ye information available nahi hai toh clearly batao.",
      answer: "Transaction History mein deposit entry aur TXID check karein.",
      degraded: false,
    },
    {
      message: "Mujhe 25 USDT withdraw karne hain. Withdrawal ka process, applicable fee, net amount aur approval steps samjhao. Exact fee verify na ho to guess mat karna.",
      answer: "Withdrawal secure Withdrawals workflow se submit hota hai. Fee aur net amount confirm karne se pehle review karein.",
      degraded: false,
    },
    {
      message: "Mere total referrals kitne hain aur meri referral earning kitni hai? Verified account data aur general guidance ko alag rakhna.",
      answer: "Aapke account snapshot mein 0 referrals aur 0 referral rewards dikh rahe hain.",
      degraded: false,
    },
    {
      message: "Mera KYC pending hai. Main verification status kaise check karun?",
      answer: "Profile section mein KYC status check karein. Delay ho to Help section se support tak pahunch sakte hain.",
      degraded: false,
    },
    {
      message: "If you don't have this information available, just explain where I can check it.",
      answer: "You can check the relevant account section for this information.",
      degraded: false,
    },
  ];
  for (const item of cases) {
    if (shouldEscalateUnresolvedIssue(item)) {
      throw new Error("Routine question incorrectly escalated: " + item.message);
    }
  }
});

Deno.test("an unresolved issue is escalated when AI cannot resolve it", () => {
  const escalates = shouldEscalateUnresolvedIssue({
    message: "My deposit has still not been credited after I checked the TXID. I tried again and the same problem remains.",
    answer: "I could not verify this transaction. Please contact support for a manual investigation.",
    degraded: false,
  });
  if (!escalates) throw new Error("Expected unresolved deposit issue to escalate.");
});

Deno.test("AI provider failure escalates a concrete customer issue", () => {
  const escalates = shouldEscalateUnresolvedIssue({
    message: "My withdrawal is stuck and the status is not updating.",
    answer: "I could not check the withdrawal status right now.",
    degraded: true,
  });
  if (!escalates) throw new Error("Expected degraded handling of a concrete issue to escalate.");
});

Deno.test("explicit representative requests escalate immediately", () => {
  const messages = [
    "Please connect me to a live representative.",
    "I want to speak to customer support.",
    "Mujhe representative se baat karwa dein.",
    "Please escalate this to the Master Admin.",
  ];
  for (const message of messages) {
    if (!isExplicitHumanSupportRequest(message)) {
      throw new Error("Expected explicit human-support request: " + message);
    }
    if (!shouldEscalateUnresolvedIssue({ message, answer: "I can help with that.", degraded: false })) {
      throw new Error("Explicit human-support request did not escalate: " + message);
    }
  }
});

Deno.test("generic negation alone is not a support escalation", () => {
  const messages = [
    "Agar exact fee available nahi hai to guess mat karna.",
    "Mere paas abhi TXID nahi hai; mujhe batao TXID kahan milta hai.",
    "I don't know the exact reward amount; explain where I can check it.",
  ];
  for (const message of messages) {
    if (isExplicitHumanSupportRequest(message)) {
      throw new Error("Generic negation was mistaken for a request for an agent: " + message);
    }
  }
});
