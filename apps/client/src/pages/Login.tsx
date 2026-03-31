import { useState, useEffect } from 'react'
import { useNavigate, useSearchParams } from 'react-router-dom'
import { useAuthStore } from '@/store/auth.store'
import api from '@/lib/api'
import toast from 'react-hot-toast'
import { Eye, EyeOff, Loader2 } from 'lucide-react'

function GoogleIcon() {
  return (
    <svg className="w-5 h-5" viewBox="0 0 24 24" aria-hidden="true">
      <path d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z" fill="#4285F4" />
      <path d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z" fill="#34A853" />
      <path d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z" fill="#FBBC05" />
      <path d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z" fill="#EA4335" />
    </svg>
  )
}

function MicrosoftIcon() {
  return (
    <svg className="w-5 h-5" viewBox="0 0 24 24" aria-hidden="true">
      <path d="M11.4 2H2v9.4h9.4V2z" fill="#F25022" />
      <path d="M22 2h-9.4v9.4H22V2z" fill="#7FBA00" />
      <path d="M11.4 12.6H2V22h9.4v-9.4z" fill="#00A4EF" />
      <path d="M22 12.6h-9.4V22H22v-9.4z" fill="#FFB900" />
    </svg>
  )
}

const SSO_PROVIDER_META: Record<string, { label: string; icon: React.ReactNode }> = {
  google: { label: 'Continue with Google', icon: <GoogleIcon /> },
  microsoft: { label: 'Continue with Microsoft', icon: <MicrosoftIcon /> },
}

