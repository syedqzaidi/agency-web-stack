import { Heading, Text } from '@react-email/components'
import * as React from 'react'

import { Layout } from './components/layout'

type FollowUpReminderProps = {
  firstName: string
  originalDealName: string
}

export default function FollowUpReminder({
  firstName,
  originalDealName,
}: FollowUpReminderProps) {
  return (
    <Layout previewText={`Follow-up reminder: ${originalDealName}`}>
      <Heading as="h1" style={heading}>
        Follow-Up Reminder
      </Heading>
      <Text style={paragraph}>Hi {firstName},</Text>
      <Text style={paragraph}>
        This is a friendly reminder to follow up regarding the deal{' '}
        <strong>{originalDealName}</strong>.
      </Text>
      <Text style={paragraph}>
        Checking in after a closed deal is a great opportunity to ensure satisfaction, gather
        feedback, and explore additional ways we can support you.
      </Text>
      <Text style={paragraph}>
        We'd love to hear how things are going. Feel free to reply to this email at your
        convenience.
      </Text>
    </Layout>
  )
}

const heading: React.CSSProperties = {
  color: '#1a1a2e',
  fontSize: '24px',
  fontWeight: 700,
  lineHeight: '32px',
  margin: '0 0 16px',
}

const paragraph: React.CSSProperties = {
  color: '#525f7f',
  fontSize: '15px',
  lineHeight: '24px',
  margin: '0 0 12px',
}
