import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { apiError, getClientIp, handleOptions } from '@/lib/auth'
import { consumeRateLimitDistributed } from '@/lib/rate-limit'
import { sendEmail } from '@/lib/mailer'
import { logger } from '@/lib/logger'

const contactRequestSchema = z.object({
  name: z.string().min(2).max(120),
  email: z.string().email().max(320),
  company: z.string().min(2).max(200),
  message: z.string().min(10).max(5000),
  requestedPackage: z.enum(['Starter', 'Growth', 'Enterprise AI Package', 'General Inquiry']).optional(),
})

export async function OPTIONS() {
  return handleOptions()
}

export async function POST(req: NextRequest) {
  try {
    const ip = getClientIp(req)
    const rate = await consumeRateLimitDistributed(`public:contact:${ip}`, 6, 10 * 60 * 1000)

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

    const body = await req.json()
    const payload = contactRequestSchema.parse(body)

    const destination = process.env.PUBLIC_CONTACT_EMAIL || process.env.SMTP_FROM || process.env.SMTP_USER
    if (!destination) {
      logger.warn('Public contact destination email not configured', { action: 'PUBLIC_CONTACT' })
      return apiError('Contact channel is not configured yet. Please use direct email for now.', 503)
    }

    const subject = `[Public Inquiry] ${payload.requestedPackage || 'General'} - ${payload.company}`
    const text = [
      'New public subscription inquiry',
      '',
      `Name: ${payload.name}`,
      `Email: ${payload.email}`,
      `Company: ${payload.company}`,
      `Requested Package: ${payload.requestedPackage || 'General Inquiry'}`,
      '',
      'Message:',
      payload.message,
    ].join('\n')

    const emailResult = await sendEmail({
      to: [destination],
      subject,
      text,
      html: `<p><strong>New public subscription inquiry</strong></p>
             <p><strong>Name:</strong> ${payload.name}</p>
             <p><strong>Email:</strong> ${payload.email}</p>
             <p><strong>Company:</strong> ${payload.company}</p>
             <p><strong>Requested Package:</strong> ${payload.requestedPackage || 'General Inquiry'}</p>
             <p><strong>Message:</strong><br/>${payload.message.replace(/\n/g, '<br/>')}</p>`,
    })

    if (!emailResult.sent) {
      logger.error('Public contact email failed', { error: emailResult.error, action: 'PUBLIC_CONTACT' })
      return apiError('Unable to send request right now. Please try again shortly.', 502)
    }

    return NextResponse.json({ message: 'Request received successfully.' }, { status: 201 })
  } catch (err) {
    if (err instanceof z.ZodError) {
      return NextResponse.json({ error: err.errors }, { status: 422 })
    }

    logger.error('Public contact request failed', { err, action: 'PUBLIC_CONTACT' })
    return apiError('Internal server error', 500)
  }
}
