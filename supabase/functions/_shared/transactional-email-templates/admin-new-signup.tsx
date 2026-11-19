/// <reference types="npm:@types/react@19.2.7" />
import * as React from 'npm:react@19.3.1'
import {
  Body,
  Container,
  Head,
  Heading,
  Hr,
  Html,
  Preview,
  Section,
  Text,
} from 'npm:@react-email/components@1.0.12'
import type { TemplateEntry } from './registry.ts'

interface Props {
  businessName?: string
  contactName?: string
  email?: string
  phone?: string
  industry?: string
  storeSlug?: string
  registeredAt?: string
}

const Row = ({ label, value }: { label: string; value?: string }) => (
  <Text style={row}>
    <span style={rowLabel}>{label}: </span>
    <span style={rowValue}>{value || '—'}</span>
  </Text>
)

const Email = ({
  businessName,
  contactName,
  email,
  phone,
  industry,
  storeSlug,
  registeredAt,
}: Props) => (
  <Html lang="en" dir="ltr">
    <Head />
    <Preview>New JMSURF DASH signup: {businessName || 'New business'}</Preview>
    <Body style={main}>
      <Container style={container}>
        <Heading style={h1}>New registration</Heading>
        <Text style={text}>
          A new business just created a free JMSURF DASH account.
        </Text>
        <Hr style={hr} />
        <Section>
          <Row label="Business" value={businessName} />
          <Row label="Contact" value={contactName} />
          <Row label="Email" value={email} />
          <Row label="Phone" value={phone} />
          <Row label="Industry" value={industry} />
          <Row label="Store URL" value={storeSlug ? `${storeSlug}.jmsurfdash.co.ke` : undefined} />
          <Row label="Registered" value={registeredAt} />
        </Section>
        <Hr style={hr} />
        <Text style={muted}>JMSURF DASH — automatic admin notification</Text>
      </Container>
    </Body>
  </Html>
)

export const template = {
  component: Email,
  subject: 'New JMSURF DASH registration',
  displayName: 'Admin: new signup',
  to: 'jmsurftech@gmail.com',
  previewData: {
    businessName: 'Business name',
    contactName: 'Contact name',
    email: 'Email address',
    phone: 'Phone number',
    industry: 'Retail',
    storeSlug: 'shop',
    registeredAt: '2 Sep 2026, 10:55',
  },
} satisfies TemplateEntry

const main = { backgroundColor: '#ffffff', fontFamily: 'Arial, sans-serif' }
const container = { padding: '24px 28px', maxWidth: '560px' }
const h1 = { color: '#0f172a', fontSize: '22px', margin: '0 0 8px' }
const text = { color: '#475569', fontSize: '14px', lineHeight: '22px' }
const row = { color: '#0f172a', fontSize: '14px', margin: '6px 0' }
const rowLabel = { color: '#64748b' }
const rowValue = { fontWeight: 600 }
const hr = { borderColor: '#e2e8f0', margin: '18px 0' }
const muted = { color: '#94a3b8', fontSize: '12px' }
