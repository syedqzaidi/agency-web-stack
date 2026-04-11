import { Heading, Text } from '@react-email/components'
import * as React from 'react'

import { Layout } from './components/layout'

type ClosedWonCongratulationsProps = {
  firstName: string
  dealName: string
  amount: number
}

export default function ClosedWonCongratulations({
  firstName,
  dealName,
  amount,
}: ClosedWonCongratulationsProps) {
  const formattedAmount = new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: 'USD',
  }).format(amount)

  return (
    <Layout previewText={`Congratulations on closing ${dealName}!`}>
      <Heading as="h1" style={heading}>
        Congratulations!
      </Heading>
      <Text style={paragraph}>Hi {firstName},</Text>
      <Text style={paragraph}>
        Great news — the deal <strong>{dealName}</strong> has been successfully closed!
      </Text>
      <Text style={highlightBox}>
        Deal value: <strong>{formattedAmount}</strong>
      </Text>
      <Text style={paragraph}>
        Thank you for your trust in working with us. We're excited to get started and deliver
        outstanding results.
      </Text>
      <Text style={paragraph}>
        A member of our team will be in touch shortly to discuss next steps.
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

const highlightBox: React.CSSProperties = {
  backgroundColor: '#e8f5e9',
  borderLeft: '4px solid #2e7d32',
  color: '#1a1a2e',
  fontSize: '16px',
  lineHeight: '24px',
  margin: '0 0 12px',
  padding: '12px 16px',
}
