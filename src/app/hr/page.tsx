import Link from 'next/link'
import { auth } from '@/lib/auth'
import { AdminConsole } from '@/components/AdminConsole'

export default async function HrPage() {
  const session = await auth()

  if (session?.user.role !== 'hr_admin') {
    return (
      <main className="flex flex-col items-center gap-2 py-16 text-center">
        <h1 className="text-xl font-semibold">Accès réservé aux RH</h1>
        <p className="text-sm text-gray-500 dark:text-gray-400">
          Cette page n&apos;est visible que par les utilisateurs de rôle hr_admin.
        </p>
      </main>
    )
  }

  return <>
    <p className="mb-4 text-right"><Link href="/hr/invitations" className="font-medium text-brand-600 hover:underline">Gérer les invitations</Link></p>
    <AdminConsole />
  </>
}
