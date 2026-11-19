export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json | undefined }
  | Json[]

export type Database = {
  // Allows to automatically instantiate createClient with right options
  // instead of createClient<Database, { PostgrestVersion: 'XX' }>(URL, KEY)
  __InternalSupabase: {
    PostgrestVersion: "14.5"
  }
  public: {
    Tables: {
      aggregator_audit_events: {
        Row: {
          aggregator_tenant_id: string
          aggregator_transaction_id: string | null
          created_at: string
          event_type: string
          id: string
          message: string
          metadata: Json
          payout_id: string | null
          pos_transaction_id: string | null
          status: string
        }
        Insert: {
          aggregator_tenant_id: string
          aggregator_transaction_id?: string | null
          created_at?: string
          event_type: string
          id?: string
          message: string
          metadata?: Json
          payout_id?: string | null
          pos_transaction_id?: string | null
          status: string
        }
        Update: {
          aggregator_tenant_id?: string
          aggregator_transaction_id?: string | null
          created_at?: string
          event_type?: string
          id?: string
          message?: string
          metadata?: Json
          payout_id?: string | null
          pos_transaction_id?: string | null
          status?: string
        }
        Relationships: [
          {
            foreignKeyName: "aggregator_audit_events_aggregator_tenant_id_fkey"
            columns: ["aggregator_tenant_id"]
            isOneToOne: false
            referencedRelation: "aggregator_tenant_balances"
            referencedColumns: ["aggregator_tenant_id"]
          },
          {
            foreignKeyName: "aggregator_audit_events_aggregator_tenant_id_fkey"
            columns: ["aggregator_tenant_id"]
            isOneToOne: false
            referencedRelation: "aggregator_tenants"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "aggregator_audit_events_aggregator_transaction_id_fkey"
            columns: ["aggregator_transaction_id"]
            isOneToOne: false
            referencedRelation: "aggregator_transactions"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "aggregator_audit_events_payout_id_fkey"
            columns: ["payout_id"]
            isOneToOne: false
            referencedRelation: "aggregator_payouts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "aggregator_audit_events_pos_transaction_id_fkey"
            columns: ["pos_transaction_id"]
            isOneToOne: false
            referencedRelation: "transactions"
            referencedColumns: ["id"]
          },
        ]
      }
      aggregator_ledger: {
        Row: {
          aggregator_tenant_id: string
          amount: number
          created_at: string
          entry_type: string
          id: string
          notes: string | null
          ref_payout_id: string | null
          ref_transaction_id: string | null
        }
        Insert: {
          aggregator_tenant_id: string
          amount: number
          created_at?: string
          entry_type: string
          id?: string
          notes?: string | null
          ref_payout_id?: string | null
          ref_transaction_id?: string | null
        }
        Update: {
          aggregator_tenant_id?: string
          amount?: number
          created_at?: string
          entry_type?: string
          id?: string
          notes?: string | null
          ref_payout_id?: string | null
          ref_transaction_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "aggregator_ledger_aggregator_tenant_id_fkey"
            columns: ["aggregator_tenant_id"]
            isOneToOne: false
            referencedRelation: "aggregator_tenant_balances"
            referencedColumns: ["aggregator_tenant_id"]
          },
          {
            foreignKeyName: "aggregator_ledger_aggregator_tenant_id_fkey"
            columns: ["aggregator_tenant_id"]
            isOneToOne: false
            referencedRelation: "aggregator_tenants"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "aggregator_ledger_ref_payout_id_fkey"
            columns: ["ref_payout_id"]
            isOneToOne: false
            referencedRelation: "aggregator_payouts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "aggregator_ledger_ref_transaction_id_fkey"
            columns: ["ref_transaction_id"]
            isOneToOne: false
            referencedRelation: "aggregator_transactions"
            referencedColumns: ["id"]
          },
        ]
      }
      aggregator_payouts: {
        Row: {
          aggregator_tenant_id: string
          amount: number
          attempts: number
          channel: string
          conversation_id: string | null
          created_at: string
          destination_account: string | null
          destination_ref: string
          destination_type: string
          failure_reason: string | null
          id: string
          idempotency_key: string | null
          is_test_payout: boolean
          last_attempt_at: string | null
          mpesa_receipt: string | null
          next_retry_at: string | null
          originator_conversation_id: string | null
          parent_payout_id: string | null
          provider_ref: string | null
          raw_result: Json | null
          result_code: number | null
          result_desc: string | null
          retry_count: number
          source_transaction_id: string | null
          status: string
          updated_at: string
        }
        Insert: {
          aggregator_tenant_id: string
          amount: number
          attempts?: number
          channel: string
          conversation_id?: string | null
          created_at?: string
          destination_account?: string | null
          destination_ref: string
          destination_type: string
          failure_reason?: string | null
          id?: string
          idempotency_key?: string | null
          is_test_payout?: boolean
          last_attempt_at?: string | null
          mpesa_receipt?: string | null
          next_retry_at?: string | null
          originator_conversation_id?: string | null
          parent_payout_id?: string | null
          provider_ref?: string | null
          raw_result?: Json | null
          result_code?: number | null
          result_desc?: string | null
          retry_count?: number
          source_transaction_id?: string | null
          status?: string
          updated_at?: string
        }
        Update: {
          aggregator_tenant_id?: string
          amount?: number
          attempts?: number
          channel?: string
          conversation_id?: string | null
          created_at?: string
          destination_account?: string | null
          destination_ref?: string
          destination_type?: string
          failure_reason?: string | null
          id?: string
          idempotency_key?: string | null
          is_test_payout?: boolean
          last_attempt_at?: string | null
          mpesa_receipt?: string | null
          next_retry_at?: string | null
          originator_conversation_id?: string | null
          parent_payout_id?: string | null
          provider_ref?: string | null
          raw_result?: Json | null
          result_code?: number | null
          result_desc?: string | null
          retry_count?: number
          source_transaction_id?: string | null
          status?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "aggregator_payouts_aggregator_tenant_id_fkey"
            columns: ["aggregator_tenant_id"]
            isOneToOne: false
            referencedRelation: "aggregator_tenant_balances"
            referencedColumns: ["aggregator_tenant_id"]
          },
          {
            foreignKeyName: "aggregator_payouts_aggregator_tenant_id_fkey"
            columns: ["aggregator_tenant_id"]
            isOneToOne: false
            referencedRelation: "aggregator_tenants"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "aggregator_payouts_parent_payout_id_fkey"
            columns: ["parent_payout_id"]
            isOneToOne: false
            referencedRelation: "aggregator_payouts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "aggregator_payouts_source_transaction_id_fkey"
            columns: ["source_transaction_id"]
            isOneToOne: false
            referencedRelation: "aggregator_transactions"
            referencedColumns: ["id"]
          },
        ]
      }
      aggregator_settings: {
        Row: {
          brand_name: string
          commission_percent: number
          id: string
          support_phone: string | null
          updated_at: string
          updated_by: string | null
        }
        Insert: {
          brand_name?: string
          commission_percent?: number
          id?: string
          support_phone?: string | null
          updated_at?: string
          updated_by?: string | null
        }
        Update: {
          brand_name?: string
          commission_percent?: number
          id?: string
          support_phone?: string | null
          updated_at?: string
          updated_by?: string | null
        }
        Relationships: []
      }
      aggregator_tenants: {
        Row: {
          auto_payout_enabled: boolean
          created_at: string
          email: string
          id: string
          is_active: boolean
          min_payout_amount: number
          mpesa_number: string
          mpesa_type: string
          name: string
          payout_bank_account: string | null
          payout_bank_account_name: string | null
          payout_bank_code: string | null
          payout_destination_type: string
          payout_paybill_account: string | null
          payout_paybill_number: string | null
          payout_till_number: string | null
          phone: string
          slug: string
          updated_at: string
          user_id: string | null
        }
        Insert: {
          auto_payout_enabled?: boolean
          created_at?: string
          email: string
          id?: string
          is_active?: boolean
          min_payout_amount?: number
          mpesa_number?: string
          mpesa_type?: string
          name: string
          payout_bank_account?: string | null
          payout_bank_account_name?: string | null
          payout_bank_code?: string | null
          payout_destination_type?: string
          payout_paybill_account?: string | null
          payout_paybill_number?: string | null
          payout_till_number?: string | null
          phone: string
          slug: string
          updated_at?: string
          user_id?: string | null
        }
        Update: {
          auto_payout_enabled?: boolean
          created_at?: string
          email?: string
          id?: string
          is_active?: boolean
          min_payout_amount?: number
          mpesa_number?: string
          mpesa_type?: string
          name?: string
          payout_bank_account?: string | null
          payout_bank_account_name?: string | null
          payout_bank_code?: string | null
          payout_destination_type?: string
          payout_paybill_account?: string | null
          payout_paybill_number?: string | null
          payout_till_number?: string | null
          phone?: string
          slug?: string
          updated_at?: string
          user_id?: string | null
        }
        Relationships: []
      }
      aggregator_transactions: {
        Row: {
          aggregator_tenant_id: string
          amount: number
          checkout_request_id: string | null
          commission_amount: number
          commission_percent: number
          created_at: string
          customer_phone: string
          destination_number: string
          destination_type: string
          id: string
          merchant_request_id: string | null
          mpesa_receipt: string | null
          pos_transaction_id: string | null
          raw_callback: Json | null
          result_code: number | null
          result_desc: string | null
          status: string
          updated_at: string
        }
        Insert: {
          aggregator_tenant_id: string
          amount: number
          checkout_request_id?: string | null
          commission_amount?: number
          commission_percent?: number
          created_at?: string
          customer_phone: string
          destination_number: string
          destination_type: string
          id?: string
          merchant_request_id?: string | null
          mpesa_receipt?: string | null
          pos_transaction_id?: string | null
          raw_callback?: Json | null
          result_code?: number | null
          result_desc?: string | null
          status?: string
          updated_at?: string
        }
        Update: {
          aggregator_tenant_id?: string
          amount?: number
          checkout_request_id?: string | null
          commission_amount?: number
          commission_percent?: number
          created_at?: string
          customer_phone?: string
          destination_number?: string
          destination_type?: string
          id?: string
          merchant_request_id?: string | null
          mpesa_receipt?: string | null
          pos_transaction_id?: string | null
          raw_callback?: Json | null
          result_code?: number | null
          result_desc?: string | null
          status?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "aggregator_transactions_aggregator_tenant_id_fkey"
            columns: ["aggregator_tenant_id"]
            isOneToOne: false
            referencedRelation: "aggregator_tenant_balances"
            referencedColumns: ["aggregator_tenant_id"]
          },
          {
            foreignKeyName: "aggregator_transactions_aggregator_tenant_id_fkey"
            columns: ["aggregator_tenant_id"]
            isOneToOne: false
            referencedRelation: "aggregator_tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      bill_categories: {
        Row: {
          created_at: string
          id: string
          is_active: boolean
          name: string
        }
        Insert: {
          created_at?: string
          id?: string
          is_active?: boolean
          name: string
        }
        Update: {
          created_at?: string
          id?: string
          is_active?: boolean
          name?: string
        }
        Relationships: []
      }
      bill_payments: {
        Row: {
          amount: number
          bill_id: string | null
          created_at: string
          id: string
          method: string
          received_by: string | null
          reference: string | null
          tenant_id: string
          transaction_id: string | null
        }
        Insert: {
          amount: number
          bill_id?: string | null
          created_at?: string
          id?: string
          method: string
          received_by?: string | null
          reference?: string | null
          tenant_id: string
          transaction_id?: string | null
        }
        Update: {
          amount?: number
          bill_id?: string | null
          created_at?: string
          id?: string
          method?: string
          received_by?: string | null
          reference?: string | null
          tenant_id?: string
          transaction_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "bill_payments_bill_id_fkey"
            columns: ["bill_id"]
            isOneToOne: false
            referencedRelation: "open_bills"
            referencedColumns: ["id"]
          },
        ]
      }
      bills: {
        Row: {
          amount: number
          category: string
          created_at: string
          created_by: string | null
          id: string
          is_recurring: boolean
          last_paid_at: string | null
          location_id: string | null
          name: string
          next_due_date: string | null
          notes: string | null
          purchase_id: string | null
          recurrence_interval: number | null
          recurrence_unit: string | null
          status: string
          supplier_id: string | null
          tenant_id: string | null
          updated_at: string
        }
        Insert: {
          amount?: number
          category?: string
          created_at?: string
          created_by?: string | null
          id?: string
          is_recurring?: boolean
          last_paid_at?: string | null
          location_id?: string | null
          name: string
          next_due_date?: string | null
          notes?: string | null
          purchase_id?: string | null
          recurrence_interval?: number | null
          recurrence_unit?: string | null
          status?: string
          supplier_id?: string | null
          tenant_id?: string | null
          updated_at?: string
        }
        Update: {
          amount?: number
          category?: string
          created_at?: string
          created_by?: string | null
          id?: string
          is_recurring?: boolean
          last_paid_at?: string | null
          location_id?: string | null
          name?: string
          next_due_date?: string | null
          notes?: string | null
          purchase_id?: string | null
          recurrence_interval?: number | null
          recurrence_unit?: string | null
          status?: string
          supplier_id?: string | null
          tenant_id?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "bills_location_id_fkey"
            columns: ["location_id"]
            isOneToOne: false
            referencedRelation: "locations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "bills_supplier_id_fkey"
            columns: ["supplier_id"]
            isOneToOne: false
            referencedRelation: "suppliers"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "bills_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenant_domains_public"
            referencedColumns: ["tenant_id"]
          },
          {
            foreignKeyName: "bills_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "bills_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants_public"
            referencedColumns: ["id"]
          },
        ]
      }
      business_settings: {
        Row: {
          barcode_format: string | null
          barcode_label_height: string | null
          barcode_label_width: string | null
          barcode_show_name: boolean | null
          barcode_show_price: boolean | null
          business_address: string | null
          business_email: string | null
          business_name: string
          business_phone: string | null
          created_at: string
          daily_logout_time: string
          daily_sales_target: number
          default_vat_rate: number
          has_mpesa_consumer_key: boolean | null
          has_mpesa_consumer_secret: boolean | null
          has_mpesa_passkey: boolean | null
          has_paystack_secret_key: boolean | null
          id: string
          idle_timeout_minutes: number
          mpesa_account_reference: string | null
          mpesa_consumer_key: string | null
          mpesa_consumer_secret: string | null
          mpesa_environment: string
          mpesa_passkey: string | null
          mpesa_shortcode: string | null
          mpesa_till_number: string | null
          mpesa_transaction_type: string
          payhero_api_password: string | null
          payhero_api_username: string | null
          payhero_channel_id: string | null
          payment_provider: string
          paystack_public_key: string | null
          paystack_secret_key: string | null
          receipt_footer: string
          receipt_header: string
          session_warning_seconds: number
          smtp_encryption: string | null
          smtp_from_email: string | null
          smtp_from_name: string | null
          smtp_host: string | null
          smtp_password: string | null
          smtp_port: string | null
          smtp_username: string | null
          stk_label_mode: string
          stk_label_override: string | null
          tax_pin: string | null
          tenant_id: string | null
          updated_at: string
          updated_by: string | null
          use_platform_mpesa: boolean
          use_platform_smtp: boolean
        }
        Insert: {
          barcode_format?: string | null
          barcode_label_height?: string | null
          barcode_label_width?: string | null
          barcode_show_name?: boolean | null
          barcode_show_price?: boolean | null
          business_address?: string | null
          business_email?: string | null
          business_name?: string
          business_phone?: string | null
          created_at?: string
          daily_logout_time?: string
          daily_sales_target?: number
          default_vat_rate?: number
          has_mpesa_consumer_key?: boolean | null
          has_mpesa_consumer_secret?: boolean | null
          has_mpesa_passkey?: boolean | null
          has_paystack_secret_key?: boolean | null
          id?: string
          idle_timeout_minutes?: number
          mpesa_account_reference?: string | null
          mpesa_consumer_key?: string | null
          mpesa_consumer_secret?: string | null
          mpesa_environment?: string
          mpesa_passkey?: string | null
          mpesa_shortcode?: string | null
          mpesa_till_number?: string | null
          mpesa_transaction_type?: string
          payhero_api_password?: string | null
          payhero_api_username?: string | null
          payhero_channel_id?: string | null
          payment_provider?: string
          paystack_public_key?: string | null
          paystack_secret_key?: string | null
          receipt_footer?: string
          receipt_header?: string
          session_warning_seconds?: number
          smtp_encryption?: string | null
          smtp_from_email?: string | null
          smtp_from_name?: string | null
          smtp_host?: string | null
          smtp_password?: string | null
          smtp_port?: string | null
          smtp_username?: string | null
          stk_label_mode?: string
          stk_label_override?: string | null
          tax_pin?: string | null
          tenant_id?: string | null
          updated_at?: string
          updated_by?: string | null
          use_platform_mpesa?: boolean
          use_platform_smtp?: boolean
        }
        Update: {
          barcode_format?: string | null
          barcode_label_height?: string | null
          barcode_label_width?: string | null
          barcode_show_name?: boolean | null
          barcode_show_price?: boolean | null
          business_address?: string | null
          business_email?: string | null
          business_name?: string
          business_phone?: string | null
          created_at?: string
          daily_logout_time?: string
          daily_sales_target?: number
          default_vat_rate?: number
          has_mpesa_consumer_key?: boolean | null
          has_mpesa_consumer_secret?: boolean | null
          has_mpesa_passkey?: boolean | null
          has_paystack_secret_key?: boolean | null
          id?: string
          idle_timeout_minutes?: number
          mpesa_account_reference?: string | null
          mpesa_consumer_key?: string | null
          mpesa_consumer_secret?: string | null
          mpesa_environment?: string
          mpesa_passkey?: string | null
          mpesa_shortcode?: string | null
          mpesa_till_number?: string | null
          mpesa_transaction_type?: string
          payhero_api_password?: string | null
          payhero_api_username?: string | null
          payhero_channel_id?: string | null
          payment_provider?: string
          paystack_public_key?: string | null
          paystack_secret_key?: string | null
          receipt_footer?: string
          receipt_header?: string
          session_warning_seconds?: number
          smtp_encryption?: string | null
          smtp_from_email?: string | null
          smtp_from_name?: string | null
          smtp_host?: string | null
          smtp_password?: string | null
          smtp_port?: string | null
          smtp_username?: string | null
          stk_label_mode?: string
          stk_label_override?: string | null
          tax_pin?: string | null
          tenant_id?: string | null
          updated_at?: string
          updated_by?: string | null
          use_platform_mpesa?: boolean
          use_platform_smtp?: boolean
        }
        Relationships: [
          {
            foreignKeyName: "business_settings_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenant_domains_public"
            referencedColumns: ["tenant_id"]
          },
          {
            foreignKeyName: "business_settings_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "business_settings_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants_public"
            referencedColumns: ["id"]
          },
        ]
      }
      cash_register: {
        Row: {
          actual_cash: number | null
          cash_in: number
          cash_out: number
          cash_sales: number
          closed_at: string | null
          closed_by: string | null
          created_at: string
          difference: number | null
          expected_cash: number
          id: string
          location_id: string | null
          notes: string | null
          opened_at: string
          opened_by: string
          opening_float: number
          status: string
          tenant_id: string | null
          updated_at: string
        }
        Insert: {
          actual_cash?: number | null
          cash_in?: number
          cash_out?: number
          cash_sales?: number
          closed_at?: string | null
          closed_by?: string | null
          created_at?: string
          difference?: number | null
          expected_cash?: number
          id?: string
          location_id?: string | null
          notes?: string | null
          opened_at?: string
          opened_by: string
          opening_float?: number
          status?: string
          tenant_id?: string | null
          updated_at?: string
        }
        Update: {
          actual_cash?: number | null
          cash_in?: number
          cash_out?: number
          cash_sales?: number
          closed_at?: string | null
          closed_by?: string | null
          created_at?: string
          difference?: number | null
          expected_cash?: number
          id?: string
          location_id?: string | null
          notes?: string | null
          opened_at?: string
          opened_by?: string
          opening_float?: number
          status?: string
          tenant_id?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "cash_register_location_id_fkey"
            columns: ["location_id"]
            isOneToOne: false
            referencedRelation: "locations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "cash_register_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenant_domains_public"
            referencedColumns: ["tenant_id"]
          },
          {
            foreignKeyName: "cash_register_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "cash_register_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants_public"
            referencedColumns: ["id"]
          },
        ]
      }
      cms_content: {
        Row: {
          content: Json
          id: string
          section: string
          updated_at: string
          updated_by: string | null
        }
        Insert: {
          content?: Json
          id?: string
          section: string
          updated_at?: string
          updated_by?: string | null
        }
        Update: {
          content?: Json
          id?: string
          section?: string
          updated_at?: string
          updated_by?: string | null
        }
        Relationships: []
      }
      contact_inquiries: {
        Row: {
          created_at: string
          email: string
          id: string
          message: string
          name: string
          responded_at: string | null
          status: string
          subject: string
        }
        Insert: {
          created_at?: string
          email: string
          id?: string
          message: string
          name: string
          responded_at?: string | null
          status?: string
          subject: string
        }
        Update: {
          created_at?: string
          email?: string
          id?: string
          message?: string
          name?: string
          responded_at?: string | null
          status?: string
          subject?: string
        }
        Relationships: []
      }
      customers: {
        Row: {
          balance: number
          created_at: string
          credit_limit: number
          email: string | null
          id: string
          location_id: string | null
          loyalty_points: number
          name: string
          phone: string
          tenant_id: string | null
          updated_at: string
          wholesale_eligible: boolean
        }
        Insert: {
          balance?: number
          created_at?: string
          credit_limit?: number
          email?: string | null
          id?: string
          location_id?: string | null
          loyalty_points?: number
          name: string
          phone: string
          tenant_id?: string | null
          updated_at?: string
          wholesale_eligible?: boolean
        }
        Update: {
          balance?: number
          created_at?: string
          credit_limit?: number
          email?: string | null
          id?: string
          location_id?: string | null
          loyalty_points?: number
          name?: string
          phone?: string
          tenant_id?: string | null
          updated_at?: string
          wholesale_eligible?: boolean
        }
        Relationships: [
          {
            foreignKeyName: "customers_location_id_fkey"
            columns: ["location_id"]
            isOneToOne: false
            referencedRelation: "locations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "customers_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenant_domains_public"
            referencedColumns: ["tenant_id"]
          },
          {
            foreignKeyName: "customers_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "customers_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants_public"
            referencedColumns: ["id"]
          },
        ]
      }
      delivery_confirmations: {
        Row: {
          confirmed_at: string
          created_at: string
          delivery_note_id: string
          id: string
          location_lat: number | null
          location_lng: number | null
          receiver_id_number: string
          receiver_name: string
          receiver_phone: string | null
          signature_data: string
          tenant_id: string | null
        }
        Insert: {
          confirmed_at?: string
          created_at?: string
          delivery_note_id: string
          id?: string
          location_lat?: number | null
          location_lng?: number | null
          receiver_id_number: string
          receiver_name: string
          receiver_phone?: string | null
          signature_data: string
          tenant_id?: string | null
        }
        Update: {
          confirmed_at?: string
          created_at?: string
          delivery_note_id?: string
          id?: string
          location_lat?: number | null
          location_lng?: number | null
          receiver_id_number?: string
          receiver_name?: string
          receiver_phone?: string | null
          signature_data?: string
          tenant_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "delivery_confirmations_delivery_note_id_fkey"
            columns: ["delivery_note_id"]
            isOneToOne: false
            referencedRelation: "delivery_notes"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "delivery_confirmations_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenant_domains_public"
            referencedColumns: ["tenant_id"]
          },
          {
            foreignKeyName: "delivery_confirmations_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "delivery_confirmations_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants_public"
            referencedColumns: ["id"]
          },
        ]
      }
      delivery_notes: {
        Row: {
          assigned_at: string | null
          created_at: string
          created_by: string | null
          customer_address: string | null
          customer_id: string | null
          customer_name: string
          customer_phone: string | null
          delivered_at: string | null
          delivery_number: string
          dispatched_at: string | null
          id: string
          invoice_id: string | null
          items: Json
          notes: string | null
          packing_list_id: string | null
          rider_id: string | null
          rider_name: string | null
          status: string
          tenant_id: string | null
          updated_at: string
        }
        Insert: {
          assigned_at?: string | null
          created_at?: string
          created_by?: string | null
          customer_address?: string | null
          customer_id?: string | null
          customer_name?: string
          customer_phone?: string | null
          delivered_at?: string | null
          delivery_number?: string
          dispatched_at?: string | null
          id?: string
          invoice_id?: string | null
          items?: Json
          notes?: string | null
          packing_list_id?: string | null
          rider_id?: string | null
          rider_name?: string | null
          status?: string
          tenant_id?: string | null
          updated_at?: string
        }
        Update: {
          assigned_at?: string | null
          created_at?: string
          created_by?: string | null
          customer_address?: string | null
          customer_id?: string | null
          customer_name?: string
          customer_phone?: string | null
          delivered_at?: string | null
          delivery_number?: string
          dispatched_at?: string | null
          id?: string
          invoice_id?: string | null
          items?: Json
          notes?: string | null
          packing_list_id?: string | null
          rider_id?: string | null
          rider_name?: string | null
          status?: string
          tenant_id?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "delivery_notes_customer_id_fkey"
            columns: ["customer_id"]
            isOneToOne: false
            referencedRelation: "customers"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "delivery_notes_invoice_id_fkey"
            columns: ["invoice_id"]
            isOneToOne: false
            referencedRelation: "invoices"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "delivery_notes_packing_list_id_fkey"
            columns: ["packing_list_id"]
            isOneToOne: false
            referencedRelation: "packing_lists"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "delivery_notes_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenant_domains_public"
            referencedColumns: ["tenant_id"]
          },
          {
            foreignKeyName: "delivery_notes_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "delivery_notes_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants_public"
            referencedColumns: ["id"]
          },
        ]
      }
      email_logs: {
        Row: {
          channel: string
          created_at: string
          from_email: string | null
          id: string
          recipient: string
          sent_by: string | null
          smtp_host: string | null
          smtp_response: string | null
          status: string
          subject: string
          tenant_id: string | null
        }
        Insert: {
          channel?: string
          created_at?: string
          from_email?: string | null
          id?: string
          recipient: string
          sent_by?: string | null
          smtp_host?: string | null
          smtp_response?: string | null
          status?: string
          subject: string
          tenant_id?: string | null
        }
        Update: {
          channel?: string
          created_at?: string
          from_email?: string | null
          id?: string
          recipient?: string
          sent_by?: string | null
          smtp_host?: string | null
          smtp_response?: string | null
          status?: string
          subject?: string
          tenant_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "email_logs_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenant_domains_public"
            referencedColumns: ["tenant_id"]
          },
          {
            foreignKeyName: "email_logs_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "email_logs_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants_public"
            referencedColumns: ["id"]
          },
        ]
      }
      email_send_log: {
        Row: {
          created_at: string
          error_message: string | null
          id: string
          message_id: string | null
          metadata: Json | null
          recipient_email: string
          status: string
          template_name: string
        }
        Insert: {
          created_at?: string
          error_message?: string | null
          id?: string
          message_id?: string | null
          metadata?: Json | null
          recipient_email: string
          status: string
          template_name: string
        }
        Update: {
          created_at?: string
          error_message?: string | null
          id?: string
          message_id?: string | null
          metadata?: Json | null
          recipient_email?: string
          status?: string
          template_name?: string
        }
        Relationships: []
      }
      email_send_state: {
        Row: {
          auth_email_ttl_minutes: number
          batch_size: number
          id: number
          retry_after_until: string | null
          send_delay_ms: number
          transactional_email_ttl_minutes: number
          updated_at: string
        }
        Insert: {
          auth_email_ttl_minutes?: number
          batch_size?: number
          id?: number
          retry_after_until?: string | null
          send_delay_ms?: number
          transactional_email_ttl_minutes?: number
          updated_at?: string
        }
        Update: {
          auth_email_ttl_minutes?: number
          batch_size?: number
          id?: number
          retry_after_until?: string | null
          send_delay_ms?: number
          transactional_email_ttl_minutes?: number
          updated_at?: string
        }
        Relationships: []
      }
      email_unsubscribe_tokens: {
        Row: {
          created_at: string
          email: string
          id: string
          token: string
          used_at: string | null
        }
        Insert: {
          created_at?: string
          email: string
          id?: string
          token: string
          used_at?: string | null
        }
        Update: {
          created_at?: string
          email?: string
          id?: string
          token?: string
          used_at?: string | null
        }
        Relationships: []
      }
      empties_ledger: {
        Row: {
          container_kind: string
          created_at: string
          created_by: string | null
          created_by_name: string | null
          customer_id: string | null
          customer_name: string | null
          deposit_per_unit: number
          deposit_total: number
          direction: string
          id: string
          item_label: string
          location_id: string | null
          note: string | null
          product_id: string | null
          quantity: number
          tenant_id: string
          updated_at: string
        }
        Insert: {
          container_kind?: string
          created_at?: string
          created_by?: string | null
          created_by_name?: string | null
          customer_id?: string | null
          customer_name?: string | null
          deposit_per_unit?: number
          deposit_total?: number
          direction?: string
          id?: string
          item_label: string
          location_id?: string | null
          note?: string | null
          product_id?: string | null
          quantity?: number
          tenant_id: string
          updated_at?: string
        }
        Update: {
          container_kind?: string
          created_at?: string
          created_by?: string | null
          created_by_name?: string | null
          customer_id?: string | null
          customer_name?: string | null
          deposit_per_unit?: number
          deposit_total?: number
          direction?: string
          id?: string
          item_label?: string
          location_id?: string | null
          note?: string | null
          product_id?: string | null
          quantity?: number
          tenant_id?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "empties_ledger_customer_id_fkey"
            columns: ["customer_id"]
            isOneToOne: false
            referencedRelation: "customers"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "empties_ledger_location_id_fkey"
            columns: ["location_id"]
            isOneToOne: false
            referencedRelation: "locations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "empties_ledger_product_id_fkey"
            columns: ["product_id"]
            isOneToOne: false
            referencedRelation: "products"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "empties_ledger_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenant_domains_public"
            referencedColumns: ["tenant_id"]
          },
          {
            foreignKeyName: "empties_ledger_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "empties_ledger_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants_public"
            referencedColumns: ["id"]
          },
        ]
      }
      expense_categories: {
        Row: {
          created_at: string
          id: string
          is_active: boolean
          name: string
        }
        Insert: {
          created_at?: string
          id?: string
          is_active?: boolean
          name: string
        }
        Update: {
          created_at?: string
          id?: string
          is_active?: boolean
          name?: string
        }
        Relationships: []
      }
      expenses: {
        Row: {
          amount: number
          category_id: string | null
          category_name: string
          created_at: string
          created_by: string | null
          description: string | null
          expense_date: string
          id: string
          is_recurring: boolean
          last_generated_at: string | null
          location_id: string | null
          next_due_date: string | null
          recurrence_interval: number | null
          recurrence_unit: string | null
          tenant_id: string | null
        }
        Insert: {
          amount?: number
          category_id?: string | null
          category_name?: string
          created_at?: string
          created_by?: string | null
          description?: string | null
          expense_date?: string
          id?: string
          is_recurring?: boolean
          last_generated_at?: string | null
          location_id?: string | null
          next_due_date?: string | null
          recurrence_interval?: number | null
          recurrence_unit?: string | null
          tenant_id?: string | null
        }
        Update: {
          amount?: number
          category_id?: string | null
          category_name?: string
          created_at?: string
          created_by?: string | null
          description?: string | null
          expense_date?: string
          id?: string
          is_recurring?: boolean
          last_generated_at?: string | null
          location_id?: string | null
          next_due_date?: string | null
          recurrence_interval?: number | null
          recurrence_unit?: string | null
          tenant_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "expenses_category_id_fkey"
            columns: ["category_id"]
            isOneToOne: false
            referencedRelation: "expense_categories"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "expenses_location_id_fkey"
            columns: ["location_id"]
            isOneToOne: false
            referencedRelation: "locations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "expenses_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenant_domains_public"
            referencedColumns: ["tenant_id"]
          },
          {
            foreignKeyName: "expenses_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "expenses_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants_public"
            referencedColumns: ["id"]
          },
        ]
      }
      feature_audit_logs: {
        Row: {
          actor_email: string | null
          actor_user_id: string | null
          after_features: Json | null
          before_features: Json | null
          created_at: string
          diff: Json | null
          effective_after: Json | null
          effective_before: Json | null
          id: string
          plan_id: string | null
          scope: string
          tenant_id: string | null
        }
        Insert: {
          actor_email?: string | null
          actor_user_id?: string | null
          after_features?: Json | null
          before_features?: Json | null
          created_at?: string
          diff?: Json | null
          effective_after?: Json | null
          effective_before?: Json | null
          id?: string
          plan_id?: string | null
          scope: string
          tenant_id?: string | null
        }
        Update: {
          actor_email?: string | null
          actor_user_id?: string | null
          after_features?: Json | null
          before_features?: Json | null
          created_at?: string
          diff?: Json | null
          effective_after?: Json | null
          effective_before?: Json | null
          id?: string
          plan_id?: string | null
          scope?: string
          tenant_id?: string | null
        }
        Relationships: []
      }
      inventory_settings: {
        Row: {
          categories: Json
          created_at: string
          default_cost_price: number | null
          default_price: number | null
          default_reorder_level: number | null
          default_stock: number | null
          default_unit: string | null
          default_vat_rate: number | null
          id: string
          sku_prefix: string | null
          subcategories: Json
          tenant_id: string | null
          units: Json
          updated_at: string
        }
        Insert: {
          categories?: Json
          created_at?: string
          default_cost_price?: number | null
          default_price?: number | null
          default_reorder_level?: number | null
          default_stock?: number | null
          default_unit?: string | null
          default_vat_rate?: number | null
          id?: string
          sku_prefix?: string | null
          subcategories?: Json
          tenant_id?: string | null
          units?: Json
          updated_at?: string
        }
        Update: {
          categories?: Json
          created_at?: string
          default_cost_price?: number | null
          default_price?: number | null
          default_reorder_level?: number | null
          default_stock?: number | null
          default_unit?: string | null
          default_vat_rate?: number | null
          id?: string
          sku_prefix?: string | null
          subcategories?: Json
          tenant_id?: string | null
          units?: Json
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "inventory_settings_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenant_domains_public"
            referencedColumns: ["tenant_id"]
          },
          {
            foreignKeyName: "inventory_settings_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "inventory_settings_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants_public"
            referencedColumns: ["id"]
          },
        ]
      }
      invoices: {
        Row: {
          created_at: string
          created_by: string | null
          customer_email: string | null
          customer_id: string | null
          customer_name: string | null
          discount: number
          due_date: string | null
          id: string
          invoice_number: string
          is_recurring: boolean
          items: Json
          last_generated_at: string | null
          next_due_date: string | null
          notes: string | null
          paid_at: string | null
          recurrence_interval: number | null
          recurrence_unit: string | null
          sent_at: string | null
          status: string
          subtotal: number
          tax: number
          tenant_id: string | null
          total: number
          updated_at: string
        }
        Insert: {
          created_at?: string
          created_by?: string | null
          customer_email?: string | null
          customer_id?: string | null
          customer_name?: string | null
          discount?: number
          due_date?: string | null
          id?: string
          invoice_number?: string
          is_recurring?: boolean
          items?: Json
          last_generated_at?: string | null
          next_due_date?: string | null
          notes?: string | null
          paid_at?: string | null
          recurrence_interval?: number | null
          recurrence_unit?: string | null
          sent_at?: string | null
          status?: string
          subtotal?: number
          tax?: number
          tenant_id?: string | null
          total?: number
          updated_at?: string
        }
        Update: {
          created_at?: string
          created_by?: string | null
          customer_email?: string | null
          customer_id?: string | null
          customer_name?: string | null
          discount?: number
          due_date?: string | null
          id?: string
          invoice_number?: string
          is_recurring?: boolean
          items?: Json
          last_generated_at?: string | null
          next_due_date?: string | null
          notes?: string | null
          paid_at?: string | null
          recurrence_interval?: number | null
          recurrence_unit?: string | null
          sent_at?: string | null
          status?: string
          subtotal?: number
          tax?: number
          tenant_id?: string | null
          total?: number
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "invoices_customer_id_fkey"
            columns: ["customer_id"]
            isOneToOne: false
            referencedRelation: "customers"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "invoices_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenant_domains_public"
            referencedColumns: ["tenant_id"]
          },
          {
            foreignKeyName: "invoices_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "invoices_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants_public"
            referencedColumns: ["id"]
          },
        ]
      }
      layaways: {
        Row: {
          balance: number
          created_at: string
          created_by: string | null
          customer_id: string | null
          customer_name: string | null
          customer_phone: string | null
          deposit_paid: number
          due_date: string | null
          id: string
          items: Json
          location_id: string | null
          notes: string | null
          school: string | null
          status: string
          tenant_id: string
          total: number
          updated_at: string
        }
        Insert: {
          balance?: number
          created_at?: string
          created_by?: string | null
          customer_id?: string | null
          customer_name?: string | null
          customer_phone?: string | null
          deposit_paid?: number
          due_date?: string | null
          id?: string
          items?: Json
          location_id?: string | null
          notes?: string | null
          school?: string | null
          status?: string
          tenant_id: string
          total?: number
          updated_at?: string
        }
        Update: {
          balance?: number
          created_at?: string
          created_by?: string | null
          customer_id?: string | null
          customer_name?: string | null
          customer_phone?: string | null
          deposit_paid?: number
          due_date?: string | null
          id?: string
          items?: Json
          location_id?: string | null
          notes?: string | null
          school?: string | null
          status?: string
          tenant_id?: string
          total?: number
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "layaways_customer_id_fkey"
            columns: ["customer_id"]
            isOneToOne: false
            referencedRelation: "customers"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "layaways_location_id_fkey"
            columns: ["location_id"]
            isOneToOne: false
            referencedRelation: "locations"
            referencedColumns: ["id"]
          },
        ]
      }
      leads: {
        Row: {
          created_at: string
          email: string
          id: string
          name: string
          notes: string | null
          phone: string
          source: string
        }
        Insert: {
          created_at?: string
          email: string
          id?: string
          name: string
          notes?: string | null
          phone: string
          source?: string
        }
        Update: {
          created_at?: string
          email?: string
          id?: string
          name?: string
          notes?: string | null
          phone?: string
          source?: string
        }
        Relationships: []
      }
      locations: {
        Row: {
          building: string | null
          city: string | null
          code: string | null
          created_at: string
          id: string
          is_active: boolean
          is_main: boolean
          name: string
          po_box: string | null
          street: string | null
          tenant_id: string | null
          updated_at: string
        }
        Insert: {
          building?: string | null
          city?: string | null
          code?: string | null
          created_at?: string
          id?: string
          is_active?: boolean
          is_main?: boolean
          name: string
          po_box?: string | null
          street?: string | null
          tenant_id?: string | null
          updated_at?: string
        }
        Update: {
          building?: string | null
          city?: string | null
          code?: string | null
          created_at?: string
          id?: string
          is_active?: boolean
          is_main?: boolean
          name?: string
          po_box?: string | null
          street?: string | null
          tenant_id?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "locations_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenant_domains_public"
            referencedColumns: ["tenant_id"]
          },
          {
            foreignKeyName: "locations_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "locations_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants_public"
            referencedColumns: ["id"]
          },
        ]
      }
      open_bills: {
        Row: {
          amount_paid: number
          bill_number: string | null
          closed_at: string | null
          created_at: string
          customer_id: string | null
          customer_name: string | null
          discount: number
          id: string
          items: Json
          label: string
          location_id: string | null
          opened_by: string | null
          opened_by_name: string | null
          printed_at: string | null
          status: string
          subtotal: number
          tax: number
          tenant_id: string
          total: number
          transaction_id: string | null
          updated_at: string
        }
        Insert: {
          amount_paid?: number
          bill_number?: string | null
          closed_at?: string | null
          created_at?: string
          customer_id?: string | null
          customer_name?: string | null
          discount?: number
          id?: string
          items?: Json
          label: string
          location_id?: string | null
          opened_by?: string | null
          opened_by_name?: string | null
          printed_at?: string | null
          status?: string
          subtotal?: number
          tax?: number
          tenant_id: string
          total?: number
          transaction_id?: string | null
          updated_at?: string
        }
        Update: {
          amount_paid?: number
          bill_number?: string | null
          closed_at?: string | null
          created_at?: string
          customer_id?: string | null
          customer_name?: string | null
          discount?: number
          id?: string
          items?: Json
          label?: string
          location_id?: string | null
          opened_by?: string | null
          opened_by_name?: string | null
          printed_at?: string | null
          status?: string
          subtotal?: number
          tax?: number
          tenant_id?: string
          total?: number
          transaction_id?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "open_bills_customer_id_fkey"
            columns: ["customer_id"]
            isOneToOne: false
            referencedRelation: "customers"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "open_bills_location_id_fkey"
            columns: ["location_id"]
            isOneToOne: false
            referencedRelation: "locations"
            referencedColumns: ["id"]
          },
        ]
      }
      packing_lists: {
        Row: {
          created_at: string
          created_by: string | null
          customer_id: string | null
          customer_name: string
          id: string
          invoice_id: string | null
          items: Json
          notes: string | null
          packed_at: string | null
          packed_by: string | null
          status: string
          tenant_id: string | null
          transaction_id: string | null
          updated_at: string
        }
        Insert: {
          created_at?: string
          created_by?: string | null
          customer_id?: string | null
          customer_name?: string
          id?: string
          invoice_id?: string | null
          items?: Json
          notes?: string | null
          packed_at?: string | null
          packed_by?: string | null
          status?: string
          tenant_id?: string | null
          transaction_id?: string | null
          updated_at?: string
        }
        Update: {
          created_at?: string
          created_by?: string | null
          customer_id?: string | null
          customer_name?: string
          id?: string
          invoice_id?: string | null
          items?: Json
          notes?: string | null
          packed_at?: string | null
          packed_by?: string | null
          status?: string
          tenant_id?: string | null
          transaction_id?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "packing_lists_customer_id_fkey"
            columns: ["customer_id"]
            isOneToOne: false
            referencedRelation: "customers"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "packing_lists_invoice_id_fkey"
            columns: ["invoice_id"]
            isOneToOne: false
            referencedRelation: "invoices"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "packing_lists_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenant_domains_public"
            referencedColumns: ["tenant_id"]
          },
          {
            foreignKeyName: "packing_lists_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "packing_lists_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants_public"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "packing_lists_transaction_id_fkey"
            columns: ["transaction_id"]
            isOneToOne: false
            referencedRelation: "transactions"
            referencedColumns: ["id"]
          },
        ]
      }
      payhero_transactions: {
        Row: {
          amount: number
          created_at: string
          customer_phone: string
          disburse_reference: string | null
          disbursed: boolean
          disbursed_at: string | null
          external_reference: string | null
          id: string
          mpesa_receipt: string | null
          net_amount: number | null
          payhero_fee: number
          payhero_payment_id: string | null
          payout_channel_id: string | null
          pos_transaction_id: string | null
          raw_callback: Json | null
          result_code: number | null
          result_desc: string | null
          status: string
          tenant_id: string
          updated_at: string
        }
        Insert: {
          amount: number
          created_at?: string
          customer_phone: string
          disburse_reference?: string | null
          disbursed?: boolean
          disbursed_at?: string | null
          external_reference?: string | null
          id?: string
          mpesa_receipt?: string | null
          net_amount?: number | null
          payhero_fee?: number
          payhero_payment_id?: string | null
          payout_channel_id?: string | null
          pos_transaction_id?: string | null
          raw_callback?: Json | null
          result_code?: number | null
          result_desc?: string | null
          status?: string
          tenant_id: string
          updated_at?: string
        }
        Update: {
          amount?: number
          created_at?: string
          customer_phone?: string
          disburse_reference?: string | null
          disbursed?: boolean
          disbursed_at?: string | null
          external_reference?: string | null
          id?: string
          mpesa_receipt?: string | null
          net_amount?: number | null
          payhero_fee?: number
          payhero_payment_id?: string | null
          payout_channel_id?: string | null
          pos_transaction_id?: string | null
          raw_callback?: Json | null
          result_code?: number | null
          result_desc?: string | null
          status?: string
          tenant_id?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "payhero_transactions_payout_channel_id_fkey"
            columns: ["payout_channel_id"]
            isOneToOne: false
            referencedRelation: "tenant_payout_channels"
            referencedColumns: ["id"]
          },
        ]
      }
      plans: {
        Row: {
          created_at: string
          features: Json
          id: string
          is_active: boolean
          max_locations: number
          max_users: number
          name: string
          price_annually: number
          price_monthly: number
          price_quarterly: number
          trial_days: number
          updated_at: string
        }
        Insert: {
          created_at?: string
          features?: Json
          id?: string
          is_active?: boolean
          max_locations?: number
          max_users?: number
          name: string
          price_annually?: number
          price_monthly?: number
          price_quarterly?: number
          trial_days?: number
          updated_at?: string
        }
        Update: {
          created_at?: string
          features?: Json
          id?: string
          is_active?: boolean
          max_locations?: number
          max_users?: number
          name?: string
          price_annually?: number
          price_monthly?: number
          price_quarterly?: number
          trial_days?: number
          updated_at?: string
        }
        Relationships: []
      }
      platform_settings: {
        Row: {
          id: string
          key: string
          updated_at: string
          value: Json
        }
        Insert: {
          id?: string
          key: string
          updated_at?: string
          value?: Json
        }
        Update: {
          id?: string
          key?: string
          updated_at?: string
          value?: Json
        }
        Relationships: []
      }
      product_batches: {
        Row: {
          batch_number: string | null
          created_at: string
          created_by: string | null
          expiry_date: string | null
          id: string
          location_id: string | null
          notes: string | null
          product_id: string
          quantity: number
          received_at: string
          tenant_id: string
          updated_at: string
        }
        Insert: {
          batch_number?: string | null
          created_at?: string
          created_by?: string | null
          expiry_date?: string | null
          id?: string
          location_id?: string | null
          notes?: string | null
          product_id: string
          quantity?: number
          received_at?: string
          tenant_id: string
          updated_at?: string
        }
        Update: {
          batch_number?: string | null
          created_at?: string
          created_by?: string | null
          expiry_date?: string | null
          id?: string
          location_id?: string | null
          notes?: string | null
          product_id?: string
          quantity?: number
          received_at?: string
          tenant_id?: string
          updated_at?: string
        }
        Relationships: []
      }
      product_bundle_items: {
        Row: {
          bundle_id: string
          created_at: string
          id: string
          product_id: string | null
          quantity: number
          tenant_id: string
          variant_id: string | null
        }
        Insert: {
          bundle_id: string
          created_at?: string
          id?: string
          product_id?: string | null
          quantity?: number
          tenant_id: string
          variant_id?: string | null
        }
        Update: {
          bundle_id?: string
          created_at?: string
          id?: string
          product_id?: string | null
          quantity?: number
          tenant_id?: string
          variant_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "product_bundle_items_bundle_id_fkey"
            columns: ["bundle_id"]
            isOneToOne: false
            referencedRelation: "product_bundles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "product_bundle_items_product_id_fkey"
            columns: ["product_id"]
            isOneToOne: false
            referencedRelation: "products"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "product_bundle_items_variant_id_fkey"
            columns: ["variant_id"]
            isOneToOne: false
            referencedRelation: "product_variants"
            referencedColumns: ["id"]
          },
        ]
      }
      product_bundles: {
        Row: {
          created_at: string
          id: string
          is_active: boolean
          name: string
          price: number
          school: string | null
          tenant_id: string
          updated_at: string
        }
        Insert: {
          created_at?: string
          id?: string
          is_active?: boolean
          name: string
          price?: number
          school?: string | null
          tenant_id: string
          updated_at?: string
        }
        Update: {
          created_at?: string
          id?: string
          is_active?: boolean
          name?: string
          price?: number
          school?: string | null
          tenant_id?: string
          updated_at?: string
        }
        Relationships: []
      }
      product_categories: {
        Row: {
          created_at: string
          id: string
          image_url: string | null
          name: string
          sort_order: number
          tenant_id: string
          updated_at: string
        }
        Insert: {
          created_at?: string
          id?: string
          image_url?: string | null
          name: string
          sort_order?: number
          tenant_id: string
          updated_at?: string
        }
        Update: {
          created_at?: string
          id?: string
          image_url?: string | null
          name?: string
          sort_order?: number
          tenant_id?: string
          updated_at?: string
        }
        Relationships: []
      }
      product_stocks: {
        Row: {
          created_at: string
          id: string
          location_id: string
          product_id: string
          reorder_level: number
          stock: number
          updated_at: string
          variant_id: string | null
        }
        Insert: {
          created_at?: string
          id?: string
          location_id: string
          product_id: string
          reorder_level?: number
          stock?: number
          updated_at?: string
          variant_id?: string | null
        }
        Update: {
          created_at?: string
          id?: string
          location_id?: string
          product_id?: string
          reorder_level?: number
          stock?: number
          updated_at?: string
          variant_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "product_stocks_location_id_fkey"
            columns: ["location_id"]
            isOneToOne: false
            referencedRelation: "locations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "product_stocks_product_id_fkey"
            columns: ["product_id"]
            isOneToOne: false
            referencedRelation: "products"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "product_stocks_variant_id_fkey"
            columns: ["variant_id"]
            isOneToOne: false
            referencedRelation: "product_variants"
            referencedColumns: ["id"]
          },
        ]
      }
      product_subcategories: {
        Row: {
          category_id: string | null
          created_at: string
          id: string
          image_url: string | null
          name: string
          parent_name: string | null
          sort_order: number
          tenant_id: string
          updated_at: string
        }
        Insert: {
          category_id?: string | null
          created_at?: string
          id?: string
          image_url?: string | null
          name: string
          parent_name?: string | null
          sort_order?: number
          tenant_id: string
          updated_at?: string
        }
        Update: {
          category_id?: string | null
          created_at?: string
          id?: string
          image_url?: string | null
          name?: string
          parent_name?: string | null
          sort_order?: number
          tenant_id?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "product_subcategories_category_id_fkey"
            columns: ["category_id"]
            isOneToOne: false
            referencedRelation: "product_categories"
            referencedColumns: ["id"]
          },
        ]
      }
      product_units: {
        Row: {
          abbreviation: string | null
          created_at: string
          id: string
          name: string
          sort_order: number
          tenant_id: string
          updated_at: string
        }
        Insert: {
          abbreviation?: string | null
          created_at?: string
          id?: string
          name: string
          sort_order?: number
          tenant_id: string
          updated_at?: string
        }
        Update: {
          abbreviation?: string | null
          created_at?: string
          id?: string
          name?: string
          sort_order?: number
          tenant_id?: string
          updated_at?: string
        }
        Relationships: []
      }
      product_variants: {
        Row: {
          barcode: string | null
          color: string | null
          cost_price: number
          created_at: string
          id: string
          is_active: boolean
          price: number
          product_id: string
          reorder_level: number
          size: string | null
          sku: string | null
          stock: number
          tenant_id: string
          updated_at: string
        }
        Insert: {
          barcode?: string | null
          color?: string | null
          cost_price?: number
          created_at?: string
          id?: string
          is_active?: boolean
          price?: number
          product_id: string
          reorder_level?: number
          size?: string | null
          sku?: string | null
          stock?: number
          tenant_id: string
          updated_at?: string
        }
        Update: {
          barcode?: string | null
          color?: string | null
          cost_price?: number
          created_at?: string
          id?: string
          is_active?: boolean
          price?: number
          product_id?: string
          reorder_level?: number
          size?: string | null
          sku?: string | null
          stock?: number
          tenant_id?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "product_variants_product_id_fkey"
            columns: ["product_id"]
            isOneToOne: false
            referencedRelation: "products"
            referencedColumns: ["id"]
          },
        ]
      }
      products: {
        Row: {
          barcode: string | null
          bottle_size: string | null
          brand: string | null
          category: string
          cost_price: number
          crate_deposit: number
          created_at: string
          enable_wholesale: boolean
          id: string
          image_url: string | null
          is_active: boolean
          name: string
          price: number
          product_type: string
          reorder_level: number
          school: string | null
          sku: string
          stock: number
          subcategory: string | null
          tenant_id: string | null
          tot_price: number | null
          tots_per_bottle: number | null
          unit: string
          units_per_crate: number | null
          updated_at: string
          vat_rate: number
          wholesale_min_quantity: number
          wholesale_price: number | null
        }
        Insert: {
          barcode?: string | null
          bottle_size?: string | null
          brand?: string | null
          category: string
          cost_price: number
          crate_deposit?: number
          created_at?: string
          enable_wholesale?: boolean
          id?: string
          image_url?: string | null
          is_active?: boolean
          name: string
          price: number
          product_type?: string
          reorder_level?: number
          school?: string | null
          sku: string
          stock?: number
          subcategory?: string | null
          tenant_id?: string | null
          tot_price?: number | null
          tots_per_bottle?: number | null
          unit?: string
          units_per_crate?: number | null
          updated_at?: string
          vat_rate?: number
          wholesale_min_quantity?: number
          wholesale_price?: number | null
        }
        Update: {
          barcode?: string | null
          bottle_size?: string | null
          brand?: string | null
          category?: string
          cost_price?: number
          crate_deposit?: number
          created_at?: string
          enable_wholesale?: boolean
          id?: string
          image_url?: string | null
          is_active?: boolean
          name?: string
          price?: number
          product_type?: string
          reorder_level?: number
          school?: string | null
          sku?: string
          stock?: number
          subcategory?: string | null
          tenant_id?: string | null
          tot_price?: number | null
          tots_per_bottle?: number | null
          unit?: string
          units_per_crate?: number | null
          updated_at?: string
          vat_rate?: number
          wholesale_min_quantity?: number
          wholesale_price?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "products_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenant_domains_public"
            referencedColumns: ["tenant_id"]
          },
          {
            foreignKeyName: "products_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "products_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants_public"
            referencedColumns: ["id"]
          },
        ]
      }
      profiles: {
        Row: {
          created_at: string
          display_name: string
          id: string
          must_change_password: boolean
          phone: string | null
          store_location: string | null
          tenant_id: string | null
          updated_at: string
          user_id: string
        }
        Insert: {
          created_at?: string
          display_name: string
          id?: string
          must_change_password?: boolean
          phone?: string | null
          store_location?: string | null
          tenant_id?: string | null
          updated_at?: string
          user_id: string
        }
        Update: {
          created_at?: string
          display_name?: string
          id?: string
          must_change_password?: boolean
          phone?: string | null
          store_location?: string | null
          tenant_id?: string | null
          updated_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "profiles_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenant_domains_public"
            referencedColumns: ["tenant_id"]
          },
          {
            foreignKeyName: "profiles_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "profiles_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants_public"
            referencedColumns: ["id"]
          },
        ]
      }
      purchase_items: {
        Row: {
          created_at: string
          id: string
          product_id: string
          purchase_id: string
          quantity: number
          total: number
          unit_cost: number
          unit_type: string
          variant_id: string | null
        }
        Insert: {
          created_at?: string
          id?: string
          product_id: string
          purchase_id: string
          quantity?: number
          total?: number
          unit_cost?: number
          unit_type?: string
          variant_id?: string | null
        }
        Update: {
          created_at?: string
          id?: string
          product_id?: string
          purchase_id?: string
          quantity?: number
          total?: number
          unit_cost?: number
          unit_type?: string
          variant_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "purchase_items_product_id_fkey"
            columns: ["product_id"]
            isOneToOne: false
            referencedRelation: "products"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "purchase_items_purchase_id_fkey"
            columns: ["purchase_id"]
            isOneToOne: false
            referencedRelation: "purchases"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "purchase_items_variant_id_fkey"
            columns: ["variant_id"]
            isOneToOne: false
            referencedRelation: "product_variants"
            referencedColumns: ["id"]
          },
        ]
      }
      purchases: {
        Row: {
          created_at: string
          created_by: string | null
          id: string
          location_id: string | null
          notes: string | null
          received_at: string | null
          status: string
          subtotal: number
          supplier_id: string | null
          supplier_name: string
          tax: number
          tenant_id: string | null
          total: number
          updated_at: string
        }
        Insert: {
          created_at?: string
          created_by?: string | null
          id?: string
          location_id?: string | null
          notes?: string | null
          received_at?: string | null
          status?: string
          subtotal?: number
          supplier_id?: string | null
          supplier_name?: string
          tax?: number
          tenant_id?: string | null
          total?: number
          updated_at?: string
        }
        Update: {
          created_at?: string
          created_by?: string | null
          id?: string
          location_id?: string | null
          notes?: string | null
          received_at?: string | null
          status?: string
          subtotal?: number
          supplier_id?: string | null
          supplier_name?: string
          tax?: number
          tenant_id?: string | null
          total?: number
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "purchases_location_id_fkey"
            columns: ["location_id"]
            isOneToOne: false
            referencedRelation: "locations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "purchases_supplier_id_fkey"
            columns: ["supplier_id"]
            isOneToOne: false
            referencedRelation: "suppliers"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "purchases_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenant_domains_public"
            referencedColumns: ["tenant_id"]
          },
          {
            foreignKeyName: "purchases_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "purchases_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants_public"
            referencedColumns: ["id"]
          },
        ]
      }
      quotes: {
        Row: {
          created_at: string
          created_by: string | null
          customer_id: string | null
          customer_name: string | null
          discount: number
          id: string
          items: Json
          notes: string | null
          quote_number: string
          status: string
          subtotal: number
          tax: number
          tenant_id: string | null
          total: number
          updated_at: string
          valid_until: string | null
        }
        Insert: {
          created_at?: string
          created_by?: string | null
          customer_id?: string | null
          customer_name?: string | null
          discount?: number
          id?: string
          items?: Json
          notes?: string | null
          quote_number?: string
          status?: string
          subtotal?: number
          tax?: number
          tenant_id?: string | null
          total?: number
          updated_at?: string
          valid_until?: string | null
        }
        Update: {
          created_at?: string
          created_by?: string | null
          customer_id?: string | null
          customer_name?: string | null
          discount?: number
          id?: string
          items?: Json
          notes?: string | null
          quote_number?: string
          status?: string
          subtotal?: number
          tax?: number
          tenant_id?: string | null
          total?: number
          updated_at?: string
          valid_until?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "quotes_customer_id_fkey"
            columns: ["customer_id"]
            isOneToOne: false
            referencedRelation: "customers"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "quotes_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenant_domains_public"
            referencedColumns: ["tenant_id"]
          },
          {
            foreignKeyName: "quotes_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "quotes_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants_public"
            referencedColumns: ["id"]
          },
        ]
      }
      role_permissions: {
        Row: {
          allowed: boolean
          created_at: string
          id: string
          permission: string
          role: string
        }
        Insert: {
          allowed?: boolean
          created_at?: string
          id?: string
          permission: string
          role: string
        }
        Update: {
          allowed?: boolean
          created_at?: string
          id?: string
          permission?: string
          role?: string
        }
        Relationships: []
      }
      services: {
        Row: {
          category: string
          cost_price: number
          created_at: string
          description: string | null
          id: string
          is_active: boolean
          name: string
          price: number
          tenant_id: string | null
          updated_at: string
          vat_rate: number
        }
        Insert: {
          category?: string
          cost_price?: number
          created_at?: string
          description?: string | null
          id?: string
          is_active?: boolean
          name: string
          price?: number
          tenant_id?: string | null
          updated_at?: string
          vat_rate?: number
        }
        Update: {
          category?: string
          cost_price?: number
          created_at?: string
          description?: string | null
          id?: string
          is_active?: boolean
          name?: string
          price?: number
          tenant_id?: string | null
          updated_at?: string
          vat_rate?: number
        }
        Relationships: [
          {
            foreignKeyName: "services_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenant_domains_public"
            referencedColumns: ["tenant_id"]
          },
          {
            foreignKeyName: "services_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "services_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants_public"
            referencedColumns: ["id"]
          },
        ]
      }
      settlements: {
        Row: {
          amount: number
          bank_account_id: string | null
          completed_at: string | null
          created_at: string
          external_reference: string | null
          fee_deducted: number
          id: string
          message: string | null
          net_amount: number | null
          payhero_withdrawal_id: string | null
          source_id: string | null
          source_type: string
          status: string
          tenant_id: string
          updated_at: string
        }
        Insert: {
          amount?: number
          bank_account_id?: string | null
          completed_at?: string | null
          created_at?: string
          external_reference?: string | null
          fee_deducted?: number
          id?: string
          message?: string | null
          net_amount?: number | null
          payhero_withdrawal_id?: string | null
          source_id?: string | null
          source_type?: string
          status?: string
          tenant_id: string
          updated_at?: string
        }
        Update: {
          amount?: number
          bank_account_id?: string | null
          completed_at?: string | null
          created_at?: string
          external_reference?: string | null
          fee_deducted?: number
          id?: string
          message?: string | null
          net_amount?: number | null
          payhero_withdrawal_id?: string | null
          source_id?: string | null
          source_type?: string
          status?: string
          tenant_id?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "settlements_bank_account_id_fkey"
            columns: ["bank_account_id"]
            isOneToOne: false
            referencedRelation: "tenant_bank_accounts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "settlements_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenant_domains_public"
            referencedColumns: ["tenant_id"]
          },
          {
            foreignKeyName: "settlements_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "settlements_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants_public"
            referencedColumns: ["id"]
          },
        ]
      }
      shifts: {
        Row: {
          created_at: string
          end_time: string | null
          id: string
          location_id: string | null
          notes: string | null
          staff_name: string
          start_time: string
          status: string
          tenant_id: string | null
          total_sales: number
          transactions_count: number
          user_id: string
        }
        Insert: {
          created_at?: string
          end_time?: string | null
          id?: string
          location_id?: string | null
          notes?: string | null
          staff_name: string
          start_time?: string
          status?: string
          tenant_id?: string | null
          total_sales?: number
          transactions_count?: number
          user_id: string
        }
        Update: {
          created_at?: string
          end_time?: string | null
          id?: string
          location_id?: string | null
          notes?: string | null
          staff_name?: string
          start_time?: string
          status?: string
          tenant_id?: string | null
          total_sales?: number
          transactions_count?: number
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "shifts_location_id_fkey"
            columns: ["location_id"]
            isOneToOne: false
            referencedRelation: "locations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "shifts_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenant_domains_public"
            referencedColumns: ["tenant_id"]
          },
          {
            foreignKeyName: "shifts_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "shifts_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants_public"
            referencedColumns: ["id"]
          },
        ]
      }
      stock_adjustments: {
        Row: {
          adjusted_by: string | null
          created_at: string
          id: string
          location_id: string
          product_id: string
          quantity_change: number
          reason: string
          stock_after: number
          stock_before: number
          variant_id: string | null
        }
        Insert: {
          adjusted_by?: string | null
          created_at?: string
          id?: string
          location_id: string
          product_id: string
          quantity_change: number
          reason: string
          stock_after: number
          stock_before: number
          variant_id?: string | null
        }
        Update: {
          adjusted_by?: string | null
          created_at?: string
          id?: string
          location_id?: string
          product_id?: string
          quantity_change?: number
          reason?: string
          stock_after?: number
          stock_before?: number
          variant_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "stock_adjustments_location_id_fkey"
            columns: ["location_id"]
            isOneToOne: false
            referencedRelation: "locations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "stock_adjustments_product_id_fkey"
            columns: ["product_id"]
            isOneToOne: false
            referencedRelation: "products"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "stock_adjustments_variant_id_fkey"
            columns: ["variant_id"]
            isOneToOne: false
            referencedRelation: "product_variants"
            referencedColumns: ["id"]
          },
        ]
      }
      subscription_payments: {
        Row: {
          amount: number
          created_at: string
          gateway: string
          id: string
          metadata: Json | null
          phone: string | null
          reference: string | null
          status: string
          subscription_id: string | null
          tenant_id: string
          updated_at: string
        }
        Insert: {
          amount?: number
          created_at?: string
          gateway?: string
          id?: string
          metadata?: Json | null
          phone?: string | null
          reference?: string | null
          status?: string
          subscription_id?: string | null
          tenant_id: string
          updated_at?: string
        }
        Update: {
          amount?: number
          created_at?: string
          gateway?: string
          id?: string
          metadata?: Json | null
          phone?: string | null
          reference?: string | null
          status?: string
          subscription_id?: string | null
          tenant_id?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "subscription_payments_subscription_id_fkey"
            columns: ["subscription_id"]
            isOneToOne: false
            referencedRelation: "subscriptions"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "subscription_payments_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenant_domains_public"
            referencedColumns: ["tenant_id"]
          },
          {
            foreignKeyName: "subscription_payments_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "subscription_payments_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants_public"
            referencedColumns: ["id"]
          },
        ]
      }
      subscriptions: {
        Row: {
          billing_cycle: string
          created_at: string
          current_period_end: string | null
          current_period_start: string | null
          id: string
          last_expired_reminder_at: string | null
          last_expiry_reminder_at: string | null
          max_locations: number
          max_users: number
          paused_at: string | null
          plan_id: string | null
          plan_name: string
          price: number
          status: string
          suspended_at: string | null
          suspended_reason: string | null
          tenant_id: string
          trial_ends_at: string | null
          updated_at: string
        }
        Insert: {
          billing_cycle?: string
          created_at?: string
          current_period_end?: string | null
          current_period_start?: string | null
          id?: string
          last_expired_reminder_at?: string | null
          last_expiry_reminder_at?: string | null
          max_locations?: number
          max_users?: number
          paused_at?: string | null
          plan_id?: string | null
          plan_name?: string
          price?: number
          status?: string
          suspended_at?: string | null
          suspended_reason?: string | null
          tenant_id: string
          trial_ends_at?: string | null
          updated_at?: string
        }
        Update: {
          billing_cycle?: string
          created_at?: string
          current_period_end?: string | null
          current_period_start?: string | null
          id?: string
          last_expired_reminder_at?: string | null
          last_expiry_reminder_at?: string | null
          max_locations?: number
          max_users?: number
          paused_at?: string | null
          plan_id?: string | null
          plan_name?: string
          price?: number
          status?: string
          suspended_at?: string | null
          suspended_reason?: string | null
          tenant_id?: string
          trial_ends_at?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "subscriptions_plan_id_fkey"
            columns: ["plan_id"]
            isOneToOne: false
            referencedRelation: "plans"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "subscriptions_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenant_domains_public"
            referencedColumns: ["tenant_id"]
          },
          {
            foreignKeyName: "subscriptions_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "subscriptions_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants_public"
            referencedColumns: ["id"]
          },
        ]
      }
      suppliers: {
        Row: {
          address: string | null
          created_at: string
          email: string | null
          id: string
          is_active: boolean
          name: string
          notes: string | null
          phone: string | null
          tenant_id: string | null
          updated_at: string
        }
        Insert: {
          address?: string | null
          created_at?: string
          email?: string | null
          id?: string
          is_active?: boolean
          name: string
          notes?: string | null
          phone?: string | null
          tenant_id?: string | null
          updated_at?: string
        }
        Update: {
          address?: string | null
          created_at?: string
          email?: string | null
          id?: string
          is_active?: boolean
          name?: string
          notes?: string | null
          phone?: string | null
          tenant_id?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "suppliers_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenant_domains_public"
            referencedColumns: ["tenant_id"]
          },
          {
            foreignKeyName: "suppliers_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "suppliers_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants_public"
            referencedColumns: ["id"]
          },
        ]
      }
      suppressed_emails: {
        Row: {
          created_at: string
          email: string
          id: string
          metadata: Json | null
          reason: string
        }
        Insert: {
          created_at?: string
          email: string
          id?: string
          metadata?: Json | null
          reason: string
        }
        Update: {
          created_at?: string
          email?: string
          id?: string
          metadata?: Json | null
          reason?: string
        }
        Relationships: []
      }
      tenant_access_audit: {
        Row: {
          attempted_slug: string | null
          attempted_url: string
          created_at: string
          id: string
          redirected_to: string | null
          user_agent: string | null
          user_email: string | null
          user_id: string | null
          user_tenant_id: string | null
          user_tenant_slug: string | null
        }
        Insert: {
          attempted_slug?: string | null
          attempted_url: string
          created_at?: string
          id?: string
          redirected_to?: string | null
          user_agent?: string | null
          user_email?: string | null
          user_id?: string | null
          user_tenant_id?: string | null
          user_tenant_slug?: string | null
        }
        Update: {
          attempted_slug?: string | null
          attempted_url?: string
          created_at?: string
          id?: string
          redirected_to?: string | null
          user_agent?: string | null
          user_email?: string | null
          user_id?: string | null
          user_tenant_id?: string | null
          user_tenant_slug?: string | null
        }
        Relationships: []
      }
      tenant_bank_accounts: {
        Row: {
          account_name: string
          account_number: string
          bank_code: string
          bank_name: string
          created_at: string
          id: string
          is_active: boolean
          payhero_reference: string | null
          tenant_id: string
          updated_at: string
          verification_message: string | null
          verification_status: string
        }
        Insert: {
          account_name: string
          account_number: string
          bank_code: string
          bank_name: string
          created_at?: string
          id?: string
          is_active?: boolean
          payhero_reference?: string | null
          tenant_id: string
          updated_at?: string
          verification_message?: string | null
          verification_status?: string
        }
        Update: {
          account_name?: string
          account_number?: string
          bank_code?: string
          bank_name?: string
          created_at?: string
          id?: string
          is_active?: boolean
          payhero_reference?: string | null
          tenant_id?: string
          updated_at?: string
          verification_message?: string | null
          verification_status?: string
        }
        Relationships: [
          {
            foreignKeyName: "tenant_bank_accounts_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenant_domains_public"
            referencedColumns: ["tenant_id"]
          },
          {
            foreignKeyName: "tenant_bank_accounts_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "tenant_bank_accounts_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants_public"
            referencedColumns: ["id"]
          },
        ]
      }
      tenant_domains: {
        Row: {
          activated_at: string | null
          approved_at: string | null
          approved_by: string | null
          created_at: string
          dns_target: string | null
          host: string
          id: string
          kind: string
          notes: string | null
          paid_at: string | null
          payment_amount: number
          payment_checkout_id: string | null
          payment_phone: string | null
          payment_receipt: string | null
          payment_status: string
          requested_by: string | null
          status: string
          tenant_id: string
          updated_at: string
        }
        Insert: {
          activated_at?: string | null
          approved_at?: string | null
          approved_by?: string | null
          created_at?: string
          dns_target?: string | null
          host: string
          id?: string
          kind: string
          notes?: string | null
          paid_at?: string | null
          payment_amount?: number
          payment_checkout_id?: string | null
          payment_phone?: string | null
          payment_receipt?: string | null
          payment_status?: string
          requested_by?: string | null
          status?: string
          tenant_id: string
          updated_at?: string
        }
        Update: {
          activated_at?: string | null
          approved_at?: string | null
          approved_by?: string | null
          created_at?: string
          dns_target?: string | null
          host?: string
          id?: string
          kind?: string
          notes?: string | null
          paid_at?: string | null
          payment_amount?: number
          payment_checkout_id?: string | null
          payment_phone?: string | null
          payment_receipt?: string | null
          payment_status?: string
          requested_by?: string | null
          status?: string
          tenant_id?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "tenant_domains_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenant_domains_public"
            referencedColumns: ["tenant_id"]
          },
          {
            foreignKeyName: "tenant_domains_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "tenant_domains_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants_public"
            referencedColumns: ["id"]
          },
        ]
      }
      tenant_feature_overrides: {
        Row: {
          created_at: string
          features: Json
          id: string
          tenant_id: string
          updated_at: string
        }
        Insert: {
          created_at?: string
          features?: Json
          id?: string
          tenant_id: string
          updated_at?: string
        }
        Update: {
          created_at?: string
          features?: Json
          id?: string
          tenant_id?: string
          updated_at?: string
        }
        Relationships: []
      }
      tenant_payout_channels: {
        Row: {
          account_number: string | null
          channel_type: string
          created_at: string
          created_by: string | null
          description: string | null
          id: string
          is_active: boolean
          is_default: boolean
          payhero_channel_id: string | null
          registered_at: string | null
          short_code: string
          tenant_id: string
          updated_at: string
        }
        Insert: {
          account_number?: string | null
          channel_type: string
          created_at?: string
          created_by?: string | null
          description?: string | null
          id?: string
          is_active?: boolean
          is_default?: boolean
          payhero_channel_id?: string | null
          registered_at?: string | null
          short_code: string
          tenant_id: string
          updated_at?: string
        }
        Update: {
          account_number?: string | null
          channel_type?: string
          created_at?: string
          created_by?: string | null
          description?: string | null
          id?: string
          is_active?: boolean
          is_default?: boolean
          payhero_channel_id?: string | null
          registered_at?: string | null
          short_code?: string
          tenant_id?: string
          updated_at?: string
        }
        Relationships: []
      }
      tenant_sms_settings: {
        Row: {
          balance_units: number
          created_at: string
          id: string
          is_active: boolean
          price_per_sms: number
          sender_id: string | null
          tenant_id: string
          total_sent: number
          updated_at: string
        }
        Insert: {
          balance_units?: number
          created_at?: string
          id?: string
          is_active?: boolean
          price_per_sms?: number
          sender_id?: string | null
          tenant_id: string
          total_sent?: number
          updated_at?: string
        }
        Update: {
          balance_units?: number
          created_at?: string
          id?: string
          is_active?: boolean
          price_per_sms?: number
          sender_id?: string | null
          tenant_id?: string
          total_sent?: number
          updated_at?: string
        }
        Relationships: []
      }
      tenant_sms_topups: {
        Row: {
          amount_paid: number
          created_at: string
          id: string
          notes: string | null
          price_per_sms: number
          recorded_by: string | null
          reference: string | null
          tenant_id: string
          units_added: number
        }
        Insert: {
          amount_paid?: number
          created_at?: string
          id?: string
          notes?: string | null
          price_per_sms?: number
          recorded_by?: string | null
          reference?: string | null
          tenant_id: string
          units_added: number
        }
        Update: {
          amount_paid?: number
          created_at?: string
          id?: string
          notes?: string | null
          price_per_sms?: number
          recorded_by?: string | null
          reference?: string | null
          tenant_id?: string
          units_added?: number
        }
        Relationships: []
      }
      tenant_themes: {
        Row: {
          custom_color: string
          dark_mode: boolean
          tenant_id: string
          theme_name: string
          updated_at: string
          updated_by: string | null
        }
        Insert: {
          custom_color?: string
          dark_mode?: boolean
          tenant_id: string
          theme_name?: string
          updated_at?: string
          updated_by?: string | null
        }
        Update: {
          custom_color?: string
          dark_mode?: boolean
          tenant_id?: string
          theme_name?: string
          updated_at?: string
          updated_by?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "tenant_themes_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: true
            referencedRelation: "tenant_domains_public"
            referencedColumns: ["tenant_id"]
          },
          {
            foreignKeyName: "tenant_themes_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: true
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "tenant_themes_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: true
            referencedRelation: "tenants_public"
            referencedColumns: ["id"]
          },
        ]
      }
      tenants: {
        Row: {
          activation_fee_paid_at: string | null
          business_address: string | null
          business_email: string | null
          business_name: string
          business_phone: string | null
          business_type: Database["public"]["Enums"]["business_type"]
          contact_email: string
          contact_name: string
          contact_phone: string | null
          created_at: string
          deleted_at: string | null
          id: string
          industry: string | null
          is_active: boolean
          logo_url: string | null
          owner_user_id: string
          slug: string | null
          updated_at: string
        }
        Insert: {
          activation_fee_paid_at?: string | null
          business_address?: string | null
          business_email?: string | null
          business_name: string
          business_phone?: string | null
          business_type?: Database["public"]["Enums"]["business_type"]
          contact_email: string
          contact_name: string
          contact_phone?: string | null
          created_at?: string
          deleted_at?: string | null
          id?: string
          industry?: string | null
          is_active?: boolean
          logo_url?: string | null
          owner_user_id: string
          slug?: string | null
          updated_at?: string
        }
        Update: {
          activation_fee_paid_at?: string | null
          business_address?: string | null
          business_email?: string | null
          business_name?: string
          business_phone?: string | null
          business_type?: Database["public"]["Enums"]["business_type"]
          contact_email?: string
          contact_name?: string
          contact_phone?: string | null
          created_at?: string
          deleted_at?: string | null
          id?: string
          industry?: string | null
          is_active?: boolean
          logo_url?: string | null
          owner_user_id?: string
          slug?: string | null
          updated_at?: string
        }
        Relationships: []
      }
      transactions: {
        Row: {
          cashier_id: string | null
          cashier_name: string | null
          created_at: string
          customer_id: string | null
          customer_name: string | null
          discount: number
          event_id: string | null
          id: string
          items: Json
          location_id: string | null
          mpesa_error_message: string | null
          mpesa_error_payload: Json | null
          mpesa_ref: string | null
          payment_method: string
          split_payments: Json | null
          status: string
          subtotal: number
          tax: number
          tenant_id: string | null
          total: number
        }
        Insert: {
          cashier_id?: string | null
          cashier_name?: string | null
          created_at?: string
          customer_id?: string | null
          customer_name?: string | null
          discount?: number
          event_id?: string | null
          id?: string
          items?: Json
          location_id?: string | null
          mpesa_error_message?: string | null
          mpesa_error_payload?: Json | null
          mpesa_ref?: string | null
          payment_method: string
          split_payments?: Json | null
          status?: string
          subtotal: number
          tax?: number
          tenant_id?: string | null
          total: number
        }
        Update: {
          cashier_id?: string | null
          cashier_name?: string | null
          created_at?: string
          customer_id?: string | null
          customer_name?: string | null
          discount?: number
          event_id?: string | null
          id?: string
          items?: Json
          location_id?: string | null
          mpesa_error_message?: string | null
          mpesa_error_payload?: Json | null
          mpesa_ref?: string | null
          payment_method?: string
          split_payments?: Json | null
          status?: string
          subtotal?: number
          tax?: number
          tenant_id?: string | null
          total?: number
        }
        Relationships: [
          {
            foreignKeyName: "transactions_customer_id_fkey"
            columns: ["customer_id"]
            isOneToOne: false
            referencedRelation: "customers"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "transactions_location_id_fkey"
            columns: ["location_id"]
            isOneToOne: false
            referencedRelation: "locations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "transactions_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenant_domains_public"
            referencedColumns: ["tenant_id"]
          },
          {
            foreignKeyName: "transactions_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "transactions_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants_public"
            referencedColumns: ["id"]
          },
        ]
      }
      user_activity_log: {
        Row: {
          action: string
          created_at: string
          description: string
          entity_id: string | null
          entity_type: string | null
          event_id: string | null
          id: string
          metadata: Json | null
          tenant_id: string
          user_display_name: string | null
          user_email: string | null
          user_id: string | null
        }
        Insert: {
          action: string
          created_at?: string
          description: string
          entity_id?: string | null
          entity_type?: string | null
          event_id?: string | null
          id?: string
          metadata?: Json | null
          tenant_id: string
          user_display_name?: string | null
          user_email?: string | null
          user_id?: string | null
        }
        Update: {
          action?: string
          created_at?: string
          description?: string
          entity_id?: string | null
          entity_type?: string | null
          event_id?: string | null
          id?: string
          metadata?: Json | null
          tenant_id?: string
          user_display_name?: string | null
          user_email?: string | null
          user_id?: string | null
        }
        Relationships: []
      }
      user_locations: {
        Row: {
          created_at: string
          id: string
          is_primary: boolean
          location_id: string
          user_id: string
        }
        Insert: {
          created_at?: string
          id?: string
          is_primary?: boolean
          location_id: string
          user_id: string
        }
        Update: {
          created_at?: string
          id?: string
          is_primary?: boolean
          location_id?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "user_locations_location_id_fkey"
            columns: ["location_id"]
            isOneToOne: false
            referencedRelation: "locations"
            referencedColumns: ["id"]
          },
        ]
      }
      user_roles: {
        Row: {
          id: string
          role: Database["public"]["Enums"]["app_role"]
          user_id: string
        }
        Insert: {
          id?: string
          role: Database["public"]["Enums"]["app_role"]
          user_id: string
        }
        Update: {
          id?: string
          role?: Database["public"]["Enums"]["app_role"]
          user_id?: string
        }
        Relationships: []
      }
      user_ui_preferences: {
        Row: {
          created_at: string
          id: string
          preference_key: string
          preference_value: Json
          updated_at: string
          user_id: string
        }
        Insert: {
          created_at?: string
          id?: string
          preference_key: string
          preference_value?: Json
          updated_at?: string
          user_id: string
        }
        Update: {
          created_at?: string
          id?: string
          preference_key?: string
          preference_value?: Json
          updated_at?: string
          user_id?: string
        }
        Relationships: []
      }
      variant_exchanges: {
        Row: {
          created_at: string
          created_by: string | null
          customer_id: string | null
          customer_name: string | null
          from_variant_id: string | null
          id: string
          location_id: string | null
          price_difference: number
          product_id: string | null
          quantity: number
          reason: string | null
          status: string
          tenant_id: string
          to_variant_id: string | null
          transaction_id: string | null
        }
        Insert: {
          created_at?: string
          created_by?: string | null
          customer_id?: string | null
          customer_name?: string | null
          from_variant_id?: string | null
          id?: string
          location_id?: string | null
          price_difference?: number
          product_id?: string | null
          quantity?: number
          reason?: string | null
          status?: string
          tenant_id: string
          to_variant_id?: string | null
          transaction_id?: string | null
        }
        Update: {
          created_at?: string
          created_by?: string | null
          customer_id?: string | null
          customer_name?: string | null
          from_variant_id?: string | null
          id?: string
          location_id?: string | null
          price_difference?: number
          product_id?: string | null
          quantity?: number
          reason?: string | null
          status?: string
          tenant_id?: string
          to_variant_id?: string | null
          transaction_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "variant_exchanges_customer_id_fkey"
            columns: ["customer_id"]
            isOneToOne: false
            referencedRelation: "customers"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "variant_exchanges_from_variant_id_fkey"
            columns: ["from_variant_id"]
            isOneToOne: false
            referencedRelation: "product_variants"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "variant_exchanges_location_id_fkey"
            columns: ["location_id"]
            isOneToOne: false
            referencedRelation: "locations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "variant_exchanges_product_id_fkey"
            columns: ["product_id"]
            isOneToOne: false
            referencedRelation: "products"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "variant_exchanges_to_variant_id_fkey"
            columns: ["to_variant_id"]
            isOneToOne: false
            referencedRelation: "product_variants"
            referencedColumns: ["id"]
          },
        ]
      }
    }
    Views: {
      aggregator_tenant_balances: {
        Row: {
          aggregator_tenant_id: string | null
          balance: number | null
          lifetime_collected: number | null
          lifetime_paid_out: number | null
          name: string | null
          pending_payouts: number | null
          slug: string | null
        }
        Relationships: []
      }
      business_settings_safe: {
        Row: {
          barcode_format: string | null
          barcode_label_height: string | null
          barcode_label_width: string | null
          barcode_show_name: boolean | null
          barcode_show_price: boolean | null
          business_address: string | null
          business_email: string | null
          business_name: string | null
          business_phone: string | null
          created_at: string | null
          daily_sales_target: number | null
          default_vat_rate: number | null
          has_mpesa_consumer_key: boolean | null
          has_mpesa_consumer_secret: boolean | null
          has_mpesa_passkey: boolean | null
          has_paystack_secret_key: boolean | null
          id: string | null
          mpesa_account_reference: string | null
          mpesa_environment: string | null
          mpesa_shortcode: string | null
          mpesa_till_number: string | null
          mpesa_transaction_type: string | null
          payment_provider: string | null
          paystack_public_key: string | null
          receipt_footer: string | null
          receipt_header: string | null
          smtp_encryption: string | null
          smtp_from_email: string | null
          smtp_from_name: string | null
          smtp_host: string | null
          smtp_port: string | null
          smtp_username: string | null
          tax_pin: string | null
          tenant_id: string | null
          updated_at: string | null
          updated_by: string | null
          use_platform_mpesa: boolean | null
        }
        Insert: {
          barcode_format?: string | null
          barcode_label_height?: string | null
          barcode_label_width?: string | null
          barcode_show_name?: boolean | null
          barcode_show_price?: boolean | null
          business_address?: string | null
          business_email?: string | null
          business_name?: string | null
          business_phone?: string | null
          created_at?: string | null
          daily_sales_target?: number | null
          default_vat_rate?: number | null
          has_mpesa_consumer_key?: boolean | null
          has_mpesa_consumer_secret?: boolean | null
          has_mpesa_passkey?: boolean | null
          has_paystack_secret_key?: boolean | null
          id?: string | null
          mpesa_account_reference?: string | null
          mpesa_environment?: string | null
          mpesa_shortcode?: string | null
          mpesa_till_number?: string | null
          mpesa_transaction_type?: string | null
          payment_provider?: string | null
          paystack_public_key?: string | null
          receipt_footer?: string | null
          receipt_header?: string | null
          smtp_encryption?: string | null
          smtp_from_email?: string | null
          smtp_from_name?: string | null
          smtp_host?: string | null
          smtp_port?: string | null
          smtp_username?: string | null
          tax_pin?: string | null
          tenant_id?: string | null
          updated_at?: string | null
          updated_by?: string | null
          use_platform_mpesa?: boolean | null
        }
        Update: {
          barcode_format?: string | null
          barcode_label_height?: string | null
          barcode_label_width?: string | null
          barcode_show_name?: boolean | null
          barcode_show_price?: boolean | null
          business_address?: string | null
          business_email?: string | null
          business_name?: string | null
          business_phone?: string | null
          created_at?: string | null
          daily_sales_target?: number | null
          default_vat_rate?: number | null
          has_mpesa_consumer_key?: boolean | null
          has_mpesa_consumer_secret?: boolean | null
          has_mpesa_passkey?: boolean | null
          has_paystack_secret_key?: boolean | null
          id?: string | null
          mpesa_account_reference?: string | null
          mpesa_environment?: string | null
          mpesa_shortcode?: string | null
          mpesa_till_number?: string | null
          mpesa_transaction_type?: string | null
          payment_provider?: string | null
          paystack_public_key?: string | null
          receipt_footer?: string | null
          receipt_header?: string | null
          smtp_encryption?: string | null
          smtp_from_email?: string | null
          smtp_from_name?: string | null
          smtp_host?: string | null
          smtp_port?: string | null
          smtp_username?: string | null
          tax_pin?: string | null
          tenant_id?: string | null
          updated_at?: string | null
          updated_by?: string | null
          use_platform_mpesa?: boolean | null
        }
        Relationships: [
          {
            foreignKeyName: "business_settings_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenant_domains_public"
            referencedColumns: ["tenant_id"]
          },
          {
            foreignKeyName: "business_settings_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "business_settings_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants_public"
            referencedColumns: ["id"]
          },
        ]
      }
      profiles_safe: {
        Row: {
          created_at: string | null
          display_name: string | null
          id: string | null
          phone: string | null
          store_location: string | null
          tenant_id: string | null
          updated_at: string | null
          user_id: string | null
        }
        Insert: {
          created_at?: string | null
          display_name?: string | null
          id?: string | null
          phone?: string | null
          store_location?: string | null
          tenant_id?: string | null
          updated_at?: string | null
          user_id?: string | null
        }
        Update: {
          created_at?: string | null
          display_name?: string | null
          id?: string | null
          phone?: string | null
          store_location?: string | null
          tenant_id?: string | null
          updated_at?: string | null
          user_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "profiles_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenant_domains_public"
            referencedColumns: ["tenant_id"]
          },
          {
            foreignKeyName: "profiles_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "profiles_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants_public"
            referencedColumns: ["id"]
          },
        ]
      }
      tenant_domains_public: {
        Row: {
          business_name: string | null
          host: string | null
          kind: string | null
          logo_url: string | null
          slug: string | null
          tenant_id: string | null
        }
        Relationships: []
      }
      tenants_public: {
        Row: {
          business_name: string | null
          id: string | null
          logo_url: string | null
          slug: string | null
        }
        Insert: {
          business_name?: string | null
          id?: string | null
          logo_url?: string | null
          slug?: string | null
        }
        Update: {
          business_name?: string | null
          id?: string | null
          logo_url?: string | null
          slug?: string | null
        }
        Relationships: []
      }
    }
    Functions: {
      allowed_feature_keys: { Args: never; Returns: string[] }
      calculate_period_end: {
        Args: { billing_cycle: string; start_date: string }
        Returns: string
      }
      confirm_user_email: {
        Args: { _email?: string; _user_id?: string }
        Returns: Json
      }
      current_user_tenant_id: { Args: never; Returns: string }
      delete_user_account: { Args: { _user_id: string }; Returns: Json }
      has_role: {
        Args: {
          _role: Database["public"]["Enums"]["app_role"]
          _user_id: string
        }
        Returns: boolean
      }
      record_tenant_activity: {
        Args: {
          _action: string
          _description: string
          _entity_id: string
          _entity_type: string
          _metadata?: Json
          _tenant_id: string
          _user_display_name: string
          _user_email: string
          _user_id: string
        }
        Returns: string
      }
      sync_plan_subscriptions: { Args: { _plan_id: string }; Returns: number }
    }
    Enums: {
      app_role:
        | "admin"
        | "manager"
        | "cashier"
        | "stock_manager"
        | "super_admin"
        | "rider"
        | "packaging"
        | "sales_person"
      business_type: "general" | "liquor" | "clothing"
    }
    CompositeTypes: {
      [_ in never]: never
    }
  }
}

