'use server'

import { AuthError } from 'next-auth'
import { getPool } from '@/lib/db'
import { redeemInvitation, EnrollmentError } from '@/lib/enrollment/invitations'
import { signIn, signOut } from '@/lib/auth'

export interface AuthFormState {
  error?: string
  accountCreated?: boolean
}

/** Company, role and email come from the locked invitation, never a form. */
export async function signup(
  _prevState: AuthFormState,
  formData: FormData
): Promise<AuthFormState> {
  void _prevState
  const token = formData.get('invitation')
  const emailProof = formData.get('emailProof')
  const name = formData.get('name')
  const password = formData.get('password')
  if (typeof token !== 'string' || typeof emailProof !== 'string' ||
      typeof name !== 'string' || typeof password !== 'string') {
    return { error: "L'inscription nécessite une invitation et la vérification de votre adresse email. Utilisez le lien reçu ; si vous avez déjà un compte, connectez-vous." }
  }
  let email: string
  try {
    const created = await redeemInvitation(getPool(), { token, emailProof, name, password })
    email = created.email
  } catch (error) {
    if (error instanceof EnrollmentError) {
      if (error.code === 'account_exists') return { error: 'Un compte existe déjà. Connectez-vous ; aucune affiliation n’a été modifiée.' }
      if (error.code === 'invalid_input') return { error: 'Nom requis, mot de passe de 8 caractères minimum et de 72 octets maximum.' }
      if (error.code === 'invitation_unavailable') return { error: 'Invitation invalide, expirée, révoquée ou déjà utilisée.' }
    }
    return { error: 'Inscription non confirmée. Essayez de vous connecter avant de recommencer.' }
  }
  try {
    await signIn('credentials', { email, password, redirectTo: '/expenses' })
  } catch (error) {
    if (error instanceof AuthError) return { accountCreated: true, error: 'Compte créé, mais la connexion automatique a échoué. Connectez-vous ; ne recréez pas le compte.' }
    // Auth.js redirects are expected control flow and must reach Next unchanged.
    throw error
  }
  return { accountCreated: true }
}

export async function login(
  _prevState: AuthFormState,
  formData: FormData
): Promise<AuthFormState> {
  const email = formData.get('email')
  const password = formData.get('password')

  if (typeof email !== 'string' || typeof password !== 'string') {
    return { error: 'Champs invalides.' }
  }

  try {
    await signIn('credentials', { email, password, redirectTo: '/expenses' })
  } catch (error) {
    if (error instanceof AuthError) {
      return { error: 'Email ou mot de passe incorrect.' }
    }
    throw error
  }
  return {}
}

export async function logout(): Promise<void> {
  await signOut({ redirectTo: '/login' })
}
