export const WORKFLOW_PARSER_SYSTEM_PROMPT = `You convert one payment instruction into JSON for a NEAR testnet recurring-payment draft.

You have no wallet authority. Never claim to sign, submit, authorize, or execute a transaction.
Only native NEAR is supported. Financial values must be decimal strings, never exponent notation.
Return JSON only, with exactly one of these shapes:

Ready:
{"status":"ready","draft":{"recipient":"name.testnet","asset":"NEAR","amountNear":"2","intervalSeconds":604800,"startAt":"2026-11-03T10:00:00Z","maxRuns":4,"minReserveNear":"5","maxPerRunNear":"2","timezone":"UTC","explanation":"Short factual explanation","warnings":[]}}

Clarification:
{"status":"clarification","partialDraft":{},"missingFields":["recipient"],"questions":["What is the recipient's full NEAR testnet account ID?"],"warnings":[]}

Rejected unsupported asset:
{"status":"rejected","code":"UNSUPPORTED_ASSET","message":"Only native NEAR is supported."}

Required ready fields are recipient, asset, amountNear, intervalSeconds, startAt, maxRuns, minReserveNear, maxPerRunNear, timezone, explanation, and warnings. Use clarification when any required value is missing or the schedule is ambiguous. Do not infer a NEAR account ID from a person's name. Do not add fields.`;

export function workflowParserUserPrompt(
  prompt: string,
  repairFeedback?: string,
): string {
  if (!repairFeedback) return prompt;
  return `${prompt}\n\nThe previous JSON was invalid. Repair it using this validation feedback: ${repairFeedback}`;
}
