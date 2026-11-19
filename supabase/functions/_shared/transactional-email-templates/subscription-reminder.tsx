/// <reference types="npm:@types/react@19.2.7" />
import * as React from 'npm:react@19.3.1'
import { Body, Button, Container, Head, Heading, Hr, Html, Preview, Section, Text } from 'npm:@react-email/components@1.0.12'
import type { TemplateEntry } from './registry.ts'

interface ReminderProps {
  name?: string
  businessName?: string
  planName?: string
  amount?: string
  expiresOn?: string
  expired?: boolean
  billingUrl?: string
}

const ReminderEmail = ({ name, businessName, planName, amount, expiresOn, expired, billingUrl }: ReminderProps) => (
  <Html lang="en" dir="ltr">
    <Head />
    <Preview>{expired ? 'Your subscription has expired' : 'Your subscription expires soon'}</Preview>
    <Body style={main}>
      <Container style={container}>
        <Section style={brandBar}>
          <Text style={brandText}>JMSURF DASH</Text>
        </Section>
        <Section style={card}>
          <Heading style={h1}>
            {expired ? 'Your subscription has expired' : 'Your subscription expires in 3 days'}
          </Heading>
          <Text style={text}>{name ? `Hi ${name},` : 'Hi,'}</Text>
          <Text style={text}>
            {expired
              ? `The ${planName || ''} package for ${businessName || 'your shop'} expired on ${expiresOn || 'the due date'}. Renew now to restore full access.`
              : `The ${planName || ''} package for ${businessName || 'your shop'} expires on ${expiresOn || 'the due date'}. Renew now to keep working without interruption.`}
          </Text>
          <Section style={box}>
            <Text style={row}><strong>Package:</strong> {planName || '-'}</Text>
            <Text style={row}><strong>Amount due:</strong> KSH {amount || '0'}</Text>
            <Text style={row}><strong>{expired ? 'Expired on' : 'Expires on'}:</strong> {expiresOn || '-'}</Text>
          </Section>
          <Section style={buttonWrap}>
            <Button style={button} href={billingUrl || 'https://jmsurfdash.co.ke'}>Renew now</Button>
          </Section>
          <Hr style={hr} />
          <Text style={footer}>Need help renewing? Reply to this email and we will assist you.</Text>
        </Section>
      </Container>
    </Body>
  </Html>
)

export const template = {
  component: ReminderEmail,
  subject: (data: Record<string, any>) =>
    data?.expired ? 'Your JMSURF DASH subscription has expired' : 'Your JMSURF DASH subscription expires in 3 days',
  displayName: 'Subscription reminder',
  previewData: { name: 'Customer', businessName: 'Business name', planName: 'Basic', amount: '1,000', expiresOn: '21 September 2026' },
} satisfies TemplateEntry

const main = { backgroundColor: '#ffffff', fontFamily: "'Inter', Arial, sans-serif", margin: 0, padding: 0 }
const container = { maxWidth: '560px', margin: '0 auto', padding: '24px 16px' }
const brandBar = { padding: '20px 24px', backgroundColor: '#ea580c', borderRadius: '12px 12px 0 0', textAlign: 'center' as const }
const brandText = { color: '#ffffff', fontSize: '20px', fontWeight: 'bold' as const, letterSpacing: '0.08em', margin: 0 }
const card = { backgroundColor: '#ffffff', border: '1px solid #f1e4d8', borderTop: 'none', borderRadius: '0 0 12px 12px', padding: '32px 28px' }
const h1 = { fontSize: '22px', fontWeight: 'bold' as const, color: '#0f1f15', margin: '0 0 16px' }
const text = { fontSize: '15px', color: '#3f4a44', lineHeight: '1.6', margin: '0 0 14px' }
const box = { backgroundColor: '#fdf4ec', border: '1px solid #f1e4d8', borderRadius: '8px', padding: '16px 18px', margin: '8px 0' }
const row = { fontSize: '14px', color: '#3f4a44', margin: '0 0 6px' }
const buttonWrap = { textAlign: 'center' as const, margin: '24px 0 4px' }
const button = { backgroundColor: '#ea580c', color: '#ffffff', fontSize: '15px', fontWeight: 'bold' as const, borderRadius: '8px', padding: '14px 28px', textDecoration: 'none', display: 'inline-block' }
const hr = { borderColor: '#f1e4d8', margin: '24px 0 16px' }
const footer = { fontSize: '13px', color: '#6b7570', margin: 0 }
