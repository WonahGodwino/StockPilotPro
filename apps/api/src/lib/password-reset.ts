import crypto from 'crypto'

const OTP_LENGTH = 6

export function generateNumericOtp(length = OTP_LENGTH): string {
  const max = 10 ** length
  const min = 10 ** (length - 1)
  const value = crypto.randomInt(min, max)
  return String(value)
}

export function hashResetOtp(otp: string): string {
  return crypto.createHash('sha256').update(otp).digest('hex')
}

export function maskEmail(email: string): string {
  const [localPart, domainPart] = email.split('@')
  if (!localPart || !domainPart) return email

  const visibleLocal = localPart.slice(0, 2)
  const maskedLocal = `${visibleLocal}${'*'.repeat(Math.max(1, localPart.length - 2))}`

  const domainParts = domainPart.split('.')
  const domainName = domainParts[0] || ''
  const domainSuffix = domainParts.slice(1).join('.')
  const visibleDomain = domainName.slice(0, 1)
  const maskedDomainName = `${visibleDomain}${'*'.repeat(Math.max(1, domainName.length - 1))}`

  return `${maskedLocal}@${maskedDomainName}${domainSuffix ? `.${domainSuffix}` : ''}`
}

export function buildPasswordResetEmail(input: {
  firstName?: string | null
  otp: string
  expiresInMinutes: number
  requestIp: string
  requestAgent: string
}): { subject: string; text: string; html: string } {
  const name = input.firstName?.trim() || 'there'
  const subject = 'StockPilot Pro Password Reset OTP'

  const securityNote = [
    'If you did not request this reset:',
    '- Do not share this OTP with anyone.',
    '- Ignore this email and keep your account password unchanged.',
    '- Consider changing your password immediately if you suspect unauthorized activity.',
  ].join('\n')

  const text = [
    `Hello ${name},`,
    '',
    'We received a request to reset your StockPilot Pro account password.',
    `Your one-time password (OTP) is: ${input.otp}`,
    `This OTP expires in ${input.expiresInMinutes} minutes and can only be used once.`,
    '',
    `Request details:`,
    `- IP address: ${input.requestIp}`,
    `- Device: ${input.requestAgent}`,
    '',
    securityNote,
    '',
    'For your protection, StockPilot Pro support will never ask you for this OTP by email, phone, or chat.',
    '',
    'Regards,',
    'StockPilot Pro Security Team',
  ].join('\n')

  const html = `
  <div style="margin:0;padding:0;background:#f1f5f9;font-family:Segoe UI,Arial,sans-serif;color:#0f172a;">
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="padding:24px 12px;">
      <tr>
        <td align="center">
          <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:640px;background:#ffffff;border:1px solid #e2e8f0;border-radius:14px;overflow:hidden;">
            <tr>
              <td style="padding:18px 24px;background:#0f172a;color:#e2e8f0;">
                <div style="font-size:14px;letter-spacing:0.08em;text-transform:uppercase;font-weight:700;">StockPilot Pro</div>
                <div style="font-size:12px;opacity:0.85;margin-top:4px;">Security Notification</div>
              </td>
            </tr>
            <tr>
              <td style="padding:24px;">
                <h1 style="margin:0 0 12px;font-size:20px;line-height:1.35;color:#0f172a;">Password Reset Request</h1>
                <p style="margin:0 0 12px;font-size:14px;line-height:1.6;color:#334155;">Hello ${name},</p>
                <p style="margin:0 0 16px;font-size:14px;line-height:1.6;color:#334155;">We received a request to reset your StockPilot Pro account password.</p>

                <div style="margin:0 0 18px;padding:14px;border-radius:10px;background:#f8fafc;border:1px solid #cbd5e1;text-align:center;">
                  <div style="font-size:12px;color:#475569;letter-spacing:0.08em;text-transform:uppercase;font-weight:700;">Your OTP</div>
                  <div style="font-size:34px;line-height:1.2;font-weight:800;letter-spacing:0.18em;color:#0f172a;margin-top:4px;">${input.otp}</div>
                  <div style="font-size:13px;color:#475569;margin-top:8px;">Expires in ${input.expiresInMinutes} minutes • one-time use</div>
                </div>

                <div style="margin:0 0 18px;padding:12px;border-radius:10px;background:#f8fafc;border:1px solid #e2e8f0;">
                  <div style="font-size:13px;color:#334155;font-weight:700;margin-bottom:6px;">Request details</div>
                  <div style="font-size:13px;color:#334155;line-height:1.6;">IP address: ${input.requestIp}<br/>Device: ${input.requestAgent}</div>
                </div>

                <div style="margin:0;padding:12px 14px;border-radius:10px;background:#fff7ed;border:1px solid #fed7aa;">
                  <div style="font-size:13px;color:#9a3412;font-weight:700;margin-bottom:6px;">Security guidance</div>
                  <ul style="margin:0;padding-left:18px;font-size:13px;line-height:1.6;color:#9a3412;">
                    <li>If you did not request this reset, ignore this email.</li>
                    <li>Never share this OTP with anyone, including support staff.</li>
                    <li>Change your password immediately if you suspect suspicious activity.</li>
                  </ul>
                </div>

                <p style="margin:16px 0 0;font-size:12px;line-height:1.5;color:#64748b;">StockPilot Pro support will never ask for this OTP by email, phone, or chat.</p>
              </td>
            </tr>
          </table>
        </td>
      </tr>
    </table>
  </div>`

  return { subject, text, html }
}
