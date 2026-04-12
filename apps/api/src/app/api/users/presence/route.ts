import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { authenticate, apiError, handleOptions } from '@/lib/auth'

export async function OPTIONS() {
  return handleOptions()
}

export async function POST(req: NextRequest) {
  try {
    const user = authenticate(req)

    await prisma.user.update({
      where: { id: user.userId },
      data: { lastSeenAt: new Date() },
      select: { id: true },
    })

    return NextResponse.json({ data: { ok: true } })
  } catch (err) {
    const message = (err as Error).message || ''
    if (
      message === 'Unauthorized'
      || message === 'No token provided'
      || message.toLowerCase().includes('token')
      || message.toLowerCase().includes('jwt')
    ) {
      return apiError('Unauthorized', 401)
    }
    console.error('[USER PRESENCE POST]', err)
    return apiError('Internal server error', 500)
  }
}
