import {
  Body,
  Container,
  Head,
  Hr,
  Html,
  Preview,
  Section,
  Text,
} from '@react-email/components'
import * as React from 'react'

type LayoutProps = {
  children: React.ReactNode
  previewText?: string
}

export function Layout({ children, previewText }: LayoutProps) {
  const siteName = process.env.NEXT_PUBLIC_SITE_NAME || 'Site Name'

  return (
    <Html>
      <Head />
      {previewText && <Preview>{previewText}</Preview>}
      <Body style={body}>
        <Container style={container}>
          <Section style={header}>
            <Text style={headerText}>{siteName}</Text>
          </Section>

          <Section style={content}>{children}</Section>

          <Hr style={divider} />

          <Section style={footer}>
            <Text style={footerText}>
              This email was sent by {siteName}. If you believe you received this in error, please
              disregard it.
            </Text>
          </Section>
        </Container>
      </Body>
    </Html>
  )
}

const body: React.CSSProperties = {
  backgroundColor: '#f6f9fc',
  fontFamily:
    '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif',
  margin: 0,
  padding: 0,
}

const container: React.CSSProperties = {
  backgroundColor: '#ffffff',
  border: '1px solid #e6ebf1',
  borderRadius: '6px',
  margin: '40px auto',
  maxWidth: '560px',
  padding: '0',
}

const header: React.CSSProperties = {
  backgroundColor: '#1a1a2e',
  borderRadius: '6px 6px 0 0',
  padding: '24px 32px',
}

const headerText: React.CSSProperties = {
  color: '#ffffff',
  fontSize: '20px',
  fontWeight: 700,
  margin: 0,
}

const content: React.CSSProperties = {
  padding: '32px',
}

const divider: React.CSSProperties = {
  borderColor: '#e6ebf1',
  margin: '0 32px',
}

const footer: React.CSSProperties = {
  padding: '16px 32px 24px',
}

const footerText: React.CSSProperties = {
  color: '#8898aa',
  fontSize: '12px',
  lineHeight: '16px',
  margin: 0,
}
