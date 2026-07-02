import { entityValue } from './entity-files';
import { entityFolder } from './settings';
import type { App, TFile } from 'obsidian';
import type { EntityDef, EntityField, EntityRecord, EntityRegistry, JsonValue } from './types';

/* The shared EntityDef misses a few keys the built-in registry actually
   carries: `locationPattern`/`location_pattern` (create-folder patterns,
   also merged in from schema YAML) and `defaultValue` on fields (deal
   stage default; schema YAML can set any JSON default via applySchemas).
   Extend locally until types.ts models them. */
export interface BobEntityField extends EntityField {
  defaultValue?: JsonValue;
}
export interface BobEntityDef extends EntityDef {
  fields?: BobEntityField[];
  locationPattern?: string;
  location_pattern?: string;
}

export const ENTITIES: Record<string, BobEntityDef> = {
  contact: {
    folder: '10-ME/10-PEOPLE',
    typeFilter: 'person',
    label: 'Contact', plural: 'Contacts',
    fields: [
      { key: 'name',        label: 'Name',         primary: true },
      { key: 'person_category', label: 'Category', type: 'enum', options: ['employee', 'freelancer', 'contractor', 'business-contact', 'personal-contact', 'prospect', 'other'] },
      { key: 'email',       label: 'Email',        type: 'email' },
      { key: 'company',     label: 'Company' },
      { key: 'role',        label: 'Role' },
      { key: 'last_contact', label: 'Last contact', type: 'date' },
      { key: 'tags',        label: 'Tags',         type: 'tags' },
    ],
    columns: ['name', 'person_category', 'company', 'email', 'role', 'last_contact'],
  },
  company: {
    folder: '20-COMPANY/00-PROFILE',
    typeFilter: 'company',
    label: 'Company', plural: 'Companies',
    fields: [
      { key: 'title',     label: 'Name',     primary: true },
      { key: 'entity_id', label: 'Entity ID' },
      { key: 'status',    label: 'Status',   type: 'enum', options: ['active', 'inactive', 'archived'] },
      { key: 'regions',   label: 'Regions',  type: 'tags' },
      { key: 'tags',      label: 'Tags',     type: 'tags' },
    ],
    columns: ['title', 'entity_id', 'status', 'regions'],
  },
  client: {
    folder: '30-CLIENTS',
    typeFilter: 'client',
    label: 'Client', plural: 'Clients',
    fields: [
      { key: 'client_name', label: 'Name', primary: true },
      { key: 'client_id',   label: 'Client ID' },
      { key: 'status',      label: 'Status', type: 'enum', options: ['prospect', 'active', 'inactive', 'on-hold', 'completed', 'archived'] },
      { key: 'regions',     label: 'Regions', type: 'tags' },
      { key: 'jurisdiction', label: 'Jurisdiction' },
      { key: 'legal_form', label: 'Legal Form' },
      { key: 'company_registration_number', label: 'Registration No.' },
      { key: 'company_registration_registry', label: 'Registry' },
      { key: 'vat_id', label: 'VAT ID' },
      { key: 'location',    label: 'Location' },
      { key: 'tags',        label: 'Tags', type: 'tags' },
    ],
    columns: ['client_name', 'client_id', 'status', 'regions', 'jurisdiction', 'legal_form', 'vat_id'],
  },
  supplier: {
    folder: '20-COMPANY/30-SUPPLIERS',
    typeFilter: 'supplier',
    label: 'Supplier', plural: 'Suppliers',
    fields: [
      { key: 'supplier_name', label: 'Name', primary: true },
      { key: 'supplier_id',   label: 'Supplier ID' },
      { key: 'status',        label: 'Status', type: 'enum', options: ['active', 'inactive', 'archived'] },
      { key: 'spend_category', label: 'Category' },
      { key: 'regions', label: 'Regions', type: 'tags' },
      { key: 'contract_value_annual', label: 'Annual Spend', type: 'currency' },
      { key: 'payment_terms_default', label: 'Payment Terms' },
      { key: 'contract_expiry', label: 'Contract Expiry', type: 'date' },
      { key: 'tags',          label: 'Tags', type: 'tags' },
    ],
    columns: ['supplier_name', 'supplier_id', 'status', 'spend_category', 'regions', 'contract_value_annual', 'payment_terms_default'],
  },
  partner: {
    folder: '20-COMPANY/35-PARTNERS',
    typeFilter: 'partner',
    label: 'Partner', plural: 'Partners',
    fields: [
      { key: 'partner_name', label: 'Name', primary: true },
      { key: 'partner_id', label: 'Partner ID' },
      { key: 'status', label: 'Status', type: 'enum', options: ['lead', 'qualified', 'active', 'inactive', 'archived'] },
      { key: 'relationship_type', label: 'Relationship' },
      { key: 'my_role', label: 'My Role' },
      { key: 'agreement_type', label: 'Agreement' },
    ],
    columns: ['partner_name', 'partner_id', 'status', 'relationship_type', 'my_role', 'agreement_type'],
  },
  registration: {
    folder: '20-COMPANY/35-PARTNERS',
    typeFilter: 'registration',
    label: 'Registration', plural: 'Registrations',
    fields: [
      { key: 'title',     label: 'Title',      primary: true },
      { key: 'partner_ref', label: 'Partner' },
      { key: 'status',    label: 'Status',     type: 'enum', options: ['submitted', 'approved', 'rejected', 'expired'] },
      { key: 'value',     label: 'Value',      type: 'currency' },
      { key: 'submitted_date', label: 'Submitted',  type: 'date' },
      { key: 'expires_date',   label: 'Expires',    type: 'date' },
      { key: 'deal_ref', label: 'Deal' },
    ],
    columns: ['title', 'partner_ref', 'status', 'value', 'submitted_date', 'expires_date'],
  },
  commission: {
    folder: '20-COMPANY/35-PARTNERS',
    typeFilter: 'commission',
    label: 'Commission', plural: 'Commissions',
    fields: [
      { key: 'reference', label: 'Ref',     primary: true },
      { key: 'partner_ref', label: 'Partner' },
      { key: 'amount',    label: 'Amount',  type: 'currency' },
      { key: 'status',    label: 'Status',  type: 'enum', options: ['pending', 'earned', 'paid', 'disputed', 'written-off'] },
      { key: 'period',    label: 'Period' },
      { key: 'earned_date', label: 'Earned', type: 'date' },
      { key: 'paid_date', label: 'Paid on', type: 'date' },
      { key: 'deal_ref', label: 'Deal' },
    ],
    columns: ['reference', 'partner_ref', 'amount', 'status', 'period', 'earned_date', 'paid_date'],
  },
  lead: {
    folder: '20-COMPANY/55-LEADS',
    typeFilter: 'lead',
    label: 'Lead', plural: 'Leads',
    fields: [
      { key: 'company_name', label: 'Company', primary: true },
      { key: 'client_id', label: 'Billing Client' },
      { key: 'end_client_id', label: 'End Client' },
      { key: 'project_id', label: 'Project ID' },
      { key: 'project', label: 'Project' },
      { key: 'contact_name', label: 'Contact' },
      { key: 'contact_email', label: 'Email', type: 'email' },
      { key: 'source',   label: 'Source' },
      { key: 'owner', label: 'Owner' },
      { key: 'status',   label: 'Status',   type: 'enum', options: ['lead', 'qualified', 'nurture', 'disqualified'] },
      { key: 'prospect_grade', label: 'Grade', type: 'enum', options: ['A+', 'A', 'B', 'C', 'D'] },
      { key: 'prospect_score', label: 'Score', type: 'number' },
      { key: 'next_action', label: 'Next Action' },
      { key: 'next_action_date', label: 'Action Date', type: 'date' },
      { key: 'last_contact', label: 'Last Contact', type: 'date' },
      { key: 'related', label: 'Related' },
      { key: 'lead_date', label: 'Lead Date', type: 'date' },
    ],
    columns: ['company_name', 'client_id', 'end_client_id', 'project_id', 'status', 'owner', 'prospect_grade', 'next_action_date'],
  },
  certification: {
    folder: '20-COMPANY/35-PARTNERS',
    typeFilter: 'certification',
    label: 'Certification', plural: 'Certifications',
    fields: [
      { key: 'name',    label: 'Name',    primary: true },
      { key: 'partner_ref', label: 'Partner' },
      { key: 'level',   label: 'Level' },
      { key: 'issued_date', label: 'Issued',  type: 'date' },
      { key: 'expires_date', label: 'Expires', type: 'date' },
      { key: 'status', label: 'Status', type: 'enum', options: ['active', 'expiring-soon', 'expired', 'renewed', 'revoked'] },
      { key: 'holder_ref', label: 'Holder' },
    ],
    columns: ['name', 'partner_ref', 'level', 'issued_date', 'expires_date', 'status'],
  },
  activity: {
    folder: '30-CLIENTS',
    typeFilter: 'activity',
    label: 'Activity', plural: 'Activities',
    fields: [
      { key: 'title', label: 'Title', primary: true },
      { key: 'channel', label: 'Channel', type: 'enum', options: ['telegram', 'whatsapp', 'email', 'call', 'meeting', 'note'] },
      { key: 'direction', label: 'Direction', type: 'enum', options: ['in', 'out', 'internal'] },
      { key: 'client_id', label: 'Client' },
      { key: 'lead_id', label: 'Lead' },
      { key: 'contact_ref', label: 'Contact' },
      { key: 'date', label: 'Date', type: 'date' },
      { key: 'outcome', label: 'Outcome' },
      { key: 'next_action', label: 'Next Action' },
      { key: 'next_action_date', label: 'Action Date', type: 'date' },
      { key: 'related', label: 'Related' },
    ],
    columns: ['title', 'channel', 'direction', 'client_id', 'lead_id', 'contact_ref', 'date'],
  },
  meeting: {
    folder: '30-CLIENTS',
    typeFilter: 'meeting',
    label: 'Meeting', plural: 'Meetings',
    fields: [
      { key: 'context', label: 'Context', primary: true },
      { key: 'date', label: 'Date', type: 'date' },
      { key: 'attendees', label: 'Attendees', type: 'tags' },
      { key: 'status', label: 'Status', type: 'enum', options: ['scheduled', 'completed', 'cancelled'] },
      { key: 'client_id', label: 'Client' },
      { key: 'end_client_id', label: 'End Client' },
      { key: 'project_id', label: 'Project ID' },
      { key: 'project', label: 'Project' },
      { key: 'time', label: 'Time' },
      { key: 'created', label: 'Created', type: 'date' },
    ],
    columns: ['context', 'date', 'client_id', 'end_client_id', 'project_id', 'status'],
  },
  'comms-thread': {
    folder: '30-CLIENTS',
    typeFilter: 'comms-thread',
    label: 'Comms Thread', plural: 'Comms Threads',
    fields: [
      { key: 'client_id', label: 'Client', primary: true },
      { key: 'thread_id', label: 'Thread ID' },
      { key: 'channel', label: 'Channel', type: 'enum', options: ['email', 'whatsapp', 'telegram'] },
      { key: 'subject', label: 'Subject' },
      { key: 'status', label: 'Status', type: 'enum', options: ['open', 'awaiting-us', 'awaiting-them', 'closed'] },
      { key: 'urgency', label: 'Urgency', type: 'enum', options: ['urgent', 'high', 'normal', 'low'] },
      { key: 'awaiting_reply', label: 'Awaiting Reply' },
      { key: 'last_message_at', label: 'Last Message' },
      { key: 'end_client_id', label: 'End Client' },
      { key: 'project_id', label: 'Project ID' },
      { key: 'project', label: 'Project' },
      { key: 'lead_id', label: 'Lead' },
      { key: 'captured_in', label: 'Captured In', type: 'tags' },
    ],
    columns: ['client_id', 'end_client_id', 'project_id', 'channel', 'subject', 'status', 'last_message_at'],
  },
  deliverable: {
    folder: '30-CLIENTS',
    typeFilter: 'deliverable',
    label: 'Deliverable', plural: 'Deliverables',
    fields: [
      { key: 'client_id', label: 'Client', primary: true },
      { key: 'end_client_id', label: 'End Client' },
      { key: 'project_id', label: 'Project ID' },
      { key: 'project', label: 'Project' },
      { key: 'status', label: 'Status', type: 'enum', options: ['draft', 'review', 'approved', 'delivered'] },
      { key: 'related', label: 'Related', type: 'tags' },
      { key: 'created', label: 'Created', type: 'date' },
    ],
    columns: ['client_id', 'end_client_id', 'project_id', 'project', 'status', 'created'],
  },
  feedback: {
    folder: '30-CLIENTS',
    typeFilter: 'feedback',
    label: 'Feedback', plural: 'Feedback',
    fields: [
      { key: 'feedback_type', label: 'Type', primary: true, type: 'enum', options: ['nps', 'csat', 'pmf', 'exit-survey', 'interview', 'feature-request', 'supplier-review'] },
      { key: 'respondent', label: 'Respondent' },
      { key: 'score', label: 'Score', type: 'number' },
      { key: 'themes', label: 'Themes', type: 'tags' },
      { key: 'sentiment', label: 'Sentiment', type: 'enum', options: ['positive', 'neutral', 'negative', 'mixed'] },
      { key: 'status', label: 'Status', type: 'enum', options: ['raw', 'reviewed', 'actioned', 'archived'] },
      { key: 'client_id', label: 'Client' },
      { key: 'end_client_id', label: 'End Client' },
      { key: 'project_id', label: 'Project ID' },
      { key: 'project', label: 'Project' },
      { key: 'action_taken', label: 'Action Taken' },
    ],
    columns: ['feedback_type', 'client_id', 'end_client_id', 'project_id', 'respondent', 'score', 'status'],
  },
  survey: {
    folder: '20-COMPANY/70-OPERATIONS/SURVEYS',
    typeFilter: 'survey',
    label: 'Survey', plural: 'Surveys',
    fields: [
      { key: 'title', label: 'Title', primary: true },
      { key: 'client_id', label: 'Client' },
      { key: 'end_client_id', label: 'End Client' },
      { key: 'project_id', label: 'Project ID' },
      { key: 'project', label: 'Project' },
      { key: 'survey_type', label: 'Type', type: 'enum', options: ['nps', 'csat', 'pmf', 'exit-survey', 'supplier-review', 'custom'] },
      { key: 'target_audience', label: 'Audience', type: 'enum', options: ['clients', 'prospects', 'suppliers', 'mixed'] },
      { key: 'tool', label: 'Tool' },
      { key: 'external_url', label: 'External URL' },
      { key: 'response_count', label: 'Responses', type: 'number' },
      { key: 'response_rate', label: 'Response Rate', type: 'number' },
      { key: 'status', label: 'Status', type: 'enum', options: ['draft', 'active', 'closed', 'analyzed'] },
      { key: 'launch_date', label: 'Launch', type: 'date' },
      { key: 'close_date', label: 'Close', type: 'date' },
    ],
    columns: ['title', 'client_id', 'end_client_id', 'project_id', 'survey_type', 'target_audience', 'status', 'launch_date'],
  },
  testimonial: {
    folder: '30-CLIENTS',
    typeFilter: 'testimonial',
    label: 'Testimonial', plural: 'Testimonials',
    fields: [
      { key: 'client_id', label: 'Client', primary: true },
      { key: 'end_client_id', label: 'End Client' },
      { key: 'respondent', label: 'Respondent' },
      { key: 'format', label: 'Format', type: 'enum', options: ['written', 'video', 'linkedin-recommendation', 'case-study-quote'] },
      { key: 'permission_level', label: 'Permission', type: 'enum', options: ['public', 'anonymized', 'internal-only'] },
      { key: 'status', label: 'Status', type: 'enum', options: ['requested', 'received', 'approved', 'published', 'expired'] },
      { key: 'respondent_name', label: 'Name' },
      { key: 'respondent_role', label: 'Role' },
      { key: 'respondent_company', label: 'Company' },
      { key: 'received_date', label: 'Received', type: 'date' },
      { key: 'expiry_date', label: 'Expires', type: 'date' },
      { key: 'project_id', label: 'Project ID' },
      { key: 'project', label: 'Project' },
    ],
    columns: ['client_id', 'end_client_id', 'project_id', 'respondent_name', 'format', 'permission_level', 'status'],
  },
  decision: {
    folder: '20-COMPANY/02-DECISIONS',
    typeFilter: 'decision-log',
    label: 'Decision', plural: 'Decisions',
    fields: [
      { key: 'status', label: 'Status', primary: true, type: 'enum', options: ['proposed', 'decided', 'superseded'] },
      { key: 'client_id', label: 'Client' },
      { key: 'end_client_id', label: 'End Client' },
      { key: 'project_id', label: 'Project ID' },
      { key: 'project', label: 'Project' },
      { key: 'created', label: 'Created', type: 'date' },
    ],
    columns: ['status', 'client_id', 'end_client_id', 'project_id', 'created'],
  },
  campaign: {
    folder: '20-COMPANY/60-SALES/CAMPAIGNS',
    typeFilter: 'campaign',
    label: 'Campaign', plural: 'Campaigns',
    fields: [
      { key: 'campaign_name',  label: 'Name',        primary: true },
      { key: 'campaign_type',  label: 'Type',        type: 'enum', options: ['outbound', 'inbound', 'mixed'] },
      { key: 'status',         label: 'Status',      type: 'enum', options: ['draft', 'active', 'paused', 'completed', 'archived'] },
      { key: 'target_persona', label: 'Persona' },
      { key: 'launch_date',    label: 'Launch',      type: 'date' },
      { key: 'target_metric_value', label: 'Target Metric', type: 'number' },
      { key: 'budget',         label: 'Budget',      type: 'currency' },
      { key: 'owner',          label: 'Owner' },
      { key: 'expected_end_date', label: 'Expected End', type: 'date' },
      { key: 'tags',           label: 'Tags',        type: 'tags' },
    ],
    columns: ['campaign_name', 'campaign_type', 'status', 'launch_date', 'target_persona', 'target_metric_value', 'budget', 'owner'],
  },
  sequence: {
    folder: '20-COMPANY/60-SALES/SEQUENCES',
    typeFilter: 'sequence',
    label: 'Sequence', plural: 'Sequences',
    fields: [
      { key: 'sequence_name',   label: 'Name',         primary: true },
      { key: 'campaign_ref',    label: 'Campaign' },
      { key: 'target_persona',  label: 'Persona' },
      { key: 'total_touches',   label: 'Touches',      type: 'number' },
      { key: 'duration_days',   label: 'Days',         type: 'number' },
      { key: 'enrolled_count',  label: 'Enrolled',     type: 'number' },
      { key: 'reply_count',     label: 'Replies',      type: 'number' },
      { key: 'meeting_count',   label: 'Meetings',     type: 'number' },
      { key: 'status',          label: 'Status',       type: 'enum', options: ['draft', 'active', 'paused', 'completed', 'archived'] },
      { key: 'launch_date',     label: 'Launch',       type: 'date' },
      { key: 'owner',           label: 'Owner' },
      { key: 'tags',            label: 'Tags',         type: 'tags' },
    ],
    columns: ['sequence_name', 'campaign_ref', 'status', 'total_touches', 'duration_days', 'enrolled_count', 'reply_count', 'meeting_count', 'launch_date'],
  },
  project: {
    folder: '30-CLIENTS',
    typeFilter: 'project',
    label: 'Project', plural: 'Projects',
    locationPattern: '30-CLIENTS/{project_id}',
    fields: [
      { key: 'project_id', label: 'Project ID', primary: true },
      { key: 'project_name', label: 'Project Name' },
      { key: 'client_id', label: 'Client' },
      { key: 'end_client_id', label: 'End Client' },
      { key: 'status',   label: 'Status',   type: 'enum', options: ['active', 'on_hold', 'backlog', 'done', 'cancelled'] },
      { key: 'priority', label: 'Priority', type: 'enum', options: ['low', 'medium', 'high'] },
      { key: 'deadline', label: 'Deadline', type: 'date' },
      { key: 'created',  label: 'Created',  type: 'date' },
    ],
    columns: ['project_id', 'project_name', 'client_id', 'end_client_id', 'status', 'priority', 'deadline'],
  },
  task: {
    folder: '00-CORE/TaskNotes/Tasks',
    typeFilter: 'task',
    label: 'TaskNote', plural: 'TaskNotes',
    fields: [
      { key: 'title', label: 'Title', primary: true },
      { key: 'status', label: 'Status', type: 'enum', options: ['open', 'in-progress', 'awaiting-input', 'done'] },
      { key: 'priority', label: 'Priority', type: 'enum', options: ['none', 'low', 'normal', 'high'] },
      { key: 'due', label: 'Due', type: 'date' },
      { key: 'size', label: 'Size', type: 'enum', options: ['XS', 'S', 'M', 'L', 'XL'] },
      { key: 'projects', label: 'Projects', type: 'tags' },
      { key: 'blockedBy', label: 'Blocked By' },
      { key: 'playbook', label: 'Playbook' },
      { key: 'remaining-steps', label: 'Remaining Steps', type: 'number' },
      { key: 'awaiting', label: 'Awaiting' },
      { key: 'run_command', label: 'Run Command' },
      { key: 'contexts', label: 'Contexts', type: 'tags' },
      { key: 'timeEstimate', label: 'Time Estimate', type: 'number' },
    ],
    columns: ['title', 'status', 'priority', 'due', 'size', 'projects', 'blockedBy'],
  },
  'accounting-period': {
    folder: '20-COMPANY/06-FINANCE/PERIODS',
    typeFilter: 'accounting-period',
    label: 'Accounting Period', plural: 'Accounting Periods',
    fields: [
      { key: 'period_id', label: 'Period ID', primary: true },
      { key: 'period_type', label: 'Period Type' },
      { key: 'start_date', label: 'Start', type: 'date' },
      { key: 'end_date', label: 'End', type: 'date' },
      { key: 'status', label: 'Status' },
      { key: 'currency', label: 'Currency' },
    ],
    columns: ['period_id', 'period_type', 'start_date', 'end_date', 'status', 'currency'],
  },
  'bank-account': {
    folder: '20-COMPANY/06-FINANCE/BANK',
    typeFilter: 'bank-account',
    label: 'Bank Account', plural: 'Bank Accounts',
    fields: [
      { key: 'account_id', label: 'Account ID', primary: true },
      { key: 'bank_name', label: 'Bank' },
      { key: 'iban', label: 'IBAN' },
      { key: 'currency', label: 'Currency' },
      { key: 'gl_account_code', label: 'GL Account' },
      { key: 'status', label: 'Status' },
    ],
    columns: ['account_id', 'bank_name', 'iban', 'currency', 'gl_account_code', 'status'],
  },
  'bank-reconciliation': {
    folder: '20-COMPANY/06-FINANCE/BANK',
    typeFilter: 'bank-reconciliation',
    label: 'Bank Reconciliation', plural: 'Bank Reconciliations',
    fields: [
      { key: 'recon_id', label: 'Recon ID', primary: true },
      { key: 'bank_account', label: 'Bank Account' },
      { key: 'period_id', label: 'Period' },
      { key: 'bank_statement_balance', label: 'Statement Balance', type: 'number' },
      { key: 'gl_balance', label: 'GL Balance', type: 'number' },
      { key: 'adjusted_bank_balance', label: 'Adjusted Bank', type: 'number' },
      { key: 'adjusted_gl_balance', label: 'Adjusted GL', type: 'number' },
      { key: 'status', label: 'Status' },
    ],
    columns: ['recon_id', 'bank_account', 'period_id', 'bank_statement_balance', 'gl_balance', 'adjusted_bank_balance', 'adjusted_gl_balance', 'status'],
  },
  'chart-of-accounts': {
    folder: '20-COMPANY/06-FINANCE/COA',
    typeFilter: 'coa-account',
    label: 'Chart of Accounts', plural: 'Chart of Accounts',
    fields: [
      { key: 'account_code', label: 'Account Code', primary: true },
      { key: 'account_name', label: 'Account Name' },
      { key: 'account_type', label: 'Type' },
      { key: 'normal_balance', label: 'Normal Balance' },
      { key: 'jurisdiction', label: 'Jurisdiction' },
      { key: 'ifrs_classification', label: 'IFRS Classification' },
      { key: 'status', label: 'Status' },
    ],
    columns: ['account_code', 'account_name', 'account_type', 'normal_balance', 'jurisdiction', 'ifrs_classification', 'status'],
  },
  'financial-statement': {
    folder: '20-COMPANY/06-FINANCE/REPORTS',
    typeFilter: 'financial-statement',
    label: 'Financial Statement', plural: 'Financial Statements',
    fields: [
      { key: 'statement_type', label: 'Statement Type', primary: true },
      { key: 'period_id', label: 'Period' },
      { key: 'trial_balance', label: 'Trial Balance' },
      { key: 'total_assets', label: 'Assets', type: 'number' },
      { key: 'total_liabilities', label: 'Liabilities', type: 'number' },
      { key: 'total_equity', label: 'Equity', type: 'number' },
      { key: 'generated_date', label: 'Generated', type: 'date' },
      { key: 'status', label: 'Status' },
    ],
    columns: ['statement_type', 'period_id', 'trial_balance', 'total_assets', 'total_liabilities', 'total_equity', 'status'],
  },
  'fs-notes': {
    folder: '20-COMPANY/06-FINANCE/REPORTS',
    typeFilter: 'fs-notes',
    label: 'FS Notes', plural: 'FS Notes',
    fields: [
      { key: 'period_id', label: 'Period', primary: true },
      { key: 'statement_refs', label: 'Statements' },
      { key: 'status', label: 'Status' },
      { key: 'significant_accounting_policies', label: 'Policies' },
      { key: 'going_concern_assessment', label: 'Going Concern' },
      { key: 'notes', label: 'Notes' },
    ],
    columns: ['period_id', 'statement_refs', 'status'],
  },
  'fx-rates-table': {
    folder: '20-COMPANY/06-FINANCE/FX',
    typeFilter: 'fx-rate-table',
    label: 'FX Rates Table', plural: 'FX Rates Tables',
    fields: [
      { key: 'rates_date', label: 'Rates Date', primary: true, type: 'date' },
      { key: 'period_id', label: 'Period' },
      { key: 'source', label: 'Source' },
      { key: 'rates', label: 'Rates' },
    ],
    columns: ['rates_date', 'period_id', 'source'],
  },
  inventory: {
    folder: '20-COMPANY/06-FINANCE/INVENTORY',
    typeFilter: 'inventory-item',
    label: 'Inventory', plural: 'Inventory',
    fields: [
      { key: 'sku', label: 'SKU', primary: true },
      { key: 'description', label: 'Description' },
      { key: 'cost_method', label: 'Cost Method' },
      { key: 'closing_qty', label: 'Closing Qty', type: 'number' },
      { key: 'total_cost', label: 'Total Cost', type: 'number' },
      { key: 'net_realisable_value', label: 'NRV', type: 'number' },
      { key: 'write_down', label: 'Write-down', type: 'number' },
      { key: 'status', label: 'Status' },
    ],
    columns: ['sku', 'description', 'cost_method', 'closing_qty', 'total_cost', 'net_realisable_value', 'write_down', 'status'],
  },
  invoice: {
    folder: '30-CLIENTS',
    typeFilter: 'invoice',
    label: 'Invoice', plural: 'Invoices',
    fields: [
      { key: 'invoice_id', label: 'Invoice ID', primary: true },
      { key: 'client_id', label: 'Client ID' },
      { key: 'client_name', label: 'Client' },
      { key: 'invoice_date', label: 'Invoice Date', type: 'date' },
      { key: 'due_date', label: 'Due Date', type: 'date' },
      { key: 'amount', label: 'Amount', type: 'currency' },
      { key: 'currency', label: 'Currency' },
      { key: 'payment_status', label: 'Payment Status' },
      { key: 'deal_ref', label: 'Deal' },
    ],
    columns: ['invoice_id', 'client_id', 'client_name', 'invoice_date', 'due_date', 'amount', 'currency', 'payment_status', 'deal_ref'],
  },
  'journal-entry': {
    folder: '20-COMPANY/06-FINANCE/JOURNALS',
    typeFilter: 'journal-entry',
    label: 'Journal Entry', plural: 'Journal Entries',
    fields: [
      { key: 'je_id', label: 'JE ID', primary: true },
      { key: 'period_id', label: 'Period' },
      { key: 'entry_date', label: 'Entry Date', type: 'date' },
      { key: 'entry_type', label: 'Entry Type' },
      { key: 'total_debit', label: 'Debit', type: 'number' },
      { key: 'total_credit', label: 'Credit', type: 'number' },
      { key: 'source_document', label: 'Source Document' },
      { key: 'status', label: 'Status' },
    ],
    columns: ['je_id', 'period_id', 'entry_date', 'entry_type', 'total_debit', 'total_credit', 'source_document', 'status'],
  },
  'purchase-order': {
    folder: '20-COMPANY/06-FINANCE/AP/ORDERS',
    typeFilter: 'purchase-order',
    label: 'Purchase Order', plural: 'Purchase Orders',
    fields: [
      { key: 'po_id', label: 'PO ID', primary: true },
      { key: 'supplier_id', label: 'Supplier' },
      { key: 'pr_ref', label: 'PR Ref' },
      { key: 'total_amount', label: 'Total', type: 'currency' },
      { key: 'currency', label: 'Currency' },
      { key: 'payment_terms', label: 'Payment Terms' },
      { key: 'approval_status', label: 'Approval Status' },
      { key: 'delivery_status', label: 'Delivery Status' },
      { key: 'created', label: 'Issued', type: 'date' },
    ],
    columns: ['po_id', 'supplier_id', 'pr_ref', 'total_amount', 'currency', 'approval_status', 'delivery_status', 'created'],
  },
  'purchase-requisition': {
    folder: '20-COMPANY/06-FINANCE/AP/REQUISITIONS',
    typeFilter: 'purchase-requisition',
    label: 'Purchase Requisition', plural: 'Purchase Requisitions',
    fields: [
      { key: 'pr_id', label: 'PR ID', primary: true },
      { key: 'title', label: 'Title' },
      { key: 'requestor', label: 'Requestor' },
      { key: 'category', label: 'Category' },
      { key: 'estimated_amount', label: 'Estimated Amount', type: 'currency' },
      { key: 'currency', label: 'Currency' },
      { key: 'approval_status', label: 'Approval Status' },
      { key: 'supplier_id', label: 'Supplier' },
      { key: 'po_ref', label: 'PO Ref' },
      { key: 'created', label: 'Requested', type: 'date' },
    ],
    columns: ['pr_id', 'requestor', 'category', 'estimated_amount', 'currency', 'approval_status', 'supplier_id', 'po_ref', 'created'],
  },
  'supplier-invoice': {
    folder: '20-COMPANY/06-FINANCE/AP/INVOICES',
    typeFilter: 'supplier-invoice',
    label: 'Supplier Invoice', plural: 'Supplier Invoices',
    fields: [
      { key: 'internal_id', label: 'Internal ID', primary: true },
      { key: 'invoice_id', label: 'Invoice ID' },
      { key: 'supplier_id', label: 'Supplier' },
      { key: 'po_ref', label: 'PO Ref' },
      { key: 'amount', label: 'Amount', type: 'currency' },
      { key: 'currency', label: 'Currency' },
      { key: 'invoice_date', label: 'Invoice Date', type: 'date' },
      { key: 'due_date', label: 'Due Date', type: 'date' },
      { key: 'match_status', label: 'Match Status' },
      { key: 'payment_status', label: 'Payment Status' },
    ],
    columns: ['invoice_id', 'supplier_id', 'po_ref', 'amount', 'currency', 'invoice_date', 'due_date', 'match_status', 'payment_status'],
  },
  'trial-balance': {
    folder: '20-COMPANY/06-FINANCE/REPORTS',
    typeFilter: 'trial-balance',
    label: 'Trial Balance', plural: 'Trial Balances',
    fields: [
      { key: 'period_id', label: 'Period', primary: true },
      { key: 'generated_date', label: 'Generated', type: 'date' },
      { key: 'total_closing_dr', label: 'Closing DR', type: 'number' },
      { key: 'total_closing_cr', label: 'Closing CR', type: 'number' },
      { key: 'status', label: 'Status' },
    ],
    columns: ['period_id', 'generated_date', 'total_closing_dr', 'total_closing_cr', 'status'],
  },
  'vat-return': {
    folder: '20-COMPANY/06-FINANCE/TAX/VAT',
    typeFilter: 'vat-return',
    label: 'VAT Return', plural: 'VAT Returns',
    fields: [
      { key: 'return_id', label: 'Return ID', primary: true },
      { key: 'trn', label: 'TRN' },
      { key: 'period_start', label: 'Period Start', type: 'date' },
      { key: 'period_end', label: 'Period End', type: 'date' },
      { key: 'output_vat', label: 'Output VAT', type: 'number' },
      { key: 'input_vat', label: 'Input VAT', type: 'number' },
      { key: 'net_payable', label: 'Net Payable', type: 'number' },
      { key: 'status', label: 'Status' },
    ],
    columns: ['return_id', 'trn', 'period_start', 'period_end', 'output_vat', 'input_vat', 'net_payable', 'status'],
  },
  'corporate-tax-return': {
    folder: '20-COMPANY/06-FINANCE/TAX/CT',
    typeFilter: 'ct-return',
    label: 'Corporate Tax Return', plural: 'Corporate Tax Returns',
    fields: [
      { key: 'return_id', label: 'Return ID', primary: true },
      { key: 'entity_type', label: 'Entity Type' },
      { key: 'taxable_income', label: 'Taxable Income', type: 'number' },
      { key: 'tax_rate', label: 'Tax Rate', type: 'number' },
      { key: 'tax_payable', label: 'Tax Payable', type: 'number' },
      { key: 'small_business_relief', label: 'Small Business Relief' },
      { key: 'filing_due', label: 'Filing Due', type: 'date' },
      { key: 'status', label: 'Status' },
    ],
    columns: ['return_id', 'entity_type', 'taxable_income', 'tax_rate', 'tax_payable', 'small_business_relief', 'status'],
  },
  'deferred-tax': {
    folder: '20-COMPANY/06-FINANCE/TAX/DEFERRED',
    typeFilter: 'deferred-tax',
    label: 'Deferred Tax', plural: 'Deferred Tax',
    fields: [
      { key: 'period_id', label: 'Period', primary: true },
      { key: 'net_dta', label: 'Net DTA', type: 'number' },
      { key: 'net_dtl', label: 'Net DTL', type: 'number' },
      { key: 'tax_rate_used', label: 'Tax Rate', type: 'number' },
      { key: 'recoverability_assessment', label: 'Recoverability' },
      { key: 'assessment_date', label: 'Assessment Date', type: 'date' },
      { key: 'status', label: 'Status' },
    ],
    columns: ['period_id', 'net_dta', 'net_dtl', 'tax_rate_used', 'recoverability_assessment', 'assessment_date', 'status'],
  },
  'transfer-pricing': {
    folder: '20-COMPANY/06-FINANCE/TAX/TP',
    typeFilter: 'transfer-pricing',
    label: 'Transfer Pricing', plural: 'Transfer Pricing',
    fields: [
      { key: 'period_id', label: 'Period', primary: true },
      { key: 'related_party', label: 'Related Party' },
      { key: 'transaction_type', label: 'Transaction Type' },
      { key: 'transaction_amount', label: 'Amount', type: 'number' },
      { key: 'arm_length_method', label: 'Arm Length Method' },
      { key: 'documented', label: 'Documented' },
      { key: 'status', label: 'Status' },
    ],
    columns: ['period_id', 'related_party', 'transaction_type', 'transaction_amount', 'arm_length_method', 'documented', 'status'],
  },
  'free-zone-status': {
    folder: '20-COMPANY/04-LEGAL/FREEZONE',
    typeFilter: 'freezone-status',
    label: 'Free Zone Status', plural: 'Free Zone Status',
    fields: [
      { key: 'period_id', label: 'Period', primary: true },
      { key: 'free_zone_authority', label: 'Authority' },
      { key: 'qualifying_income', label: 'Qualifying Income', type: 'number' },
      { key: 'non_qualifying_income', label: 'Non-Qualifying Income', type: 'number' },
      { key: 'substance_test_passed', label: 'Substance Test' },
      { key: 'nexus_maintained', label: 'Nexus Maintained' },
      { key: 'status', label: 'Status' },
    ],
    columns: ['period_id', 'free_zone_authority', 'qualifying_income', 'non_qualifying_income', 'substance_test_passed', 'nexus_maintained', 'status'],
  },
  'legal-rule': {
    folder: '40-RESOURCES/legal',
    typeFilter: 'legal-rule',
    label: 'Legal Rule', plural: 'Legal Rules',
    fields: [
      { key: 'rule_identifier', label: 'Rule Identifier', primary: true },
      { key: 'rule_jurisdiction', label: 'Jurisdiction' },
      { key: 'rule_source_type', label: 'Source Type' },
      { key: 'rule_authority', label: 'Authority' },
      { key: 'rule_effective_from', label: 'Effective From', type: 'date' },
      { key: 'as_of_date', label: 'As Of', type: 'date' },
      { key: 'last_verified', label: 'Last Verified', type: 'date' },
      { key: 'confidence', label: 'Confidence', type: 'number' },
      { key: 'status', label: 'Status' },
    ],
    columns: ['rule_identifier', 'rule_jurisdiction', 'rule_source_type', 'rule_authority', 'rule_effective_from', 'as_of_date', 'last_verified', 'confidence', 'status'],
  },
  'document-retention': {
    folder: '20-COMPANY/04-LEGAL/RETENTION',
    typeFilter: 'retention-register',
    label: 'Document Retention', plural: 'Document Retention',
    fields: [
      { key: 'document_type', label: 'Document Type', primary: true },
      { key: 'retention_period_years', label: 'Retention Years' },
      { key: 'destroy_after_date', label: 'Destroy After', type: 'date' },
      { key: 'responsible_person', label: 'Responsible Person' },
      { key: 'status', label: 'Status' },
    ],
    columns: ['document_type', 'retention_period_years', 'destroy_after_date', 'responsible_person', 'status'],
  },
  deal: {
    folder: '30-CLIENTS',
    typeFilter: 'deal',
    valueField: 'deal_value',
    closeByField: 'expected_close',
    wonStages: ['won'],
    lostStages: ['lost'],
    label: 'Deal', plural: 'Deals',
    fields: [
      { key: 'title',   label: 'Title',   primary: true },
      { key: 'client_id', label: 'Client' },
      { key: 'end_client_id', label: 'End Client' },
      { key: 'project_id', label: 'Project ID' },
      { key: 'project', label: 'Project' },
      { key: 'owner', label: 'Owner' },
      { key: 'partner_ref', label: 'Partner' },
      { key: 'stage',   label: 'Stage',   type: 'enum', options: ['lead', 'qualified', 'proposal', 'negotiation', 'won', 'lost'], defaultValue: 'lead' },
      { key: 'deal_value', label: 'Deal Value', type: 'currency' },
      { key: 'deal_source', label: 'Source', type: 'enum', options: ['referral', 'inbound', 'outbound', 'event', 'partner'] },
      { key: 'probability', label: 'Probability', type: 'number' },
      { key: 'expected_close', label: 'Expected close', type: 'date' },
      { key: 'next_action', label: 'Next Action', type: 'date' },
      { key: 'next_action_note', label: 'Next Action Note' },
      { key: 'last_contact', label: 'Last Contact', type: 'date' },
    ],
    columns: ['title', 'client_id', 'end_client_id', 'project_id', 'owner', 'partner_ref', 'stage', 'deal_value', 'expected_close'],
  },

  playbook: {
    folder: '00-CORE/Playbooks',
    typeFilter: 'playbook',
    label: 'Playbook', plural: 'Playbooks',
    fields: [
      { key: 'title',              label: 'Title',       primary: true },
      { key: 'trigger',            label: 'Trigger' },
      { key: 'outcome',            label: 'Outcome' },
      { key: 'status',             label: 'Status',      type: 'enum', options: ['active', 'draft', 'deprecated'] },
      { key: 'value-chain',        label: 'Value Chain' },
      { key: 'total-steps',        label: 'Steps',       type: 'number' },
      { key: 'estimated-duration', label: 'Duration' },
      { key: 'maturity',           label: 'Maturity',    type: 'tags' },
      { key: 'tags',               label: 'Tags',        type: 'tags' },
      { key: 'created',            label: 'Created',     type: 'date' },
      { key: 'modified',           label: 'Modified',    type: 'date' },
    ],
    columns: ['title', 'trigger', 'status', 'value-chain', 'total-steps'],
  },

  skill: {
    folder: '00-CORE/Agents/skills',
    filenameFilter: 'SKILL.md',
    label: 'Skill', plural: 'Skills',
    fields: [
      { key: 'name',                       label: 'Name',         primary: true },
      { key: 'description',                label: 'Description' },
      { key: 'category',                   label: 'Category',     type: 'enum', options: ['utilities', 'crm', 'finance', 'marketing', 'operations', 'hr', 'content', 'research', 'legal', 'product'] },
      { key: 'version',                    label: 'Version' },
      { key: 'disable-model-invocation',   label: 'Enabled',      type: 'enum', options: ['false', 'true'] },
      { key: 'user-invocable',             label: 'User Invocable', type: 'enum', options: ['true', 'false'] },
      { key: 'pricing-tier',               label: 'Pricing Tier', type: 'enum', options: ['starter', 'pro', 'enterprise', 'free'] },
      { key: 'origin',                     label: 'Origin',       type: 'enum', options: ['custom', 'community', 'marketplace'] },
      { key: 'value-chains',               label: 'Value Chains', type: 'tags' },
      { key: 'dev-status',                 label: 'Dev Status',   type: 'enum', options: ['integrated', 'beta', 'experimental', 'deprecated'] },
    ],
    columns: ['name', 'category', 'version', 'disable-model-invocation', 'user-invocable', 'pricing-tier'],
  },
};
export const BUILTIN_ENTITY_DEFAULTS: Record<string, BobEntityDef> = JSON.parse(JSON.stringify(ENTITIES));

