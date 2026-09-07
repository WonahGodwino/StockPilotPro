import { NextRequest, NextResponse } from 'next/server'
import { authenticate } from '@/lib/auth'

export async function GET(req: NextRequest) {
  try {
    authenticate(req)

    const { searchParams } = new URL(req.url)
    const url = searchParams.get('url')

    if (!url) {
      return new NextResponse('Missing url param', { status: 400 })
    }

    // Only allow Open Food Facts images
    if (!url.startsWith('https://images.openfoodfacts.org/')) {
      return new NextResponse('Invalid source', { status: 403 })
    }

    const controller = new AbortController()
    const timeout = setTimeout(() => controller.abort(), 10000)
    const imageRes = await fetch(url, { signal: controller.signal })
    clearTimeout(timeout)

    if (!imageRes.ok) {
      return new NextResponse('Image not found', { status: 404 })
    }

    const contentType = imageRes.headers.get('content-type') || 'image/jpeg'
    const buffer = await imageRes.arrayBuffer()

    return new NextResponse(buffer, {
      headers: {
        'Content-Type': contentType,
        'Cache-Control': 'public, max-age=86400, immutable',
      },
    })
  } catch {
    return new NextResponse('Image fetch failed', { status: 500 })
  }
}
