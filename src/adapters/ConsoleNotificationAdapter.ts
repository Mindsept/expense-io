import type { NotificationPort } from '@/ports/NotificationPort'

export class ConsoleNotificationAdapter implements NotificationPort {
  async notifyDecision(...[, , decision, context]: Parameters<NotificationPort['notifyDecision']>): Promise<void> {
    if (decision !== 'approved' && decision !== 'rejected') {
      throw new Error('Unsupported notification decision.')
    }
    const eventId = typeof context?.eventId === 'string' &&
      /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(context.eventId)
      ? context.eventId.toLowerCase() : undefined
    // Demonstration only: no recipient, note identifier, content, network send or delivery claim.
    console.log(JSON.stringify({ operation: 'notification.demo', decision, eventId, outcome: 'simulated' }))
  }
}
