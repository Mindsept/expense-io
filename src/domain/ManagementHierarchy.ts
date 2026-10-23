import type { UserRole } from './User'

export type ManagementMember = Readonly<{ id: string; role: UserRole; managerId: string | null }>
export type ManagerAssignmentAssessment = 'allowed' | 'cycle' | 'invalid_chain'

/** The supplied members are the current company's graph, with canonical database IDs. */
export function assessManagerAssignment(
  targetId: string,
  managerId: string | null,
  members: readonly ManagementMember[],
): ManagerAssignmentAssessment {
  if (managerId === null) return 'allowed'
  const byId = new Map(members.map((member) => [member.id, member]))
  const visited = new Set<string>()
  let current: string | null = managerId
  while (current !== null) {
    if (current === targetId || visited.has(current)) return 'cycle'
    visited.add(current)
    const manager = byId.get(current)
    if (!manager || manager.role !== 'manager') return 'invalid_chain'
    current = manager.managerId
  }
  return 'allowed'
}
