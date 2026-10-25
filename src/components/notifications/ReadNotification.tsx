'use client'
import { useActionState } from 'react'
import { markNotificationRead,type ReadNotificationState } from '@/app/actions/notifications'
export function ReadNotification({eventId,readAt,kind}:{eventId:string;readAt:string|null;kind:'decision'|'assignment'}){
  const[state,action,pending]=useActionState(markNotificationRead,{} as ReadNotificationState)
  return <form action={action} className="flex flex-col gap-1">
    <input type="hidden" name="eventId" value={eventId}/><input type="hidden" name="kind" value={kind}/>
    <button type="submit" disabled={pending||!!readAt||!!state.readAt} className="rounded-md border border-gray-300 px-3 py-1 text-sm disabled:opacity-60">{readAt||state.readAt?'Lue':pending?'Mise à jour…':'Marquer comme lue'}</button>
    {state.error&&<p role="alert" className="text-sm text-red-700">{state.error}</p>}
  </form>
}
