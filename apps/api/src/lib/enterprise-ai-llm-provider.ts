// ============================================================
// ENTERPRISE AI LLM PROVIDER - Multi-Provider with Market Intelligence
// ============================================================

import { prisma } from '@/lib/prisma'

// ============================================================
// TYPES
// ============================================================

export type LLMProvider = 'anthropic' | 'openai' | 'google' | 'azure-openai' | 'openai-compatible'

export interface MarketContext {
  location: {
    country: string
    city?: string
    region?: string
  }
  industry: string
  economicIndicators?: {
    inflationRate?: number
    consumerSpendingTrend?: 'increasing' | 'stable' | 'decreasing'
    industryGrowthRate?: number
    competitorCount?: number
  }
  marketSignals?: {
    demandTrend: 'rising' | 'stable' | 'falling'
    priceSensitivity: 'low' | 'medium' | 'high'
    seasonalityFactor: number
    competitorActivity?: string[]
  }
}

export interface LLMConfig {
  provider: LLMProvider
  apiKey: string
  model: string
  baseUrl?: string
  timeoutMs: number
  maxRetries: number
  enableWebSearch?: boolean
  temperature?: number
}

export interface LLMResponse {
  content: string
  provider: LLMProvider
  model: string
  latencyMs: number
  attempts: number
  usedWebSearch: boolean
  tokensUsed?: {
    input: number
    output: number
  }
}

// ============================================================
// CONFIGURATION LOADER (Environment + Database overrides)
// ============================================================

export async function getLLMConfigForTenant(
  tenantId: string,
  useCase: 'business_analysis' | 'market_intelligence' | 'routine'
): Promise<LLMConfig | null> {
  // Check tenant-specific override in database
  const tenantConfig = await prisma.enterpriseAiMetric.findFirst({
    where: {
      tenantId,
      metricKey: 'llm_tenant_override',
    },
    orderBy: { createdAt: 'desc' },
  })

  if (tenantConfig?.dimensions && typeof tenantConfig.dimensions === 'object') {
    const dims = tenantConfig.dimensions as any
    if (dims.provider && dims.model) {
      return {
        provider: dims.provider as LLMProvider,
        apiKey: process.env[`${dims.provider.toUpperCase()}_API_KEY`] || '',
        model: dims.model,
        timeoutMs: dims.timeoutMs || 30000,
        maxRetries: dims.maxRetries || 2,
        enableWebSearch: dims.enableWebSearch === true,
        temperature: dims.temperature || 0.2,
      }
    }
  }

  // Fall back to environment-based configuration
  const useCaseConfig = {
    business_analysis: {
      // Claude 3.5 Sonnet for complex business reasoning
      provider: process.env.ENTERPRISE_AI_LLM_PROVIDER_BUSINESS || 'anthropic',
      model: process.env.ENTERPRISE_AI_LLM_MODEL_BUSINESS || 'claude-3-5-sonnet-20241022',
      temperature: 0.2,
      enableWebSearch: false,
    },
    market_intelligence: {
      // GPT-4o with web search for real-time market data
      provider: process.env.ENTERPRISE_AI_LLM_PROVIDER_MARKET || 'openai',
      model: process.env.ENTERPRISE_AI_LLM_MODEL_MARKET || 'gpt-4o',
      temperature: 0.3,
      enableWebSearch: true,
    },
    routine: {
      // Gemini Flash for cost-effective routine analysis
      provider: process.env.ENTERPRISE_AI_LLM_PROVIDER_ROUTINE || 'google',
      model: process.env.ENTERPRISE_AI_LLM_MODEL_ROUTINE || 'gemini-1.5-flash',
      temperature: 0.1,
      enableWebSearch: false,
    },
  }

  const config = useCaseConfig[useCase]
  const apiKey = getApiKeyForProvider(config.provider)

  if (!apiKey) {
    console.warn(`No API key found for provider ${config.provider}, falling back to next provider`)
    return getFallbackConfig(useCase)
  }

  return {
    provider: config.provider as LLMProvider,
    apiKey,
    model: config.model,
    timeoutMs: Number(process.env.ENTERPRISE_AI_LLM_TIMEOUT_MS) || 30000,
    maxRetries: Number(process.env.ENTERPRISE_AI_LLM_MAX_RETRIES) || 2,
    enableWebSearch: config.enableWebSearch ?? false,
    temperature: config.temperature,
  }
}

function getApiKeyForProvider(provider: string): string | null {
  const keyMap: Record<string, string> = {
    anthropic: process.env.ANTHROPIC_API_KEY || '',
    openai: process.env.OPENAI_API_KEY || '',
    google: process.env.GOOGLE_API_KEY || '',
    'azure-openai': process.env.AZURE_OPENAI_API_KEY || '',
  }
  return keyMap[provider] || null
}