export const DEAL_STAGES: string[] = ['lead', 'qualified', 'proposal', 'negotiation', 'won', 'lost'];

/* Deal field accessors — read entity definition overrides with safe defaults */
export function dealStageField(def: EntityDef): string    { return def.stageField    || 'stage'; }
export function dealValueField(def: EntityDef): string    { return def.valueField    || 'deal_value'; }
export function dealWonStages(def: EntityDef): string[]     { return def.wonStages     || ['won']; }
export function dealLostStages(def: EntityDef): string[]    { return def.lostStages    || ['lost']; }
export function dealTerminalStages(def: EntityDef): string[]{ return [...dealWonStages(def), ...dealLostStages(def)]; }
export function normalizeStatusValue(value: unknown): string {
  return String(value || '').toLowerCase().replace(/[\s_]+/g, '-').trim();
}
export function entityStatusField(def: EntityDef): string {
  if (!def) return 'status';
  if (String(def.statusField || '').trim()) return def.statusField;
  if (String(def.stageField || '').trim()) return def.stageField;
  const fields = Array.isArray(def.fields) ? def.fields : [];
  const exact = fields.find((field) => field?.key === 'status' || field?.key === 'stage');
  if (exact) return exact.key;
  const suffixed = fields.find((field) => /_status$/.test(String(field?.key || '')));
  if (suffixed) return suffixed.key;
  return 'status';
}
export function entityTerminalStatuses(def: EntityDef): Set<string> {
  const statuses = new Set(['done', 'completed', 'closed', 'cancelled', 'canceled', 'archived', 'paid', 'filed', 'submitted', 'approved', 'rejected', 'expired', 'written-off', 'won', 'lost'].map(normalizeStatusValue));
  (Array.isArray(def?.terminalStatuses) ? def.terminalStatuses : []).forEach((status) => {
    const normalized = normalizeStatusValue(status);
    if (normalized) statuses.add(normalized);
  });
  (Array.isArray(def?.wonStages) ? def.wonStages : []).forEach((status) => {
    const normalized = normalizeStatusValue(status);
    if (normalized) statuses.add(normalized);
  });
  (Array.isArray(def?.lostStages) ? def.lostStages : []).forEach((status) => {
    const normalized = normalizeStatusValue(status);
    if (normalized) statuses.add(normalized);
  });
  return statuses;
}

