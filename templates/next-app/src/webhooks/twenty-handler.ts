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

  const rawBody = await req.text()
  const signature = req.headers.get('x-twenty-webhook-signature') || ''

  if (!verifyTwentySignature(rawBody, signature, secret)) {
    return Response.json({ error: 'Invalid signature' }, { status: 401 })
  }

  const body = JSON.parse(rawBody) as {
    event: string
    data: Record<string, unknown>
    timestamp?: string
  }

  // Respond immediately, process async
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
    case 'person.created': {
      const email = data.email as string | undefined
      const nameObj = data.name as { firstName?: string; lastName?: string } | undefined
      const firstName = nameObj?.firstName || ''
      const lastName = nameObj?.lastName || ''
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
      })
      break
    }

    case 'person.updated': {
      const twentyId = data.id as string
      const email = data.email as string | undefined
      const nameObj = data.name as { firstName?: string; lastName?: string } | undefined
      const firstName = nameObj?.firstName || undefined
      const lastName = nameObj?.lastName || undefined

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

      const email = data.contactEmail as string | undefined
      const firstName = (data.contactFirstName as string) || ''
      const dealName = (data.name as string) || (data.dealName as string) || 'your deal'
      const amount = (data.amount as number) || 0
      const contactId = (data.id as string) || ''

      if (!email) {
        req.payload.logger.warn({ data }, 'opportunity.stage_changed missing contactEmail')
        return
      }

      // Send congratulations email
      await sendCrmEmail({
        to: email,
        subject: 'Congratulations on your new deal!',
        react: ClosedWonCongratulations({ firstName, dealName, amount }),
        tags: [
          { name: 'contact_id', value: contactId },
          { name: 'email_type', value: 'closed_won' },
        ],
      })

      // Schedule 7-day follow-up
      const sevenDays = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString()
      await sendCrmEmail({
        to: email,
        subject: 'Following up...',
        react: FollowUpReminder({ firstName, originalDealName: dealName }),
        tags: [
          { name: 'contact_id', value: contactId },
          { name: 'email_type', value: 'follow_up' },
        ],
        scheduledAt: sevenDays,
      })
      break
    }

    default:
      // Unhandled event — log and ignore
      req.payload.logger.info({ event }, 'Unhandled Twenty webhook event')
  }
}