function getFallbackConfig(useCase: 'business_analysis' | 'market_intelligence' | 'routine'): LLMConfig | null {
  // Try OpenAI as fallback
  const openaiKey = process.env.OPENAI_API_KEY
  if (openaiKey) {
    return {
      provider: 'openai',
      apiKey: openaiKey,
      model: 'gpt-4o-mini',
      timeoutMs: 30000,
      maxRetries: 2,
      enableWebSearch: useCase === 'market_intelligence',
      temperature: 0.2,
    }
  }
  return null
}

// ============================================================
// LOCATION-AWARE MARKET CONTEXT
// ============================================================

export async function getMarketContextForTenant(
  tenantId: string
): Promise<MarketContext | null> {
  // Get tenant location from database
  const tenant = await prisma.tenant.findUnique({
    where: { id: tenantId },
    select: { country: true, state: true, name: true },
  })

  if (!tenant?.country) {
    return null
  }

  // Detect industry from product catalog
  const products = await prisma.product.groupBy({
    by: ['type'],
    where: { tenantId, archived: false },
    _count: true,
  })

  const hasGoods = products.some(p => p.type === 'GOODS')
  const hasServices = products.some(p => p.type === 'SERVICE')
  
  let industry = 'retail'
  if (hasGoods && !hasServices) industry = 'retail'
  else if (!hasGoods && hasServices) industry = 'service'
  else if (hasGoods && hasServices) industry = 'mixed'

  // Try to fetch economic indicators (cached)
  const cachedIndicators = await prisma.enterpriseAiSignal.findFirst({
    where: {
      tenantId,
      signalKey: `economic_indicators_${tenant.country}`,
      effectiveDate: { gte: new Date(Date.now() - 7 * 24 * 60 * 60 * 1000) },
    },
    orderBy: { effectiveDate: 'desc' },
  })

  let economicIndicators: MarketContext['economicIndicators'] = {}
  
  if (cachedIndicators?.signalValue && typeof cachedIndicators.signalValue === 'object') {
    economicIndicators = cachedIndicators.signalValue as any
  }

  return {
    location: {
      country: tenant.country,
      region: tenant.state || undefined,
    },
    industry,
    economicIndicators,
    marketSignals: {
      demandTrend: 'stable',
      priceSensitivity: 'medium',
      seasonalityFactor: 0.5,
    },
  }
}

// ============================================================
// ANTHROPIC CLAUDE INTEGRATION
// ============================================================

async function queryAnthropic(
  config: LLMConfig,
  systemPrompt: string,
  userPrompt: string
): Promise<LLMResponse | null> {
  const startTime = Date.now()
  const endpoint = 'https://api.anthropic.com/v1/messages'

  for (let attempt = 1; attempt <= config.maxRetries; attempt++) {
    const controller = new AbortController()
    const timeout = setTimeout(() => controller.abort(), config.timeoutMs)

    try {
      const response = await fetch(endpoint, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-api-key': config.apiKey,
          'anthropic-version': '2023-06-01',
        },
        body: JSON.stringify({
          model: config.model,
          system: systemPrompt,
          messages: [{ role: 'user', content: userPrompt }],
          temperature: config.temperature || 0.2,
          max_tokens: 4096,
        }),
        signal: controller.signal,
      })

      if (!response.ok) {
        const error = await response.text()
        console.error(`Anthropic attempt ${attempt} failed:`, error)
        continue
      }

      const data = await response.json() as any
      const content = data.content?.[0]?.text || ''

      return {
        content,
        provider: 'anthropic',
        model: config.model,
        latencyMs: Date.now() - startTime,
        attempts: attempt,
        usedWebSearch: false,
        tokensUsed: {
          input: data.usage?.input_tokens || 0,
          output: data.usage?.output_tokens || 0,
        },
      }
    } catch (error) {
      console.error(`Anthropic attempt ${attempt} error:`, error)
    } finally {
      clearTimeout(timeout)
    }
  }

  return null
}

// ============================================================
// OPENAI INTEGRATION (with Web Search for market intelligence)
// ============================================================

