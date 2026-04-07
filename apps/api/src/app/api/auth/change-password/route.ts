import { NextRequest, NextResponse } from 'next/server'
import bcrypt from 'bcryptjs'
import { z } from 'zod'
import { prisma } from '@/lib/prisma'
import { authenticate, apiError, handleOptions } from '@/lib/auth'
import { logAudit } from '@/lib/audit'

const changePasswordSchema = z.object({
  currentPassword: z.string().min(6),
  newPassword: z.string().min(8).max(128),
})

export async function OPTIONS() {
  return handleOptions()
}

export async function POST(req: NextRequest) {
  try {
    const authUser = authenticate(req)
    const body = await req.json()
    const { currentPassword, newPassword } = changePasswordSchema.parse(body)

    if (currentPassword === newPassword) {
      return apiError('New password must be different from your current password.', 400)
    }

    const user = await prisma.user.findUnique({
      where: { id: authUser.userId },
      select: {
        id: true,
        password: true,
        email: true,
        tenantId: true,
      },
    })

    if (!user || !user.password) {
      return apiError('User password account is not available.', 400)
    }

    const isValidCurrent = await bcrypt.compare(currentPassword, user.password)
    if (!isValidCurrent) {
      return apiError('Current password is incorrect.', 401)
    }

    const isSameAsExisting = await bcrypt.compare(newPassword, user.password)
    if (isSameAsExisting) {
      return apiError('New password must be different from your current password.', 400)
    }

    const nextHash = await bcrypt.hash(newPassword, 12)

    await prisma.$transaction([
      prisma.user.update({
        where: { id: user.id },
        data: {
          password: nextHash,
          updatedBy: user.id,
        },
      }),
      prisma.refreshToken.deleteMany({ where: { userId: user.id } }),
    ])

    await logAudit({
      tenantId: user.tenantId,
      userId: user.id,
      action: 'PASSWORD_CHANGE',
      entity: 'auth',
      entityId: user.id,
      req,
    })

    return NextResponse.json({ message: 'Password changed successfully. Please sign in again.' })
  } catch (err) {
    if (err instanceof z.ZodError) {
      return NextResponse.json({ error: err.errors }, { status: 422 })
    }

    console.error('[AUTH CHANGE PASSWORD]', err)
    return apiError('Internal server error', 500)
  }
}