export function isOpenEntityRecord(entity: EntityRecord, entityKey: string, entities: EntityRegistry = ENTITIES): boolean {
  const def = entities[entityKey];
  const statusField = entityStatusField(def);
  const status = normalizeStatusValue(entityValue(entity, statusField, def));
  if (!status) return true;
  return !entityTerminalStatuses(def).has(status);
}
/* Activity field accessors — configurable with mtime fallback for dateField */
export function activityDate(entity: EntityRecord, def: EntityDef): string {
  const field = def.dateField || 'date';
  const val = entity.frontmatter?.[field];
  if (val) return String(val);
  return entity.file?.stat?.mtime ? new Date(entity.file.stat.mtime).toISOString().slice(0, 10) : '';
}
export function activityTitle(entity: EntityRecord, def: EntityDef): string {
  const field = def.titleField || 'title';
  return entity.frontmatter?.[field] || entity.basename || '';
}

export function primaryField(def: EntityDef): EntityField | null {
  return def?.fields?.find((f) => f.primary) || def?.fields?.[0] || null;
}

export function primaryFieldKey(def: EntityDef): string {
  return primaryField(def)?.key || '';
}

export function getDealStages(def: EntityDef): string[] {
  const sf = dealStageField(def);
  return def.fields?.find((f) => f.key === sf)?.options || DEAL_STAGES;
}

