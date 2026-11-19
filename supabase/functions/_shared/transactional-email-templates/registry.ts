/// <reference types="npm:@types/react@19.2.7" />
import * as React from 'npm:react@19.3.1'

export interface TemplateEntry {
  component: React.ComponentType<any>
  subject: string | ((data: Record<string, any>) => string)
  to?: string
  displayName?: string
  previewData?: Record<string, any>
}

import { template as welcome } from './welcome.tsx'
import { template as receipt } from './receipt.tsx'
import { template as invoice } from './invoice.tsx'
import { template as adminNewSignup } from './admin-new-signup.tsx'
import { template as temporaryPassword } from './temporary-password.tsx'
import { template as renewalConfirmation } from './renewal-confirmation.tsx'
import { template as subscriptionReminder } from './subscription-reminder.tsx'

export const TEMPLATES: Record<string, TemplateEntry> = {
  'welcome': welcome,
  'receipt': receipt,
  'invoice': invoice,
  'admin-new-signup': adminNewSignup,
  'temporary-password': temporaryPassword,
  'renewal-confirmation': renewalConfirmation,
  'subscription-reminder': subscriptionReminder,
}
