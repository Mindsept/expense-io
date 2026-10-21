import { describe,expect,it } from 'vitest'
import { chooseAssignmentRecipient } from '@/lib/notifications/inbox'
const company='aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',first='bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',second='cccccccc-cccc-4ccc-8ccc-cccccccccccc'
describe('assignment recipient boundary',()=>{
  it('notifies the unique eligible validator',()=>{expect(chooseAssignmentRecipient([first],company)).toEqual({recipient:first,reason:null})})
  it('does not invent a winner when multiple HR are eligible',()=>{expect(chooseAssignmentRecipient([first,second],company)).toEqual({recipient:null,reason:'multiple_hr_policy_pending'})})
  it('keeps a note without a validator traceable and pending',()=>{expect(chooseAssignmentRecipient([],company)).toEqual({recipient:null,reason:'no_active_validator'})})
  it('uses an explicitly configured recipient only while they are eligible',()=>{
    expect(chooseAssignmentRecipient([first,second],company,{[company]:second})).toEqual({recipient:second,reason:null})
    expect(chooseAssignmentRecipient([first,second],company,{[company]:'foreign'})).toEqual({recipient:null,reason:'multiple_hr_policy_pending'})
  })
})
