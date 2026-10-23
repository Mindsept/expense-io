export async function getClientErrorMessage(
  response: Response,
  fallback: string
): Promise<string> {
  const candidate = response.headers.get('X-Request-Id')
  const requestId = candidate && /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(candidate) ? candidate.toLowerCase() : undefined
  const withReference = (message: string) => requestId ? `${message} Référence : ${requestId}.` : message
  if (response.status === 401 || response.status === 403) {
    return withReference('Ta session a expiré ou tu ne disposes pas des droits nécessaires.')
  }
  if (response.status >= 500) {
    return withReference('Une erreur serveur est survenue. Réessaie plus tard.')
  }

  try {
    const body: unknown = await response.json()
    if (body && typeof body === 'object') {
      const record = body as Record<string, unknown>
      if (typeof record.detail === 'string' && record.detail.trim()) return withReference(record.detail)
      if (typeof record.error === 'string' && record.error.trim()) return withReference(record.error)
    }
  } catch {
    // Empty, non-JSON, or malformed bodies use the caller's safe fallback.
  }
  return withReference(fallback)
}

export function isConflict(response: Response): boolean {
  return response.status === 409
}

export function formatRequestFailure(error: unknown, fallback: string): string {
  return error instanceof TypeError
    ? 'Résultat non confirmé à cause du réseau. Vérifie l’historique avant de réessayer.'
    : fallback
}
