import { Resend } from 'resend'

const resend = new Resend(process.env.RESEND_API_KEY)

type CrmEmailOptions = {
  to: string
  subject: string
  react: React.ReactElement
  tags?: Array<{ name: string; value: string }>
  scheduledAt?: string // ISO date string for delayed send
}

export async function sendCrmEmail(options: CrmEmailOptions) {
  const fromAddress = process.env.EMAIL_FROM_ADDRESS || 'noreply@example.com'
  const fromName = process.env.NEXT_PUBLIC_SITE_NAME || 'Site Name'

  const { data, error } = await resend.emails.send({
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