export default function Login() {
  const navigate = useNavigate()
  const [searchParams] = useSearchParams()
  const setAuth = useAuthStore((s) => s.setAuth)

  const [form, setForm] = useState({ email: '', password: '' })
  const [showPassword, setShowPassword] = useState(false)
  const [loading, setLoading] = useState(false)

  const [ssoChecking, setSsoChecking] = useState(false)
  const [ssoInfo, setSsoInfo] = useState<{
    ssoEnabled: boolean
    providers: string[]
    tenantId: string | null
  } | null>(null)

  useEffect(() => {
    const ssoError = searchParams.get('sso_error')
    if (ssoError) {
      const messages: Record<string, string> = {
        unsupported_provider: 'Unsupported SSO provider.',
        missing_tenant: 'Tenant information is missing.',
        tenant_not_found: 'Tenant not found or inactive.',
        sso_disabled: 'SSO is not enabled for this account.',
        provider_not_enabled: 'This SSO provider is not enabled for your organisation.',
        user_not_found: 'No account found for this SSO identity.',
        role_not_permitted: 'SSO login is only available for admin accounts.',
        subscription_expired: 'Subscription expired. Contact your administrator.',
        server_error: 'An error occurred during SSO login. Please try again.',
        missing_params: 'Invalid SSO response.',
        invalid_state: 'Invalid SSO state. Please try again.',
      }
      toast.error(messages[ssoError] || `SSO error: ${ssoError}`)
    }
  }, [searchParams])

  const handleEmailBlur = async () => {
    const email = form.email.trim()
    if (!email || !email.includes('@')) {
      setSsoInfo(null)
      return
    }
    setSsoChecking(true)
    try {
      const { data } = await api.post('/auth/sso-check', { email })
      setSsoInfo(data)
    } catch {
      setSsoInfo(null)
    } finally {
      setSsoChecking(false)
    }
  }

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!form.email || !form.password) return
    setLoading(true)
    try {
      const { data } = await api.post('/auth/login', form)
      setAuth(data.user, data.accessToken, data.refreshToken)
      toast.success(`Welcome back, ${data.user.firstName}!`)
      navigate('/dashboard')
    } catch (err: unknown) {
      const message = (err as { response?: { data?: { error?: string } } })?.response?.data?.error || 'Login failed'
      toast.error(message)
    } finally {
      setLoading(false)
    }
  }

  const handleSsoLogin = (provider: string) => {
    if (!ssoInfo?.tenantId) return
    const apiBase = import.meta.env.VITE_API_URL || '/api'
    window.location.href = `${apiBase}/auth/sso/${provider}?tenantId=${encodeURIComponent(ssoInfo.tenantId)}`
  }

  const hasSsoProviders = ssoInfo?.ssoEnabled && (ssoInfo.providers?.length ?? 0) > 0

  return (
    <div className="min-h-screen bg-gradient-to-br from-gray-900 via-primary-900 to-gray-900 flex items-center justify-center p-4">
      <div className="w-full max-w-md">
        <div className="text-center mb-8">
          <div className="w-16 h-16 bg-primary-600 rounded-2xl flex items-center justify-center text-white font-bold text-2xl mx-auto mb-4 shadow-lg">
            SP
          </div>
          <h1 className="text-3xl font-bold text-white">StockPilot Pro</h1>
          <p className="text-gray-400 mt-2 text-sm">Enterprise Stock & Financial Management</p>
        </div>

        <div className="bg-white rounded-2xl shadow-2xl p-8">
          <h2 className="text-xl font-semibold text-gray-900 mb-6">Sign in to your account</h2>

          <form onSubmit={handleSubmit} className="space-y-5">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1.5">Email address</label>
              <input
                type="email"
                className="input"
                placeholder="you@company.com"
                value={form.email}
                onChange={(e) => { setForm({ ...form, email: e.target.value }); setSsoInfo(null) }}
                onBlur={handleEmailBlur}
                required
                autoComplete="email"
              />
            </div>

            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1.5">Password</label>
              <div className="relative">
                <input
                  type={showPassword ? 'text' : 'password'}
                  className="input pr-10"
                  placeholder="••••••••"
                  value={form.password}
                  onChange={(e) => setForm({ ...form, password: e.target.value })}
                  required
                  autoComplete="current-password"
                />
                <button
                  type="button"
                  onClick={() => setShowPassword(!showPassword)}
                  className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600"
                >
                  {showPassword ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                </button>
              </div>
            </div>

            <button type="submit" disabled={loading} className="btn-primary w-full py-2.5">
              {loading ? <Loader2 className="w-4 h-4 animate-spin" /> : null}
              {loading ? 'Signing in...' : 'Sign in'}
            </button>
          </form>

          {ssoChecking && (
            <div className="mt-5 pt-5 border-t border-gray-100 flex items-center justify-center gap-2 text-sm text-gray-400">
              <Loader2 className="w-4 h-4 animate-spin" />
              Checking SSO availability…
            </div>
          )}

          {!ssoChecking && hasSsoProviders && (
            <div className="mt-5 pt-5 border-t border-gray-100">
              <p className="text-xs text-gray-500 text-center mb-3">Or sign in with your organisation account</p>
              <div className="space-y-2">
                {ssoInfo!.providers.map((provider) => {
                  const meta = SSO_PROVIDER_META[provider]
                  if (!meta) return null
                  return (
                    <button
                      key={provider}
                      type="button"
                      onClick={() => handleSsoLogin(provider)}
                      className="w-full flex items-center justify-center gap-3 px-4 py-2.5 rounded-lg border border-gray-200 bg-white hover:bg-gray-50 text-sm font-medium text-gray-700 transition-colors"
                    >
                      {meta.icon}
                      {meta.label}
                    </button>
                  )
                })}
              </div>
            </div>
          )}

          <div className="mt-6 pt-6 border-t border-gray-100">
            <p className="text-xs text-gray-500 text-center font-medium">Test credentials are managed in the seed file.</p>
            <p className="text-xs text-gray-400 text-center mt-1">Use your provisioned account details to sign in.</p>
          </div>
        </div>

        <div className="mt-5 text-center text-xs text-gray-400 space-y-1">
          <p>StockPilot Pro • Secure Business Operations Platform</p>
          <p>Copyright {new Date().getFullYear()} StockPilot Pro. All rights reserved.</p>
        </div>
      </div>
    </div>
  )
}