type DatabaseWithoutInternals = Omit<Database, "__InternalSupabase">

type DefaultSchema = DatabaseWithoutInternals[Extract<keyof Database, "public">]

export type Tables<
  DefaultSchemaTableNameOrOptions extends
    | keyof (DefaultSchema["Tables"] & DefaultSchema["Views"])
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends (DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
        DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])
    : never) = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
      DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])[TableName] extends {
      Row: infer R
    }
    ? R
    : never
  : DefaultSchemaTableNameOrOptions extends keyof (DefaultSchema["Tables"] &
        DefaultSchema["Views"])
    ? (DefaultSchema["Tables"] &
        DefaultSchema["Views"])[DefaultSchemaTableNameOrOptions] extends {
        Row: infer R
      }
      ? R
      : never
    : never

export type TablesInsert<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends (DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never) = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Insert: infer I
    }
    ? I
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Insert: infer I
      }
      ? I
      : never
    : never

export type TablesUpdate<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends (DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never) = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Update: infer U
    }
    ? U
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Update: infer U
      }
      ? U
      : never
    : never

export type Enums<
  DefaultSchemaEnumNameOrOptions extends
    | keyof DefaultSchema["Enums"]
    | { schema: keyof DatabaseWithoutInternals },
  EnumName extends (DefaultSchemaEnumNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"]
    : never) = never,
> = DefaultSchemaEnumNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"][EnumName]
  : DefaultSchemaEnumNameOrOptions extends keyof DefaultSchema["Enums"]
    ? DefaultSchema["Enums"][DefaultSchemaEnumNameOrOptions]
    : never

export type CompositeTypes<
  PublicCompositeTypeNameOrOptions extends
    | keyof DefaultSchema["CompositeTypes"]
    | { schema: keyof DatabaseWithoutInternals },
  CompositeTypeName extends (PublicCompositeTypeNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"]
    : never) = never,
> = PublicCompositeTypeNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"][CompositeTypeName]
  : PublicCompositeTypeNameOrOptions extends keyof DefaultSchema["CompositeTypes"]
    ? DefaultSchema["CompositeTypes"][PublicCompositeTypeNameOrOptions]
    : never

export const Constants = {
  public: {
    Enums: {
      app_role: [
        "admin",
        "manager",
        "cashier",
        "stock_manager",
        "super_admin",
        "rider",
        "packaging",
        "sales_person",
      ],
      business_type: ["general", "liquor", "clothing"],
    },
  },
} as const
