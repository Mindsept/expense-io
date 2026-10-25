import Link from 'next/link'
import { redirect } from 'next/navigation'
import { auth } from '@/lib/auth'
import { withCurrentActor } from '@/lib/current-actor'
import { notificationInbox } from '@/lib/notifications/inbox'
import { ReadNotification } from '@/components/notifications/ReadNotification'
export default async function NotificationsPage(){
  if(!(await auth())?.user)redirect('/login')
  const inbox=await withCurrentActor(undefined,notificationInbox)
  return <main className="flex flex-col gap-5"><h1 className="text-2xl font-semibold">Notifications</h1>
    <p className="text-sm text-gray-500">Les 50 notifications les plus récentes accessibles avec vos droits actuels.</p>
    {!inbox.length&&<p>Aucune notification pour le moment.</p>}
    <ul className="flex flex-col gap-3">{inbox.map(item=><li key={`${item.kind}:${item.eventId}`} className="flex flex-wrap items-center justify-between gap-4 rounded-lg border border-gray-200 p-4 dark:border-gray-800"><div><p>{item.kind==='assignment'?(item.expenseStatus==='pending'?'Une note attend votre validation.':item.expenseStatus==='approved'?'Cette note a déjà été acceptée.':'Cette note a déjà été refusée.'):item.decision==='approved'?'Votre note a été acceptée.':'Votre note a été refusée.'}</p><p className="text-sm text-gray-500">{new Date(item.createdAt).toLocaleString('fr-FR',{timeZone:'Europe/Paris'})}</p><Link href={item.href} className="text-sm text-brand-600 hover:underline">{item.kind==='assignment'?'Voir la file de validation':'Voir mes notes'}</Link></div><ReadNotification eventId={item.eventId} readAt={item.readAt} kind={item.kind}/></li>)}</ul>
  </main>
}
