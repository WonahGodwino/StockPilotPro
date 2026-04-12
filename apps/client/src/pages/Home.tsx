import { useEffect, useRef, useState } from 'react'
import { Link } from 'react-router-dom'
import api from '@/lib/api'
import toast from 'react-hot-toast'
import type { TrustedCustomer } from '@/types'
import { trackEvent } from '@/lib/analytics'
import { useSeo } from '@/lib/seo'
import { isOnlineNow, readSuperadminCache, writeSuperadminCache } from '@/lib/superadminCache'
import {
  ArrowRight,
  BarChart3,
  BrainCircuit,
  Building2,
  CheckCircle2,
  CircleDollarSign,
  Headset,
  Layers3,
  MessageSquareText,
  WifiOff,
  RefreshCw,
  Database,
  ShieldCheck,
  Sparkles,
  Users,
  Loader2,
  Home as HomeIcon,
  ChevronLeft,
  ChevronRight,
  ChevronUp,
} from 'lucide-react'

type PackageCard = {
  name: string
  price: string
  cycle: string
  bestFor: string
  blurb: string
  benefits: string[]
  cta: string
  featured?: boolean
}

const packages: PackageCard[] = [
  {
    name: 'Starter',
    price: '$99.99',
    cycle: '/month',
    bestFor: 'Single-site operators launching strong controls',
    blurb: 'For focused teams starting with one core business unit.',
    benefits: [
      'Single business setup',
      '1 business admin seat',
      '1 salesperson seat',
      'Core inventory and sales tracking',
      'Basic reports and expense logging',
      'Offline mode with auto sync on reconnect',
    ],
    cta: 'Request Starter',
  },
  {
    name: 'Growth',
    price: '$249.99',
    cycle: '/month',
    bestFor: 'Multi-branch teams scaling operations',
    blurb: 'For expanding operations with multiple branches and teams.',
    benefits: [
      'Multi-branch operations',
      'Expanded role seats and controls',
      'Advanced reporting and exports',
      'Subscription and transaction workflows',
      'Improved operational visibility',
      'Offline mode with background sync support',
    ],
    cta: 'Request Growth',
  },
  {
    name: 'Enterprise AI Package',
    price: '$599.99',
    cycle: '/month',
    bestFor: 'Established organizations needing AI-led optimization',
    blurb: 'For high-scale organizations using AI to drive strategic performance.',
    benefits: [
      'Unlimited branches',
      'Unlimited salesperson seats',
      'AI demand forecasting and reorder advisory',
      'AI cash-flow and anomaly intelligence',
      'AI branch performance insights and Enterprise Assistant',
      'Offline-first operations with automatic sync recovery',
      'Priority onboarding and support',
    ],
    cta: 'Contact Sales',
    featured: true,
  },
]

const aiBenefits = [
  {
    title: 'Smarter Inventory Decisions',
    text: 'Predict product movement, reduce stockouts, and avoid overstock before costs pile up.',
    icon: BrainCircuit,
  },
  {
    title: 'Branch Performance Clarity',
    text: 'Compare branches instantly and focus managers on the highest-impact actions first.',
    icon: Building2,
  },
  {
    title: 'Financial Risk Awareness',
    text: 'Catch expense spikes, suspicious transactions, and margin leaks earlier with AI alerts.',
    icon: ShieldCheck,
  },
  {
    title: 'Faster Leadership Answers',
    text: 'Ask business questions in plain language and receive practical, traceable recommendations.',
    icon: MessageSquareText,
  },
]

const reliabilityBenefits = [
  {
    title: 'Offline Mode That Keeps Work Moving',
    text: 'Sales and expenses continue to queue locally when internet is unstable so your team never pauses operations.',
    icon: WifiOff,
  },
  {
    title: 'Automatic Sync On Reconnect',
    text: 'Queued records sync automatically when network returns, with real-time queue and sync status visibility.',
    icon: RefreshCw,
  },
  {
    title: 'Safe Local Queue and Sync History',
    text: 'Pending records and sync runs are tracked to reduce duplicate risk and improve operational confidence.',
    icon: Database,
  },
]

const testimonials = [
  {
    quote:
      'StockPilot Pro gave us one clear view of stock, sales, and branch performance. Decision cycles that took days now happen in the same morning.',
    name: 'Angela M.',
    role: 'Operations Director',
    company: 'Northfield Retail Group',
  },
  {
    quote:
      'Offline sales continuity and automatic sync removed our biggest daily risk. Teams keep working, and finance trusts the numbers at close.',
    name: 'Daniel K.',
    role: 'Head of Finance',
    company: 'Bluecrest Distribution',
  },
  {
    quote:
      'The AI recommendations helped our managers reorder with confidence and reduce avoidable stockouts across multiple branches.',
    name: 'Grace T.',
    role: 'General Manager',
    company: 'Summit Pharmacy Network',
  },
]

