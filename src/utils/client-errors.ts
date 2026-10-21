export async function getClientErrorMessage(
  response: Response,
  fallback: string
): Promise<string> {
  if (response.status === 401 || response.status === 403) {
    return 'Ta session a expiré ou tu ne disposes pas des droits nécessaires.'
  }
  if (response.status >= 500) {
    return 'Une erreur serveur est survenue. Réessaie plus tard.'
  }

  try {
    const body: unknown = await response.json()
    if (body && typeof body === 'object') {
      const record = body as Record<string, unknown>
      if (typeof record.detail === 'string' && record.detail.trim()) return record.detail
      if (typeof record.error === 'string' && record.error.trim()) return record.error
    }
  } catch {
    // Empty, non-JSON, or malformed bodies use the caller's safe fallback.
  }
  return fallback
}

export function isConflict(response: Response): boolean {
  return response.status === 409
}

export function formatRequestFailure(error: unknown, fallback: string): string {
  return error instanceof TypeError
    ? 'Résultat non confirmé à cause du réseau. Vérifie l’historique avant de réessayer.'
    : fallback
}