/* Resolve which entity an arbitrary file belongs to, by frontmatter `type`
   first, then path-prefix fallback. Returns null if not a Cadence entity. */
export function entityKeyFromFile(app: App, file: TFile | null): string | null {
  if (!file) return null;
  const cache = app.metadataCache.getFileCache(file);
  const t = cache && cache.frontmatter && cache.frontmatter.type;
  if (t) {
    if (ENTITIES[t]) return t;
    for (const [key, def] of Object.entries(ENTITIES)) {
      if (def.typeFilter && def.typeFilter === t) return key;
    }
  }
  for (const key of Object.keys(ENTITIES)) {
    const def = ENTITIES[key];
    if (!def.typeFilter && !Array.isArray(def.folders) &&
        file.path.startsWith(entityFolder(key) + '/')) return key;
  }
  return null;
}

export const BUILT_SURFACES: Set<string> = new Set([
  'home',
  'planner.inbox', 'planner.today', 'planner.calendar', 'planner.projects',
  'crm.dashboard', 'crm.pipeline', 'crm.contacts', 'crm.leads', 'crm.campaigns', 'crm.sequences', 'crm.clients', 'crm.companies', 'crm.activities',
  'client-work.overview', 'client-work.meetings', 'client-work.comms', 'client-work.deliverables', 'client-work.feedback', 'client-work.surveys', 'client-work.testimonials', 'client-work.decisions',
  'procurement.suppliers', 'procurement.supplier-invoices', 'procurement.purchase-requisitions', 'procurement.purchase-orders',
  'finance.invoices', 'finance.gl', 'finance.setup',
  'tax.overview',
  'prm.partners', 'prm.registrations', 'prm.commissions', 'prm.certifications', 'prm.analytics',
  'reports.pipeline', 'reports.sales', 'reports.partners', 'reports.activity', 'reports.productivity',
  'team', 'settings', 'misc.dashboard-editor', 'misc.export', 'misc.import',
  'ai.playbooks', 'ai.skills',
]);
export const BUILTIN_SURFACE_IDS: Set<string> = new Set(BUILT_SURFACES);

/* ─────────── Settings ─────────── */
