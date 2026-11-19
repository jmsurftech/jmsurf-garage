import * as React from 'npm:react@19.3.1'
// react-email's renderer takes react-dom as a peer; name 19.3.1 so it matches npm:react@19.3.1.
import 'npm:react-dom@19.3.1/server'
import { render } from 'npm:@react-email/components@1.0.12'
import { TEMPLATES } from './registry.ts'
import { sendPlatformEmail } from '../platform-smtp.ts'

// Server-only. Renders a registered template and delivers it through the SMTP
// server configured in the admin portal. Import from edge functions only —
// never expose sending to the browser.

export type SendTemplateEmailResult =
  | { sent: true }
  | { sent: false; reason: 'recipient_suppressed' }

export interface SendTemplateEmailOptions {
  templateData?: Record<string, any>
  /** Kept for call-site compatibility; SMTP delivery does not dedupe. */
  idempotencyKey?: string
  replyTo?: string
}

export async function sendTemplateEmail(
  templateName: string,
  to: string,
  options: SendTemplateEmailOptions = {}
): Promise<SendTemplateEmailResult> {
  const template = TEMPLATES[templateName]
  if (!template) {
    throw new Error(
      `Template '${templateName}' not found. Available: ${Object.keys(TEMPLATES).join(', ')}`
    )
  }

  // Template-level `to` takes precedence — notification templates always
  // send to their fixed address.
  const recipient = template.to || to
  if (!recipient) {
    throw new Error('Recipient is required (the template defines no fixed recipient)')
  }

  const templateData = options.templateData ?? {}
  const element = React.createElement(template.component, templateData)
  const html = await render(element)
  const text = await render(element, { plainText: true })
  const subject =
    typeof template.subject === 'function'
      ? template.subject(templateData)
      : template.subject

  await sendPlatformEmail({
    to: recipient,
    subject,
    html,
    text,
    replyTo: options.replyTo,
  })

  return { sent: true }
}
