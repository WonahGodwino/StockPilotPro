import nodemailer from 'nodemailer'
import { logger } from './logger'

type SendEmailInput = {
  to: string[]
  subject: string
  text: string
  html?: string
}

let transporter: nodemailer.Transporter | null = null

function getTransporter(): nodemailer.Transporter | null {
  if (transporter) return transporter

  const host = process.env.SMTP_HOST
  const port = Number(process.env.SMTP_PORT || '587')
  const user = process.env.SMTP_USER
  const pass = process.env.SMTP_PASS

  if (!host || !user || !pass) {
    logger.warn('SMTP configuration missing; email reminders will be skipped')
    return null
  }

  transporter = nodemailer.createTransport({
    host,
    port,
    secure: process.env.SMTP_SECURE === 'true',
    auth: { user, pass },
  })

  return transporter
}

export async function sendEmail(input: SendEmailInput): Promise<{ sent: boolean; error?: string }> {
  const tx = getTransporter()
  const from = process.env.SMTP_FROM || process.env.SMTP_USER

  if (!tx || !from) {
    return { sent: false, error: 'smtp_not_configured' }
  }

  try {
    await tx.sendMail({
      from,
      to: input.to.join(','),
      subject: input.subject,
      text: input.text,
      html: input.html,
    })

    return { sent: true }
  } catch (err) {
    logger.error('Failed to send email', { err, action: 'send_email' })
    return { sent: false, error: 'send_failed' }
  }
}
