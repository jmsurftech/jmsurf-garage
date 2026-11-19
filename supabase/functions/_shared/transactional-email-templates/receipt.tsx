/// <reference types="npm:@types/react@19.2.7" />
import * as React from 'npm:react@19.3.1'
import { Body, Container, Head, Heading, Html, Link, Preview, Section, Text, Hr } from 'npm:@react-email/components@1.0.12'
import type { TemplateEntry } from './registry.ts'

const SITE_NAME = 'JMSURF DASH'
const SITE_URL = 'https://jmsurfdash.co.ke'

interface ReceiptProps {
  customerName?: string
  receiptNumber?: string
  total?: string
  date?: string
  businessName?: string
}

const ReceiptEmail = ({ customerName, receiptNumber, total, date, businessName }: ReceiptProps) => (
  <Html lang="en" dir="ltr">
    <Head />
    <Preview>Your receipt from {businessName || SITE_NAME}</Preview>
    <Body style={main}>
      <Container style={container}>
        <Section style={brandBar}>
          <Text style={brandText}>{(businessName || SITE_NAME).toUpperCase()}</Text>
        </Section>
        <Section style={card}>
          <Heading style={h1}>Thank you{customerName ? `, ${customerName}` : ''}!</Heading>
          <Text style={text}>Here is your receipt from {businessName || SITE_NAME}.</Text>
          <Section style={detailsBox}>
            {receiptNumber && <Text style={row}><strong style={rowLabel}>Receipt #</strong> {receiptNumber}</Text>}
            {date && <Text style={row}><strong style={rowLabel}>Date</strong> {date}</Text>}
            {total && <Text style={total_}><strong style={rowLabel}>Total</strong> <span style={totalAmt}>{total}</span></Text>}
          </Section>
          <Hr style={hr} />
          <Text style={footer}>We appreciate your business.</Text>
          <Text style={footerSmall}>
            Powered by JMSURF DASH · <Link href={SITE_URL} style={footerLink}>jmsurfdash.co.ke</Link>
          </Text>
        </Section>
      </Container>
    </Body>
  </Html>
)

export const template = {
  component: ReceiptEmail,
  subject: (d: Record<string, any>) => `Receipt ${d.receiptNumber || ''} from ${d.businessName || SITE_NAME}`.trim(),
  displayName: 'Sales receipt',
  previewData: { customerName: 'Customer', receiptNumber: 'R-1024', total: 'KES 2,500.00', date: '20 Apr 2026', businessName: 'JMSURF DASH' },
} satisfies TemplateEntry

const main = { backgroundColor: '#ffffff', fontFamily: "'Inter', Arial, sans-serif", margin: 0, padding: 0 }
const container = { maxWidth: '560px', margin: '0 auto', padding: '24px 16px' }
const brandBar = { padding: '20px 24px', backgroundColor: '#ea580c', borderRadius: '12px 12px 0 0', textAlign: 'center' as const }
const brandText = { color: '#ffffff', fontSize: '20px', fontWeight: 'bold' as const, letterSpacing: '0.08em', margin: 0, fontFamily: "'Space Grotesk', Arial, sans-serif" }
const card = { backgroundColor: '#ffffff', border: '1px solid #f1e4d8', borderTop: 'none', borderRadius: '0 0 12px 12px', padding: '32px 28px' }
const h1 = { fontSize: '24px', fontWeight: 'bold' as const, color: '#0f1f15', margin: '0 0 8px', fontFamily: "'Space Grotesk', Arial, sans-serif" }
const text = { fontSize: '15px', color: '#3f4a44', lineHeight: '1.6', margin: '0 0 16px' }
const detailsBox = { backgroundColor: '#fff4ed', borderRadius: '8px', padding: '16px 20px', margin: '16px 0' }
const row = { fontSize: '14px', color: '#0f1f15', margin: '6px 0' }
const rowLabel = { color: '#6b7570', fontWeight: 'normal' as const, marginRight: '8px' }
const total_ = { fontSize: '16px', color: '#0f1f15', margin: '12px 0 4px', borderTop: '1px solid #f1d9c2', paddingTop: '12px' }
const totalAmt = { color: '#ea580c', fontWeight: 'bold' as const, fontSize: '18px' }
const hr = { borderColor: '#f1e4d8', margin: '24px 0 16px' }
const footer = { fontSize: '13px', color: '#6b7570', margin: '0 0 8px' }
const footerSmall = { fontSize: '12px', color: '#9aa39e', margin: '8px 0 0' }
const footerLink = { color: '#ea580c', textDecoration: 'none' }
