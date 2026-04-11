import { Heading, Text } from '@react-email/components'
import * as React from 'react'

import { Layout } from './components/layout'

type DealStageNotificationProps = {
  firstName: string
  dealName: string
  stage: string
  amount?: number
}

export default function DealStageNotification({
  firstName,
  dealName,
  stage,
  amount,
}: DealStageNotificationProps) {
  const formattedAmount = amount
    ? new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format(amount)
    : null

  return (
    <Layout previewText={`Deal update: ${dealName} moved to ${stage}`}>
      <Heading as="h1" style={heading}>
        Deal Stage Update
      </Heading>
      <Text style={paragraph}>Hi {firstName},</Text>
      <Text style={paragraph}>
        Your deal <strong>{dealName}</strong> has moved to the{' '}
        <strong>{stage}</strong> stage.
      </Text>
      {formattedAmount && (
        <Text style={amountText}>Deal value: {formattedAmount}</Text>
      )}
      <Text style={paragraph}>
        If you have any questions about this update, please don't hesitate to reach out.
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

const amountText: React.CSSProperties = {
  backgroundColor: '#f6f9fc',
  borderLeft: '4px solid #1a1a2e',
  color: '#1a1a2e',
  fontSize: '16px',
  fontWeight: 600,
  lineHeight: '24px',
  margin: '0 0 12px',
  padding: '12px 16px',
}
