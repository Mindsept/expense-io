export interface NotificationPort {
  // A future durable caller supplies its persisted event ID. This does not promise deduplication.
  notifyDecision(
    userId: string,
    noteId: string,
    decision: 'approved' | 'rejected',
    context?: Readonly<{ eventId: string }>,
  ): Promise<void>
}