const trustBadges = [
  {
    title: 'Protected Access',
    text: 'Role-based permissions and tenant controls keep operational data visible only to the right teams.',
    icon: ShieldCheck,
  },
  {
    title: 'Reliable Data Sync',
    text: 'Offline queue and reconnect syncing protect transaction continuity in low-connectivity environments.',
    icon: Database,
  },
  {
    title: 'Responsive Support',
    text: 'Dedicated onboarding and support guidance for rollout, branch setup, and adoption success.',
    icon: Headset,
  },
]

const onboardingSteps = [
  {
    title: 'Business Discovery',
    text: 'We review your branch structure, reporting goals, and user roles to match the right package.',
  },
  {
    title: 'Guided Setup',
    text: 'Our team helps configure products, permissions, and workflows so operations launch cleanly.',
  },
  {
    title: 'Go Live and Optimize',
    text: 'Teams onboard with practical support while leadership tracks adoption and early performance gains.',
  },
]

const faqs = [
  {
    question: 'Can StockPilot Pro work if internet is unstable?',
    answer:
      'Yes. Teams can continue recording sales and expenses offline. Data syncs automatically once the connection returns.',
  },
  {
    question: 'Which businesses is StockPilot Pro best for?',
    answer:
      'It is built for both established organizations and growing businesses, whether operating a single location or multiple branches, that need stronger inventory, sales, and financial control.',
  },
  {
    question: 'How long does onboarding usually take?',
    answer:
      'Most teams can start core operations quickly after setup planning, with rollout pace based on branch count and data readiness.',
  },
  {
    question: 'Does the platform include AI features in all packages?',
    answer:
      'Core operational intelligence is available across plans, while advanced AI capabilities scale further in higher packages.',
  },
]

const packageComparisonRows = [
  {
    feature: 'Branch coverage',
    starter: 'Single location',
    growth: 'Multiple branches',
    enterprise: 'Unlimited branches',
  },
  {
    feature: 'User access model',
    starter: 'Core admin + sales seats',
    growth: 'Expanded role controls',
    enterprise: 'Unlimited salesperson seats',
  },
  {
    feature: 'Reporting depth',
    starter: 'Essential operational reporting',
    growth: 'Advanced reports and exports',
    enterprise: 'Strategic AI performance insights',
  },
  {
    feature: 'AI intelligence level',
    starter: 'Operational guidance',
    growth: 'Broader performance visibility',
    enterprise: 'Forecasting, anomalies, Enterprise Assistant insights',
  },
  {
    feature: 'Support and onboarding',
    starter: 'Standard onboarding support',
    growth: 'Guided rollout support',
    enterprise: 'Priority onboarding and support',
  },
]

const TRUSTED_CUSTOMERS_VISIBLE_COUNT = 4
const TRUSTED_CUSTOMERS_ROTATION_MS = 4000
const HOME_TRUSTED_CUSTOMERS_CACHE_KEY = 'stockpilot:public:trusted-customers'

