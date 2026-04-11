import { Heading, Text } from '@react-email/components'
import * as React from 'react'

import { Layout } from './components/layout'

type WelcomeContactProps = {
  firstName: string
  email: string
}

export default function WelcomeContact({ firstName, email }: WelcomeContactProps) {
  return (
    <Layout previewText={`Welcome, ${firstName}!`}>
      <Heading as="h1" style={heading}>
        Welcome, {firstName}!
      </Heading>
      <Text style={paragraph}>
        Thank you for connecting with us. We're glad to have you on board and look forward to
        working together.
      </Text>
      <Text style={paragraph}>
        We've registered your contact information ({email}) and will keep you updated on any
        relevant opportunities.
      </Text>
      <Text style={paragraph}>
        If you have any questions, feel free to reply to this email — we're here to help.
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
