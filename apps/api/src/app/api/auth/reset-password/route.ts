import { NextRequest, NextResponse } from 'next/server'
import bcrypt from 'bcryptjs'
import { z } from 'zod'
import { prisma } from '@/lib/prisma'
import { apiError, getClientIp, handleOptions } from '@/lib/auth'
import { consumeRateLimitDistributed } from '@/lib/rate-limit'
import { hashResetOtp } from '@/lib/password-reset'

type PasswordResetTokenDelegate = {
  findFirst: (args: Record<string, unknown>) => Promise<{ id: string } | null>
  update: (args: Record<string, unknown>) => Promise<unknown>
  updateMany: (args: Record<string, unknown>) => Promise<unknown>
}

const passwordResetToken = (prisma as unknown as { passwordResetToken: PasswordResetTokenDelegate }).passwordResetToken

const resetPasswordSchema = z.object({
  email: z.string().email().max(320),
  otp: z.string().regex(/^\d{6}$/),
  newPassword: z.string().min(8).max(128),
})

export async function OPTIONS() {
  return handleOptions()
}

export async function POST(req: NextRequest) {
  try {
    const clientIp = getClientIp(req)
    const body = await req.json()
    const { email, otp, newPassword } = resetPasswordSchema.parse(body)

    const normalizedEmail = email.trim().toLowerCase()

    const rate = await consumeRateLimitDistributed(`auth:reset-password:${clientIp}:${normalizedEmail}`, 10, 15 * 60 * 1000)
    if (!rate.allowed) {
      return NextResponse.json(
        { error: 'Too many reset attempts. Please try again shortly.' },
        {
          status: 429,
          headers: {
            'Retry-After': String(rate.retryAfterSec),
          },
        }
      )
    }

    const user = await prisma.user.findUnique({
      where: { email: normalizedEmail },
      select: {
        id: true,
        password: true,
        isActive: true,
        archived: true,
        tenantId: true,
      },
    })

    if (!user || !user.isActive || user.archived) {
      return apiError('Invalid or expired OTP.', 400)
    }

    const tokenHash = hashResetOtp(otp)

    const token = await passwordResetToken.findFirst({
      where: {
        userId: user.id,
        email: normalizedEmail,
        tokenHash,
        usedAt: null,
        expiresAt: { gt: new Date() },
      },
      orderBy: { createdAt: 'desc' },
    })

    if (!token) {
      return apiError('Invalid or expired OTP.', 400)
    }

    if (user.password) {
      const isSameAsCurrent = await bcrypt.compare(newPassword, user.password)
      if (isSameAsCurrent) {
        return apiError('New password must be different from your current password.', 400)
      }
    }

    const nextHash = await bcrypt.hash(newPassword, 12)
    const now = new Date()

    await prisma.$transaction(async (tx) => {
      const txPasswordResetToken = (tx as unknown as { passwordResetToken: PasswordResetTokenDelegate }).passwordResetToken

      await tx.user.update({
        where: { id: user.id },
        data: {
          password: nextHash,
          updatedBy: user.id,
        },
      })

      await txPasswordResetToken.update({
        where: { id: token.id },
        data: { usedAt: now },
      })

      await txPasswordResetToken.updateMany({
        where: {
          userId: user.id,
          usedAt: null,
          id: { not: token.id },
        },
        data: { usedAt: now },
      })

      await tx.refreshToken.deleteMany({ where: { userId: user.id } })
    })

    return NextResponse.json({ message: 'Password has been reset successfully. Please sign in.' })
  } catch (err) {
    if (err instanceof z.ZodError) {
      return NextResponse.json({ error: err.errors }, { status: 422 })
    }

    console.error('[AUTH RESET PASSWORD]', err)
    return apiError('Internal server error', 500)
  }
}
