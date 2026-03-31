import { useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import { useAuthStore } from '@/store/auth.store'
import toast from 'react-hot-toast'
import type { AuthUser } from '@/types'
import { Loader2 } from 'lucide-react'

/**
 * SsoCallback
 *
 * After a successful SSO authentication the API redirects here with JWT tokens
 * and basic user info in the URL fragment (e.g. /sso-callback#accessToken=…).
 *
 * Using the fragment means tokens are never sent to any server and do not
 * appear in server access logs. The fragment is only readable by client-side
 * JavaScript.
 */
export default function SsoCallback() {
  const navigate = useNavigate()
  const setAuth = useAuthStore((s) => s.setAuth)

  useEffect(() => {
    // Parse the URL fragment (remove leading "#")
    const hash = window.location.hash.slice(1)
    const params = new URLSearchParams(hash)

    const accessToken = params.get('accessToken')
    const refreshToken = params.get('refreshToken')
    const userId = params.get('userId')
    const email = params.get('email')
    const firstName = params.get('firstName')
    const lastName = params.get('lastName')
    const role = params.get('role')
    const tenantId = params.get('tenantId')
    const subsidiaryId = params.get('subsidiaryId')
    const tenantName = params.get('tenantName')
    const tenantSlug = params.get('tenantSlug')

    if (!accessToken || !refreshToken || !userId || !email || !role) {
      toast.error('SSO login failed. Missing session data.')
      navigate('/login', { replace: true })
      return
    }

    const user: AuthUser = {
      id: userId,
      email,
      firstName: firstName || '',
      lastName: lastName || '',
      role: role as AuthUser['role'],
      tenantId: tenantId || null,
      subsidiaryId: subsidiaryId || null,
      tenant:
        tenantId && tenantName && tenantSlug
          ? { id: tenantId, name: tenantName, slug: tenantSlug }
          : null,
    }

    setAuth(user, accessToken, refreshToken)
    toast.success(`Welcome back, ${user.firstName || user.email}!`)
    navigate('/dashboard', { replace: true })
  }, [navigate, setAuth])

  return (
    <div className="min-h-screen flex items-center justify-center bg-gray-50">
      <div className="flex flex-col items-center gap-4 text-gray-500">
        <Loader2 className="w-8 h-8 animate-spin text-primary-600" />
        <p className="text-sm">Completing sign-in…</p>
      </div>
    </div>
  )
}
