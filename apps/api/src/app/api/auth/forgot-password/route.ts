import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { prisma } from '@/lib/prisma'
import { apiError, getClientIp, handleOptions } from '@/lib/auth'
import { consumeRateLimitDistributed } from '@/lib/rate-limit'
import { sendEmail } from '@/lib/mailer'
import { buildPasswordResetEmail, generateNumericOtp, hashResetOtp } from '@/lib/password-reset'

type PasswordResetTokenDelegate = {
  updateMany: (args: Record<string, unknown>) => Promise<unknown>
  create: (args: Record<string, unknown>) => Promise<unknown>
}

const passwordResetToken = (prisma as unknown as { passwordResetToken: PasswordResetTokenDelegate }).passwordResetToken

const forgotPasswordSchema = z.object({
  email: z.string().email().max(320),
})

const OTP_EXPIRY_MINUTES = 7

export async function OPTIONS() {
  return handleOptions()
}

export async function POST(req: NextRequest) {
  try {
    const clientIp = getClientIp(req)
    const body = await req.json()
    const { email } = forgotPasswordSchema.parse(body)

    const normalizedEmail = email.trim().toLowerCase()

    const rate = await consumeRateLimitDistributed(`auth:forgot-password:${clientIp}:${normalizedEmail}`, 5, 15 * 60 * 1000)
    if (!rate.allowed) {
      return NextResponse.json(
        { error: 'Too many requests. Please try again shortly.' },
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
        email: true,
        firstName: true,
        isActive: true,
        archived: true,
      },
    })

    // Always return generic response to prevent account enumeration.
    const genericResponse = NextResponse.json({
      message: 'If an account exists for this email, a password reset OTP has been sent.',
    })

    if (!user || !user.isActive || user.archived) {
      return genericResponse
    }

    const otp = generateNumericOtp(6)
    const tokenHash = hashResetOtp(otp)
    const expiresAt = new Date(Date.now() + OTP_EXPIRY_MINUTES * 60 * 1000)

    await prisma.$transaction(async (tx) => {
      const txPasswordResetToken = (tx as unknown as { passwordResetToken: PasswordResetTokenDelegate }).passwordResetToken
      const now = new Date()

      await txPasswordResetToken.updateMany({
        where: {
          userId: user.id,
          usedAt: null,
          expiresAt: { gt: now },
        },
        data: { usedAt: now },
      })

      await txPasswordResetToken.create({
        data: {
          userId: user.id,
          email: user.email,
          tokenHash,
          expiresAt,
        },
      })
    })

    const userAgent = req.headers.get('user-agent') || 'Unknown device'
    const mail = buildPasswordResetEmail({
      firstName: user.firstName,
      otp,
      expiresInMinutes: OTP_EXPIRY_MINUTES,
      requestIp: clientIp,
      requestAgent: userAgent,
    })

    await sendEmail({
      to: [user.email],
      subject: mail.subject,
      text: mail.text,
      html: mail.html,
    })

    return genericResponse
  } catch (err) {
    if (err instanceof z.ZodError) {
      return NextResponse.json({ error: err.errors }, { status: 422 })
    }

    console.error('[AUTH FORGOT PASSWORD]', err)
    return apiError('Internal server error', 500)
  }
}