async function queryOpenAI(
  config: LLMConfig,
  systemPrompt: string,
  userPrompt: string
): Promise<LLMResponse | null> {
  const startTime = Date.now()
  const endpoint = 'https://api.openai.com/v1/chat/completions'

  for (let attempt = 1; attempt <= config.maxRetries; attempt++) {
    const controller = new AbortController()
    const timeout = setTimeout(() => controller.abort(), config.timeoutMs)

    try {
      const messages = [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: userPrompt },
      ]

      // Add web search capability for market intelligence
      const tools = config.enableWebSearch
        ? [{
            type: 'web_search_preview',
            search_context_size: 'medium',
          }]
        : undefined

      const response = await fetch(endpoint, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${config.apiKey}`,
        },
        body: JSON.stringify({
          model: config.model,
          messages,
          temperature: config.temperature || 0.2,
          max_tokens: 4096,
          tools,
        }),
        signal: controller.signal,
      })

      if (!response.ok) {
        const error = await response.text()
        console.error(`OpenAI attempt ${attempt} failed:`, error)
        continue
      }

      const data = await response.json() as any
      const content = data.choices?.[0]?.message?.content || ''

      // Check if web search was used
      const usedWebSearch = !!(data.choices?.[0]?.message?.tool_calls?.length)

      return {
        content,
        provider: 'openai',
        model: config.model,
        latencyMs: Date.now() - startTime,
        attempts: attempt,
        usedWebSearch,
        tokensUsed: {
          input: data.usage?.prompt_tokens || 0,
          output: data.usage?.completion_tokens || 0,
        },
      }
    } catch (error) {
      console.error(`OpenAI attempt ${attempt} error:`, error)
    } finally {
      clearTimeout(timeout)
    }
  }

  return null
}

// ============================================================
// GOOGLE GEMINI INTEGRATION
// ============================================================

async function queryGoogle(
  config: LLMConfig,
  systemPrompt: string,
  userPrompt: string
): Promise<LLMResponse | null> {
  const startTime = Date.now()
  const endpoint = `https://generativelanguage.googleapis.com/v1/models/${config.model}:generateContent?key=${config.apiKey}`

  for (let attempt = 1; attempt <= config.maxRetries; attempt++) {
    const controller = new AbortController()
    const timeout = setTimeout(() => controller.abort(), config.timeoutMs)

    try {
      const response = await fetch(endpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          contents: [
            {
              parts: [
                { text: `${systemPrompt}\n\n${userPrompt}` },
              ],
            },
          ],
          generationConfig: {
            temperature: config.temperature || 0.2,
            maxOutputTokens: 4096,
          },
        }),
        signal: controller.signal,
      })

      if (!response.ok) {
        const error = await response.text()
        console.error(`Google attempt ${attempt} failed:`, error)
        continue
      }

      const data = await response.json() as any
      const content = data.candidates?.[0]?.content?.parts?.[0]?.text || ''

      return {
        content,
        provider: 'google',
        model: config.model,
        latencyMs: Date.now() - startTime,
        attempts: attempt,
        usedWebSearch: false,
      }
    } catch (error) {
      console.error(`Google attempt ${attempt} error:`, error)
    } finally {
      clearTimeout(timeout)
    }
  }

  return null
}

// ============================================================
// MAIN QUERY FUNCTION (with provider routing)
// ============================================================

export async function queryLLM(
  systemPrompt: string,
  userPrompt: string,
  options: {
    useCase?: 'business_analysis' | 'market_intelligence' | 'routine'
    tenantId?: string
    preferProvider?: LLMProvider
  } = {}
): Promise<LLMResponse | null> {
  const { useCase = 'business_analysis', tenantId, preferProvider } = options

  // Get configuration for this use case
  let config: LLMConfig | null = null
  
  if (tenantId) {
    config = await getLLMConfigForTenant(tenantId, useCase)
  }

  if (!config && preferProvider) {
    // Try preferred provider first
    const apiKey = getApiKeyForProvider(preferProvider)
    if (apiKey) {
      config = {
        provider: preferProvider,
        apiKey,
        model: getDefaultModelForProvider(preferProvider, useCase),
        timeoutMs: 30000,
        maxRetries: 2,
        enableWebSearch: useCase === 'market_intelligence',
        temperature: 0.2,
      }
    }
  }

  if (!config) {
    console.error('No LLM configuration available')
    return null
  }

  // Route to appropriate provider
  let response: LLMResponse | null = null

  switch (config.provider) {
    case 'anthropic':
      response = await queryAnthropic(config, systemPrompt, userPrompt)
      break
    case 'openai':
    case 'azure-openai':
    case 'openai-compatible':
      response = await queryOpenAI(config, systemPrompt, userPrompt)
      break
    case 'google':
      response = await queryGoogle(config, systemPrompt, userPrompt)
      break
    default:
      console.error(`Unknown provider: ${config.provider}`)
      return null
  }

  // Record metrics
  if (response && tenantId) {
    await prisma.enterpriseAiMetric.create({
      data: {
        tenantId,
        metricKey: 'llm_query',
        metricValue: 1,
        dimensions: {
          provider: response.provider,
          model: response.model,
          useCase,
          latencyMs: response.latencyMs,
          attempts: response.attempts,
          usedWebSearch: response.usedWebSearch,
        },
      },
    })
  }

  return response
}

function getDefaultModelForProvider(provider: LLMProvider, useCase: string): string {
  const defaults: Record<LLMProvider, string> = {
    anthropic: useCase === 'business_analysis' ? 'claude-3-5-sonnet-20241022' : 'claude-3-haiku-20240307',
    openai: useCase === 'market_intelligence' ? 'gpt-4o' : 'gpt-4o-mini',
    google: 'gemini-1.5-flash',
    'azure-openai': useCase === 'market_intelligence' ? 'gpt-4o' : 'gpt-4o-mini',
    'openai-compatible': 'gpt-4o-mini',
  }
  return defaults[provider]
}