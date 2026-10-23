export interface SubmissionIntentPayload {
  amount: string
  expenseDate: string
  description: string
  receipt: File
}

export interface SubmissionIntent {
  key: string
  payload: SubmissionIntentPayload
}

export function createSubmissionIntent(payload: SubmissionIntentPayload): SubmissionIntent {
  return { key: crypto.randomUUID(), payload }
}

export function matchesSubmissionIntent(
  intent: SubmissionIntent,
  candidate: SubmissionIntentPayload,
): boolean {
  return intent.payload.amount === candidate.amount &&
    intent.payload.expenseDate === candidate.expenseDate &&
    intent.payload.description === candidate.description &&
    intent.payload.receipt === candidate.receipt
}
