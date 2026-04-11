import type { PayloadHandler } from 'payload'
import { verifyTwentySignature } from '../lib/webhooks/verify-twenty'
import { sendCrmEmail } from '../lib/email/send'
import WelcomeContact from '../emails/welcome-contact'
import ClosedWonCongratulations from '../emails/closed-won-congratulations'
import FollowUpReminder from '../emails/follow-up-reminder'

export const twentyWebhookHandler: PayloadHandler = async (req) => {
  const secret = process.env.TWENTY_WEBHOOK_SECRET
  if (!secret) {
    return Response.json({ error: 'Webhook secret not configured' }, { status: 500 })
  }

  // Payload 3.x: req.text() may be optional on PayloadRequest
  const rawBody = await req.text!()
  const signature = req.headers.get('x-twenty-webhook-signature') || ''

  if (!verifyTwentySignature(rawBody, signature, secret)) {
    return Response.json({ error: 'Invalid signature' }, { status: 401 })
  }

  let body: { event: string; data: Record<string, unknown>; timestamp?: string }
  try {
    body = JSON.parse(rawBody)
  } catch {
    return Response.json({ error: 'Invalid JSON body' }, { status: 400 })
  }

  const { event, data } = body

  // Fire-and-forget event processing
  void processEvent(event, data, req).catch((err) => {
    req.payload.logger.error({ err, event }, 'Twenty webhook event processing failed')
  })

  return Response.json({ received: true })
}

async function processEvent(
  event: string,
  data: Record<string, unknown>,
  req: Parameters<PayloadHandler>[0],
) {
  switch (event) {
    // Twenty webhook payload uses FLAT fields (per docs):
    // { id, firstName, lastName, email, createdAt, ... }
    // This is DIFFERENT from the GraphQL schema which uses composite fields
    // (emails.primaryEmail, name.firstName, etc.)

    case 'person.created': {
      const email = data.email as string | undefined
      const firstName = (data.firstName as string) || ''
      const lastName = (data.lastName as string) || ''
      const twentyId = data.id as string

      if (!email) {
        req.payload.logger.warn({ data }, 'Twenty person.created missing email, skipping')
        return
      }

      // Upsert: check for existing contact to avoid unique constraint violation
      const existing = await req.payload.find({
        collection: 'contacts',
        where: { email: { equals: email } },
        limit: 1,
      })

      if (existing.docs.length > 0) {
        await req.payload.update({
          collection: 'contacts',
          id: existing.docs[0].id,
          data: { firstName, lastName, twentyId, source: 'twenty-webhook', lastSyncedAt: new Date().toISOString() },
          context: { skipCrmSync: true },
        })
      } else {
        await req.payload.create({
          collection: 'contacts',
          data: {
            email,
            firstName,
            lastName,
            twentyId,
            source: 'twenty-webhook',
            lastSyncedAt: new Date().toISOString(),
          },
          context: { skipCrmSync: true },
        })
      }

      await sendCrmEmail({
        to: email,
        subject: 'Welcome!',
        react: WelcomeContact({ firstName, email }),
        tags: [
          { name: 'contact_id', value: twentyId },
          { name: 'email_type', value: 'welcome' },
        ],
      }).catch((err) => {
        req.payload.logger.error({ err, email }, '[twenty-webhook] Failed to send welcome email')
      })
      break
    }

    case 'person.updated': {
      const twentyId = data.id as string
      const email = data.email as string | undefined
      const firstName = (data.firstName as string) || undefined
      const lastName = (data.lastName as string) || undefined

      const existing = await req.payload.find({
        collection: 'contacts',
        where: { twentyId: { equals: twentyId } },
        limit: 1,
      })

      if (existing.docs.length === 0) {
        req.payload.logger.warn({ twentyId }, 'Twenty person.updated: no matching contact found')
        return
      }

      await req.payload.update({
        collection: 'contacts',
        id: existing.docs[0].id,
        data: {
          ...(email && { email }),
          ...(firstName && { firstName }),
          ...(lastName && { lastName }),
          lastSyncedAt: new Date().toISOString(),
        },
        context: { skipCrmSync: true },
      })
      break
    }

    case 'opportunity.stage_changed': {
      if (data.stage !== 'CLOSED_WON') return

      // Twenty webhook sends flat fields for the opportunity object
      // Contact info may not be denormalized — use pointOfContactId to look up
      const dealName = (data.name as string) || 'your deal'
      const pointOfContactId = data.pointOfContactId as string | undefined

      // Amount in Twenty is { amountMicros, currencyCode } but webhook may flatten it
      const rawAmount = data.amount as number | { amountMicros?: number } | undefined
      const amountMicros = typeof rawAmount === 'number'
        ? rawAmount
        : (rawAmount?.amountMicros ?? 0)
      const amount = amountMicros / 1_000_000 // Convert micros to dollars

      if (!pointOfContactId) {
        req.payload.logger.warn({ data }, 'opportunity.stage_changed missing pointOfContactId')
        return
      }

      // Look up the contact's email from Payload contacts by twentyId
      const contact = await req.payload.find({
        collection: 'contacts',
        where: { twentyId: { equals: pointOfContactId } },
        limit: 1,
      })

      const contactDoc = contact.docs[0] as Record<string, unknown> | undefined
      const email = contactDoc?.email as string | undefined
      const firstName = (contactDoc?.firstName as string) || ''

      if (!email) {
        req.payload.logger.warn({ pointOfContactId }, 'opportunity.stage_changed: no contact email found')
        return
      }

      const emailTags = [{ name: 'contact_id', value: pointOfContactId }]

      // Send congratulations and follow-up independently
      await sendCrmEmail({
        to: email,
        subject: 'Congratulations on your new deal!',
        react: ClosedWonCongratulations({ firstName, dealName, amount }),
        tags: [...emailTags, { name: 'email_type', value: 'closed_won' }],
      }).catch((err) => {
        req.payload.logger.error({ err, email }, '[twenty-webhook] Failed to send closed-won email')
      })

      const sevenDays = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString()
      await sendCrmEmail({
        to: email,
        subject: 'Following up...',
        react: FollowUpReminder({ firstName, originalDealName: dealName }),
        tags: [...emailTags, { name: 'email_type', value: 'follow_up' }],
        scheduledAt: sevenDays,
      }).catch((err) => {
        req.payload.logger.error({ err, email }, '[twenty-webhook] Failed to schedule follow-up email')
      })
      break
    }

    default:
      req.payload.logger.info({ event }, 'Unhandled Twenty webhook event')
  }
}
