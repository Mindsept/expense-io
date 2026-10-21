'use server'
import { withCurrentActor } from '@/lib/current-actor'
import { markDecisionInboxRead,markAssignmentRead } from '@/lib/notifications/inbox'
export type ReadNotificationState={readAt?:string;error?:string}
export async function markNotificationRead(_previous:ReadNotificationState,form:FormData):Promise<ReadNotificationState>{
  void _previous
  const eventId=form.get('eventId')
  const kind=form.get('kind')
  if(typeof eventId!=='string'||(kind!=='decision'&&kind!=='assignment'))return{error:'Notification indisponible.'}
  try{
    const result=await withCurrentActor(undefined,(client,actor)=>kind==='decision'?markDecisionInboxRead(client,actor,eventId):markAssignmentRead(client,actor,eventId))
    return result?{readAt:result.readAt}:{error:'Cette notification n’est plus disponible avec vos droits actuels.'}
  }catch{return{error:'La notification ne peut pas être mise à jour. Réessayez plus tard.'}}
}
