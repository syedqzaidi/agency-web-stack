import type { ReactElement } from 'react'
import { Resend } from 'resend'

let _resend: Resend | undefined

function getResendClient(): Resend {
  if (!_resend) {
    const key = process.env.RESEND_API_KEY
    if (!key) throw new Error('RESEND_API_KEY is required to send CRM emails')
    _resend = new Resend(key)
  }
  return _resend
}

type CrmEmailOptions = {
  to: string
  subject: string
  react: ReactElement
  tags?: Array<{ name: string; value: string }>
  scheduledAt?: string // ISO date string for delayed send
}

export async function sendCrmEmail(options: CrmEmailOptions) {
  const fromAddress = process.env.EMAIL_FROM_ADDRESS || 'noreply@example.com'
  const fromName = process.env.NEXT_PUBLIC_SITE_NAME || 'Site Name'

  const { data, error } = await getResendClient().emails.send({
    from: `${fromName} <${fromAddress}>`,
    to: options.to,
    subject: options.subject,
    react: options.react,
    tags: options.tags,
    ...(options.scheduledAt && { scheduledAt: options.scheduledAt }),
  })

  if (error) {
    throw new Error(`Failed to send CRM email: ${error.message}`)
  }

  return data
}
