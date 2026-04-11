import type { PayloadHandler } from 'payload'
import { verifyResendSignature } from '../lib/webhooks/verify-resend'

export const resendWebhookHandler: PayloadHandler = async (req) => {
  const secret = process.env.RESEND_WEBHOOK_SECRET
  if (!secret) {
    return Response.json({ error: 'Webhook secret not configured' }, { status: 500 })
  }

  const rawBody = await req.text!()
  const svixId = req.headers.get('svix-id') || ''
  const svixTimestamp = req.headers.get('svix-timestamp') || ''
  const svixSignature = req.headers.get('svix-signature') || ''

  if (!verifyResendSignature(rawBody, {
    'svix-id': svixId,
    'svix-timestamp': svixTimestamp,
    'svix-signature': svixSignature,
  }, secret)) {
    return Response.json({ error: 'Invalid signature' }, { status: 401 })
  }

  let body: { type: string; data: Record<string, unknown> }
  try {
    body = JSON.parse(rawBody)
  } catch {
    return Response.json({ error: 'Invalid JSON body' }, { status: 400 })
  }

  const { type, data } = body

  // Extract contact_id from email tags for CRM correlation
  // Resend webhook tags are an object { key: value }, not an array
  const tags = data.tags as Record<string, string> | undefined
  const contactId = tags?.contact_id

  // Fire-and-forget event processing
  void processEvent(type, contactId, req).catch((err) => {
    req.payload.logger.error({ err, type }, 'Resend webhook event processing failed')
  })

  return Response.json({ received: true })
}

async function processEvent(
  type: string,
  contactId: string | undefined,
  req: Parameters<PayloadHandler>[0],
) {
  if (!contactId) {
    req.payload.logger.info({ type }, 'Resend event without contact_id tag, skipping')
    return
  }

  switch (type) {
    case 'email.opened': {
      await updateEngagementScore(contactId, 1, req)
      break
    }

    case 'email.clicked': {
      await updateEngagementScore(contactId, 3, req)
      break
    }

    case 'email.bounced': {
      req.payload.logger.warn({ contactId, type }, 'Email bounced for contact')
      break
    }

    default:
      req.payload.logger.info({ type }, 'Unhandled Resend webhook event')
  }
}

async function updateEngagementScore(
  twentyId: string,
  increment: number,
  req: Parameters<PayloadHandler>[0],
) {
  const existing = await req.payload.find({
    collection: 'contacts',
    where: { twentyId: { equals: twentyId } },
    limit: 1,
  })

  if (existing.docs.length === 0) {
    req.payload.logger.warn({ twentyId }, 'Resend event: no matching contact found')
    return
  }

  const contact = existing.docs[0]
  const currentScore = (contact as Record<string, unknown>).engagementScore as number || 0

  await req.payload.update({
    collection: 'contacts',
    id: contact.id,
    data: {
      engagementScore: currentScore + increment,
    },
    context: { skipCrmSync: true },
  })
}
