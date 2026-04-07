import { useEffect } from 'react'

type SeoOptions = {
  title: string
  description: string
  path?: string
  keywords?: string
  image?: string
  type?: 'website' | 'article'
  robots?: string
}

const SITE_NAME = 'StockPilot Pro'

function getSiteUrl(): string {
  const configured = import.meta.env.VITE_SITE_URL?.trim()
  if (configured) return configured.replace(/\/$/, '')
  if (typeof window !== 'undefined') return window.location.origin
  return 'https://stockpilot.pro'
}

function toAbsoluteUrl(pathOrUrl: string): string {
  if (/^https?:\/\//i.test(pathOrUrl)) return pathOrUrl
  const base = getSiteUrl()
  const normalizedPath = pathOrUrl.startsWith('/') ? pathOrUrl : `/${pathOrUrl}`
  return `${base}${normalizedPath}`
}

function setMetaByName(name: string, content: string): void {
  let tag = document.querySelector(`meta[name=\"${name}\"]`)
  if (!tag) {
    tag = document.createElement('meta')
    tag.setAttribute('name', name)
    document.head.appendChild(tag)
  }
  tag.setAttribute('content', content)
}

function setMetaByProperty(property: string, content: string): void {
  let tag = document.querySelector(`meta[property=\"${property}\"]`)
  if (!tag) {
    tag = document.createElement('meta')
    tag.setAttribute('property', property)
    document.head.appendChild(tag)
  }
  tag.setAttribute('content', content)
}

function setCanonical(url: string): void {
  let link = document.querySelector('link[rel="canonical"]')
  if (!link) {
    link = document.createElement('link')
    link.setAttribute('rel', 'canonical')
    document.head.appendChild(link)
  }
  link.setAttribute('href', url)
}

export function applySeo(options: SeoOptions): void {
  if (typeof document === 'undefined') return

  const {
    title,
    description,
    path = '/',
    keywords = 'inventory management, stock management, financial operations, AI forecasting, multi-branch retail software',
    image = '/favicon.svg',
    type = 'website',
    robots = 'index,follow',
  } = options

  const canonicalUrl = toAbsoluteUrl(path)
  const imageUrl = toAbsoluteUrl(image)
  const pageTitle = title.includes(SITE_NAME) ? title : `${title} | ${SITE_NAME}`

  document.title = pageTitle

  setMetaByName('description', description)
  setMetaByName('keywords', keywords)
  setMetaByName('robots', robots)

  setMetaByProperty('og:type', type)
  setMetaByProperty('og:site_name', SITE_NAME)
  setMetaByProperty('og:title', pageTitle)
  setMetaByProperty('og:description', description)
  setMetaByProperty('og:url', canonicalUrl)
  setMetaByProperty('og:image', imageUrl)

  setMetaByName('twitter:card', 'summary_large_image')
  setMetaByName('twitter:title', pageTitle)
  setMetaByName('twitter:description', description)
  setMetaByName('twitter:image', imageUrl)

  setCanonical(canonicalUrl)
}

export function useSeo(options: SeoOptions): void {
  const {
    title,
    description,
    path,
    keywords,
    image,
    type,
    robots,
  } = options

  useEffect(() => {
    applySeo({
      title,
      description,
      path,
      keywords,
      image,
      type,
      robots,
    })
  }, [title, description, path, keywords, image, type, robots])
}
