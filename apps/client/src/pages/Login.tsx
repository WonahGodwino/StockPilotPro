import { useState, useEffect, useRef } from 'react'
import { Link, useNavigate, useSearchParams } from 'react-router-dom'
import { useAuthStore } from '@/store/auth.store'
import api from '@/lib/api'
import toast from 'react-hot-toast'
import { Eye, EyeOff, Loader2 } from 'lucide-react'
import { trackEvent } from '@/lib/analytics'
import { useSeo } from '@/lib/seo'

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
  const [showNewResetPassword, setShowNewResetPassword] = useState(false)
  const [loading, setLoading] = useState(false)
  const [forgotSubmitting, setForgotSubmitting] = useState(false)
  const [resetSubmitting, setResetSubmitting] = useState(false)
  const [view, setView] = useState<'login' | 'forgot' | 'reset'>('login')
  const [forgotEmail, setForgotEmail] = useState('')
  const [resetForm, setResetForm] = useState({ email: '', otp: '', newPassword: '' })
  const hasTrackedLoginFormStart = useRef(false)

  const [ssoChecking, setSsoChecking] = useState(false)
  const [ssoInfo, setSsoInfo] = useState<{
    ssoEnabled: boolean
    providers: string[]
    tenantId: string | null
  } | null>(null)

  useSeo({
    title: 'Secure Sign In',
    description:
      'Sign in to StockPilot Pro to manage inventory, sales, and financial operations with role-based access and secure workflows.',
    path: '/login',
    keywords: 'stockpilot login, secure business login, inventory platform sign in',
    robots: 'noindex,nofollow',
  })

  const trackLoginFormStart = () => {
    if (hasTrackedLoginFormStart.current) return
    hasTrackedLoginFormStart.current = true
    trackEvent('login_form_started')
  }

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
      trackEvent('login_sso_error_received', { error_code: ssoError })
    }
  }, [searchParams])

  const handleEmailBlur = async () => {
    const email = form.email.trim()
    if (!email || !email.includes('@')) {
      setSsoInfo(null)
      return
    }
    setSsoChecking(true)
    trackEvent('login_sso_check_started')
    try {
      const { data } = await api.post('/auth/sso-check', { email })
      setSsoInfo(data)
      trackEvent('login_sso_check_completed', {
        sso_enabled: data.ssoEnabled,
        provider_count: data.providers?.length ?? 0,
      })
    } catch {
      setSsoInfo(null)
      trackEvent('login_sso_check_failed')
    } finally {
      setSsoChecking(false)
    }
  }

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!form.email || !form.password) return
    setLoading(true)
    trackEvent('login_submit_attempted')
    try {
      const { data } = await api.post('/auth/login', form)
      setAuth(data.user, data.accessToken, data.refreshToken)
      toast.success(`Welcome back, ${data.user.firstName}!`)
      trackEvent('login_submit_succeeded', { role: data.user.role })
      navigate('/dashboard')
    } catch (err: unknown) {
      const message = (err as { response?: { data?: { error?: string } } })?.response?.data?.error || 'Login failed'
      toast.error(message)
      trackEvent('login_submit_failed', { has_error_message: Boolean(message) })
    } finally {
      setLoading(false)
    }
  }

  const handleSsoLogin = (provider: string) => {
    if (!ssoInfo?.tenantId) return
    const apiBase = import.meta.env.VITE_API_URL || '/api'
    trackEvent('login_sso_provider_clicked', { provider })
    window.location.href = `${apiBase}/auth/sso/${provider}?tenantId=${encodeURIComponent(ssoInfo.tenantId)}`
  }

  const hasSsoProviders = ssoInfo?.ssoEnabled && (ssoInfo.providers?.length ?? 0) > 0

  const handleForgotSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!forgotEmail.trim()) return

    setForgotSubmitting(true)
    try {
      await api.post('/auth/forgot-password', { email: forgotEmail.trim() })
      toast.success('If your email is registered, an OTP has been sent.')
      setResetForm((prev) => ({ ...prev, email: forgotEmail.trim() }))
      setView('reset')
    } catch (err: unknown) {
      const message = (err as { response?: { data?: { error?: string } } })?.response?.data?.error || 'Unable to process request right now.'
      toast.error(message)
    } finally {
      setForgotSubmitting(false)
    }
  }

  const handleResetSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!resetForm.email || !resetForm.otp || !resetForm.newPassword) return

    setResetSubmitting(true)
    try {
      await api.post('/auth/reset-password', {
        email: resetForm.email.trim(),
        otp: resetForm.otp.trim(),
        newPassword: resetForm.newPassword,
      })
      toast.success('Password reset successful. Please sign in.')
      setView('login')
      setForm((prev) => ({ ...prev, email: resetForm.email.trim(), password: '' }))
      setResetForm((prev) => ({ ...prev, otp: '', newPassword: '' }))
      setShowNewResetPassword(false)
    } catch (err: unknown) {
      const message = (err as { response?: { data?: { error?: string } } })?.response?.data?.error || 'Failed to reset password.'
      toast.error(message)
    } finally {
      setResetSubmitting(false)
    }
  }

  return (
    <div className="min-h-screen bg-gradient-to-br from-gray-900 via-primary-900 to-gray-900 p-4">
      <div className="mx-auto grid w-full max-w-6xl gap-8 py-6 lg:min-h-screen lg:grid-cols-[1.08fr_0.92fr] lg:items-center">
        <section className="relative overflow-hidden rounded-3xl border border-white/15 bg-white/10 p-7 shadow-2xl backdrop-blur-sm sm:p-8 lg:p-10">
          <div className="pointer-events-none absolute -top-24 -left-10 h-44 w-44 rounded-full bg-primary-400/25 blur-2xl" />
          <div className="pointer-events-none absolute -right-14 bottom-0 h-48 w-48 rounded-full bg-cyan-300/20 blur-2xl" />
          <div className="pointer-events-none absolute top-8 right-8 h-20 w-20 rounded-full border border-cyan-200/25" />
          <div className="pointer-events-none absolute right-14 top-16 h-2 w-2 animate-pulse rounded-full bg-cyan-200/80" />
          <div className="pointer-events-none absolute right-20 top-24 h-1.5 w-1.5 animate-pulse rounded-full bg-primary-200/70" style={{ animationDelay: '250ms' }} />

          <Link
            to="/home"
            className="relative z-10 inline-flex items-center gap-2 rounded-lg border border-white/30 bg-white/10 px-3 py-1.5 text-xs font-semibold text-white transition hover:bg-white/20"
          >
            Home
          </Link>

          <div className="relative z-10 mt-8">
            <div className="flex h-16 w-16 items-center justify-center rounded-2xl bg-primary-500 text-2xl font-black text-white shadow-lg shadow-primary-500/35">
              SP
            </div>
            <h1 className="mt-6 text-3xl font-bold text-white sm:text-4xl">StockPilot Pro</h1>
            <p className="mt-3 text-base font-semibold leading-snug text-white sm:text-lg">
              AI-Powered Stock & Financial Management Platform
            </p>

            <div className="mt-7 max-w-xl rounded-2xl border border-white/15 bg-black/10 p-5 shadow-xl shadow-black/20 sm:p-6">
              <p className="text-[11px] font-bold uppercase tracking-[0.2em] text-cyan-200">Built to lead</p>
              <p className="mt-3 text-3xl font-black leading-tight text-white sm:text-4xl lg:text-5xl">
                Built for businesses of every size that need smarter decisions, faster.
              </p>
            </div>

            <p className="mt-5 max-w-lg text-sm leading-relaxed text-primary-100 sm:text-base">
              Track stock, sales, expenses, and financial signals in one place, with practical AI that helps teams move confidently every day.
            </p>

            <div className="mt-6 flex flex-wrap gap-2">
              <span className="rounded-full border border-cyan-200/30 bg-cyan-300/10 px-3 py-1 text-xs font-semibold text-cyan-100">Decision Intelligence</span>
              <span className="rounded-full border border-cyan-200/30 bg-cyan-300/10 px-3 py-1 text-xs font-semibold text-cyan-100">Multi-Branch Ready</span>
              <span className="rounded-full border border-cyan-200/30 bg-cyan-300/10 px-3 py-1 text-xs font-semibold text-cyan-100">Real-Time Visibility</span>
            </div>
          </div>
        </section>

        <section className="w-full lg:justify-self-end">
          <div className="mx-auto w-full max-w-md rounded-2xl bg-white p-8 shadow-2xl">
            <div className="mb-6 text-center">
              <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-xl bg-primary-600 text-lg font-black text-white shadow-lg">
                SP
              </div>
              <p className="mt-3 text-xl font-bold text-gray-900">StockPilot Pro</p>
            </div>

            <h2 className="mb-6 text-center text-xl font-semibold text-gray-900">
              {view === 'login' ? 'Sign in to your account' : view === 'forgot' ? 'Forgot password' : 'Reset password'}
            </h2>

          {view === 'login' && (
          <form onSubmit={handleSubmit} onFocusCapture={trackLoginFormStart} className="space-y-5">
            <div>
              <label className="mb-1.5 block text-center text-sm font-medium text-gray-700">Email address</label>
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

            <div className="text-right">
              <button
                type="button"
                className="text-xs font-medium text-indigo-600 hover:text-indigo-700"
                onClick={() => {
                  setForgotEmail(form.email)
                  setView('forgot')
                }}
              >
                Forgot password?
              </button>
            </div>

            <button type="submit" disabled={loading} className="btn-primary w-full py-2.5">
              {loading ? <Loader2 className="w-4 h-4 animate-spin" /> : null}
              {loading ? 'Signing in...' : 'Sign in'}
            </button>
          </form>
          )}

          {view === 'forgot' && (
            <form onSubmit={handleForgotSubmit} className="space-y-5">
              <div>
                <label className="mb-1.5 block text-sm font-medium text-gray-700">Registered email</label>
                <input
                  type="email"
                  className="input"
                  placeholder="you@company.com"
                  value={forgotEmail}
                  onChange={(e) => setForgotEmail(e.target.value)}
                  required
                  autoComplete="email"
                />
                <p className="mt-1 text-xs text-gray-500">If this email exists, a 6-digit OTP valid for 7 minutes will be sent.</p>
              </div>
              <button type="submit" disabled={forgotSubmitting} className="btn-primary w-full py-2.5">
                {forgotSubmitting ? <Loader2 className="w-4 h-4 animate-spin" /> : null}
                {forgotSubmitting ? 'Sending OTP...' : 'Send reset OTP'}
              </button>
              <button
                type="button"
                className="w-full text-sm font-medium text-gray-600 hover:text-gray-800"
                onClick={() => setView('login')}
              >
                Back to sign in
              </button>
            </form>
          )}

          {view === 'reset' && (
            <form onSubmit={handleResetSubmit} className="space-y-5">
              <div>
                <label className="mb-1.5 block text-sm font-medium text-gray-700">Registered email</label>
                <input
                  type="email"
                  className="input"
                  placeholder="you@company.com"
                  value={resetForm.email}
                  onChange={(e) => setResetForm({ ...resetForm, email: e.target.value })}
                  required
                  autoComplete="email"
                />
              </div>
              <div>
                <label className="mb-1.5 block text-sm font-medium text-gray-700">OTP code</label>
                <input
                  type="text"
                  className="input"
                  inputMode="numeric"
                  maxLength={6}
                  placeholder="Enter 6-digit OTP"
                  value={resetForm.otp}
                  onChange={(e) => setResetForm({ ...resetForm, otp: e.target.value.replace(/\D/g, '').slice(0, 6) })}
                  required
                />
              </div>
              <div>
                <label className="mb-1.5 block text-sm font-medium text-gray-700">New password</label>
                <div className="relative">
                  <input
                    type={showNewResetPassword ? 'text' : 'password'}
                    className="input pr-10"
                    placeholder="At least 8 characters"
                    value={resetForm.newPassword}
                    onChange={(e) => setResetForm({ ...resetForm, newPassword: e.target.value })}
                    required
                    minLength={8}
                    autoComplete="new-password"
                  />
                  <button
                    type="button"
                    onClick={() => setShowNewResetPassword(!showNewResetPassword)}
                    className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600"
                  >
                    {showNewResetPassword ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                  </button>
                </div>
              </div>
              <button type="submit" disabled={resetSubmitting} className="btn-primary w-full py-2.5">
                {resetSubmitting ? <Loader2 className="w-4 h-4 animate-spin" /> : null}
                {resetSubmitting ? 'Resetting password...' : 'Reset password'}
              </button>
              <div className="flex items-center justify-between gap-2">
                <button
                  type="button"
                  className="text-xs font-medium text-indigo-600 hover:text-indigo-700"
                  onClick={() => {
                    setForgotEmail(resetForm.email)
                    setView('forgot')
                  }}
                >
                  Resend OTP
                </button>
                <button
                  type="button"
                  className="text-xs font-medium text-gray-600 hover:text-gray-800"
                  onClick={() => setView('login')}
                >
                  Back to sign in
                </button>
              </div>
            </form>
          )}

          {view === 'login' && ssoChecking && (
            <div className="mt-5 pt-5 border-t border-gray-100 flex items-center justify-center gap-2 text-sm text-gray-400">
              <Loader2 className="w-4 h-4 animate-spin" />
              Checking SSO availability…
            </div>
          )}

          {view === 'login' && !ssoChecking && hasSsoProviders && (
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
              <div className="mt-3 rounded-lg border border-gray-200 bg-gray-50 px-3 py-2">
                <p className="text-[11px] font-semibold text-gray-700">SSO security notes</p>
                <ul className="mt-1 space-y-1 text-[11px] leading-relaxed text-gray-600">
                  <li>Only approved admin accounts can use SSO providers configured for your tenant.</li>
                  <li>Authentication happens on provider-owned pages. StockPilot never stores your provider password.</li>
                  <li>If SSO access is denied, contact your tenant admin to verify provider and role assignment.</li>
                </ul>
              </div>
            </div>
          )}

            <div className="mt-6 pt-6 border-t border-gray-100">
            <p className="text-xs text-gray-500 text-center font-medium">Test credentials are managed in the seed file.</p>
            <p className="text-xs text-gray-400 text-center mt-1">Use your provisioned account details to sign in.</p>
            <p className="text-xs text-gray-400 text-center mt-2">Business registration is handled internally by platform administrators.</p>
            </div>
          </div>

          <div className="mt-5 text-center text-xs text-gray-400 space-y-1">
            <p>StockPilot Pro • Secure Business Operations Platform</p>
            <p>Copyright {new Date().getFullYear()} StockPilot Pro. All rights reserved.</p>
          </div>
        </section>
      </div>
    </div>
  )
}
