/// <reference types="npm:@types/react@19.2.7" />
import * as React from 'npm:react@19.3.1'
import { Body, Button, Container, Head, Heading, Hr, Html, Preview, Section, Text } from 'npm:@react-email/components@1.0.12'
import type { TemplateEntry } from './registry.ts'

interface RenewalProps {
  name?: string
  businessName?: string
  planName?: string
  amount?: string
  cycle?: string
  reference?: string
  expiresOn?: string
  billingUrl?: string
}

const RenewalEmail = ({ name, businessName, planName, amount, cycle, reference, expiresOn, billingUrl }: RenewalProps) => (
  <Html lang="en" dir="ltr">
    <Head />
    <Preview>Payment received - your subscription is renewed</Preview>
    <Body style={main}>
      <Container style={container}>
        <Section style={brandBar}>
          <Text style={brandText}>JMSURF DASH</Text>
        </Section>
        <Section style={card}>
          <Heading style={h1}>Payment received</Heading>
          <Text style={text}>{name ? `Hi ${name},` : 'Hi,'}</Text>
          <Text style={text}>
            We have received your payment{businessName ? ` for ${businessName}` : ''} and your subscription is now active.
          </Text>
          <Section style={box}>
            <Text style={row}><strong>Package:</strong> {planName || '-'}</Text>
            <Text style={row}><strong>Amount paid:</strong> KSH {amount || '0'}</Text>
            <Text style={row}><strong>Billing period:</strong> {cycle || 'monthly'}</Text>
            <Text style={row}><strong>Expires on:</strong> {expiresOn || '-'}</Text>
            <Text style={row}><strong>Reference:</strong> {reference || '-'}</Text>
          </Section>
          <Section style={buttonWrap}>
            <Button style={button} href={billingUrl || 'https://jmsurfdash.co.ke'}>View billing</Button>
          </Section>
          <Hr style={hr} />
          <Text style={footer}>Thank you for choosing JMSURF DASH. We appreciate your business.</Text>
        </Section>
      </Container>
    </Body>
  </Html>
)

export const template = {
  component: RenewalEmail,
  subject: (data: Record<string, any>) => `Payment received - ${data?.planName || 'subscription'} renewed`,
  displayName: 'Renewal confirmation',
  previewData: {
    name: 'Customer', businessName: 'Business name', planName: 'Basic', amount: '1,000',
    cycle: 'monthly', reference: 'ws_CO_123', expiresOn: '18 October 2026',
  },
} satisfies TemplateEntry

const main = { backgroundColor: '#ffffff', fontFamily: "'Inter', Arial, sans-serif", margin: 0, padding: 0 }
const container = { maxWidth: '560px', margin: '0 auto', padding: '24px 16px' }
const brandBar = { padding: '20px 24px', backgroundColor: '#ea580c', borderRadius: '12px 12px 0 0', textAlign: 'center' as const }
const brandText = { color: '#ffffff', fontSize: '20px', fontWeight: 'bold' as const, letterSpacing: '0.08em', margin: 0 }
const card = { backgroundColor: '#ffffff', border: '1px solid #f1e4d8', borderTop: 'none', borderRadius: '0 0 12px 12px', padding: '32px 28px' }
const h1 = { fontSize: '22px', fontWeight: 'bold' as const, color: '#166534', margin: '0 0 16px' }
const text = { fontSize: '15px', color: '#3f4a44', lineHeight: '1.6', margin: '0 0 14px' }
const box = { backgroundColor: '#fdf4ec', border: '1px solid #f1e4d8', borderRadius: '8px', padding: '16px 18px', margin: '8px 0' }
const row = { fontSize: '14px', color: '#3f4a44', margin: '0 0 6px' }
const buttonWrap = { textAlign: 'center' as const, margin: '24px 0 4px' }
const button = { backgroundColor: '#ea580c', color: '#ffffff', fontSize: '15px', fontWeight: 'bold' as const, borderRadius: '8px', padding: '14px 28px', textDecoration: 'none', display: 'inline-block' }
const hr = { borderColor: '#f1e4d8', margin: '24px 0 16px' }
const footer = { fontSize: '13px', color: '#6b7570', margin: 0 }
