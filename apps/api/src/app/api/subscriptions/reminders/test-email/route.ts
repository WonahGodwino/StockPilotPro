import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { authenticate, apiError, handleOptions } from '@/lib/auth'
import { isSuperAdmin } from '@/lib/rbac'
import { sendEmail } from '@/lib/mailer'
import { logAudit } from '@/lib/audit'

const schema = z.object({
  to: z.string().email().optional(),
})

export async function OPTIONS() {
  return handleOptions()
}

export async function POST(req: NextRequest) {
  try {
    const user = authenticate(req)
    if (!isSuperAdmin(user)) return apiError('Forbidden', 403)

    const body = await req.json().catch(() => ({}))
    const input = schema.parse(body)
    const targetEmail = input.to || user.email

    const result = await sendEmail({
      to: [targetEmail],
      subject: 'StockPilot SMTP Test',
      text: `SMTP test successful. Time: ${new Date().toISOString()}`,
      html: `<p>SMTP test successful.</p><p>Time: ${new Date().toISOString()}</p>`,
    })

    await logAudit({
      tenantId: user.tenantId,
      userId: user.userId,
      action: 'NOTIFY',
      entity: 'smtp_test',
      entityId: null,
      newValues: {
        to: targetEmail,
        status: result.sent ? 'SUCCESS' : 'FAILED',
        reason: result.error || null,
        sentAt: new Date().toISOString(),
      },
      req,
    })

    if (!result.sent) {
      return apiError('SMTP test failed. Check SMTP config.', 400)
    }

    return NextResponse.json({ data: { ok: true, to: targetEmail } })
  } catch (err) {
    if (err instanceof z.ZodError) {
      return NextResponse.json({ error: err.errors }, { status: 422 })
    }
    console.error('[SMTP TEST EMAIL POST]', err)
    return apiError('Internal server error', 500)
  }
}