export default function Home() {
  const apiBase = import.meta.env.VITE_API_URL || '/api'
  const apiOrigin = apiBase.startsWith('http') ? new URL(apiBase).origin : window.location.origin

  const toPublicMediaUrl = (value?: string | null) => {
    if (!value) return ''
    if (/^https?:\/\//i.test(value) || value.startsWith('blob:') || value.startsWith('data:')) return value
    if (value.startsWith('/uploads/')) return `${apiOrigin}${value}`
    return value
  }

  const [name, setName] = useState('')
  const [email, setEmail] = useState('')
  const [company, setCompany] = useState('')
  const [requestedPackage, setRequestedPackage] = useState('General Inquiry')
  const [message, setMessage] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const hasTrackedContactFormStart = useRef(false)
  const [trustedCustomers, setTrustedCustomers] = useState<Array<Pick<TrustedCustomer, 'id' | 'name' | 'logoUrl' | 'websiteUrl'>>>([])
  const [trustedCustomerStartIndex, setTrustedCustomerStartIndex] = useState(0)
  const [trustedCustomersPaused, setTrustedCustomersPaused] = useState(false)

  useSeo({
    title: 'AI-Powered Inventory, Sales and Financial Control',
    description:
      'StockPilot Pro helps established and growing businesses manage inventory, sales, expenses, and multi-branch operations with practical AI insights.',
    path: '/home',
    keywords:
      'inventory management software, stock and sales tracking, business financial control, AI business operations, multi-branch management platform',
    image: '/favicon.svg',
  })

  const trackContactFormStart = () => {
    if (hasTrackedContactFormStart.current) return
    hasTrackedContactFormStart.current = true
    trackEvent('home_contact_form_started', { section: 'contact' })
  }

  useEffect(() => {
    let cancelled = false

    const loadTrustedCustomers = async () => {
      const setFromCache = () => {
        const cached = readSuperadminCache<{ items: Array<Pick<TrustedCustomer, 'id' | 'name' | 'logoUrl' | 'websiteUrl'>> }>(HOME_TRUSTED_CUSTOMERS_CACHE_KEY)
        if (!cancelled) {
          setTrustedCustomers(cached?.items || [])
        }
      }

      try {
        if (!isOnlineNow()) {
          setFromCache()
          return
        }

        const res = await api.get<{ data: Array<Pick<TrustedCustomer, 'id' | 'name' | 'logoUrl' | 'websiteUrl'>> }>('/public/trusted-customers')
        if (cancelled) return
        const items = res.data.data || []
        setTrustedCustomers(items)
        writeSuperadminCache(HOME_TRUSTED_CUSTOMERS_CACHE_KEY, {
          items,
          cachedAt: new Date().toISOString(),
        })
      } catch {
        setFromCache()
      }
    }

    void loadTrustedCustomers()

    return () => {
      cancelled = true
    }
  }, [])

  const trustedCustomersToRender = trustedCustomers
  const canRotateTrustedCustomers = trustedCustomersToRender.length > TRUSTED_CUSTOMERS_VISIBLE_COUNT

  const goToNextTrustedCustomers = () => {
    if (!canRotateTrustedCustomers) return
    setTrustedCustomerStartIndex((prev) => (prev + 1) % trustedCustomersToRender.length)
    trackEvent('home_trusted_customers_nav_clicked', { direction: 'next' })
  }

  const goToPreviousTrustedCustomers = () => {
    if (!canRotateTrustedCustomers) return
    setTrustedCustomerStartIndex((prev) => (prev - 1 + trustedCustomersToRender.length) % trustedCustomersToRender.length)
    trackEvent('home_trusted_customers_nav_clicked', { direction: 'previous' })
  }

  const goToTrustedCustomerIndex = (index: number) => {
    if (!canRotateTrustedCustomers) return
    setTrustedCustomerStartIndex(index)
    trackEvent('home_trusted_customers_dot_clicked', { index })
  }

  useEffect(() => {
    if (!canRotateTrustedCustomers) {
      setTrustedCustomerStartIndex(0)
      return
    }

    if (trustedCustomersPaused) return

    const intervalId = window.setInterval(() => {
      setTrustedCustomerStartIndex((prev) => (prev + 1) % trustedCustomersToRender.length)
    }, TRUSTED_CUSTOMERS_ROTATION_MS)

    return () => {
      window.clearInterval(intervalId)
    }
  }, [canRotateTrustedCustomers, trustedCustomersPaused, trustedCustomersToRender.length])

  const visibleTrustedCustomers = (() => {
    if (trustedCustomersToRender.length <= TRUSTED_CUSTOMERS_VISIBLE_COUNT) return trustedCustomersToRender

    const visible: Array<Pick<TrustedCustomer, 'id' | 'name' | 'logoUrl' | 'websiteUrl'>> = []
    for (let i = 0; i < TRUSTED_CUSTOMERS_VISIBLE_COUNT; i += 1) {
      const idx = (trustedCustomerStartIndex + i) % trustedCustomersToRender.length
      visible.push(trustedCustomersToRender[idx])
    }
    return visible
  })()

  const openDirectEmailFallback = () => {
    const subject = `[StockPilot Pro Inquiry] ${requestedPackage} - ${company || 'Company'}`
    const body = [
      `Name: ${name}`,
      `Email: ${email}`,
      `Company: ${company}`,
      `Requested Package: ${requestedPackage}`,
      '',
      'Message:',
      message,
    ].join('\n')

    const mailto = `mailto:contact@stockpilot.pro?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(body)}`
    trackEvent('home_contact_mailto_fallback_opened', {
      requested_package: requestedPackage,
      company_provided: Boolean(company),
    })
    window.location.href = mailto
  }

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setSubmitting(true)
    trackEvent('home_contact_submit_attempted', {
      requested_package: requestedPackage,
    })
    try {
      await api.post('/public/contact', {
        name,
        email,
        company,
        requestedPackage,
        message,
      })

      toast.success('Request sent successfully. Our team will contact you shortly.')
      trackEvent('home_contact_submit_succeeded', {
        requested_package: requestedPackage,
      })
      setName('')
      setEmail('')
      setCompany('')
      setRequestedPackage('General Inquiry')
      setMessage('')
    } catch (err: unknown) {
      const msg = (err as { response?: { data?: { error?: string } } })?.response?.data?.error
      trackEvent('home_contact_submit_failed', {
        requested_package: requestedPackage,
        has_error_message: Boolean(msg),
      })
      if (msg?.includes('Contact channel is not configured yet')) {
        toast('Opening your email app to send this enquiry directly.')
        openDirectEmailFallback()
      } else {
        toast.error(msg || 'Unable to submit request right now. Please try again.')
      }
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <div
      id="home-top"
      className="min-h-screen bg-[#0A1122] text-slate-100"
      style={{ fontFamily: 'Poppins, Manrope, Segoe UI, sans-serif' }}
    >
      <div className="relative overflow-hidden">
        <div className="pointer-events-none absolute -top-40 -left-32 h-[28rem] w-[28rem] rounded-full bg-cyan-500/20 blur-3xl" />
        <div className="pointer-events-none absolute top-0 right-0 h-[24rem] w-[24rem] rounded-full bg-amber-400/15 blur-3xl" />

        <header className="mx-auto flex w-full max-w-7xl items-center justify-between px-6 py-6 lg:px-10">
          <div className="flex items-center gap-3">
            <div className="flex h-12 w-12 items-center justify-center rounded-xl bg-cyan-500 text-xl font-black text-white shadow-lg shadow-cyan-500/30">
              SP
            </div>
            <div>
              <p className="text-xl font-black uppercase tracking-[0.14em] text-white sm:text-2xl">StockPilot Pro</p>
              <p className="text-sm font-extrabold uppercase tracking-[0.12em] text-cyan-200 sm:text-base">AI-Powered Operations Platform</p>
            </div>
          </div>

          <div className="flex items-center gap-3">
            <a href="#home-top" className="hidden text-sm text-slate-200 hover:text-white sm:block">
              Home
            </a>
            <a href="#packages" className="hidden text-sm text-slate-200 hover:text-white sm:block">
              Packages
            </a>
            <a href="#contact" className="hidden text-sm text-slate-200 hover:text-white sm:block">
              Contact
            </a>
            <Link
              to="/login"
              onClick={() => trackEvent('home_nav_login_clicked', { placement: 'header' })}
              className="rounded-lg bg-white/10 px-4 py-2 text-sm font-semibold text-white ring-1 ring-white/30 transition hover:bg-white/20"
            >
              Login
            </Link>
          </div>
        </header>

        <section className="mx-auto grid w-full max-w-7xl gap-10 px-6 pb-16 pt-8 lg:grid-cols-[1.2fr_1fr] lg:items-center lg:px-10 lg:pb-24 lg:pt-12">
          <div>
            <div className="mb-4 inline-flex items-center gap-2 rounded-full border border-cyan-300/40 bg-cyan-400/10 px-4 py-1.5 text-xs font-semibold uppercase tracking-widest text-cyan-200">
              Built for serious operators
            </div>
            <p className="mb-3 text-lg font-black uppercase tracking-[0.12em] text-cyan-200 sm:text-xl">
              StockPilot Pro • AI-Powered Operations Platform
            </p>
            <h1 className="text-4xl font-extrabold leading-tight text-white md:text-5xl lg:text-6xl">
              Run inventory, sales, expenses, and growth from one intelligent platform.
            </h1>
            <p className="mt-5 max-w-2xl text-base leading-relaxed text-slate-200 md:text-lg">
              StockPilot Pro helps businesses of every size manage daily operations while using AI to improve forecasting, pricing, branch performance, and financial control.
            </p>

            <div className="mt-8 flex flex-wrap gap-3">
              <a
                href="#contact"
                onClick={() => trackEvent('home_cta_clicked', { cta: 'book_demo', placement: 'hero' })}
                className="inline-flex items-center gap-2 rounded-xl bg-cyan-500 px-5 py-3 text-sm font-bold text-slate-950 transition hover:bg-cyan-400"
              >
                Book a Demo
                <ArrowRight className="h-4 w-4" />
              </a>
              <a
                href="#packages"
                onClick={() => trackEvent('home_cta_clicked', { cta: 'view_packages', placement: 'hero' })}
                className="inline-flex items-center gap-2 rounded-xl border border-white/30 bg-transparent px-5 py-3 text-sm font-semibold text-white transition hover:bg-white/10"
              >
                View Packages
              </a>
            </div>

            <div className="mt-10 grid grid-cols-2 gap-3 sm:grid-cols-4">
              <div className="rounded-xl border border-white/10 bg-white/5 p-3">
                <p className="text-xl font-extrabold text-cyan-300">24/7</p>
                <p className="text-xs text-slate-300">Operational visibility</p>
              </div>
              <div className="rounded-xl border border-white/10 bg-white/5 p-3">
                <p className="text-xl font-extrabold text-cyan-300">AI</p>
                <p className="text-xs text-slate-300">Decision intelligence</p>
              </div>
              <div className="rounded-xl border border-white/10 bg-white/5 p-3">
                <p className="text-xl font-extrabold text-cyan-300">Multi-role</p>
                <p className="text-xs text-slate-300">Admin and sales controls</p>
              </div>
              <div className="rounded-xl border border-white/10 bg-white/5 p-3">
                <p className="text-xl font-extrabold text-cyan-300">Cloud</p>
                <p className="text-xs text-slate-300">Secure and scalable</p>
              </div>
            </div>
          </div>

          <div className="rounded-2xl border border-white/10 bg-white/5 p-5 backdrop-blur-sm">
            <div className="rounded-2xl bg-slate-950/80 p-5">
              <p className="text-xs uppercase tracking-widest text-cyan-300">Enterprise AI Package Highlight</p>
              <h2 className="mt-2 text-2xl font-bold text-white">Unlimited Scale + AI Intelligence</h2>
              <ul className="mt-4 space-y-3 text-sm text-slate-200">
                <li className="flex items-start gap-2"><CheckCircle2 className="mt-0.5 h-4 w-4 text-cyan-300" /> Unlimited branches for large operations</li>
                <li className="flex items-start gap-2"><CheckCircle2 className="mt-0.5 h-4 w-4 text-cyan-300" /> Unlimited salesperson seats across teams</li>
                <li className="flex items-start gap-2"><CheckCircle2 className="mt-0.5 h-4 w-4 text-cyan-300" /> Forecasting, anomaly detection, and Enterprise Assistant insights</li>
              </ul>
              <a
                href="#contact"
                onClick={() => trackEvent('home_cta_clicked', { cta: 'book_enterprise_demo', placement: 'enterprise_highlight' })}
                className="mt-5 inline-flex items-center gap-2 rounded-lg bg-amber-300 px-4 py-2 text-sm font-bold text-slate-950 transition hover:bg-amber-200"
              >
                Book Enterprise Demo
                <Sparkles className="h-4 w-4" />
              </a>
            </div>
          </div>
        </section>
      </div>

      <section className="mx-auto w-full max-w-7xl px-6 py-8 lg:px-10">
        <div className="rounded-2xl border border-white/10 bg-white/5 px-5 py-5 sm:px-6">
          <div className="flex flex-wrap items-center justify-center gap-3">
            <p className="text-center text-[11px] font-bold uppercase tracking-[0.2em] text-cyan-200">Trusted by growth-focused teams</p>
            {canRotateTrustedCustomers && (
              <div className="inline-flex items-center gap-1 rounded-full border border-white/15 bg-slate-950/30 p-1">
                <button
                  type="button"
                  onClick={goToPreviousTrustedCustomers}
                  className="inline-flex h-7 w-7 items-center justify-center rounded-full text-slate-200 transition hover:bg-white/10"
                  aria-label="Show previous trusted customers"
                >
                  <ChevronLeft className="h-4 w-4" />
                </button>
                <button
                  type="button"
                  onClick={goToNextTrustedCustomers}
                  className="inline-flex h-7 w-7 items-center justify-center rounded-full text-slate-200 transition hover:bg-white/10"
                  aria-label="Show next trusted customers"
                >
                  <ChevronRight className="h-4 w-4" />
                </button>
              </div>
            )}
          </div>
          {visibleTrustedCustomers.length > 0 ? (
            <div
              className="mt-5 grid gap-3 sm:grid-cols-2 lg:grid-cols-4"
              onMouseEnter={() => setTrustedCustomersPaused(true)}
              onMouseLeave={() => setTrustedCustomersPaused(false)}
              onFocusCapture={() => setTrustedCustomersPaused(true)}
              onBlurCapture={() => setTrustedCustomersPaused(false)}
            >
              {visibleTrustedCustomers.map((customer) => (
                <a
                  key={customer.id}
                  href={customer.websiteUrl || undefined}
                  target={customer.websiteUrl ? '_blank' : undefined}
                  rel={customer.websiteUrl ? 'noreferrer' : undefined}
                  className="flex min-h-[122px] items-center gap-4 rounded-xl border border-white/10 bg-slate-950/35 px-5 py-4 text-left transition hover:border-cyan-300/50"
                >
                  {customer.logoUrl ? (
                    <img src={toPublicMediaUrl(customer.logoUrl)} alt={`${customer.name} logo`} className="h-20 w-20 rounded-lg object-contain bg-white/95 p-2 shadow-sm" loading="lazy" />
                  ) : (
                    <div className="flex h-20 w-20 items-center justify-center rounded-lg bg-cyan-400/15 text-base font-black uppercase tracking-wider text-cyan-200">
                      {customer.name.slice(0, 2)}
                    </div>
                  )}
                  <span className="text-sm font-bold uppercase tracking-[0.08em] text-slate-200 sm:text-base">{customer.name}</span>
                </a>
              ))}
            </div>
          ) : (
            <p className="mt-4 text-center text-sm text-slate-400">No trusted customers configured yet.</p>
          )}
          {canRotateTrustedCustomers && (
            <p className="mt-3 text-center text-[11px] text-slate-400">
              Rotating through {trustedCustomersToRender.length} customer references. Hover to pause.
            </p>
          )}
          {canRotateTrustedCustomers && (
            <div className="mt-2 flex items-center justify-center gap-1.5" aria-label="Trusted customer rotation indicators">
              {trustedCustomersToRender.map((customer, index) => {
                const isActive = index === trustedCustomerStartIndex
                return (
                  <button
                    key={`dot-${customer.id}`}
                    type="button"
                    onClick={() => goToTrustedCustomerIndex(index)}
                    className={`h-2.5 w-2.5 rounded-full transition ${isActive ? 'bg-cyan-300' : 'bg-white/35 hover:bg-white/55'}`}
                    aria-label={`Show trusted customer set ${index + 1}`}
                  />
                )
              })}
            </div>
          )}
        </div>
      </section>

      <section className="mx-auto w-full max-w-7xl px-6 py-4 lg:px-10">
        <div className="grid gap-4 md:grid-cols-3">
          {trustBadges.map((item) => (
            <article key={item.title} className="rounded-2xl border border-cyan-300/30 bg-cyan-500/10 p-5">
              <div className="mb-3 inline-flex rounded-xl bg-cyan-400/15 p-2 text-cyan-300">
                <item.icon className="h-5 w-5" />
              </div>
              <h4 className="text-base font-semibold text-white">{item.title}</h4>
              <p className="mt-2 text-sm text-slate-200">{item.text}</p>
            </article>
          ))}
        </div>
      </section>

      <section className="mx-auto w-full max-w-7xl px-6 py-10 lg:px-10">
        <div className="mb-6 flex items-end justify-between gap-4">
          <div>
            <p className="text-xs uppercase tracking-widest text-cyan-300">Why StockPilot Pro</p>
            <h3 className="text-3xl font-bold text-white">Practical AI that improves daily decisions</h3>
          </div>
        </div>
        <div className="grid gap-4 md:grid-cols-2">
          {aiBenefits.map((item) => (
            <article key={item.title} className="rounded-2xl border border-white/10 bg-white/5 p-5">
              <div className="mb-3 inline-flex rounded-xl bg-cyan-400/15 p-2 text-cyan-300">
                <item.icon className="h-5 w-5" />
              </div>
              <h4 className="text-lg font-semibold text-white">{item.title}</h4>
              <p className="mt-2 text-sm text-slate-200">{item.text}</p>
            </article>
          ))}
        </div>
      </section>

      <section className="mx-auto w-full max-w-7xl px-6 py-8 lg:px-10">
        <div className="mb-6 text-center">
          <p className="text-xs uppercase tracking-widest text-cyan-300">Network Reliability</p>
          <h3 className="mt-1 text-3xl font-bold text-white">Built for low-connectivity environments</h3>
          <p className="mt-2 text-sm text-slate-300">Work offline with confidence and let the platform handle sync automatically when internet is restored.</p>
        </div>
        <div className="grid gap-4 md:grid-cols-3">
          {reliabilityBenefits.map((item) => (
            <article key={item.title} className="rounded-2xl border border-cyan-300/30 bg-cyan-500/10 p-5">
              <div className="mb-3 inline-flex rounded-xl bg-cyan-400/15 p-2 text-cyan-300">
                <item.icon className="h-5 w-5" />
              </div>
              <h4 className="text-lg font-semibold text-white">{item.title}</h4>
              <p className="mt-2 text-sm text-slate-200">{item.text}</p>
            </article>
          ))}
        </div>
      </section>

      <section id="packages" className="mx-auto w-full max-w-7xl px-6 py-12 lg:px-10">
        <div className="mb-7 text-center">
          <p className="text-xs uppercase tracking-widest text-cyan-300">Packages</p>
          <h3 className="mt-1 text-3xl font-bold text-white">Choose the right package for your organization</h3>
          <p className="mt-2 text-sm text-slate-300">Transparent pricing, clear benefits, and upgrade paths as you scale.</p>
        </div>

        <div className="grid gap-5 lg:grid-cols-3">
          {packages.map((pkg) => (
            <article
              key={pkg.name}
              className={`rounded-2xl border p-6 ${pkg.featured ? 'border-cyan-300/50 bg-cyan-400/10 shadow-xl shadow-cyan-900/40' : 'border-white/10 bg-white/5'}`}
            >
              {pkg.featured && (
                <p className="mb-3 inline-flex rounded-full bg-amber-300 px-3 py-1 text-xs font-extrabold uppercase tracking-wider text-slate-950">
                  Most Powerful
                </p>
              )}
              <h4 className="text-xl font-bold text-white">{pkg.name}</h4>
              <p className="mt-2 inline-flex rounded-full border border-cyan-300/40 bg-cyan-400/10 px-2.5 py-1 text-[11px] font-semibold uppercase tracking-wider text-cyan-200">
                Best for: {pkg.bestFor}
              </p>
              <p className="mt-2 text-sm text-slate-300">{pkg.blurb}</p>

              <div className="mt-5 flex items-end gap-2">
                <span className="text-4xl font-extrabold text-white">{pkg.price}</span>
                <span className="pb-1 text-sm text-slate-300">{pkg.cycle}</span>
              </div>

              <ul className="mt-5 space-y-2 text-sm text-slate-100">
                {pkg.benefits.map((benefit) => (
                  <li key={benefit} className="flex items-start gap-2">
                    <CheckCircle2 className="mt-0.5 h-4 w-4 text-cyan-300" />
                    <span>{benefit}</span>
                  </li>
                ))}
              </ul>

              <a
                href={`#contact`}
                onClick={() => trackEvent('home_package_cta_clicked', { package_name: pkg.name })}
                className={`mt-6 inline-flex w-full items-center justify-center rounded-lg px-4 py-2.5 text-sm font-bold transition ${pkg.featured ? 'bg-cyan-400 text-slate-950 hover:bg-cyan-300' : 'bg-white/10 text-white hover:bg-white/20'}`}
              >
                {pkg.cta}
              </a>
            </article>
          ))}
        </div>

        <div className="mt-8 overflow-x-auto rounded-2xl border border-white/10 bg-white/5">
          <table className="min-w-full text-left text-sm text-slate-200">
            <caption className="px-5 pb-0 pt-5 text-left text-xs uppercase tracking-[0.18em] text-cyan-200">
              Package comparison matrix
            </caption>
            <thead>
              <tr className="border-b border-white/10 text-xs uppercase tracking-wider text-cyan-200">
                <th className="px-5 py-3 font-semibold">Feature</th>
                <th className="px-5 py-3 font-semibold">Starter</th>
                <th className="px-5 py-3 font-semibold">Growth</th>
                <th className="px-5 py-3 font-semibold">Enterprise AI Package</th>
              </tr>
            </thead>
            <tbody>
              {packageComparisonRows.map((row) => (
                <tr key={row.feature} className="border-b border-white/10 last:border-b-0">
                  <td className="px-5 py-3 font-semibold text-white">{row.feature}</td>
                  <td className="px-5 py-3">{row.starter}</td>
                  <td className="px-5 py-3">{row.growth}</td>
                  <td className="px-5 py-3">{row.enterprise}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      <section className="mx-auto grid w-full max-w-7xl gap-4 px-6 py-6 sm:grid-cols-2 lg:grid-cols-4 lg:px-10">
        <div className="rounded-xl border border-white/10 bg-white/5 p-4">
          <Layers3 className="h-5 w-5 text-cyan-300" />
          <p className="mt-2 text-sm font-semibold text-white">Unified Operations</p>
          <p className="mt-1 text-xs text-slate-300">Products, sales, expenses, subscriptions, and users in one workflow.</p>
        </div>
        <div className="rounded-xl border border-white/10 bg-white/5 p-4">
          <CircleDollarSign className="h-5 w-5 text-cyan-300" />
          <p className="mt-2 text-sm font-semibold text-white">Financial Control</p>
          <p className="mt-1 text-xs text-slate-300">Track profitability and spending patterns with role-aware visibility.</p>
        </div>
        <div className="rounded-xl border border-white/10 bg-white/5 p-4">
          <Users className="h-5 w-5 text-cyan-300" />
          <p className="mt-2 text-sm font-semibold text-white">Role-Based Access</p>
          <p className="mt-1 text-xs text-slate-300">Secure permissions for super admin, business admin, agents, and sales teams.</p>
        </div>
        <div className="rounded-xl border border-white/10 bg-white/5 p-4">
          <BarChart3 className="h-5 w-5 text-cyan-300" />
          <p className="mt-2 text-sm font-semibold text-white">Actionable Insights</p>
          <p className="mt-1 text-xs text-slate-300">Turn operational data into practical recommendations and growth decisions.</p>
        </div>
      </section>

      <section className="mx-auto w-full max-w-7xl px-6 py-10 lg:px-10">
        <div className="mb-6 text-center">
          <p className="text-xs uppercase tracking-widest text-cyan-300">Testimonials</p>
          <h3 className="mt-1 text-3xl font-bold text-white">What business leaders say about StockPilot Pro</h3>
        </div>
        <div className="grid gap-4 md:grid-cols-3">
          {testimonials.map((item) => (
            <article key={`${item.name}-${item.company}`} className="rounded-2xl border border-white/10 bg-white/5 p-5">
              <p className="text-sm leading-relaxed text-slate-100">"{item.quote}"</p>
              <div className="mt-5 border-t border-white/10 pt-4">
                <p className="text-sm font-semibold text-white">{item.name}</p>
                <p className="text-xs text-slate-300">{item.role} • {item.company}</p>
              </div>
            </article>
          ))}
        </div>
      </section>

      <section className="mx-auto w-full max-w-7xl px-6 py-6 lg:px-10">
        <div className="mb-6 text-center">
          <p className="text-xs uppercase tracking-widest text-cyan-300">Onboarding</p>
          <h3 className="mt-1 text-3xl font-bold text-white">Get started in 3 clear steps</h3>
        </div>
        <div className="grid gap-4 md:grid-cols-3">
          {onboardingSteps.map((step, index) => (
            <article key={step.title} className="rounded-2xl border border-white/10 bg-white/5 p-5">
              <p className="inline-flex h-8 w-8 items-center justify-center rounded-full bg-cyan-400 text-sm font-black text-slate-950">
                {index + 1}
              </p>
              <h4 className="mt-3 text-lg font-semibold text-white">{step.title}</h4>
              <p className="mt-2 text-sm text-slate-200">{step.text}</p>
            </article>
          ))}
        </div>
      </section>

      <section id="contact" className="mx-auto w-full max-w-7xl px-6 pb-20 pt-12 lg:px-10">
        <div className="grid gap-6 lg:grid-cols-[1fr_1.2fr]">
          <div className="rounded-2xl border border-white/10 bg-white/5 p-6">
            <div className="mb-4 inline-flex rounded-xl bg-cyan-400/15 p-2 text-cyan-300">
              <Headset className="h-5 w-5" />
            </div>
            <h3 className="text-2xl font-bold text-white">Contact us for subscription or more information</h3>
            <p className="mt-3 text-sm text-slate-200">
              Tell us your business goals, branch structure, and preferred rollout timeline. We will help you select the right package and onboarding path.
            </p>
            <div className="mt-6 space-y-3 text-sm text-slate-100">
              <p><span className="font-semibold text-white">Email:</span> contact@stockpilot.pro</p>
              <p><span className="font-semibold text-white">Phone:</span> +1 (555) 100-2200</p>
              <p><span className="font-semibold text-white">Business Hours:</span> Mon-Fri, 9:00 AM - 6:00 PM</p>
            </div>
            <Link to="/login" className="mt-6 inline-flex items-center gap-2 rounded-lg border border-white/30 px-4 py-2 text-sm font-semibold text-white transition hover:bg-white/10">
              Existing Customer Login
              <ArrowRight className="h-4 w-4" />
            </Link>
          </div>

          <div className="rounded-2xl border border-white/10 bg-white/5 p-6">
            <h4 className="text-lg font-semibold text-white">Request a subscription consultation</h4>
            <p className="mt-1 text-sm text-slate-300">Fill this form and our team will contact you directly.</p>
            <form className="mt-5 grid gap-3 sm:grid-cols-2" onSubmit={handleSubmit} onFocusCapture={trackContactFormStart}>
              <input
                className="rounded-lg border border-white/20 bg-slate-950/40 px-3 py-2 text-sm text-white placeholder:text-slate-400 focus:border-cyan-300 focus:outline-none"
                placeholder="Full name"
                value={name}
                onChange={(e) => setName(e.target.value)}
                required
              />
              <input
                className="rounded-lg border border-white/20 bg-slate-950/40 px-3 py-2 text-sm text-white placeholder:text-slate-400 focus:border-cyan-300 focus:outline-none"
                type="email"
                placeholder="Work email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                required
              />
              <input
                className="sm:col-span-2 rounded-lg border border-white/20 bg-slate-950/40 px-3 py-2 text-sm text-white placeholder:text-slate-400 focus:border-cyan-300 focus:outline-none"
                placeholder="Company name"
                value={company}
                onChange={(e) => setCompany(e.target.value)}
                required
              />
              <select
                className="sm:col-span-2 rounded-lg border border-white/20 bg-slate-950/40 px-3 py-2 text-sm text-white focus:border-cyan-300 focus:outline-none"
                value={requestedPackage}
                onChange={(e) => setRequestedPackage(e.target.value)}
              >
                <option value="General Inquiry">General Inquiry</option>
                <option value="Starter">Starter</option>
                <option value="Growth">Growth</option>
                <option value="Enterprise AI Package">Enterprise AI Package</option>
              </select>
              <textarea
                className="sm:col-span-2 min-h-28 rounded-lg border border-white/20 bg-slate-950/40 px-3 py-2 text-sm text-white placeholder:text-slate-400 focus:border-cyan-300 focus:outline-none"
                placeholder="Tell us what you want to achieve (branches, users, AI needs, support expectations)"
                value={message}
                onChange={(e) => setMessage(e.target.value)}
                required
              />
              <button
                type="submit"
                disabled={submitting}
                className="sm:col-span-2 inline-flex items-center justify-center gap-2 rounded-lg bg-cyan-400 px-4 py-2.5 text-sm font-bold text-slate-950 transition hover:bg-cyan-300"
              >
                {submitting ? (
                  <>
                    <Loader2 className="h-4 w-4 animate-spin" />
                    Sending Request...
                  </>
                ) : (
                  <>
                    Submit Request
                    <ArrowRight className="h-4 w-4" />
                  </>
                )}
              </button>
            </form>
          </div>
        </div>
      </section>

      <section className="mx-auto w-full max-w-7xl px-6 pb-14 lg:px-10">
        <div className="mb-6 text-center">
          <p className="text-xs uppercase tracking-widest text-cyan-300">FAQ</p>
          <h3 className="mt-1 text-3xl font-bold text-white">Common questions before rollout</h3>
        </div>
        <div className="space-y-3">
          {faqs.map((item) => (
            <details key={item.question} className="group rounded-2xl border border-white/10 bg-white/5 p-5">
              <summary className="cursor-pointer list-none text-sm font-semibold text-white marker:content-none">
                {item.question}
              </summary>
              <p className="mt-3 text-sm leading-relaxed text-slate-200">{item.answer}</p>
            </details>
          ))}
        </div>
      </section>

      <footer className="border-t border-white/10 bg-slate-950/70">
        <div className="mx-auto flex w-full max-w-7xl flex-col items-center justify-between gap-3 px-6 py-5 text-xs text-slate-300 sm:flex-row lg:px-10">
          <p>StockPilot Pro • AI-Powered Stock & Financial Management Platform</p>
          <div className="flex items-center gap-4">
            <a href="#home-top" className="inline-flex items-center gap-1.5 rounded-md border border-white/20 px-2.5 py-1 text-[11px] font-semibold text-slate-100 transition hover:bg-white/10">
              <ChevronUp className="h-3.5 w-3.5" />
              Back to Top
            </a>
            <Link to="/home" className="inline-flex items-center gap-1.5 rounded-md border border-white/20 px-2.5 py-1 text-[11px] font-semibold text-slate-100 transition hover:bg-white/10">
              <HomeIcon className="h-3.5 w-3.5" />
              Home
            </Link>
            <p>Copyright {new Date().getFullYear()} StockPilot Pro. All rights reserved.</p>
          </div>
        </div>
      </footer>
    </div>
  )
}
