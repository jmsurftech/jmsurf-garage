/// <reference types="npm:@types/react@19.2.7" />
import * as React from 'npm:react@19.3.1'
import { Body, Button, Container, Head, Heading, Hr, Html, Preview, Section, Text } from 'npm:@react-email/components@1.0.12'
import type { TemplateEntry } from './registry.ts'

const SITE_NAME = 'JMSURF DASH'

interface TempPasswordProps {
  name?: string
  tempPassword?: string
  loginUrl?: string
}

const TemporaryPasswordEmail = ({ name, tempPassword, loginUrl }: TempPasswordProps) => (
  <Html lang="en" dir="ltr">
    <Head />
    <Preview>Your temporary password for {SITE_NAME}</Preview>
    <Body style={main}>
      <Container style={container}>
        <Section style={brandBar}>
          <Text style={brandText}>JMSURF DASH</Text>
        </Section>
        <Section style={card}>
          <Heading style={h1}>Your temporary password</Heading>
          <Text style={text}>{name ? `Hi ${name},` : 'Hi,'}</Text>
          <Text style={text}>
            A password reset was requested for your account. Sign in with the temporary password below.
            You will be asked to choose a new password immediately after signing in.
          </Text>
          <Text style={code}>{tempPassword || '------'}</Text>
          <Section style={buttonWrap}>
            <Button style={button} href={loginUrl || 'https://jmsurfdash.co.ke/login'}>Sign in</Button>
          </Section>
          <Hr style={hr} />
          <Text style={footer}>
            If you did not request this, sign in and change your password, or contact your administrator.
          </Text>
        </Section>
      </Container>
    </Body>
  </Html>
)

export const template = {
  component: TemporaryPasswordEmail,
  subject: 'Your temporary password',
  displayName: 'Temporary password',
  previewData: { name: 'Customer', tempPassword: 'Km7x4Rt9', loginUrl: 'https://jmsurfdash.co.ke/login' },
} satisfies TemplateEntry

const main = { backgroundColor: '#ffffff', fontFamily: "'Inter', Arial, sans-serif", margin: 0, padding: 0 }
const container = { maxWidth: '560px', margin: '0 auto', padding: '24px 16px' }
const brandBar = { padding: '20px 24px', backgroundColor: '#ea580c', borderRadius: '12px 12px 0 0', textAlign: 'center' as const }
const brandText = { color: '#ffffff', fontSize: '20px', fontWeight: 'bold' as const, letterSpacing: '0.08em', margin: 0 }
const card = { backgroundColor: '#ffffff', border: '1px solid #f1e4d8', borderTop: 'none', borderRadius: '0 0 12px 12px', padding: '32px 28px' }
const h1 = { fontSize: '22px', fontWeight: 'bold' as const, color: '#0f1f15', margin: '0 0 16px' }
const text = { fontSize: '15px', color: '#3f4a44', lineHeight: '1.6', margin: '0 0 14px' }
const code = { fontFamily: 'Courier, monospace', fontSize: '26px', fontWeight: 'bold' as const, letterSpacing: '0.12em', color: '#0f1f15', backgroundColor: '#fdf4ec', border: '1px solid #f1e4d8', borderRadius: '8px', padding: '14px 18px', textAlign: 'center' as const, margin: '8px 0 4px' }
const buttonWrap = { textAlign: 'center' as const, margin: '24px 0 4px' }
const button = { backgroundColor: '#ea580c', color: '#ffffff', fontSize: '15px', fontWeight: 'bold' as const, borderRadius: '8px', padding: '14px 28px', textDecoration: 'none', display: 'inline-block' }
const hr = { borderColor: '#f1e4d8', margin: '24px 0 16px' }
const footer = { fontSize: '13px', color: '#6b7570', margin: 0 }
