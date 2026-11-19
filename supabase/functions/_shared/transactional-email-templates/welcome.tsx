/// <reference types="npm:@types/react@19.2.7" />
import * as React from 'npm:react@19.3.1'
import { Body, Button, Container, Head, Heading, Hr, Html, Link, Preview, Section, Text } from 'npm:@react-email/components@1.0.12'
import type { TemplateEntry } from './registry.ts'

const SITE_NAME = 'JMSURF DASH'
const SITE_URL = 'https://jmsurfdash.co.ke'

interface WelcomeProps {
  name?: string
  loginUrl?: string
}

const WelcomeEmail = ({ name, loginUrl }: WelcomeProps) => (
  <Html lang="en" dir="ltr">
    <Head />
    <Preview>Welcome to {SITE_NAME}</Preview>
    <Body style={main}>
      <Container style={container}>
        <Section style={brandBar}>
          <Text style={brandText}>JMSURF DASH</Text>
        </Section>
        <Section style={card}>
          <Heading style={h1}>{name ? `Welcome, ${name}!` : `Welcome to ${SITE_NAME}!`}</Heading>
          <Text style={text}>
            Your account is ready. Start managing your sales, inventory, and customers from one beautiful place.
          </Text>
          <Section style={buttonWrap}>
            <Button style={button} href={loginUrl || `${SITE_URL}/login`}>Log in to {SITE_NAME}</Button>
          </Section>
          <Hr style={hr} />
          <Text style={footer}>Need help? Reply to this email any time.</Text>
          <Text style={footerSmall}>
            JMSURF DASH · Nairobi, Kenya · <Link href={SITE_URL} style={footerLink}>jmsurfdash.co.ke</Link>
          </Text>
        </Section>
      </Container>
    </Body>
  </Html>
)

export const template = {
  component: WelcomeEmail,
  subject: 'Welcome to JMSURF DASH',
  displayName: 'Welcome',
  previewData: { name: 'Customer', loginUrl: 'https://jmsurfdash.co.ke/login' },
} satisfies TemplateEntry

const main = { backgroundColor: '#ffffff', fontFamily: "'Inter', Arial, sans-serif", margin: 0, padding: 0 }
const container = { maxWidth: '560px', margin: '0 auto', padding: '24px 16px' }
const brandBar = { padding: '20px 24px', backgroundColor: '#ea580c', borderRadius: '12px 12px 0 0', textAlign: 'center' as const }
const brandText = { color: '#ffffff', fontSize: '20px', fontWeight: 'bold' as const, letterSpacing: '0.08em', margin: 0, fontFamily: "'Space Grotesk', Arial, sans-serif" }
const card = { backgroundColor: '#ffffff', border: '1px solid #f1e4d8', borderTop: 'none', borderRadius: '0 0 12px 12px', padding: '32px 28px' }
const h1 = { fontSize: '24px', fontWeight: 'bold' as const, color: '#0f1f15', margin: '0 0 16px', fontFamily: "'Space Grotesk', Arial, sans-serif" }
const text = { fontSize: '15px', color: '#3f4a44', lineHeight: '1.6', margin: '0 0 16px' }
const buttonWrap = { textAlign: 'center' as const, margin: '28px 0' }
const button = { backgroundColor: '#ea580c', color: '#ffffff', fontSize: '15px', fontWeight: 'bold' as const, borderRadius: '8px', padding: '14px 28px', textDecoration: 'none', display: 'inline-block' }
const hr = { borderColor: '#f1e4d8', margin: '24px 0 16px' }
const footer = { fontSize: '13px', color: '#6b7570', margin: '0 0 8px' }
const footerSmall = { fontSize: '12px', color: '#9aa39e', margin: '8px 0 0' }
const footerLink = { color: '#ea580c', textDecoration: 'none' }
