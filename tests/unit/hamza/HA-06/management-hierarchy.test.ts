import { describe, expect, it } from 'vitest'
import { assessManagerAssignment, type ManagementMember } from '@/domain/ManagementHierarchy'

const manager = (id: string, managerId: string | null = null): ManagementMember => ({ id, managerId, role: 'manager' })

describe('management cycle rules independent of HTTP and PostgreSQL', () => {
  it('allows an ordinary employee to join an acyclic manager chain', () => {
    expect(assessManagerAssignment('employee', 'A', [manager('A', 'B'), manager('B')])).toBe('allowed')
  })
  it('allows a manager to join an unrelated acyclic hierarchy', () => {
    expect(assessManagerAssignment('C', 'A', [manager('A', 'B'), manager('B'), manager('C')])).toBe('allowed')
  })
  it('rejects direct self-management', () => {
    expect(assessManagerAssignment('A', 'A', [manager('A')])).toBe('cycle')
  })
  it('rejects two-way management', () => {
    expect(assessManagerAssignment('B', 'A', [manager('A', 'B'), manager('B')])).toBe('cycle')
  })
  it('rejects an indirect cycle across three managers', () => {
    expect(assessManagerAssignment('C', 'A', [manager('A', 'B'), manager('B', 'C'), manager('C')])).toBe('cycle')
  })
  it('rejects attaching a new member to an existing cycle', () => {
    expect(assessManagerAssignment('D', 'A', [manager('A', 'B'), manager('B', 'A'), manager('D')])).toBe('cycle')
  })
  it('does not confuse a separate historical cycle with the selected chain', () => {
    expect(assessManagerAssignment('D', 'C', [manager('A', 'B'), manager('B', 'A'), manager('C'), manager('D')])).toBe('allowed')
  })
  it('allows explicit removal to repair a historical cycle', () => {
    expect(assessManagerAssignment('A', null, [manager('A', 'B'), manager('B', 'A')])).toBe('allowed')
  })
  it('rejects a chain leaving the supplied company graph', () => {
    expect(assessManagerAssignment('C', 'A', [manager('A', 'foreign'), manager('C')])).toBe('invalid_chain')
  })
  it('rejects an existing non-manager in the selected chain', () => {
    expect(assessManagerAssignment('C', 'A', [manager('A', 'employee'), { id: 'employee', managerId: null, role: 'employee' }])).toBe('invalid_chain')
  })
  it('handles a long hierarchy without recursion or modifying its input', () => {
    const graph = Array.from({ length: 5000 }, (_, index) => manager(String(index), index ? String(index - 1) : null))
    const original = JSON.stringify(graph)
    expect(assessManagerAssignment('new', '4999', graph)).toBe('allowed')
    expect(assessManagerAssignment('0', '4999', graph)).toBe('cycle')
    expect(JSON.stringify(graph)).toBe(original)
  })
})
