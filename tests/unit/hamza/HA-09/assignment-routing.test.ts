import { describe,expect,it } from 'vitest'
import { chooseAssignmentRecipients } from '@/lib/notifications/inbox'
describe('assignment recipient boundary',()=>{
  it('preserves the unique eligible manager',()=>{expect(chooseAssignmentRecipients(['manager'])).toEqual({recipients:['manager'],reason:null})})
  it('notifies all eligible HR without selecting a winner',()=>{expect(chooseAssignmentRecipients(['c','a','b'])).toEqual({recipients:['a','b','c'],reason:null})})
  it('keeps a note without an eligible validator pending',()=>{expect(chooseAssignmentRecipients([])).toEqual({recipients:[],reason:'no_active_validator'})})
  it('deduplicates and stabilizes the generation across candidate order',()=>{
    expect(chooseAssignmentRecipients(['b','a','b'])).toEqual(chooseAssignmentRecipients(['a','b']))
  })
})
