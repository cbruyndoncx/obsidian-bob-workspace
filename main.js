/* ============================================================
   Cadence — Obsidian app
   Single unified view with internal tab nav (Today / Planner / ...).
   Source-of-truth = your daily-note markdown files.
   Plain JS (no build step). Loaded directly by Obsidian.
   ============================================================ */
'use strict';

const obsidian = require('obsidian');

const VIEW_TYPE_CADENCE_APP = 'cadence-app';

/* ─────────── Nav structure ─────────── */
/* Mirrors the Cadence web-app left nav exactly. Groups can be collapsed.
   Built surfaces have a render method; the rest fall through to the
   coming-soon placeholder, which describes what each surface will do. */
const BUILTIN_NAV_GROUPS = [
  {
    id: 'home_group', label: '',
    items: [
      { id: 'home', label: 'Home', icon: 'home', desc: 'Command centre — today, projects, pipeline and upcoming, all on one screen.' },
    ],
  },
  {
    id: 'planner', label: 'Planner', module: 'planner',
    items: [
      { id: 'planner.inbox',    label: 'Inbox',    icon: 'inbox',         module: 'planner', desc: 'Universal capture + reminders. Anything you toss in here surfaces at the right time.' },
      { id: 'planner.today',    label: 'Today',    icon: 'sun',           module: 'planner', desc: 'Diary view of today\'s daily note.' },
      { id: 'planner.calendar', label: 'Calendar', icon: 'calendar-days', module: 'planner', desc: 'Week view across daily notes.' },
      { id: 'planner.tasknotes', label: 'TaskNotes', icon: 'circle-check-big', module: 'planner', entityKey: 'task', folderKey: 'taskNotesFolder', desc: 'TaskNotes as full markdown task records with status, priority, due date and context.' },
      { id: 'planner.projects', label: 'Projects', icon: 'folder-kanban', module: 'planner', entityKey: 'project', folderKey: 'folderProjects', desc: 'Active projects with milestones, owners, statuses — kanban over project notes.' },
    ],
  },
  {
    id: 'crm', label: 'CRM', module: 'crm',
    items: [
      { id: 'crm.dashboard',  label: 'Dashboard',  icon: 'layout-grid',     module: 'crm', desc: 'Overview cards — today\'s tasks, deal momentum, recent contacts, week stats.' },
      { id: 'crm.pipeline',   label: 'Pipeline',   icon: 'trending-up',     module: 'crm', entityKey: 'deal',     folderKey: 'folderPipeline',     desc: 'Sales pipeline. Deals as markdown notes with stage, deal value, client and follow-up frontmatter.' },
      { id: 'crm.contacts',   label: 'Contacts',   icon: 'users',           module: 'crm', entityKey: 'contact',  folderKey: 'folderContacts',     desc: 'People as markdown notes — name, email, company, last-talked-to cadence, tags.' },
      { id: 'crm.clients',    label: 'Clients',    icon: 'briefcase',       module: 'crm', entityKey: 'client',   folderKey: 'folderClients',      desc: 'Client company profiles — status, regions, contact details, related deals and projects.' },
      { id: 'crm.companies',  label: 'My Companies', icon: 'building-2',    module: 'crm', navLevel: 'setup', parent: 'settings', entityKey: 'company',  folderKey: 'folderCompanies',    desc: 'Your own company profiles (can be multiple) — regions, status, branding.' },
      { id: 'crm.leads',      label: 'Leads',      icon: 'target',          module: 'crm', entityKey: 'lead',     folderKey: 'folderLeads',        desc: 'Prospect records — qualification, source, outreach status. Per-lead folder for replies in 03-COMMS/.' },
      { id: 'crm.campaigns',  label: 'Campaigns',  icon: 'megaphone',       module: 'crm', entityKey: 'campaign', folderKey: 'folderCampaigns',    desc: 'Marketing/sales campaigns — outbound (sequences), inbound (content+ads), or mixed.' },
      { id: 'crm.sequences',  label: 'Sequences',  icon: 'zap',             module: 'crm', navLevel: 'secondary', parent: 'crm.campaigns', entityKey: 'sequence', folderKey: 'folderSequences',    desc: 'Outbound multi-touch sequences — execution detail within a campaign.' },
      { id: 'crm.activities', label: 'Activities', icon: 'calendar',        module: 'crm', entityKey: 'activity', folderKey: 'folderActivities',   desc: 'Cross-cutting activity timeline — calls, meetings, telegram/whatsapp/email logs.' },
    ],
  },
  {
    id: 'prm', label: 'PRM', module: 'prm',
    items: [
      { id: 'prm.partners',       label: 'Partners',       icon: 'handshake',        module: 'prm', entityKey: 'partner',       folderKey: 'folderPartners',       desc: 'Partner organisations — relationship status, named contacts, joint pipeline.' },
      { id: 'prm.registrations',  label: 'Registrations',  icon: 'clipboard-check',  module: 'prm', navLevel: 'secondary', parent: 'prm.partners', entityKey: 'registration',  folderKey: 'folderRegistrations',  desc: 'Deal registrations submitted by partners — status, expiry, attached deals.' },
      { id: 'prm.commissions',    label: 'Commissions',    icon: 'wallet',           module: 'prm', navLevel: 'secondary', parent: 'prm.partners', entityKey: 'commission',    folderKey: 'folderCommissions',    desc: 'Commission ledger across partners — earned, pending, paid, by quarter.' },
      { id: 'prm.certifications', label: 'Certifications', icon: 'award',            module: 'prm', navLevel: 'secondary', parent: 'prm.partners', entityKey: 'certification', folderKey: 'folderCertifications', desc: 'Partner certifications — track expiries, renewals, training completion.' },
      { id: 'prm.analytics',      label: 'Analytics',      icon: 'bar-chart-3',      module: 'prm', navLevel: 'secondary', parent: 'prm.partners', desc: 'PRM analytics — partner-sourced revenue, top performers, lifecycle funnel.' },
    ],
  },
  {
    id: 'client-work', label: 'Client Work', module: 'client-work',
    items: [
      { id: 'client-work.overview',      label: 'Workspace',    icon: 'briefcase-business', module: 'client-work', desc: 'Client delivery workspace: meetings, communications, deliverables, feedback, surveys, testimonials and decisions.' },
      { id: 'client-work.meetings',      label: 'Meetings',     icon: 'calendar-clock',     module: 'client-work', navLevel: 'secondary', parent: 'client-work.overview', entityKey: 'meeting',      desc: 'Client meetings with attendees, status, dates and related client IDs.' },
      { id: 'client-work.comms',         label: 'Comms',        icon: 'messages-square',    module: 'client-work', navLevel: 'secondary', parent: 'client-work.overview', entityKey: 'comms-thread', desc: 'Client and lead communication threads across email, WhatsApp and Telegram.' },
      { id: 'client-work.deliverables',  label: 'Deliverables', icon: 'package-check',      module: 'client-work', navLevel: 'secondary', parent: 'client-work.overview', entityKey: 'deliverable',  desc: 'Client deliverables and their review, approval and delivery status.' },
      { id: 'client-work.feedback',      label: 'Feedback',     icon: 'message-circle',     module: 'client-work', navLevel: 'secondary', parent: 'client-work.overview', entityKey: 'feedback',     desc: 'Client feedback, scores, themes, sentiment and response actions.' },
      { id: 'client-work.surveys',       label: 'Surveys',      icon: 'clipboard-list',     module: 'client-work', navLevel: 'secondary', parent: 'client-work.overview', entityKey: 'survey',       desc: 'Survey campaigns, response rates, launch dates and analysis status.' },
      { id: 'client-work.testimonials',  label: 'Testimonials', icon: 'quote',              module: 'client-work', navLevel: 'secondary', parent: 'client-work.overview', entityKey: 'testimonial',  desc: 'Client testimonials with permissions, attribution and publication status.' },
      { id: 'client-work.decisions',     label: 'Decisions',    icon: 'git-pull-request',   module: 'client-work', navLevel: 'secondary', parent: 'client-work.overview', entityKey: 'decision',     desc: 'Decision records connected to client and delivery work.' },
    ],
  },
  {
    id: 'finance', label: 'Finance', module: 'finance',
    items: [
      { id: 'finance.invoices',                label: 'Customer Invoices',       icon: 'receipt',        module: 'finance', entityKey: 'invoice',                desc: 'Customer invoices, payment status and amounts.' },
      { id: 'finance.gl',                      label: 'General Ledger',          icon: 'book-open',      module: 'finance', desc: 'GL work area for chart of accounts, journal entries, trial balances and financial statements.' },
      { id: 'finance.setup',                   label: 'Finance Setup',           icon: 'sliders-horizontal', module: 'finance', desc: 'Finance setup records: periods, bank accounts, FX rates and inventory/reference setup.' },
      { id: 'finance.accounting-periods',      label: 'Accounting Periods',      icon: 'calendar-range', module: 'finance', navLevel: 'setup', parent: 'finance.setup', entityKey: 'accounting-period',      desc: 'Accounting periods — month, quarter and annual close windows.' },
      { id: 'finance.bank-accounts',           label: 'Bank Accounts',           icon: 'landmark',       module: 'finance', navLevel: 'setup', parent: 'finance.setup', entityKey: 'bank-account',           desc: 'Bank accounts linked to currencies and GL accounts.' },
      { id: 'finance.fx-rates',                label: 'FX Rates Tables',         icon: 'repeat-2',       module: 'finance', navLevel: 'setup', parent: 'finance.setup', entityKey: 'fx-rates-table',         desc: 'Foreign exchange rate tables and sources.' },
      { id: 'finance.inventory',               label: 'Inventory',               icon: 'boxes',          module: 'finance', navLevel: 'secondary', parent: 'finance.setup', entityKey: 'inventory',              desc: 'Inventory items, quantities, costing and write-downs.' },
      { id: 'finance.bank-reconciliations',    label: 'Bank Reconciliations',    icon: 'scale',          module: 'finance', navLevel: 'secondary', parent: 'finance.gl', entityKey: 'bank-reconciliation',    desc: 'Bank reconciliation records by account and period.' },
      { id: 'finance.chart-of-accounts',       label: 'Chart of Accounts',       icon: 'list-tree',      module: 'finance', navLevel: 'secondary', parent: 'finance.gl', entityKey: 'chart-of-accounts',      desc: 'Chart of accounts by jurisdiction and account classification.' },
      { id: 'finance.journal-entries',         label: 'Journal Entries',         icon: 'book-open',      module: 'finance', navLevel: 'secondary', parent: 'finance.gl', entityKey: 'journal-entry',          desc: 'Journal entries with posting status and totals.' },
      { id: 'finance.trial-balances',          label: 'Trial Balances',          icon: 'table-2',        module: 'finance', navLevel: 'secondary', parent: 'finance.gl', entityKey: 'trial-balance',          desc: 'Trial balances by period with review status.' },
      { id: 'finance.financial-statements',    label: 'Financial Statements',    icon: 'file-bar-chart', module: 'finance', navLevel: 'secondary', parent: 'finance.gl', entityKey: 'financial-statement',    desc: 'Financial statements generated from trial balances.' },
      { id: 'finance.fs-notes',                label: 'FS Notes',                icon: 'notebook-text',   module: 'finance', navLevel: 'secondary', parent: 'finance.gl', entityKey: 'fs-notes',               desc: 'Financial statement notes and policy disclosures.' },
      { id: 'tax.overview',              label: 'Tax',                   icon: 'receipt-text',   module: 'finance', desc: 'Tax and compliance work area: VAT, corporate tax, transfer pricing, free-zone status and retention.' },
      { id: 'tax.vat-returns',           label: 'VAT Returns',           icon: 'receipt-text',   module: 'finance', navLevel: 'secondary', parent: 'tax.overview', entityKey: 'vat-return',           desc: 'VAT returns, filing status, payable/refund and payment references.' },
      { id: 'tax.corporate-tax-returns', label: 'Corporate Tax Returns', icon: 'landmark',       module: 'finance', navLevel: 'secondary', parent: 'tax.overview', entityKey: 'corporate-tax-return', desc: 'Corporate tax returns, taxable income and filing status.' },
      { id: 'tax.deferred-tax',          label: 'Deferred Tax',          icon: 'split-square-horizontal', module: 'finance', navLevel: 'secondary', parent: 'tax.overview', entityKey: 'deferred-tax', desc: 'Deferred tax asset/liability assessments and review status.' },
      { id: 'tax.transfer-pricing',      label: 'Transfer Pricing',      icon: 'git-compare',    module: 'finance', navLevel: 'secondary', parent: 'tax.overview', entityKey: 'transfer-pricing',     desc: 'Related-party transactions and transfer pricing documentation.' },
      { id: 'tax.free-zone-status',      label: 'Free Zone Status',      icon: 'building',       module: 'finance', navLevel: 'secondary', parent: 'tax.overview', entityKey: 'free-zone-status',     desc: 'Free-zone qualifying status, substance and nexus records.' },
      { id: 'tax.legal-rules',           label: 'Legal Rules',           icon: 'scale',          module: 'finance', navLevel: 'setup', parent: 'tax.overview', entityKey: 'legal-rule',           desc: 'Legal and regulatory source tracking by jurisdiction.' },
      { id: 'tax.document-retention',    label: 'Document Retention',    icon: 'archive',        module: 'finance', navLevel: 'setup', parent: 'tax.overview', entityKey: 'document-retention',    desc: 'Retention register, destruction dates and responsible owners.' },
    ],
  },
  {
    id: 'procurement', label: 'Suppliers & Procurement', module: 'procurement',
    items: [
      { id: 'procurement.suppliers',             label: 'Suppliers',             icon: 'truck',          module: 'procurement', entityKey: 'supplier', folderKey: 'folderSuppliers', desc: 'Supplier profiles — services, contracts, contacts, spend.' },
      { id: 'procurement.supplier-invoices',     label: 'Supplier Invoices',     icon: 'file-check-2',   module: 'procurement', entityKey: 'supplier-invoice', desc: 'Supplier invoices, three-way match and payment status.' },
      { id: 'procurement.purchase-requisitions', label: 'Purchase Requisitions', icon: 'clipboard-list', module: 'procurement', entityKey: 'purchase-requisition', desc: 'Internal purchase requests before spend is approved or a PO is issued.' },
      { id: 'procurement.purchase-orders',       label: 'Purchase Orders',       icon: 'shopping-cart',  module: 'procurement', entityKey: 'purchase-order',       desc: 'Formal supplier purchase orders, approval status and delivery references.' },
    ],
  },
  {
    id: 'reports', label: 'Reports',
    items: [
      { id: 'reports.pipeline',     label: 'Pipeline',     icon: 'trending-up', module: 'crm', desc: 'Pipeline coverage and weighted forecast — by stage, owner, source.' },
      { id: 'reports.sales',        label: 'Sales',        icon: 'bar-chart-3', module: 'crm', desc: 'Closed won / lost trends — quota attainment, win rate, average cycle.' },
      { id: 'reports.partners',     label: 'Partners',     icon: 'handshake',   module: 'prm', desc: 'Partner contribution — sourced vs influenced revenue, top tiers.' },
      { id: 'reports.activity',     label: 'Activity',     icon: 'pie-chart',   module: 'crm', desc: 'Activity mix — calls, meetings, emails by rep and account.' },
      { id: 'reports.productivity', label: 'Productivity', icon: 'sun',         desc: 'Personal productivity — completion rate, streaks, focus blocks, journal volume.' },
    ],
  },
  {
    id: 'misc', label: '',
    items: [
      { id: 'team',     label: 'Team',     icon: 'user-cog',   desc: 'Team members, roles, seats — admin view of your BOB Workspace.' },
      { id: 'settings', label: 'Settings', icon: 'settings-2', desc: 'BOB Workspace settings — folders, headings, week start, API connection.' },
    ],
  },
  {
    id: 'ai', label: 'AI Workspace', module: 'ai',
    items: [
      { id: 'ai.playbooks', label: 'Playbooks', icon: 'book-open-check', module: 'ai', entityKey: 'playbook', folderKey: 'folderPlaybooks', desc: 'Runnable AI playbooks — step-by-step process recipes with triggers, outcomes and maturity levels.' },
      { id: 'ai.skills',    label: 'Skills',    icon: 'cpu',             module: 'ai', entityKey: 'skill',    folderKey: 'folderSkills',    desc: 'Agent skills installed in the vault — category, version, enabled/disabled status.' },
    ],
  },
];

const BUILTIN_SECONDARY_TABS = {
  'crm.campaigns': [
    { label: 'Overview', route: 'crm.campaigns.overview' },
    { label: 'Campaigns', entityKey: 'campaign' },
    { label: 'Sequences', entityKey: 'sequence' },
  ],
  'client-work.overview': [
    { label: 'Overview', route: 'client-work.dashboard' },
    { label: 'Meetings', entityKey: 'meeting' },
    { label: 'Comms', entityKey: 'comms-thread' },
    { label: 'Deliverables', entityKey: 'deliverable' },
    { label: 'Feedback', entityKey: 'feedback' },
    { label: 'Surveys', entityKey: 'survey' },
    { label: 'Testimonials', entityKey: 'testimonial' },
    { label: 'Decisions', entityKey: 'decision' },
  ],
  'prm.partners': [
    { label: 'Overview', route: 'prm.partners.overview' },
    { label: 'Partners', entityKey: 'partner' },
    { label: 'Registrations', entityKey: 'registration' },
    { label: 'Commissions', entityKey: 'commission' },
    { label: 'Certifications', entityKey: 'certification' },
    { label: 'Analytics', route: 'prm.analytics' },
  ],
  'finance.invoices': [
    { label: 'Customer Invoices', entityKey: 'invoice' },
  ],
  'finance.gl': [
    { label: 'Overview', route: 'finance.gl.overview' },
    { label: 'Chart of Accounts', entityKey: 'chart-of-accounts' },
    { label: 'Journal Entries', entityKey: 'journal-entry' },
    { label: 'Bank Reconciliations', entityKey: 'bank-reconciliation' },
    { label: 'Trial Balances', entityKey: 'trial-balance' },
    { label: 'Statements', entityKey: 'financial-statement' },
    { label: 'FS Notes', entityKey: 'fs-notes' },
  ],
  'finance.setup': [
    { label: 'Overview', route: 'finance.setup.overview' },
    { label: 'Accounting Periods', entityKey: 'accounting-period' },
    { label: 'Bank Accounts', entityKey: 'bank-account' },
    { label: 'FX Rates', entityKey: 'fx-rates-table' },
    { label: 'Inventory', entityKey: 'inventory' },
  ],
  'procurement.suppliers': [
    { label: 'Overview', route: 'procurement.overview' },
    { label: 'Suppliers', entityKey: 'supplier' },
    { label: 'Supplier Invoices', entityKey: 'supplier-invoice' },
    { label: 'Purchase Requisitions', entityKey: 'purchase-requisition' },
    { label: 'Purchase Orders', entityKey: 'purchase-order' },
  ],
  'tax.overview': [
    { label: 'Overview', route: 'tax.dashboard' },
    { label: 'VAT Returns', entityKey: 'vat-return' },
    { label: 'Corporate Tax', entityKey: 'corporate-tax-return' },
    { label: 'Deferred Tax', entityKey: 'deferred-tax' },
    { label: 'Transfer Pricing', entityKey: 'transfer-pricing' },
    { label: 'Free Zone Status', entityKey: 'free-zone-status' },
    { label: 'Legal Rules', entityKey: 'legal-rule' },
    { label: 'Document Retention', entityKey: 'document-retention' },
  ],
};
const BUILTIN_WORKBOOK_EXPORT_GROUPS = [
  { id: 'planner', label: 'Planner', entityKeys: ['task', 'project'] },
  { id: 'crm', label: 'CRM', entityKeys: ['deal', 'contact', 'client', 'company', 'lead', 'campaign', 'sequence', 'activity'] },
  { id: 'client-work', label: 'Client Work', entityKeys: ['meeting', 'comms-thread', 'deliverable', 'feedback', 'survey', 'testimonial', 'decision'] },
  { id: 'prm', label: 'PRM', entityKeys: ['partner', 'registration', 'commission', 'certification'] },
  { id: 'finance', label: 'Finance', entityKeys: ['invoice', 'chart-of-accounts', 'journal-entry', 'bank-reconciliation', 'trial-balance', 'financial-statement', 'fs-notes', 'accounting-period', 'bank-account', 'fx-rates-table', 'inventory', 'vat-return', 'corporate-tax-return', 'deferred-tax', 'transfer-pricing', 'free-zone-status', 'legal-rule', 'document-retention'] },
  { id: 'procurement', label: 'Suppliers & Procurement', entityKeys: ['supplier', 'supplier-invoice', 'purchase-requisition', 'purchase-order'] },
  { id: 'ai', label: 'AI Workspace', entityKeys: ['playbook', 'skill'] },
];

function cloneConfig(value) {
  return JSON.parse(JSON.stringify(value));
}

let NAV_GROUPS = cloneConfig(BUILTIN_NAV_GROUPS);
let ALL_SURFACES = [];
let SURFACE_BY_ID = {};
let SURFACES_BY_ENTITY_KEY = {};
let SECONDARY_TABS = cloneConfig(BUILTIN_SECONDARY_TABS);
let WORKBOOK_EXPORT_GROUPS = cloneConfig(BUILTIN_WORKBOOK_EXPORT_GROUPS);

function rebuildSurfaceLookups() {
  ALL_SURFACES = NAV_GROUPS.flatMap((group) => group.items || []);
  SURFACE_BY_ID = Object.fromEntries(ALL_SURFACES.map((surface) => [surface.id, surface]));
  SURFACES_BY_ENTITY_KEY = Object.fromEntries(
    ALL_SURFACES.filter((surface) => surface.entityKey).map((surface) => [surface.entityKey, surface])
  );
}

rebuildSurfaceLookups();

/* ─────────── Entity registry ───────────
   Each entity = a folder of markdown notes with a known frontmatter shape.
   The generic renderEntityList renders any of them; specialised views
   (Pipeline kanban, Dashboard, Reports) compose on top of the same data. */
const ENTITIES = {
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
    fields: [
      { key: 'project_id', label: 'Project ID', primary: true },
      { key: 'project', label: 'Project' },
      { key: 'client_id', label: 'Client' },
      { key: 'end_client_id', label: 'End Client' },
      { key: 'status',   label: 'Status',   type: 'enum', options: ['active', 'on_hold', 'backlog', 'done', 'cancelled'] },
      { key: 'priority', label: 'Priority', type: 'enum', options: ['low', 'medium', 'high'] },
      { key: 'deadline', label: 'Deadline', type: 'date' },
      { key: 'created',  label: 'Created',  type: 'date' },
    ],
    columns: ['project_id', 'project', 'client_id', 'end_client_id', 'status', 'priority', 'deadline'],
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
      { key: 'stage',   label: 'Stage',   type: 'enum', options: ['lead', 'qualified', 'proposal', 'negotiation', 'won', 'lost'], defaultValue: 'lead' },
      { key: 'deal_value', label: 'Deal Value', type: 'currency' },
      { key: 'deal_source', label: 'Source', type: 'enum', options: ['referral', 'inbound', 'outbound', 'event', 'partner'] },
      { key: 'probability', label: 'Probability', type: 'number' },
      { key: 'expected_close', label: 'Expected close', type: 'date' },
      { key: 'next_action', label: 'Next Action', type: 'date' },
      { key: 'next_action_note', label: 'Next Action Note' },
      { key: 'last_contact', label: 'Last Contact', type: 'date' },
    ],
    columns: ['title', 'client_id', 'end_client_id', 'project_id', 'owner', 'stage', 'deal_value', 'expected_close'],
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
const BUILTIN_ENTITY_DEFAULTS = JSON.parse(JSON.stringify(ENTITIES));

const DEAL_STAGES = ['lead', 'qualified', 'proposal', 'negotiation', 'won', 'lost'];

/* Deal field accessors — read entity definition overrides with safe defaults */
function dealStageField(def)    { return def.stageField    || 'stage'; }
function dealValueField(def)    { return def.valueField    || 'deal_value'; }
function dealCloseByField(def)  { return def.closeByField  || 'expected_close'; }
function dealWonStages(def)     { return def.wonStages     || ['won']; }
function dealLostStages(def)    { return def.lostStages    || ['lost']; }
function dealTerminalStages(def){ return [...dealWonStages(def), ...dealLostStages(def)]; }
/* Activity field accessors — configurable with mtime fallback for dateField */
function activityDate(entity, def) {
  const field = def.dateField || 'date';
  const val = entity.frontmatter?.[field];
  if (val) return String(val);
  return entity.file?.stat?.mtime ? new Date(entity.file.stat.mtime).toISOString().slice(0, 10) : '';
}
function activityTitle(entity, def) {
  const field = def.titleField || 'title';
  return entity.frontmatter?.[field] || entity.basename || '';
}

function primaryField(def) {
  return def?.fields?.find((f) => f.primary) || def?.fields?.[0] || null;
}

function primaryFieldKey(def) {
  return primaryField(def)?.key || '';
}

function getDealStages(def) {
  const sf = dealStageField(def);
  return def.fields?.find((f) => f.key === sf)?.options || DEAL_STAGES;
}

/* Resolve which entity an arbitrary file belongs to, by frontmatter `type`
   first, then path-prefix fallback. Returns null if not a Cadence entity. */
function entityKeyFromFile(app, file) {
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

const BUILT_SURFACES = new Set([
  'home',
  'planner.inbox', 'planner.today', 'planner.calendar', 'planner.projects',
  'crm.dashboard', 'crm.pipeline', 'crm.contacts', 'crm.leads', 'crm.campaigns', 'crm.sequences', 'crm.clients', 'crm.companies', 'crm.activities',
  'client-work.overview', 'client-work.meetings', 'client-work.comms', 'client-work.deliverables', 'client-work.feedback', 'client-work.surveys', 'client-work.testimonials', 'client-work.decisions',
  'procurement.suppliers', 'procurement.supplier-invoices', 'procurement.purchase-requisitions', 'procurement.purchase-orders',
  'finance.invoices', 'finance.gl', 'finance.setup',
  'tax.overview',
  'prm.partners', 'prm.registrations', 'prm.commissions', 'prm.certifications', 'prm.analytics',
  'reports.pipeline', 'reports.sales', 'reports.partners', 'reports.activity', 'reports.productivity',
  'team', 'settings',
  'ai.playbooks', 'ai.skills',
]);
const BUILTIN_SURFACE_IDS = new Set(BUILT_SURFACES);

/* ─────────── Settings ─────────── */
const DEFAULT_SETTINGS = {
  dailyNoteFolder: 'daily',
  dailyNoteFormat: 'YYYY-MM-DD',
  journalHeading: '## Journal',
  tasksHeading: '## Today',
  weekStartsOn: 1, // 0 = Sunday, 1 = Monday
  defaultTab: 'home',
  openOnStartup: false,
  collapsedGroups: {}, // { [groupId]: true }
  currency: 'USD',
  cadenceAppDark: false,
  taskProjectLinks: {}, // { "dailyPath::taskText": "Cadence/Projects/X.md" }
  modules: { crm: true, 'client-work': true, prm: true, srm: true, finance: true, procurement: true, tax: true, planner: true, ai: true },
  disabledSurfaces: [],    // surface IDs hidden from nav regardless of module toggle
  showSecondaryNav: false,
  showSetupNav: false,
  teamPersonCategories: ['employee', 'freelancer', 'contractor'],
  desktopNotifications: false,
  reminders: [], // [{ id, text, when (ISO|null), repeat ('none'|'daily'|'weekly'), notified, done, createdAt }]
  cadenceApiUrl: '',
  cadenceApiToken: '',
  // Task mode
  taskMode: 'checkbox',              // 'checkbox' | 'tasknotes' | 'hybrid'
  taskNotesFolder: '00-CORE/TaskNotes/Tasks',
  taskNotesArchiveFolder: '00-CORE/TaskNotes/Archive',
  workbookExportFolder: 'BOB Workspace/Exports',
  // Entity folder locations (all configurable)
  folderContacts: '10-ME/10-PEOPLE',
  folderCompanies: '20-COMPANY/00-PROFILE',
  folderClients: '30-CLIENTS',
  folderSuppliers: '20-COMPANY/30-SUPPLIERS',
  folderPipeline: '30-CLIENTS',
  folderPartners: '20-COMPANY/35-PARTNERS',
  folderRegistrations: '20-COMPANY/35-PARTNERS',
  folderCommissions: '20-COMPANY/35-PARTNERS',
  folderLeads: '20-COMPANY/55-LEADS',
  folderCertifications: '20-COMPANY/35-PARTNERS',
  folderActivities: '30-CLIENTS',
  folderSequences: '20-COMPANY/60-SALES/SEQUENCES',
  folderCampaigns: '20-COMPANY/60-SALES/CAMPAIGNS',
  folderProjects: '30-CLIENTS',
  folderPlaybooks: '00-CORE/Playbooks',
  folderSkills: '00-CORE/Agents/skills',
  projectFolders: [],   // extra folders to scan; first non-empty = default for new projects
  baseFiles: {
    contact: '00-CORE/Bases/People.base',
    client: '00-CORE/Bases/Clients.base',
    company: '00-CORE/Bases/Companies.base',
    deal: '00-CORE/Bases/Pipeline.base',
    activity: '00-CORE/Bases/Activities.base',
    lead: '00-CORE/Bases/Sales-Leads.base',
    partner: '00-CORE/Bases/Partners.base',
    registration: '00-CORE/Bases/Partner-Registrations.base',
    commission: '00-CORE/Bases/Partner-Commissions.base',
    certification: '00-CORE/Bases/Partner-Certifications.base',
    campaign: '00-CORE/Bases/Campaigns.base',
    sequence: '00-CORE/Bases/Sequences.base',
    meeting: '00-CORE/Bases/Meetings.base',
    'comms-thread': '00-CORE/Bases/Comms.base',
    deliverable: '00-CORE/Bases/Deliverables.base',
    feedback: '00-CORE/Bases/Feedback.base',
    survey: '00-CORE/Bases/Surveys.base',
    testimonial: '00-CORE/Bases/Testimonials.base',
    decision: '00-CORE/Bases/Decisions.base',
    project: '00-CORE/Bases/Projects.base',
    supplier: '00-CORE/Bases/Suppliers.base',
    'accounting-period': '00-CORE/Bases/Accounting-Periods.base',
    'bank-account': '00-CORE/Bases/Bank-Accounts.base',
    'bank-reconciliation': '00-CORE/Bases/Bank-Reconciliations.base',
    'chart-of-accounts': '00-CORE/Bases/Chart-of-Accounts.base',
    'financial-statement': '00-CORE/Bases/Financial-Statements.base',
    'fs-notes': '00-CORE/Bases/FS-Notes.base',
    'fx-rates-table': '00-CORE/Bases/FX-Rates-Tables.base',
    inventory: '00-CORE/Bases/Inventory.base',
    invoice: '00-CORE/Bases/AR.base',
    'journal-entry': '00-CORE/Bases/Journal-Entries.base',
    'purchase-requisition': '00-CORE/Bases/Purchase-Requisitions.base',
    'purchase-order': '00-CORE/Bases/Purchase-Orders.base',
    'supplier-invoice': '00-CORE/Bases/Supplier-Invoices.base',
    'trial-balance': '00-CORE/Bases/Trial-Balances.base',
    'vat-return': '00-CORE/Bases/VAT-Returns.base',
    'corporate-tax-return': '00-CORE/Bases/Corporate-Tax-Returns.base',
    'deferred-tax': '00-CORE/Bases/Deferred-Tax.base',
    'transfer-pricing': '00-CORE/Bases/Transfer-Pricing.base',
    'free-zone-status': '00-CORE/Bases/Free-Zone-Status.base',
    'legal-rule': '00-CORE/Bases/Legal-Rules.base',
    'document-retention': '00-CORE/Bases/Document-Retention.base',
  },  // { [entityKey]: 'path/to/entity.base' }
  baseViews: {},  // { [entityKey]: 'View name inside selected .base' }
  schemasFolder: '00-CORE/Schemas/source',  // Metadata Menu schema source folder
  useSchemas: false,    // toggle: read entity defs from schema YAML files
};

/* Module-level — kept in sync by the plugin so helpers can resolve folders
   without threading settings through every call. */
let CURRENT_CURRENCY = 'USD';
let ENTITY_FOLDERS = {
  contact: '10-ME/10-PEOPLE',
  company: '20-COMPANY/00-PROFILE',
  client: '30-CLIENTS',
  supplier: '20-COMPANY/30-SUPPLIERS',
  deal: '30-CLIENTS',
  partner: '20-COMPANY/35-PARTNERS',
  registration: '20-COMPANY/35-PARTNERS',
  commission: '20-COMPANY/35-PARTNERS',
  lead: '20-COMPANY/55-LEADS',
  certification: '20-COMPANY/35-PARTNERS',
  activity: '30-CLIENTS',
  sequence: '20-COMPANY/60-SALES/SEQUENCES',
  campaign: '20-COMPANY/60-SALES/CAMPAIGNS',
  project: '30-CLIENTS',
};

function syncEntityFolders(settings) {
  ENTITY_FOLDERS.contact      = (settings.folderContacts      || '').trim() || '10-ME/10-PEOPLE';
  ENTITY_FOLDERS.company      = (settings.folderCompanies     || '').trim() || '20-COMPANY/00-PROFILE';
  ENTITY_FOLDERS.client       = (settings.folderClients       || '').trim() || '30-CLIENTS';
  ENTITY_FOLDERS.supplier     = (settings.folderSuppliers     || '').trim() || '20-COMPANY/30-SUPPLIERS';
  ENTITY_FOLDERS.deal         = (settings.folderPipeline      || '').trim() || '30-CLIENTS';
  ENTITY_FOLDERS.partner      = (settings.folderPartners      || '').trim() || '20-COMPANY/35-PARTNERS';
  ENTITY_FOLDERS.registration = (settings.folderRegistrations || '').trim() || '20-COMPANY/35-PARTNERS';
  ENTITY_FOLDERS.commission   = (settings.folderCommissions   || '').trim() || '20-COMPANY/35-PARTNERS';
  ENTITY_FOLDERS.lead         = (settings.folderLeads         || '').trim() || '20-COMPANY/55-LEADS';
  ENTITY_FOLDERS.certification= (settings.folderCertifications|| '').trim() || '20-COMPANY/35-PARTNERS';
  ENTITY_FOLDERS.activity     = (settings.folderActivities    || '').trim() || '30-CLIENTS';
  ENTITY_FOLDERS.sequence     = (settings.folderSequences     || '').trim() || '20-COMPANY/60-SALES/SEQUENCES';
  ENTITY_FOLDERS.campaign     = (settings.folderCampaigns     || '').trim() || '20-COMPANY/60-SALES/CAMPAIGNS';
  ENTITY_FOLDERS.playbook     = (settings.folderPlaybooks     || '').trim() || '00-CORE/Playbooks';
  ENTITY_FOLDERS.skill        = (settings.folderSkills        || '').trim() || '00-CORE/Agents/skills';
  const extraProjectFolders = (settings.projectFolders || []).filter(f => f && f.trim());
  const allProjectFolders = [
    (settings.folderProjects || '').trim() || '30-CLIENTS',
    ...extraProjectFolders,
  ];
  ENTITY_FOLDERS.project = allProjectFolders[0];
  ENTITIES.project.folders = allProjectFolders.length > 1 ? allProjectFolders : undefined;
  if (!ENTITIES.project.folders) delete ENTITIES.project.folders;
  ENTITY_FOLDERS.task = (settings.taskNotesFolder || '').trim() || '00-CORE/TaskNotes/Tasks';
  ENTITIES.task.folder = ENTITY_FOLDERS.task;
  ENTITIES.task.folders = taskNoteFolders(settings);
}

function entityFolder(entityKey) {
  // Schema/entities.json `folders` array wins (first entry = default for new files)
  if (ENTITIES[entityKey]?.folders?.[0]) return ENTITIES[entityKey].folders[0];
  return ENTITY_FOLDERS[entityKey] || ENTITIES[entityKey]?.folder || '';
}

function normalizePathSegment(value) {
  return String(value ?? '')
    .replace(/[\\/:*?"<>|]/g, '-')
    .replace(/\s+/g, ' ')
    .trim();
}

function normalizedLookupKey(value) {
  return String(value ?? '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '');
}

function buildEntityCreateValueMap(def, context = {}) {
  const values = Object.assign({}, context.values || {});
  const map = new Map();
  const add = (key, value) => {
    if (value == null || value === '') return;
    const normalized = normalizedLookupKey(key);
    if (normalized) map.set(normalized, value);
  };

  Object.entries(values).forEach(([key, value]) => add(key, value));
  if (context.rawName) {
    const primaryKey = primaryFieldKey(def);
    if (primaryKey) add(primaryKey, context.rawName);
    add('name', context.rawName);
    add('title', context.rawName);
  }
  if (context.filePath) {
    add('file_path', context.filePath);
    add('path', context.filePath);
  }
  return map;
}

function lookupCreateValue(name, valueMap) {
  const key = normalizedLookupKey(name);
  if (!key) return '';
  if (valueMap.has(key)) return valueMap.get(key);
  return '';
}

function resolveLocationPatternFolder(pattern, def, context = {}) {
  if (!pattern) return '';
  const valueMap = buildEntityCreateValueMap(def, context);
  const candidates = String(pattern)
    .split(/\s+or\s+/i)
    .map((part) => part.trim().replace(/^['"]|['"]$/g, ''))
    .filter(Boolean);
  const resolvedPaths = [];

  for (const candidate of candidates) {
    const segments = candidate.split('/').map((segment) => segment.trim()).filter(Boolean);
    const pathSegments = [];
    let blocked = false;
    let hadPlaceholder = false;

    for (const segment of segments) {
      if (!segment.includes('{')) {
        const clean = normalizePathSegment(segment);
        if (clean) pathSegments.push(clean);
        continue;
      }

      hadPlaceholder = true;
      let segmentResolved = segment;
      let unresolved = false;
      segmentResolved = segmentResolved.replace(/\{([^}]+)\}/g, (_, placeholder) => {
        const value = lookupCreateValue(placeholder, valueMap);
        if (value === '') {
          unresolved = true;
          return '';
        }
        return normalizePathSegment(value);
      });

      if (unresolved) {
        blocked = true;
        break;
      }

      const clean = normalizePathSegment(segmentResolved);
      if (clean) pathSegments.push(clean);
    }

    resolvedPaths.push({
      path: pathSegments.join('/'),
      depth: pathSegments.length,
      fullyResolved: !blocked && (!hadPlaceholder || pathSegments.length === segments.length),
    });
  }

  const fullMatch = resolvedPaths
    .filter((item) => item.path && item.fullyResolved)
    .sort((a, b) => b.depth - a.depth)[0];
  if (fullMatch) return fullMatch.path;

  const bestPartial = resolvedPaths
    .filter((item) => item.path)
    .sort((a, b) => b.depth - a.depth)[0];
  return bestPartial?.path || '';
}

function resolveEntityCreateFolder(entityKey, rawName, context = {}) {
  const def = ENTITIES[entityKey];
  if (!def) return entityFolder(entityKey);
  const pattern = def.locationPattern || def.location_pattern || '';
  const resolved = resolveLocationPatternFolder(pattern, def, Object.assign({}, context, { rawName }));
  return resolved || entityFolder(entityKey);
}

function normalizeTemplateSpec(template) {
  if (!template) return null;
  if (typeof template === 'string') return { body: template };
  if (typeof template === 'object' && !Array.isArray(template)) return template;
  return null;
}

function applyTemplatePlaceholders(value, context = {}) {
  if (typeof value !== 'string') return value;
  return value.replace(/\{\{([^}]+)\}\}/g, (_, key) => {
    const lookup = String(key || '').trim();
    if (!lookup) return '';
    const candidates = [lookup, lookup.toLowerCase(), lookup.replace(/\s+/g, '_').toLowerCase()];
    for (const candidate of candidates) {
      if (Object.prototype.hasOwnProperty.call(context, candidate) && context[candidate] != null) {
        return String(context[candidate]);
      }
    }
    return '';
  });
}

function renderTemplateFrontmatter(frontmatter, context = {}) {
  const result = {};
  Object.entries(frontmatter || {}).forEach(([key, value]) => {
    if (Array.isArray(value)) {
      result[key] = value.map((item) => applyTemplatePlaceholders(item, context));
      return;
    }
    if (value && typeof value === 'object') {
      result[key] = renderTemplateFrontmatter(value, context);
      return;
    }
    result[key] = applyTemplatePlaceholders(value, context);
  });
  return result;
}

function renderTemplateBody(body, context = {}) {
  const lines = Array.isArray(body) ? body : String(body || '').split('\n');
  return lines.map((line) => applyTemplatePlaceholders(line, context)).join('\n');
}

function renderTemplateDocument(template, context = {}, fallback = null) {
  const spec = normalizeTemplateSpec(template);
  const body = spec?.body != null ? spec.body : fallback?.body;
  const frontmatter = spec?.frontmatter != null ? spec.frontmatter : fallback?.frontmatter;
  const fm = renderTemplateFrontmatter(frontmatter || {}, context);
  const fmLines = ['---'];
  Object.entries(fm).forEach(([key, value]) => {
    fmLines.push(obsidian.stringifyYaml({ [key]: value }).trim() || `${key}:`);
  });
  fmLines.push('---', '');
  const renderedBody = renderTemplateBody(body != null ? body : '', context);
  return [fmLines.join('\n'), renderedBody].filter(Boolean).join('\n');
}

let PLUGIN_DIR = '';
let WORKSPACE_CONFIG_PATH = 'Cadence/workspace.json';
let WORKSPACE_BACKUP_PATH = 'Cadence/workspace.backup.json';
let WORKSPACE_CONFIG = {};
let WORKSPACE_HAS_NAVIGATION = false;
let CONFIGURED_BASE_ENTITY_KEYS = new Set();

function initPluginPaths(plugin) {
  const dir = (plugin.manifest && plugin.manifest.dir) || `.obsidian/plugins/${plugin.manifest.id}`;
  PLUGIN_DIR = dir;
  WORKSPACE_CONFIG_PATH = `${dir}/workspace.json`;
  WORKSPACE_BACKUP_PATH = `${dir}/workspace.backup.json`;
}

function validateWorkspaceConfig(config) {
  if (!config || typeof config !== 'object' || Array.isArray(config)) {
    throw new Error('Must be a JSON object');
  }
  if (config.settings != null && (typeof config.settings !== 'object' || Array.isArray(config.settings))) {
    throw new Error('settings must be an object');
  }
  const navigation = config.navigation;
  if (navigation != null && (typeof navigation !== 'object' || Array.isArray(navigation))) {
    throw new Error('navigation must be an object');
  }
  if (navigation?.groups != null && !Array.isArray(navigation.groups)) {
    throw new Error('navigation.groups must be an array');
  }
  const surfaceIds = new Set();
  for (const group of navigation?.groups || []) {
    if (!group || typeof group !== 'object' || !group.id || !Array.isArray(group.items)) {
      throw new Error('Every navigation group needs an id and items array');
    }
    for (const surface of group.items) {
      if (!surface || !surface.id || !surface.label) {
        throw new Error(`Navigation group "${group.id}" has an item without id/label`);
      }
      if (surface.placement != null && surface.placement !== 'navigation') {
        throw new Error(`Navigation item "${surface.id}" has unsupported placement "${surface.placement}"`);
      }
      if (surfaceIds.has(surface.id)) throw new Error(`Duplicate surface id "${surface.id}"`);
      surfaceIds.add(surface.id);
    }
  }
  if (navigation?.secondaryTabs != null && (typeof navigation.secondaryTabs !== 'object' || Array.isArray(navigation.secondaryTabs))) {
    throw new Error('navigation.secondaryTabs must be an object keyed by parent surface id');
  }
  for (const [parentId, tabs] of Object.entries(navigation?.secondaryTabs || {})) {
    if (!Array.isArray(tabs)) throw new Error(`secondaryTabs "${parentId}" must be an array`);
    for (const tab of tabs) {
      if (!tab || !tab.label || (!tab.entityKey && !tab.route && !Array.isArray(tab.children))) {
        throw new Error(`secondaryTabs "${parentId}" has a tab without label and entityKey/route/children`);
      }
    }
  }
  if (config.entities != null && (typeof config.entities !== 'object' || Array.isArray(config.entities))) {
    throw new Error('entities must be an object keyed by entity type');
  }
  if (config.bases != null && (typeof config.bases !== 'object' || Array.isArray(config.bases))) {
    throw new Error('bases must be an object keyed by entity type');
  }
  for (const [entityKey, base] of Object.entries(config.bases || {})) {
    if (!base || typeof base !== 'object' || Array.isArray(base) || !String(base.file || base.base || '').trim()) {
      throw new Error(`bases "${entityKey}" needs a file path`);
    }
  }
  if (config.workbookGroups != null && !Array.isArray(config.workbookGroups)) {
    throw new Error('workbookGroups must be an array');
  }
  const workbookGroupIds = new Set();
  for (const group of config.workbookGroups || []) {
    if (!group || typeof group !== 'object' || !String(group.id || '').trim() ||
        !String(group.label || '').trim() || !Array.isArray(group.entityKeys)) {
      throw new Error('Every workbook group needs an id, label and entityKeys array');
    }
    if (workbookGroupIds.has(group.id)) throw new Error(`Duplicate workbook group id "${group.id}"`);
    if (group.entityKeys.some((key) => !String(key || '').trim())) {
      throw new Error(`Workbook group "${group.id}" has an invalid entity key`);
    }
    if (new Set(group.entityKeys).size !== group.entityKeys.length) {
      throw new Error(`Workbook group "${group.id}" contains duplicate entity keys`);
    }
    workbookGroupIds.add(group.id);
  }
  return config;
}

const WORKSPACE_OWNED_SETTING_KEYS = [
  'currency',
  'modules',
  'disabledSurfaces',
  'showSecondaryNav',
  'showSetupNav',
  'teamPersonCategories',
  'taskMode',
  'taskNotesFolder',
  'taskNotesArchiveFolder',
  'workbookExportFolder',
  'baseFiles',
  'baseViews',
  'schemasFolder',
  'useSchemas',
  'folderContacts',
  'folderCompanies',
  'folderClients',
  'folderSuppliers',
  'folderPipeline',
  'folderPartners',
  'folderRegistrations',
  'folderCommissions',
  'folderLeads',
  'folderCertifications',
  'folderActivities',
  'folderSequences',
  'folderCampaigns',
  'folderProjects',
  'folderPlaybooks',
  'folderSkills',
  'projectFolders',
  'dailyNoteFolder',
  'journalHeading',
  'tasksHeading',
  'defaultTab',
  'reminders',
  'taskProjectLinks',
];

function workspaceOwnedSettings(settings = {}) {
  const owned = {};
  WORKSPACE_OWNED_SETTING_KEYS.forEach((key) => {
    if (Object.prototype.hasOwnProperty.call(settings, key)) owned[key] = cloneConfig(settings[key]);
  });
  return owned;
}

function applyWorkspaceOwnedSettings(settings = {}) {
  const merged = Object.assign({}, settings);
  const workspaceSettings = WORKSPACE_CONFIG.settings || {};
  WORKSPACE_OWNED_SETTING_KEYS.forEach((key) => {
    if (Object.prototype.hasOwnProperty.call(workspaceSettings, key) && workspaceSettings[key] != null) {
      merged[key] = cloneConfig(workspaceSettings[key]);
    }
  });
  return merged;
}

function persistedWorkspaceOwnedSettings(settings = {}) {
  const existing = WORKSPACE_CONFIG.settings || {};
  const persisted = {};
  WORKSPACE_OWNED_SETTING_KEYS.forEach((key) => {
    if (!Object.prototype.hasOwnProperty.call(settings, key)) return;
    const current = settings[key];
    const defaultValue = DEFAULT_SETTINGS[key];
    const shouldPersist = Object.prototype.hasOwnProperty.call(existing, key)
      || JSON.stringify(current) !== JSON.stringify(defaultValue);
    if (shouldPersist) persisted[key] = cloneConfig(current);
  });
  return persisted;
}

async function saveWorkspaceConfig(app, jsonText) {
  const parsed = validateWorkspaceConfig(JSON.parse(jsonText));
  const adapter = app.vault.adapter;
  if (await adapter.exists(WORKSPACE_CONFIG_PATH)) {
    await adapter.write(WORKSPACE_BACKUP_PATH, await adapter.read(WORKSPACE_CONFIG_PATH));
  }
  await adapter.write(WORKSPACE_CONFIG_PATH, jsonText);
  return parsed;
}

async function loadWorkspaceConfig(app) {
  WORKSPACE_CONFIG = {};
  WORKSPACE_HAS_NAVIGATION = false;
  if (!(await app.vault.adapter.exists(WORKSPACE_CONFIG_PATH))) return WORKSPACE_CONFIG;
  try {
    WORKSPACE_CONFIG = validateWorkspaceConfig(JSON.parse(await app.vault.adapter.read(WORKSPACE_CONFIG_PATH)));
    WORKSPACE_HAS_NAVIGATION = Array.isArray(WORKSPACE_CONFIG.navigation?.groups);
  } catch (e) {
    new obsidian.Notice(`BOB Workspace: workspace.json error - ${e.message}`);
    WORKSPACE_CONFIG = {};
  }
  return WORKSPACE_CONFIG;
}

function resetWorkspaceRegistries() {
  NAV_GROUPS = cloneConfig(BUILTIN_NAV_GROUPS);
  SECONDARY_TABS = cloneConfig(BUILTIN_SECONDARY_TABS);
  WORKBOOK_EXPORT_GROUPS = cloneConfig(BUILTIN_WORKBOOK_EXPORT_GROUPS);
  for (const id of [...BUILT_SURFACES]) {
    if (!BUILTIN_SURFACE_IDS.has(id)) BUILT_SURFACES.delete(id);
  }
  rebuildSurfaceLookups();
}

function applyWorkspaceRegistries(config = {}) {
  const navigation = config.navigation || {};
  if (Array.isArray(navigation.groups)) NAV_GROUPS = cloneConfig(navigation.groups);
  if (navigation.secondaryTabs && typeof navigation.secondaryTabs === 'object') {
    SECONDARY_TABS = cloneConfig(navigation.secondaryTabs);
  }
  normalizeStandaloneNavigationSurfaces(NAV_GROUPS, SECONDARY_TABS, Array.isArray(navigation.groups));
  if (Array.isArray(config.workbookGroups)) WORKBOOK_EXPORT_GROUPS = cloneConfig(config.workbookGroups);
  NAV_GROUPS.flatMap((group) => group.items || []).forEach((surface) => {
    if (surface.entityKey || SECONDARY_TABS[surface.id]) BUILT_SURFACES.add(surface.id);
  });
  rebuildSurfaceLookups();
}

function effectiveSchemaSettings(settings = {}) {
  const schemaConfig = WORKSPACE_CONFIG.schemas || {};
  return Object.assign({}, settings, {
    useSchemas: schemaConfig.enabled == null ? settings.useSchemas : !!schemaConfig.enabled,
    schemasFolder: schemaConfig.folder || settings.schemasFolder,
  });
}

function configuredBaseDefinition(entityKey) {
  return WORKSPACE_CONFIG.bases?.[entityKey] || null;
}

function entityBasePath(settings = {}, entityKey) {
  const base = configuredBaseDefinition(entityKey);
  return base?.file || base?.base || (settings.baseFiles || {})[entityKey] || '';
}

function entityBaseViewName(settings = {}, entityKey) {
  const base = configuredBaseDefinition(entityKey);
  return base?.view || base?.baseView || (settings.baseViews || {})[entityKey] || '';
}

function resetEntityRegistry(settings = {}) {
  CONFIGURED_BASE_ENTITY_KEYS.clear();
  Object.keys(ENTITIES).forEach((key) => {
    if (!BUILTIN_ENTITY_DEFAULTS[key]) delete ENTITIES[key];
  });
  Object.entries(BUILTIN_ENTITY_DEFAULTS).forEach(([key, def]) => {
    ENTITIES[key] = JSON.parse(JSON.stringify(def));
  });
  syncEntityFolders(settings);
}

async function applyEntityDefinitions(app, settings = {}, config = {}, injectNavigation = true, configOwnsBase = false) {
  for (let [key, def] of Object.entries(config)) {
    if (!def || typeof def !== 'object') continue;

    // Compatibility layer for deprecated workspace.json entities block.
    // Canonical entity structure is derived from schema source YAML.
    const basePath = configOwnsBase
      ? (def.base || (settings.baseFiles || {})[key])
      : ((settings.baseFiles || {})[key] || def.base);
    const baseView = configOwnsBase
      ? (def.baseView || (settings.baseViews || {})[key])
      : ((settings.baseViews || {})[key] || def.baseView);
    if (configOwnsBase && def.base) CONFIGURED_BASE_ENTITY_KEYS.add(key);
    if (basePath) {
      const baseConfig = await parseBaseFile(app, basePath, baseView);
      if (baseConfig) {
        // Field-level merge: base provides structure, def augments with type/options/primary
        let mergedFields = baseConfig.fields;
        if (mergedFields && def.fields) {
          const overrides = new Map(def.fields.map(f => [f.key, f]));
          mergedFields = mergedFields.map(f => overrides.has(f.key) ? Object.assign({}, f, overrides.get(f.key)) : f);
          // Append any def.fields keys not in base (e.g. extra custom fields)
          def.fields.forEach(f => { if (!mergedFields.find(b => b.key === f.key)) mergedFields.push(f); });
        }
        def = Object.assign({}, baseConfig, def);
        if (mergedFields) def.fields = mergedFields;
      }
    }

    // New entities require label + fields; existing entities accept partial overrides
    if (!ENTITIES[key] && (!def.label || !Array.isArray(def.fields))) continue;

    const folder = (def.folder || `Cadence/${def.plural || pluralizeEntityLabel(def.label)}`).trim();
    const isNew = !ENTITIES[key];

    if (isNew) {
      ENTITIES[key] = {
        folder,
        label: def.label,
        plural: def.plural || pluralizeEntityLabel(def.label),
        fields: def.fields,
        columns: def.columns || def.fields.slice(0, 5).map((f) => f.key),
      };
      if (def.typeFilter) ENTITIES[key].typeFilter = def.typeFilter;
      if (def.typeFilters) ENTITIES[key].typeFilters = def.typeFilters;
      ['stageField','valueField','closeByField','wonStages','lostStages',
       'detailMetaFields','detailSections','terminalStatuses','stageConfidence',
       'template',
       'folders','dateField','titleField','fieldAliases','baseFilters','baseSort','baseGroupBy','baseView','externalBaseView','unsupportedBaseFilters'].forEach((k) => {
        if (def[k] != null) ENTITIES[key][k] = def[k];
      });
      ENTITY_FOLDERS[key] = folder;

      if (injectNavigation) {
        const surfaceId = `custom.${key}`;
        BUILT_SURFACES.add(surfaceId);

        // Inject nav item - into named module group if specified, else "Custom".
        let targetGroup = def.module ? NAV_GROUPS.find((g) => g.id === def.module) : null;
        if (!targetGroup) {
          targetGroup = NAV_GROUPS.find((g) => g.id === 'custom');
          if (!targetGroup) {
            targetGroup = { id: 'custom', label: 'Custom', items: [] };
            const miscIdx = NAV_GROUPS.findIndex((g) => g.id === 'misc');
            NAV_GROUPS.splice(miscIdx >= 0 ? miscIdx : NAV_GROUPS.length, 0, targetGroup);
          }
        }
        targetGroup.items.push({
          id: surfaceId,
          label: def.plural || pluralizeEntityLabel(def.label),
          icon: def.icon || 'file-text',
          module: def.module,
          entityKey: key,
          folderKey: def.folderKey,
          desc: def.desc || `${def.plural || pluralizeEntityLabel(def.label)} - custom entity`,
        });
        rebuildSurfaceLookups();
      }
    } else {
      // Merge fields by key (preserves schema-derived enum/options, adds entities.json type/primary)
      if (def.fields) {
        const existing = ENTITIES[key].fields || [];
        const overrides = new Map(def.fields.map(f => [f.key, f]));
        const merged = existing.map(f => overrides.has(f.key) ? Object.assign({}, f, overrides.get(f.key)) : f);
        // Append any def.fields keys not yet present
        def.fields.forEach(f => { if (!merged.find(b => b.key === f.key)) merged.push(f); });
        ENTITIES[key].fields = merged;
      }
      if (def.columns)      ENTITIES[key].columns      = def.columns;
      if (def.label)        ENTITIES[key].label        = def.label;
      if (def.plural)       ENTITIES[key].plural       = def.plural;
      if (def.folder)       ENTITY_FOLDERS[key]        = folder;
      if (Object.prototype.hasOwnProperty.call(def, 'typeFilter')) {
        if (def.typeFilter) ENTITIES[key].typeFilter = def.typeFilter;
        else delete ENTITIES[key].typeFilter;
      }
      if (Object.prototype.hasOwnProperty.call(def, 'typeFilters')) {
        if (def.typeFilters) ENTITIES[key].typeFilters = def.typeFilters;
        else delete ENTITIES[key].typeFilters;
      }
      // Per-entity config overrides
      ['stageField','valueField','closeByField','wonStages','lostStages',
       'detailMetaFields','detailSections','terminalStatuses','stageConfidence',
       'template',
       'folders','dateField','titleField','fieldAliases','baseFilters','baseSort','baseGroupBy','baseView','externalBaseView','unsupportedBaseFilters'].forEach((k) => {
        if (!Object.prototype.hasOwnProperty.call(def, k)) return;
        if (def[k] != null) ENTITIES[key][k] = def[k];
        else delete ENTITIES[key][k];
      });
    }
  }
}


/* ─── Schema YAML config loader ─────────────────────────────────────────────
   Reads 00-CORE/Schemas/source/*.yaml files (Metadata Menu schema source) and
   derives entity config from them. Each schema YAML has:
     entity, label, type_value, location_pattern, key_fields, fields,
     status_lifecycle (enum values for status/stage)

   Schema entity names don't always match plugin entity keys (person→contact,
   client→company). The mapping below handles the differences.
*/
const SCHEMA_FOLDER_DEFAULT = '00-CORE/Schemas/source';
const SCHEMA_TO_ENTITY_KEY = {
  person: 'contact',
};

function _schemaTypeToFieldType(schemaType, schemaField = {}) {
  if ((schemaField.format || '').toLowerCase() === 'date') return 'date';
  switch ((schemaType || '').toLowerCase()) {
    case 'number':  return 'number';
    case 'date':    return 'date';
    case 'boolean': return null;
    case 'array':   return 'tags';
    default:        return null;   // string → text (default)
  }
}

function schemaFieldLabel(name) {
  return String(name || '')
    .replace(/_/g, ' ')
    .replace(/-/g, ' ')
    .replace(/\b\w/g, (ch) => ch.toUpperCase());
}

function pluralizeEntityLabel(label) {
  const value = String(label || '').trim();
  if (!value) return '';
  const irregular = {
    analysis: 'Analyses',
    person: 'People',
  };
  const irregularPlural = irregular[value.toLowerCase()];
  if (irregularPlural) return irregularPlural;
  if (/analysis$/i.test(value)) return value.replace(/analysis$/i, 'Analyses');
  if (/[^aeiou]y$/i.test(value)) return `${value.slice(0, -1)}ies`;
  if (/(s|x|z|ch|sh)$/i.test(value)) return `${value}es`;
  return `${value}s`;
}

function fieldsFromSchema(schema, existingFields = []) {
  if (!Array.isArray(schema.fields)) return null;
  const existingByKey = new Map((existingFields || []).map((f) => [f.key, f]));
  const schemaFields = schema.fields.filter((sf) => sf && sf.name && sf.name !== 'type');
  if (!schemaFields.length) return null;
  const primaryKey = schemaFields.find((field) => field.primary)?.name ||
    (schema.key_fields || []).find((key) => key && key !== 'type') || schemaFields[0].name;
  const fields = schemaFields.map((sf) => {
    const existing = existingByKey.get(sf.name) || {};
    const field = Object.assign({}, existing, {
      key: sf.name,
      label: sf.label || existing.label || schemaFieldLabel(sf.name),
    });
    if (sf.required === true) field.required = true;
    if (sf.name === primaryKey) field.primary = true;
    else delete field.primary;
    if (Array.isArray(sf.enum) && sf.enum.length) {
      field.type = 'enum';
      field.options = sf.enum;
    } else {
      const fieldType = _schemaTypeToFieldType(sf.type, sf);
      if (fieldType) field.type = fieldType;
      else if (field.type && !existing.type) delete field.type;
    }
    if (sf.bob_type) field.type = sf.bob_type;
    if (Object.prototype.hasOwnProperty.call(sf, 'default')) field.defaultValue = cloneConfig(sf.default);
    else delete field.defaultValue;
    return field;
  });
  (existingFields || []).forEach((field) => {
    if (field?.key && field.key !== 'type' && !fields.some((f) => f.key === field.key)) {
      fields.push(Object.assign({}, field));
    }
  });
  fields.sort((a, b) => (a.primary ? -1 : 0) + (b.primary ? 1 : 0));
  return fields;
}

async function applySchemas(app, settings = {}) {
  const folder = (settings.schemasFolder || SCHEMA_FOLDER_DEFAULT).replace(/\/$/, '');
  if (!await app.vault.adapter.exists(folder)) return;

  const list = await app.vault.adapter.list(folder);
  const yamlFiles = (list.files || []).filter(f => f.endsWith('.yaml') || f.endsWith('.yml'));

  for (const filePath of yamlFiles) {
    let schema;
    try {
      const raw = await app.vault.adapter.read(filePath);
      schema = obsidian.parseYaml(raw);
    } catch (e) {
      continue;   // skip invalid schemas silently
    }
    if (!schema || typeof schema !== 'object' || !schema.entity) continue;

    const entityKey = SCHEMA_TO_ENTITY_KEY[schema.entity] || schema.entity;
    if (!ENTITIES[entityKey]) {
      const label = schema.label || schemaFieldLabel(entityKey);
      const schemaFields = fieldsFromSchema(schema, []) || [];
      ENTITIES[entityKey] = {
        folder: '',
        typeFilter: schema.type_value || entityKey,
        label,
        plural: schema.plural || pluralizeEntityLabel(label),
        icon: schema.icon || 'file-text',
        fields: schemaFields,
        columns: schemaFields.slice(0, 5).map((field) => field.key),
      };
    }
    if (schema.label) ENTITIES[entityKey].label = schema.label;
    if (schema.plural) ENTITIES[entityKey].plural = schema.plural;
    if (schema.icon) ENTITIES[entityKey].icon = schema.icon;
    if (schema.field_aliases) ENTITIES[entityKey].fieldAliases = JSON.parse(JSON.stringify(schema.field_aliases));
    if (schema.location_pattern) ENTITIES[entityKey].locationPattern = schema.location_pattern;

    // Derive folders from location_pattern. Handles single, ` or `-joined, and `{placeholder}` patterns.
    //   "30-CLIENTS/{client-id}/00-PROFILE/"          -> ["30-CLIENTS"]
    //   "10-ME/10-PEOPLE/ or 30-CLIENTS/{id}/10-PEOPLE/" -> ["10-ME/10-PEOPLE", "30-CLIENTS"]
    if (schema.location_pattern) {
      const folders = schema.location_pattern
        .split(/\s+or\s+/i)
        .map((p) => {
          const base = String(p || '')
            .trim()
            .replace(/^['"]|['"]$/g, '')
            .split('{')[0]
            .replace(/\/$/, '')
            .trim();
          // We can only express prefix folder matches; ignore wildcard/suffix patterns like "*/20-MEETINGS/".
          if (!base || base.includes('*')) return '';
          return base;
        })
        .filter((p) => p && p.includes('/') && !p.includes(','));
      if (entityKey === 'contact') {
        delete ENTITIES[entityKey].folders;
      } else if (folders.length) {
        ENTITIES[entityKey].folders = folders;
      }
    }

    // typeFilter from type_value — skip if entity uses filenameFilter (matched by filename, not type field)
    if (schema.type_value && !ENTITIES[entityKey].filenameFilter) ENTITIES[entityKey].typeFilter = schema.type_value;

    // Enrich fields from schema.fields (preserve existing labels where present)
    if (Array.isArray(schema.fields) && ENTITIES[entityKey].fields) {
      const schemaFields = fieldsFromSchema(schema, ENTITIES[entityKey].fields);
      if (schemaFields?.length) {
        ENTITIES[entityKey].fields = schemaFields;
        ENTITIES[entityKey].columns = schemaFields.slice(0, 5).map((f) => f.key);
      }
    }

    // status_lifecycle → enum options on status/stage field
    if (Array.isArray(schema.status_lifecycle) && schema.status_lifecycle.length) {
      const targetKey = ENTITIES[entityKey].fields?.find(f => f.key === 'status') ? 'status'
                      : ENTITIES[entityKey].fields?.find(f => f.key === 'stage') ? 'stage' : null;
      if (targetKey && ENTITIES[entityKey].fields) {
        ENTITIES[entityKey].fields = ENTITIES[entityKey].fields.map(f =>
          f.key === targetKey ? Object.assign({}, f, { type: 'enum', options: schema.status_lifecycle }) : f
        );
      }
    }
    if (schema.bob && typeof schema.bob === 'object' && !Array.isArray(schema.bob)) {
      await applyEntityDefinitions(app, settings, { [entityKey]: schema.bob }, false);
    }
  }
}

/* ─── Base file config parser ───────────────────────────────────────────────
   Reads a .base file and translates its filters/properties into an entity
   config fragment compatible with applyEntityDefinitions().

   Supported filter translations:
     note.type == "x"                → typeFilter: "x"
     file.path.startsWith("path/")   → folders: ["path"]
*/
async function parseBaseFile(app, basePath, viewName) {
  if (!await app.vault.adapter.exists(basePath)) return null;
  let yaml;
  try {
    const raw = await app.vault.adapter.read(basePath);
    yaml = obsidian.parseYaml(raw);
  } catch (e) {
    new obsidian.Notice(`BOB Workspace: failed to parse ${basePath} — ${e.message}`);
    return null;
  }
  if (!yaml || typeof yaml !== 'object') return null;

  const result = {};
  const views = Array.isArray(yaml.views) ? yaml.views : [];
  const targetView = viewName
    ? views.find(v => v.name === viewName)
    : null;
  const targetViewType = targetView?.type || '';
  const externalBaseView = !!targetViewType && targetViewType !== 'table';
  if (targetView) {
    result.baseView = {
      type: targetViewType || 'table',
      name: targetView.name || viewName || '',
      basePath,
    };
  }
  if (externalBaseView) {
    result.externalBaseView = {
      type: targetViewType,
      name: targetView?.name || viewName || targetViewType,
      basePath,
    };
  }

  // ── Translate filters ──────────────────────────────────────────────────
  const conditions = [
    ...collectBaseFilterConditions(yaml.filters),
    ...collectBaseFilterConditions(externalBaseView ? null : targetView?.filters),
  ];
  const noteFilters = {};   // key → value for note.* == "..." conditions
  const folders = [];

  for (const cond of conditions) {
    if (typeof cond !== 'string') continue;

    // file.path.startsWith("some/path/")
    const pathMatch = cond.match(/^file\.path\.startsWith\(["'](.+?)["']\)/);
    if (pathMatch) {
      folders.push(pathMatch[1].replace(/\/$/, ''));
      continue;
    }

    // note.<key> == "value"
    const noteEq = cond.match(/^note(?:\.(\w+)|\[['"](.+?)['"]\])\s*==\s*["'](.+?)["']/);
    if (noteEq) {
      noteFilters[noteEq[1] || noteEq[2]] = noteEq[3];
      continue;
    }

    // Bare property equality, common in newer Base files: type == "task"
    const bareEq = cond.match(/^(\w+)\s*==\s*["'](.+?)["']/);
    if (bareEq) {
      noteFilters[bareEq[1]] = bareEq[2];
      continue;
    }
  }

  if (folders.length)             result.folders = folders;
  if (Object.keys(noteFilters).length) result.typeFilters = Object.assign({}, noteFilters);
  if (noteFilters.type)           result.typeFilter = noteFilters.type;
  result.baseFilters = { global: yaml.filters || null, view: externalBaseView ? null : targetView?.filters || null };
  if (!externalBaseView && Array.isArray(targetView?.sort)) {
    const sort = targetView.sort
      .map((item) => ({
        property: basePropKey(item?.property || item),
        direction: String(item?.direction || 'ASC').toUpperCase(),
      }))
      .filter((item) => item.property && !String(item.property).startsWith('formula.'));
    if (sort.length) result.baseSort = sort;
  }
  if (!externalBaseView && targetView?.groupBy?.property) {
    const property = basePropKey(targetView.groupBy.property);
    if (property && !String(property).startsWith('formula.')) {
      result.baseGroupBy = {
        property,
        direction: String(targetView.groupBy.direction || 'ASC').toUpperCase(),
      };
    }
  }
  const unsupportedFilters = [
    ...collectUnsupportedBaseFilterConditions(yaml.filters),
    ...collectUnsupportedBaseFilterConditions(externalBaseView ? null : targetView?.filters),
  ];
  if (unsupportedFilters.length) result.unsupportedBaseFilters = [...new Set(unsupportedFilters)];

  // ── Translate properties + view order → fields + columns ──────────────
  const props = yaml.properties || {};
  // Default: use properties order (all fields), not first view (which may be filtered)
  const orderKeys = externalBaseView ? Object.keys(props) : (targetView?.order || Object.keys(props));

  const fields = orderKeys
    .filter(k => k !== 'formula.open')   // skip formula columns
    .map(k => {
      const propKey = k.startsWith('note.') ? k.slice(5) : k === 'file.name' ? 'name' : k;
      const label = props[k]?.displayName || propKey;
      return { key: propKey, label };
    });

  if (fields.length) result.fields = fields;
  result.columns = fields.slice(0, 5).map(f => f.key);

  // ── Named views → pass through for future use ──────────────────────────
  if (yaml.views?.length > 1) result._baseViews = yaml.views.map(v => v.name);

  return result;
}

function collectBaseFilterConditions(node) {
  if (!node) return [];
  if (typeof node === 'string') return [node];
  if (Array.isArray(node)) return node.flatMap(collectBaseFilterConditions);
  if (typeof node === 'object') {
    return Object.values(node).flatMap(collectBaseFilterConditions);
  }
  return [];
}

function stripOuterParens(value) {
  let s = String(value || '').trim();
  while (s.startsWith('(') && s.endsWith(')')) {
    let depth = 0;
    let quote = null;
    let encloses = true;
    for (let i = 0; i < s.length; i++) {
      const ch = s[i];
      if (quote) {
        if (ch === quote && s[i - 1] !== '\\') quote = null;
        continue;
      }
      if (ch === '"' || ch === "'") { quote = ch; continue; }
      if (ch === '(') depth++;
      if (ch === ')') depth--;
      if (depth === 0 && i < s.length - 1) { encloses = false; break; }
    }
    if (!encloses) break;
    s = s.slice(1, -1).trim();
  }
  return s;
}

function splitBaseExpression(expr, operator) {
  const parts = [];
  const op = ` ${operator} `;
  let quote = null;
  let depth = 0;
  let start = 0;
  for (let i = 0; i <= expr.length - op.length; i++) {
    const ch = expr[i];
    if (quote) {
      if (ch === quote && expr[i - 1] !== '\\') quote = null;
      continue;
    }
    if (ch === '"' || ch === "'") { quote = ch; continue; }
    if (ch === '(') { depth++; continue; }
    if (ch === ')') { depth = Math.max(0, depth - 1); continue; }
    if (depth === 0 && expr.slice(i, i + op.length) === op) {
      parts.push(expr.slice(start, i).trim());
      start = i + op.length;
      i = start - 1;
    }
  }
  if (parts.length) parts.push(expr.slice(start).trim());
  return parts.length ? parts : null;
}

function basePropKey(raw) {
  const s = String(raw || '').trim();
  if (s === 'file.path' || s === 'file.folder' || s === 'file.name' || s === 'file.basename' || s === 'file.ctime' || s === 'file.mtime' || s === 'file.tags') return s;
  const bracket = s.match(/^note\[['"](.+?)['"]\]$/);
  if (bracket) return bracket[1];
  return s.replace(/^note\./, '');
}

function basePropValue(app, file, fm, rawKey) {
  const key = basePropKey(rawKey);
  if (key === 'file.path') return file.path;
  if (key === 'file.folder') return file.parent?.path || file.path.split('/').slice(0, -1).join('/');
  if (key === 'file.name' || key === 'file.basename') return file.basename;
  if (key === 'file.ctime') return file.stat?.ctime ? new Date(file.stat.ctime) : null;
  if (key === 'file.mtime') return file.stat?.mtime ? new Date(file.stat.mtime) : null;
  if (key === 'file.tags') return fm.tags || [];
  return fm[key];
}

function hasBaseValue(value) {
  if (value == null) return false;
  if (Array.isArray(value)) return value.length > 0;
  if (typeof value === 'string') return value.trim() !== '';
  return null;
}

function parseTodayExpression(raw) {
  const expr = String(raw || '').trim();
  const match = expr.match(/^(?:today\(\)|now\(\))(?:\s*([+-])\s*["']?(\d+)\s*(?:d|day|days)["']?)?$/);
  if (!match) return null;
  const base = expr.startsWith('now()') ? new Date() : startOfDay(new Date());
  const sign = match[1] === '-' ? -1 : 1;
  const offset = match[2] ? Number(match[2]) * sign : 0;
  return startOfDay(addDays(base, offset));
}

function isSupportedBaseFilterCondition(raw) {
  const cond = stripOuterParens(String(raw || '').trim().replace(/^!/, ''));
  if (!cond) return true;
  const orParts = splitBaseExpression(cond, '||');
  if (orParts) return orParts.every(isSupportedBaseFilterCondition);
  const andParts = splitBaseExpression(cond, '&&');
  if (andParts) return andParts.every(isSupportedBaseFilterCondition);
  return /^file\.hasTag\(["']#?.+?["']\)$/.test(cond)
    || /^file\.folder\s*!=\s*["'].+?["']$/.test(cond)
    || /^file\.path\.startsWith\(["'].+?["']\)$/.test(cond)
    || /^file\.path\.contains\(["'].+?["']\)$/.test(cond)
    || /^.+?\.contains\(["'].+?["']\)$/.test(cond)
    || /^(?:date\()?[\w-]+\)?\.isEmpty\(\)$/.test(cond)
    || /^(?:note\.|note\[['"].+?['"]\])?[\w-]*\s*(==|!=)\s*(?:["'].*?["']|null)$/.test(cond)
    || /^(?:date\()?[\w.-]+(?:\[['"].+?['"]\])?\)?\s*(==|<|<=|>|>=)\s*(?:today\(\)|now\(\))(?:\s*[+-]\s*["']?\d+\s*(?:d|day|days)["']?)?$/.test(cond);
}

function collectUnsupportedBaseFilterConditions(node) {
  return collectBaseFilterConditions(node).filter((cond) => !isSupportedBaseFilterCondition(cond));
}

function normBaseName(value) {
  return String(value || '').toLowerCase().replace(/[^a-z0-9]/g, '');
}

async function readBaseSummary(app, file) {
  try {
    const raw = await app.vault.read(file);
    const yaml = obsidian.parseYaml(raw);
    if (!yaml || typeof yaml !== 'object') return null;
    const conditions = collectBaseFilterConditions(yaml.filters);
    const typeFilters = [];
    const folders = [];
    conditions.forEach((cond) => {
      if (typeof cond !== 'string') return;
      const noteEq = cond.match(/^note(?:\.(\w+)|\[['"](.+?)['"]\])\s*==\s*["'](.+?)["']/);
      const bareEq = cond.match(/^(\w+)\s*==\s*["'](.+?)["']/);
      const match = noteEq || bareEq;
      const key = noteEq ? (match[1] || match[2]) : match?.[1];
      const value = noteEq ? match[3] : match?.[2];
      if (match && key === 'type') typeFilters.push(value);
      const pathMatch = cond.match(/^file\.path\.startsWith\(["'](.+?)["']\)/);
      if (pathMatch) folders.push(pathMatch[1].replace(/\/$/, ''));
    });
    return {
      path: file.path,
      label: file.path.split('/').pop().replace(/\.base$/i, ''),
      views: Array.isArray(yaml.views) ? yaml.views.map((v) => v.name).filter(Boolean) : [],
      typeFilters: [...new Set(typeFilters)],
      folders: [...new Set(folders)],
    };
  } catch (_) {
    return null;
  }
}

function baseSummaryCompatibleWithEntity(summary, entityKey) {
  const def = ENTITIES[entityKey];
  if (!summary || !def) return false;
  const expectedTypes = new Set([entityKey, def.typeFilter].filter(Boolean).map(normBaseName));
  if (summary.typeFilters.length) {
    return summary.typeFilters.some((type) => expectedTypes.has(normBaseName(type)));
  }
  const entityNames = [
    entityKey,
    def.label,
    def.plural,
    ...(entityKey === 'task' ? ['tasks', 'tasknotes'] : []),
  ].map(normBaseName).filter(Boolean);
  const baseName = normBaseName(summary.label);
  return entityNames.some((name) => baseName.includes(name) || name.includes(baseName));
}

function mergeBaseConfigIntoEntity(entityKey, baseConfig) {
  const entity = ENTITIES[entityKey];
  if (!entity || !baseConfig) return;
  if (baseConfig.fields?.length) {
    const existingByKey = new Map((entity.fields || []).map((f) => [f.key, f]));
    const visibleFields = baseConfig.fields.map((field) => (
      existingByKey.has(field.key)
        ? Object.assign({}, existingByKey.get(field.key), field)
        : field
    ));
    visibleFields.forEach((field) => existingByKey.delete(field.key));
    entity.fields = visibleFields;
    for (const field of existingByKey.values()) {
      entity.fields.push(field);
    }
    entity.columns = baseConfig.columns || entity.fields.slice(0, 5).map((f) => f.key);
    const primary = entity.fields.find((field) => field.primary);
    if (primary && !entity.columns.includes(primary.key)) {
      entity.columns = [primary.key, ...entity.columns].slice(0, 5);
    }
  }
  if (baseConfig.folders) entity.folders = baseConfig.folders;
  if (baseConfig.typeFilters) entity.typeFilters = baseConfig.typeFilters;
  if (baseConfig.typeFilter) entity.typeFilter = baseConfig.typeFilter;
  if (baseConfig.baseFilters) entity.baseFilters = baseConfig.baseFilters;
  if (baseConfig.baseSort) entity.baseSort = baseConfig.baseSort;
  if (baseConfig.baseGroupBy) entity.baseGroupBy = baseConfig.baseGroupBy;
  if (baseConfig.baseView) entity.baseView = baseConfig.baseView;
  if (baseConfig.externalBaseView) entity.externalBaseView = baseConfig.externalBaseView;
  if (baseConfig.unsupportedBaseFilters) entity.unsupportedBaseFilters = baseConfig.unsupportedBaseFilters;
}

async function applyBaseOverrides(app, settings = {}) {
  const baseFiles = settings.baseFiles || {};
  const baseViews = settings.baseViews || {};
  for (const [entityKey, basePath] of Object.entries(baseFiles)) {
    if (!basePath || !ENTITIES[entityKey] || CONFIGURED_BASE_ENTITY_KEYS.has(entityKey)) continue;
    const baseConfig = await parseBaseFile(app, basePath, baseViews[entityKey]);
    mergeBaseConfigIntoEntity(entityKey, baseConfig);
  }
}

async function applyConfiguredBaseOverrides(app) {
  for (const [entityKey, def] of Object.entries(WORKSPACE_CONFIG.bases || {})) {
    const basePath = def?.file || def?.base;
    if (!basePath || !ENTITIES[entityKey]) continue;
    CONFIGURED_BASE_ENTITY_KEYS.add(entityKey);
    const baseConfig = await parseBaseFile(app, basePath, def.view || def.baseView);
    mergeBaseConfigIntoEntity(entityKey, baseConfig);
  }
}

async function reloadEntityConfiguration(app, settings = {}) {
  resetWorkspaceRegistries();
  await loadWorkspaceConfig(app);
  resetEntityRegistry(settings);
  applyWorkspaceRegistries(WORKSPACE_CONFIG);
  const effectiveSettings = effectiveSchemaSettings(settings);
  // Deprecated compatibility input: new record definitions belong in schemas.
  if (WORKSPACE_CONFIG.entities) {
    await applyEntityDefinitions(app, settings, WORKSPACE_CONFIG.entities, !WORKSPACE_HAS_NAVIGATION);
  }
  if (effectiveSettings.useSchemas) await applySchemas(app, effectiveSettings);
  if (WORKSPACE_CONFIG.entities) {
    await applyEntityDefinitions(app, settings, WORKSPACE_CONFIG.entities, false);
  }
  await applyConfiguredBaseOverrides(app);
  await applyBaseOverrides(app, settings);
  rebuildSurfaceLookups();
}


function workspaceConfigTemplate(settings = {}) {
  const bases = {};
  Object.entries(settings.baseFiles || {}).forEach(([entityKey, file]) => {
    if (!file) return;
    bases[entityKey] = { file };
    if ((settings.baseViews || {})[entityKey]) bases[entityKey].view = settings.baseViews[entityKey];
  });
  return JSON.stringify({
    _comment: 'This file controls no-code workspace composition. Canonical entity definitions are in schema YAML; existing built-in surface IDs keep their specialized renderers.',
    settings: workspaceOwnedSettings(settings),
    schemas: {
      enabled: !!settings.useSchemas,
      folder: settings.schemasFolder || SCHEMA_FOLDER_DEFAULT,
    },
    bases,
    templates: {},
    navigation: {
      groups: NAV_GROUPS,
      secondaryTabs: SECONDARY_TABS,
    },
    workbookGroups: WORKBOOK_EXPORT_GROUPS,
  }, null, 2);
}

function surfaceMatchesTab(surface, tab) {
  return !!surface && !!tab && (
    (tab.entityKey && surface.entityKey === tab.entityKey) ||
    (tab.route && surface.id === tab.route)
  );
}

function isTabBackedSurface(surface, tabsByParent = SECONDARY_TABS) {
  if (!surface?.parent) return false;
  return (tabsByParent[surface.parent] || []).some((tab) =>
    surfaceMatchesTab(surface, tab) ||
    (tab.children || []).some((child) => surfaceMatchesTab(surface, child))
  );
}

function makeNavigationSurfacePrimary(surface) {
  if (!surface) return;
  delete surface.navLevel;
  delete surface.parent;
  delete surface.placement;
}

function normalizeStandaloneNavigationSurfaces(groups, tabsByParent = SECONDARY_TABS, normalizeSetup = false) {
  let changed = false;
  (groups || []).forEach((group) => {
    (group.items || []).forEach((surface) => {
      const canNormalizeLevel = surface.navLevel === 'secondary' ||
        (normalizeSetup && surface.navLevel === 'setup');
      if (canNormalizeLevel && surface.parent &&
          !isTabBackedSurface(surface, tabsByParent)) {
        makeNavigationSurfacePrimary(surface);
        changed = true;
      }
    });
  });
  return changed;
}

function navigationSurfaceFromTab(parentId, tab, existingSurfaces = []) {
  const match = existingSurfaces.find((surface) =>
    surfaceMatchesTab(surface, tab)
  );
  if (match) {
    return Object.assign({}, match, {
      navLevel: 'secondary',
      parent: parentId,
      placement: 'navigation',
    });
  }
  const seed = tab.entityKey || tab.route || tab.label || 'tab';
  const slug = String(seed).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'tab';
  return {
    id: tab.route || `${parentId}.${slug}`,
    label: tab.label,
    icon: tab.icon || 'file-text',
    entityKey: tab.entityKey,
    navLevel: 'secondary',
    parent: parentId,
    placement: 'navigation',
    desc: tab.desc || `${tab.label} records`,
  };
}

function removeSurfaceFromGroups(groups, surfaceId) {
  for (const group of groups) {
    const index = (group.items || []).findIndex((surface) => surface.id === surfaceId);
    if (index >= 0) return group.items.splice(index, 1)[0];
  }
  return null;
}

function schemaFieldFromEntityField(field) {
  const result = {
    name: field.key,
    type: field.type === 'number' || field.type === 'currency' ? 'number'
      : field.type === 'tags' ? 'array'
      : 'string',
    required: !!field.primary,
  };
  if (field.type === 'date') result.format = 'date';
  if (field.type === 'enum' && Array.isArray(field.options)) result.enum = field.options;
  return result;
}

function validateSourceSchemaDefinition(schema) {
  if (!schema || typeof schema !== 'object' || Array.isArray(schema)) {
    throw new Error('Schema must be an object');
  }
  ['entity', 'label', 'location_pattern'].forEach((key) => {
    if (!String(schema[key] || '').trim()) throw new Error(`Schema needs ${key}`);
  });
  const entityKey = SCHEMA_TO_ENTITY_KEY[schema.entity] || schema.entity;
  if (!String(schema.type_value || '').trim() && !ENTITIES[entityKey]?.filenameFilter) {
    throw new Error('Schema needs type_value unless the record type is filename-backed');
  }
  if (!Array.isArray(schema.fields) || !schema.fields.length) {
    throw new Error('Schema needs at least one field');
  }
  const fieldNames = new Set();
  schema.fields.forEach((field, index) => {
    const name = String(field?.name || '').trim();
    if (!name) throw new Error(`Field ${index + 1} needs a name`);
    if (fieldNames.has(name)) throw new Error(`Duplicate field "${name}"`);
    fieldNames.add(name);
    if (!['string', 'number', 'integer', 'boolean', 'array'].includes(field.type)) {
      throw new Error(`Field "${name}" has unsupported type "${field.type}"`);
    }
    if (field.enum != null && !Array.isArray(field.enum)) {
      throw new Error(`Field "${name}" enum must be a list`);
    }
    if (field.default != null && Array.isArray(field.enum) && !field.enum.includes(field.default)) {
      throw new Error(`Field "${name}" default must be one of its enum values`);
    }
    if (field.default != null && field.type === 'array' && !Array.isArray(field.default)) {
      throw new Error(`Field "${name}" default must be a list`);
    }
    if (field.default != null && (field.type === 'number' || field.type === 'integer') &&
        typeof field.default !== 'number') {
      throw new Error(`Field "${name}" default must be a number`);
    }
    if (field.default != null && field.type === 'boolean' && typeof field.default !== 'boolean') {
      throw new Error(`Field "${name}" default must be true or false`);
    }
  });
  (schema.key_fields || []).forEach((name) => {
    if (!fieldNames.has(name)) throw new Error(`Key field "${name}" is not defined in fields`);
  });
  (schema.co_required || []).forEach((pair) => {
    if (!Array.isArray(pair) || pair.length < 2 || pair.some((name) => !fieldNames.has(name))) {
      throw new Error('Every co-required relationship must name two or more defined fields');
    }
  });
  if (schema.discriminator != null &&
      (!schema.discriminator || typeof schema.discriminator !== 'object' || Array.isArray(schema.discriminator))) {
    throw new Error('discriminator must be an object');
  }
  if (schema.field_aliases != null) {
    if (!schema.field_aliases || typeof schema.field_aliases !== 'object' || Array.isArray(schema.field_aliases)) {
      throw new Error('field_aliases must be an object keyed by field name');
    }
    const normalizedAliases = new Map();
    schema.fields.forEach((field) => {
      [field.name, field.label].filter(Boolean).forEach((name) => {
        const normalized = String(name).toLowerCase().replace(/[^a-z0-9]/g, '');
        if (normalized && !normalizedAliases.has(normalized)) normalizedAliases.set(normalized, field.name);
      });
    });
    Object.entries(schema.field_aliases).forEach(([name, aliases]) => {
      if (!fieldNames.has(name)) throw new Error(`Field aliases reference undefined field "${name}"`);
      if (!Array.isArray(aliases) || aliases.some((alias) => !String(alias || '').trim())) {
        throw new Error(`Field aliases for "${name}" must be a list of non-empty names`);
      }
      aliases.forEach((alias) => {
        const normalized = String(alias).toLowerCase().replace(/[^a-z0-9]/g, '');
        const existing = normalizedAliases.get(normalized);
        if (existing && existing !== name) {
          throw new Error(`Field alias "${alias}" conflicts with field "${existing}"`);
        }
        normalizedAliases.set(normalized, name);
      });
    });
  }
  if (schema.bob != null && (!schema.bob || typeof schema.bob !== 'object' || Array.isArray(schema.bob))) {
    throw new Error('BOB behavior JSON must be a JSON object');
  }
  return schema;
}

function editableSchemaFieldType(field) {
  if (Array.isArray(field.enum)) return 'enum';
  if (field.type === 'string' && field.format === 'date') return 'date';
  if (field.type === 'string' && field.format === 'date-time') return 'datetime';
  return field.type || 'string';
}

function applyEditableSchemaFieldType(field, value) {
  delete field.format;
  if (value !== 'enum') delete field.enum;
  if (value === 'enum') {
    field.type = 'string';
    if (!Array.isArray(field.enum)) field.enum = [];
  } else if (value === 'date' || value === 'datetime') {
    field.type = 'string';
    field.format = value === 'date' ? 'date' : 'date-time';
  } else {
    field.type = value;
  }
}

function editableSchemaFieldDefault(field) {
  if (!Object.prototype.hasOwnProperty.call(field || {}, 'default')) return '';
  return Array.isArray(field.default) ? field.default.join(', ') : String(field.default);
}

function applyEditableSchemaFieldDefault(field, value) {
  const trimmed = String(value || '').trim();
  if (!trimmed) {
    delete field.default;
    return;
  }
  if (field.type === 'array') {
    field.default = trimmed.split(',').map((item) => item.trim()).filter(Boolean);
    return;
  }
  if (field.type === 'number' || field.type === 'integer') {
    const number = Number(trimmed);
    field.default = Number.isFinite(number) ? number : trimmed;
    return;
  }
  if (field.type === 'boolean') {
    field.default = trimmed.toLowerCase() === 'true' ? true
      : trimmed.toLowerCase() === 'false' ? false
      : trimmed;
    return;
  }
  field.default = trimmed;
}

async function loadCanonicalSchemaSources(app, settings = {}) {
  const folder = (WORKSPACE_CONFIG.schemas?.folder || settings.schemasFolder || SCHEMA_FOLDER_DEFAULT).replace(/\/$/, '');
  if (!await app.vault.adapter.exists(folder)) return { folder, schemas: [], errors: [] };
  const listed = await app.vault.adapter.list(folder);
  const schemas = [];
  const errors = [];
  for (const path of (listed.files || []).filter((file) => /\.ya?ml$/i.test(file))) {
    try {
      const schema = validateSourceSchemaDefinition(obsidian.parseYaml(await app.vault.adapter.read(path)));
      schemas.push({ path, schema });
    } catch (e) {
      errors.push(`${path}: ${e.message}`);
    }
  }
  return { folder, schemas, errors };
}

function stableSchemaId(value) {
  let hash = 5381;
  for (const character of String(value || '')) hash = ((hash << 5) + hash) ^ character.charCodeAt(0);
  return (hash >>> 0).toString(16).padStart(8, '0');
}

function metadataMenuFieldType(field) {
  if (Array.isArray(field.enum)) return 'Select';
  if (field.type === 'array') return 'Multi';
  if (field.type === 'boolean') return 'Boolean';
  if (field.type === 'number' || field.type === 'integer') return 'Number';
  if (field.format === 'date') return 'Date';
  return 'Input';
}

function sourceSchemaToJsonSchema(schema) {
  const schemaId = schema.type_value || schema.entity;
  const properties = {};
  const required = [];
  (schema.fields || []).forEach((field) => {
    const property = { type: field.type || 'string' };
    if (field.format) property.format = field.format;
    if (Array.isArray(field.enum) && field.enum.length) property.enum = field.enum;
    if (field.description) property.description = field.description;
    if (Object.prototype.hasOwnProperty.call(field, 'default')) property.default = field.default;
    if (field.type === 'array') property.items = { type: 'string' };
    properties[field.name] = property;
    if (field.required) required.push(field.name);
  });
  if (schema.type_value && properties.type) properties.type = { const: schema.type_value };
  if (schema.discriminator) Object.entries(schema.discriminator).forEach(([key, value]) => {
    properties[key] = Object.assign({}, properties[key] || { type: 'string' }, { const: value });
    if (!required.includes(key)) required.push(key);
  });
  return {
    $schema: 'https://json-schema.org/draft/2020-12/schema',
    $id: `https://brn.cx/schemas/${schemaId}.schema.json`,
    title: `${schemaId} frontmatter schema`,
    type: 'object',
    properties,
    required,
    additionalProperties: true,
    ...(Array.isArray(schema.co_required) && schema.co_required.length
      ? {
          dependentRequired: Object.assign({}, ...schema.co_required.flatMap((pair) =>
            pair.map((field) => ({ [field]: pair.filter((other) => other !== field) }))
          )),
        }
      : {}),
  };
}

function sourceSchemaToFileClass(schema) {
  const fields = (schema.fields || []).map((field) => {
    const config = {
      name: field.name,
      type: metadataMenuFieldType(field),
      id: stableSchemaId(`${schema.entity}:${field.name}`),
      path: '',
    };
    if (Array.isArray(field.enum) && field.enum.length) {
      config.options = field.enum.map((value, index) => ({ [index]: value }));
    }
    if (field.required) config.required = true;
    return config;
  });
  const yaml = {
    fileClass: schema.entity,
    version: '1.0',
    mapWithTag: false,
    filesPaths: [schema.location_pattern],
    fields,
    ...(schema.description ? { description: schema.description } : {}),
  };
  return `---\n${obsidian.stringifyYaml(yaml)}---\n\n# ${schema.label}\n\nGenerated from canonical schema source. Edit the source YAML in BOB Workspace settings.\n`;
}

async function regenerateSchemaOutputs(app, settings = {}) {
  const loaded = await loadCanonicalSchemaSources(app, settings);
  if (loaded.errors.length) throw new Error(`Schema validation failed: ${loaded.errors.join('; ')}`);
  const root = loaded.folder.replace(/\/source$/, '');
  const fileClassFolder = `${root}/fileClasses`;
  const jsonFolder = `${root}/json-schema`;
  await ensureFolderSync(app, fileClassFolder);
  await ensureFolderSync(app, jsonFolder);
  const expectedFileClasses = new Set();
  const expectedJsonSchemas = new Set();
  for (const { schema } of loaded.schemas) {
    const fileClassPath = `${fileClassFolder}/${schema.entity}.md`;
    const jsonSchemaPath = `${jsonFolder}/${schema.type_value || schema.entity}.schema.json`;
    expectedFileClasses.add(fileClassPath);
    expectedJsonSchemas.add(jsonSchemaPath);
    await app.vault.adapter.write(fileClassPath, sourceSchemaToFileClass(schema));
    await app.vault.adapter.write(
      jsonSchemaPath,
      `${JSON.stringify(sourceSchemaToJsonSchema(schema), null, 2)}\n`
    );
  }
  let removed = 0;
  for (const folder of [
    { path: fileClassFolder, expected: expectedFileClasses, suffix: '.md' },
    { path: jsonFolder, expected: expectedJsonSchemas, suffix: '.schema.json' },
  ]) {
    const listed = await app.vault.adapter.list(folder.path);
    for (const path of listed.files || []) {
      if (!path.endsWith(folder.suffix) || folder.expected.has(path)) continue;
      await app.vault.adapter.remove(path);
      removed++;
    }
  }
  return {
    count: loaded.schemas.length,
    removed,
    fileClassFolder,
    jsonFolder,
  };
}


const CURRENCY_OPTIONS = [
  { code: 'USD', label: 'USD — US Dollar' },
  { code: 'EUR', label: 'EUR — Euro' },
  { code: 'GBP', label: 'GBP — British Pound' },
  { code: 'ZAR', label: 'ZAR — South African Rand' },
  { code: 'AUD', label: 'AUD — Australian Dollar' },
  { code: 'CAD', label: 'CAD — Canadian Dollar' },
  { code: 'CHF', label: 'CHF — Swiss Franc' },
  { code: 'JPY', label: 'JPY — Japanese Yen' },
  { code: 'INR', label: 'INR — Indian Rupee' },
  { code: 'BRL', label: 'BRL — Brazilian Real' },
  { code: 'AED', label: 'AED — UAE Dirham' },
];

/* ─────────── Helpers ─────────── */
function pad(n) { return String(n).padStart(2, '0'); }
function ymd(d = new Date()) {
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}
function dailyNotePath(settings, date = new Date()) {
  const folder = (settings.dailyNoteFolder || '').replace(/\/$/, '');
  const name = ymd(date);
  return folder ? `${folder}/${name}.md` : `${name}.md`;
}
function greeting() {
  const h = new Date().getHours();
  if (h < 12) return 'Good morning';
  if (h < 18) return 'Good afternoon';
  return 'Good evening';
}
function dateInfo(d = new Date()) {
  return {
    weekday: d.toLocaleDateString(undefined, { weekday: 'long' }),
    day: d.getDate(),
    month: d.toLocaleDateString(undefined, { month: 'long' }),
    year: d.getFullYear(),
  };
}
function startOfDay(d) { const x = new Date(d); x.setHours(0,0,0,0); return x; }
function addDays(d, n) { const x = new Date(d); x.setDate(x.getDate() + n); return x; }
function startOfWeek(d, weekStartsOn = 1) {
  const x = startOfDay(d);
  const diff = (x.getDay() - weekStartsOn + 7) % 7;
  return addDays(x, -diff);
}
function weekDates(anchor, weekStartsOn = 1) {
  const start = startOfWeek(anchor, weekStartsOn);
  return Array.from({ length: 7 }, (_, i) => addDays(start, i));
}
function sameDay(a, b) {
  return a.getFullYear() === b.getFullYear()
      && a.getMonth() === b.getMonth()
      && a.getDate() === b.getDate();
}

/* Map a 0-100 % to a colour band — drives progress bar tint. */
function pctBand(pct) {
  if (pct < 25) return 'rose';
  if (pct < 50) return 'warn';
  if (pct < 75) return 'mint';
  return 'emerald';
}

/* ─────────── Entity helpers ─────────── */
function ensureFolderSync(app, path) {
  const parts = path.split('/').filter(Boolean);
  let cur = '';
  const promises = [];
  for (const p of parts) {
    cur = cur ? `${cur}/${p}` : p;
    if (!app.vault.getAbstractFileByPath(cur)) {
      promises.push(app.vault.createFolder(cur).catch(() => {}));
    }
  }
  return Promise.all(promises);
}

function isTemplatePath(path) {
  return String(path || '')
    .split('/')
    .slice(0, -1)
    .some((segment) => ['template', 'templates'].includes(segment.toLowerCase()));
}

function listEntityFiles(app, entityKey) {
  const def = ENTITIES[entityKey];
  if (!def) return [];

  const hasPathFilter = Array.isArray(def.folders);
  const useDefaultPath = !def.typeFilter && !hasPathFilter;

  return app.vault.getMarkdownFiles().filter((f) => {
    if (isTemplatePath(f.path)) return false;

    // Path filter (OR within folders array; AND with type)
    if (hasPathFilter) {
      if (!def.folders.some((d) => f.path.startsWith(d.replace(/\/$/, '') + '/'))) return false;
    } else if (useDefaultPath) {
      if (!f.path.startsWith(entityFolder(entityKey) + '/')) return false;
    }
    // Filename filter (e.g. SKILL.md — one canonical file per subfolder)
    if (def.filenameFilter && f.name !== def.filenameFilter) return false;
    // Single type filter
    if (def.typeFilter) {
      const fm = (app.metadataCache.getFileCache(f) || {}).frontmatter || {};
      if (fm.type !== def.typeFilter) return false;
    }
    // Multi-frontmatter filter, used by selected Base views.
    if (def.typeFilters && typeof def.typeFilters === 'object') {
      const fm = (app.metadataCache.getFileCache(f) || {}).frontmatter || {};
      for (const [key, value] of Object.entries(def.typeFilters)) {
        if (String(fm[key] ?? '') !== String(value)) return false;
      }
    }
    if (def.baseFilters) {
      const globalMatch = evaluateBaseFilterNode(app, f, def.baseFilters.global);
      if (globalMatch === false) return false;
      const viewMatch = evaluateBaseFilterNode(app, f, def.baseFilters.view);
      if (viewMatch === false) return false;
    }
    return true;
  });
}

function readEntity(app, file) {
  const cache = app.metadataCache.getFileCache(file) || {};
  const fm = cache.frontmatter || {};
  return { file, frontmatter: fm, basename: file.basename };
}

function evaluateBaseFilterNode(app, file, node) {
  if (!node) return true;
  if (typeof node === 'string') return evaluateBaseFilterCondition(app, file, node);
  if (Array.isArray(node)) return evaluateBaseFilterGroup(app, file, 'and', node);
  if (typeof node !== 'object') return true;
  if (Array.isArray(node.and)) return evaluateBaseFilterGroup(app, file, 'and', node.and);
  if (Array.isArray(node.or)) return evaluateBaseFilterGroup(app, file, 'or', node.or);
  const results = Object.values(node).map((child) => evaluateBaseFilterNode(app, file, child));
  return results.includes(false) ? false : true;
}

function evaluateBaseFilterGroup(app, file, op, children) {
  const results = children.map((child) => evaluateBaseFilterNode(app, file, child));
  if (op === 'or') {
    if (results.includes(true)) return true;
    if (results.every((result) => result === false)) return false;
    return true;
  }
  return results.includes(false) ? false : true;
}

function evaluateBaseFilterCondition(app, file, raw) {
  let cond = stripOuterParens(String(raw || '').trim());
  if (!cond) return true;
  if (cond.startsWith('!')) {
    const inner = evaluateBaseFilterCondition(app, file, cond.slice(1));
    return inner == null ? true : !inner;
  }
  const orParts = splitBaseExpression(cond, '||');
  if (orParts) return orParts.some((part) => evaluateBaseFilterCondition(app, file, part) === true);
  const andParts = splitBaseExpression(cond, '&&');
  if (andParts) return andParts.every((part) => evaluateBaseFilterCondition(app, file, part) !== false);

  const cache = app.metadataCache.getFileCache(file) || {};
  const fm = cache.frontmatter || {};
  const folder = file.parent?.path || file.path.split('/').slice(0, -1).join('/');
  const frontmatterTags = Array.isArray(fm.tags) ? fm.tags : String(fm.tags || '').split(/[,\s]+/).filter(Boolean);
  const tags = new Set([...frontmatterTags, ...(cache.tags || []).map((t) => t.tag)]);
  const today = startOfDay(new Date());

  const hasTag = cond.match(/^file\.hasTag\(["']#?(.+?)["']\)$/);
  if (hasTag) {
    const tag = hasTag[1].replace(/^#/, '');
    return tags.has(tag) || tags.has(`#${tag}`);
  }

  const folderNe = cond.match(/^file\.folder\s*!=\s*["'](.+?)["']$/);
  if (folderNe) return folder !== folderNe[1];

  const pathStarts = cond.match(/^file\.path\.startsWith\(["'](.+?)["']\)$/);
  if (pathStarts) return file.path.startsWith(pathStarts[1].replace(/\/$/, '') + '/');

  const pathContains = cond.match(/^file\.path\.contains\(["'](.+?)["']\)$/);
  if (pathContains) return file.path.includes(pathContains[1]);

  const contains = cond.match(/^(.+?)\.contains\(["'](.+?)["']\)$/);
  if (contains) {
    const value = basePropValue(app, file, fm, contains[1]);
    if (Array.isArray(value)) return value.map((item) => String(item)).includes(contains[2]);
    return String(value ?? '').includes(contains[2]);
  }

  const empty = cond.match(/^(?:date\()?(.+?)\)?\.isEmpty\(\)$/);
  if (empty) return !hasBaseValue(basePropValue(app, file, fm, empty[1]));

  const propEq = cond.match(/^(.+?)\s*(==|!=)\s*(?:(["'])(.*?)\3|null)$/);
  if (propEq) {
    const actualValue = basePropValue(app, file, fm, propEq[1]);
    const expectedIsNull = propEq[0].trim().endsWith('null');
    if (expectedIsNull) {
      const present = hasBaseValue(actualValue);
      return propEq[2] === '==' ? !present : present;
    }
    const actual = String(actualValue ?? '');
    const expected = propEq[4] ?? '';
    return propEq[2] === '==' ? actual === expected : actual !== expected;
  }

  const dateCompare = cond.match(/^(?:date\()?(.+?)\)?\s*(==|<|<=|>|>=)\s*((?:today|now)\(\)(?:\s*[+-]\s*["']?\d+\s*(?:d|day|days)["']?)?)$/);
  if (dateCompare) {
    const actual = parseBaseDate(basePropValue(app, file, fm, dateCompare[1]));
    if (!actual) return false;
    const target = parseTodayExpression(dateCompare[3]) || today;
    return compareBaseDates(actual, dateCompare[2], target);
  }

  return null;
}

function parseBaseDate(value) {
  if (!value) return null;
  const d = startOfDay(new Date(value));
  return isNaN(d.getTime()) ? null : d;
}

function compareBaseDates(actual, op, target) {
  const a = actual.getTime();
  const b = target.getTime();
  if (op === '==') return a === b;
  if (op === '<') return a < b;
  if (op === '<=') return a <= b;
  if (op === '>') return a > b;
  if (op === '>=') return a >= b;
  return true;
}

function listEntities(app, entityKey) {
  const def = ENTITIES[entityKey];
  const entities = listEntityFiles(app, entityKey).map((f) => readEntity(app, f));
  if (!def?.baseSort?.length) return entities;
  return entities.sort((a, b) => compareEntitiesByBaseSort(a, b, def));
}

function compareEntitiesByBaseSort(a, b, def) {
  for (const sort of def.baseSort || []) {
    const av = entityValue(a, sort.property, def);
    const bv = entityValue(b, sort.property, def);
    const cmp = compareBaseSortValues(av, bv);
    if (cmp !== 0) return sort.direction === 'DESC' ? -cmp : cmp;
  }
  return 0;
}

function compareBaseSortValues(a, b) {
  const aEmpty = !hasBaseValue(a);
  const bEmpty = !hasBaseValue(b);
  if (aEmpty && bEmpty) return 0;
  if (aEmpty) return 1;
  if (bEmpty) return -1;
  const an = Number(a);
  const bn = Number(b);
  if (!isNaN(an) && !isNaN(bn)) return an - bn;
  const ad = new Date(a);
  const bd = new Date(b);
  if (!isNaN(ad.getTime()) && !isNaN(bd.getTime())) return ad.getTime() - bd.getTime();
  return String(a).localeCompare(String(b), undefined, { numeric: true, sensitivity: 'base' });
}

function entityValue(entity, key, def) {
  const fm = entity.frontmatter || {};
  if (fm[key] != null && fm[key] !== '') return fm[key];
  // File-name-backed fields default to the note basename.
  if (['name', 'title', 'subject', 'file.name', 'file.basename'].includes(key)) return entity.basename;
  if (key === 'file.path') return entity.file?.path || '';
  if (key === 'file.folder') return entity.file?.parent?.path || entity.file?.path?.split('/').slice(0, -1).join('/') || '';
  if (key === 'file.ctime') return entity.file?.stat?.ctime ? new Date(entity.file.stat.ctime).toISOString() : '';
  if (key === 'file.mtime') return entity.file?.stat?.mtime ? new Date(entity.file.stat.mtime).toISOString() : '';
  if (key === 'file.tags') return fm.tags || [];
  if (key && key === primaryFieldKey(def)) return entity.basename;
  return '';
}

function entityPrimaryValue(entity, def) {
  const key = primaryFieldKey(def);
  return (key ? entityValue(entity, key, def) : '') || entity.basename || '';
}

function fmtValue(val, type) {
  if (val == null || val === '') return '';
  if (type === 'tags' && Array.isArray(val)) return val.map((t) => `#${t}`).join(' ');
  if (type === 'date') {
    const d = new Date(val);
    if (!isNaN(d.getTime())) return d.toLocaleDateString(navigator.language || undefined, { year: 'numeric', month: 'short', day: 'numeric' });
    return String(val);
  }
  if (type === 'currency') {
    const n = Number(val);
    if (!isNaN(n)) {
      try {
        return n.toLocaleString(undefined, { style: 'currency', currency: CURRENT_CURRENCY, maximumFractionDigits: 0 });
      } catch (_) {
        return n.toLocaleString(undefined, { style: 'currency', currency: 'USD', maximumFractionDigits: 0 });
      }
    }
    return String(val);
  }
  if (type === 'number') return String(val);
  if (Array.isArray(val)) return val.join(', ');
  return String(val);
}

function resolveEntityFieldDefault(field) {
  if (!Object.prototype.hasOwnProperty.call(field || {}, 'defaultValue')) return undefined;
  if (field.defaultValue === '{{today}}') return ymd();
  return cloneConfig(field.defaultValue);
}

function templateFieldValue(field, isPrimary, name) {
  if (isPrimary) return name;
  const configured = resolveEntityFieldDefault(field);
  if (configured !== undefined) return configured;
  if (field.type === 'tags') return [];
  if (field.type === 'number' || field.type === 'currency') return 0;
  return '';
}

function yamlTemplateLine(key, value) {
  const serialized = obsidian.stringifyYaml({ [key]: value }).trim();
  return serialized || `${key}:`;
}

function entityTemplate(entityKey, name) {
  const def = ENTITIES[entityKey];
  const template = def?.template || WORKSPACE_CONFIG?.templates?.[entityKey];
  if (template) {
    const fields = Array.isArray(def?.fields) ? def.fields : [];
    const context = {
      name,
      title: name,
      today: ymd(),
      entityKey,
      label: def?.label || entityKey,
      plural: def?.plural || pluralizeEntityLabel(def?.label || entityKey),
    };
    return renderTemplateDocument(template, context, {
      frontmatter: (() => {
        const fallback = {};
        const hasTypeField = fields.some((f) => f.key === 'type');
        if (!hasTypeField) fallback.type = def.typeFilter || entityKey;
        fields.forEach((f) => {
          fallback[f.key] = templateFieldValue(f, f.key === primaryFieldKey(def), name);
        });
        return fallback;
      })(),
      body: `# ${name}\n`,
    });
  }

  if (entityKey === 'project') return projectTemplate(name);

  const lines = ['---'];
  // Only write the meta `type: <entityKey>` tag if the entity doesn't already
  // define a `type` field of its own (e.g. Activity has type=Call/Email/...).
  // Otherwise we'd emit duplicate YAML keys and the file fails to parse.
  const hasTypeField = def.fields.some((f) => f.key === 'type');
  if (!hasTypeField) {
    lines.push(yamlTemplateLine('type', def.typeFilter || entityKey));
  }

  def.fields.forEach((f) => {
    lines.push(yamlTemplateLine(f.key, templateFieldValue(f, f.key === primaryFieldKey(def), name)));
  });
  lines.push('---', '', `# ${name}`, '', '');
  return lines.join('\n');
}

function projectTemplate(name) {
  const def = ENTITIES.project || {};
  const template = def.template || WORKSPACE_CONFIG?.templates?.project;
  if (template) {
    return renderTemplateDocument(template, {
      name,
      title: name,
      today: ymd(),
      entityKey: 'project',
      label: def.label || 'Project',
      plural: def.plural || 'Projects',
    }, {
      frontmatter: {
        type: 'project',
        name,
        status: 'active',
        priority: 'medium',
        owner: '',
        started: ymd(),
        due: '',
        tags: [],
        related_deals: [],
        related_partners: [],
      },
      body: [
        `# ${name}`,
        '',
        '## Brief',
        '_The outcome we want, why now._',
        '',
        '## Scope',
        '**In scope:**',
        '- ',
        '',
        '**Out of scope:**',
        '- ',
        '',
        '## Milestones',
        `- [ ] ${ymd()} — First milestone`,
        '',
        '## Tasks',
        '- [ ] ',
        '',
        '## Risks',
        '- ',
        '',
        '## Stakeholders',
        '- ',
        '',
        '## Notes',
        '',
        '',
      ],
    });
  }
  const today = ymd(new Date());
  return [
    '---',
    'type: project',
    `name: ${name}`,
    'status: active',
    'priority: medium',
    'owner:',
    `started: ${today}`,
    'due:',
    'tags: []',
    'related_deals: []',
    'related_partners: []',
    '---',
    '',
    `# ${name}`,
    '',
    '## Brief',
    '_The outcome we want, why now._',
    '',
    '',
    '## Scope',
    '**In scope:**',
    '- ',
    '',
    '**Out of scope:**',
    '- ',
    '',
    '## Milestones',
    `- [ ] ${today} — First milestone`,
    '',
    '## Tasks',
    '- [ ] ',
    '',
    '## Risks',
    '- ',
    '',
    '## Stakeholders',
    '- ',
    '',
    '## Notes',
    '',
    '',
  ].join('\n');
}

/* Parse the H2 sections of a markdown file into a map. */
function parseH2Sections(content) {
  const lines = content.split('\n');
  const sections = {};
  let cur = null, buf = [];
  for (const line of lines) {
    if (/^##\s/.test(line)) {
      if (cur) sections[cur] = buf.join('\n');
      cur = line.replace(/^##\s+/, '').trim();
      buf = [];
    } else if (cur) {
      buf.push(line);
    }
  }
  if (cur) sections[cur] = buf.join('\n');
  return sections;
}

/* Parse milestone lines: `- [x] 2026-05-15 — Title`
   Indented (1-tab or 1-4 spaces) non-empty lines that follow a milestone are
   treated as that milestone's free-form notes.
   Returns array of { done, date (Date|null), title, notes }. */
function parseMilestones(text) {
  if (!text) return [];
  const lines = text.split('\n');
  const items = [];
  let current = null;
  for (const line of lines) {
    if (/^\s*-\s\[(x|X| )\]\s/.test(line)) {
      if (current) items.push(current);
      const done = / \[(x|X)\] /.test(line);
      const rest = line.replace(/^\s*-\s\[(x|X| )\]\s/, '');
      const m = rest.match(/^(\d{4}-\d{2}-\d{2})\s*(?:[—–-]\s*)?(.+)?$/);
      const date = m && m[1] ? new Date(m[1]) : null;
      const title = m ? (m[2] || '').trim() : rest.trim();
      current = {
        done,
        date: (date && !isNaN(date.getTime())) ? date : null,
        title,
        notes: '',
      };
    } else if (current && line.trim() && /^[ \t]/.test(line)) {
      // Indented non-empty line → child note for the current milestone.
      // Strip up to 4 leading spaces or one tab; preserve any deeper indent.
      const stripped = line.replace(/^( {1,4}|\t)/, '');
      current.notes = current.notes ? current.notes + '\n' + stripped : stripped;
    }
    // Empty / non-indented non-milestone lines are ignored — they shouldn't
    // appear inside the Milestones section but we won't choke on them.
  }
  if (current) items.push(current);
  return items;
}

/* Format a milestone array back into markdown lines.
   Notes are emitted as 4-space-indented child lines under the milestone. */
function stringifyMilestones(items) {
  if (!items || !items.length) return '';
  return items.map((m) => {
    const box = m.done ? '- [x] ' : '- [ ] ';
    const date = m.date instanceof Date && !isNaN(m.date.getTime())
      ? `${m.date.getFullYear()}-${String(m.date.getMonth() + 1).padStart(2, '0')}-${String(m.date.getDate()).padStart(2, '0')} `
      : '';
    const sep = (date && m.title) ? '— ' : '';
    let line = `${box}${date}${sep}${m.title || ''}`.trimEnd();
    if (m.notes && m.notes.trim()) {
      const noteLines = m.notes.split('\n').map((l) => '    ' + l).join('\n');
      line += '\n' + noteLines;
    }
    return line;
  }).join('\n');
}

/* Plain task lines (no date prefix) — for the Tasks H2 section. */
function parseTasksList(text) {
  if (!text) return [];
  return text.split('\n')
    .filter((l) => /^\s*-\s\[(x|X| )\]\s/.test(l))
    .map((l) => ({
      done: / \[(x|X)\] /.test(l),
      title: l.replace(/^\s*-\s\[(x|X| )\]\s/, ''),
    }));
}
function stringifyTasks(items) {
  if (!items || !items.length) return '';
  return items.map((t) => `${t.done ? '- [x] ' : '- [ ] '}${t.title || ''}`).join('\n');
}

/* ─── TaskNote helpers (used when taskMode !== 'checkbox') ─── */
function taskNoteTemplate(title) {
  const template = normalizeTemplateSpec(WORKSPACE_CONFIG?.templates?.taskNote || ENTITIES.task?.template);
  if (template) {
    return renderTemplateDocument(template, {
      title,
      name: title,
      today: ymd(),
      entityKey: 'task',
      label: 'Task',
      plural: 'Tasks',
    }, {
      frontmatter: {
        title,
        type: 'task',
        status: 'open',
        priority: 'normal',
        size: 'M',
        due: '',
        scheduled: '',
        dateCreated: ymd(),
        dateModified: ymd(),
        tags: [],
        assignee: [],
        cluster: '',
      },
      body: [
        `# ${title}`,
        '',
        '## Scope',
        '',
        '## Notes',
        '',
      ],
    });
  }
  const now = ymd();
  return [
    '---',
    `title: ${title}`,
    'type: task',
    'status: open',
    'priority: normal',
    'size: M',
    'due:',
    'scheduled:',
    `dateCreated: ${now}`,
    `dateModified: ${now}`,
    'tags: []',
    'assignee: []',
    'cluster:',
    '---',
    '',
    `# ${title}`,
    '',
    '## Scope',
    '',
    '## Notes',
    '',
  ].join('\n');
}

async function createTaskNote(app, settings, title) {
  const folder = (settings.taskNotesFolder || '00-CORE/TaskNotes/Tasks').replace(/\/$/, '');
  await ensureFolderSync(app, folder);
  const safe = title.replace(/[\\/:*?"<>|]/g, '-').trim() || 'Untitled Task';
  let path = `${folder}/${safe}.md`;
  let n = 2;
  while (app.vault.getAbstractFileByPath(path)) { path = `${folder}/${safe} ${n++}.md`; }
  return app.vault.create(path, taskNoteTemplate(title));
}

function listTodayTaskNotes(app, settings) {
  const folder = (settings.taskNotesFolder || '00-CORE/TaskNotes/Tasks').replace(/\/$/, '');
  const todayStr = ymd();
  return app.vault.getMarkdownFiles()
    .filter((f) => f.path.startsWith(folder + '/'))
    .map((f) => {
      const fm = (app.metadataCache.getFileCache(f) || {}).frontmatter || {};
      return { file: f, fm };
    })
    .filter(({ fm }) => {
      if (fm.status === 'done') return false;
      const due   = fm.due       ? String(fm.due).slice(0, 10)       : null;
      const sched = fm.scheduled ? String(fm.scheduled).slice(0, 10) : null;
      return due === todayStr || sched === todayStr;
    });
}

function taskNoteStatus(fm) {
  return String(fm?.status || 'open').toLowerCase().replace(/[\s_]+/g, '-');
}
function taskNoteIgnored(status) {
  return status === 'cancelled' || status === 'canceled';
}
function taskNoteFolders(settings) {
  const active = (settings.taskNotesFolder || '00-CORE/TaskNotes/Tasks').replace(/\/$/, '');
  const fallbackArchive = active.replace(/\/Tasks$/, '/Archive');
  const archive = (settings.taskNotesArchiveFolder || fallbackArchive || '00-CORE/TaskNotes/Archive').replace(/\/$/, '');
  return [...new Set([active, archive].filter(Boolean))];
}
function taskNoteDateValue(file, fm, done) {
  const raw = done
    ? (fm.dateCompleted || fm.completedDate || fm.completed || fm.dateModified || fm.modified || fm.due || fm.scheduled || fm.dateCreated || fm.created)
    : (fm.due || fm.scheduled || fm.dateCreated || fm.created || fm.dateModified || fm.modified);
  if (raw) return String(raw).slice(0, 10);
  if (file?.stat?.mtime) return ymd(new Date(file.stat.mtime));
  return '';
}
function listTaskNotesForProductivity(app, settings, start, end) {
  const folders = taskNoteFolders(settings);
  const startTime = startOfDay(start).getTime();
  const endTime = startOfDay(end).getTime();
  return app.vault.getMarkdownFiles()
    .filter((f) => folders.some((folder) => f.path.startsWith(folder + '/')))
    .map((file) => {
      const fm = (app.metadataCache.getFileCache(file) || {}).frontmatter || {};
      const status = taskNoteStatus(fm);
      const done = status === 'done' || status === 'completed' || status === 'archived';
      const date = taskNoteDateValue(file, fm, done);
      return { file, fm, status, done, date };
    })
    .filter((item) => {
      const time = item.date ? new Date(item.date + 'T00:00:00').getTime() : NaN;
      return !taskNoteIgnored(item.status) && Number.isFinite(time) && time >= startTime && time <= endTime;
    });
}

async function toggleTaskNoteStatus(app, file, done) {
  await app.fileManager.processFrontMatter(file, (fm) => {
    fm.status = done ? 'done' : 'open';
    fm.dateModified = new Date().toISOString().slice(0, 10);
  });
}

async function readProjectMeta(app, file) {
  const content = await app.vault.read(file);
  const sections = parseH2Sections(content);
  const milestones = parseMilestones(sections['Milestones'] || '');
  const total = milestones.length;
  const done = milestones.filter((m) => m.done).length;
  const percent = total === 0 ? 0 : Math.round((done / total) * 100);
  const today = startOfDay(new Date());
  const upcoming = milestones
    .filter((m) => !m.done && m.date)
    .sort((a, b) => a.date - b.date);
  const next = upcoming[0] || null;
  return { content, sections, milestones, total, done, percent, next, today };
}

async function createEntity(app, entityKey, rawName, context = {}) {
  const def = ENTITIES[entityKey];
  const folder = resolveEntityCreateFolder(entityKey, rawName, context);
  await ensureFolderSync(app, folder);
  const safeName = (rawName || `Untitled ${def.label}`).replace(/[\\/:*?"<>|]/g, '-').trim() || 'Untitled';
  let path = `${folder}/${safeName}.md`;
  let n = 2;
  while (app.vault.getAbstractFileByPath(path)) {
    path = `${folder}/${safeName} ${n}.md`;
    n++;
  }
  return await app.vault.create(path, entityTemplate(entityKey, safeName));
}

/* ─────────── Daily-note read/write ─────────── */
async function ensureDailyNote(app, settings, date = new Date()) {
  const path = dailyNotePath(settings, date);
  let file = app.vault.getAbstractFileByPath(path);
  if (file) return file;
  const folder = (settings.dailyNoteFolder || '').replace(/\/$/, '');
  if (folder && !app.vault.getAbstractFileByPath(folder)) {
    try { await app.vault.createFolder(folder); } catch (_) {}
  }
  const templater = app.plugins?.plugins?.['templater-obsidian'];
  const folderTemplates = templater?.settings?.folder_templates || [];
  const dailyFolder = (settings.dailyNoteFolder || '').replace(/\/$/, '');
  const match = folderTemplates.find(ft => ft.folder.replace(/\/$/, '') === dailyFolder || ft.folder === '/');
  const templateFile = match ? app.vault.getAbstractFileByPath(match.template) : null;

  if (templater?.templater && templateFile) {
    const filename = path.split('/').pop().replace('.md', '');
    const folderObj = app.vault.getAbstractFileByPath(dailyFolder) || undefined;
    file = await templater.templater.create_new_note_from_template(templateFile, folderObj, filename, false);
  } else {
    const template = [
      `# ${ymd(date)}`, '',
      settings.tasksHeading, '- [ ] ', '',
      settings.journalHeading, '', '',
    ].join('\n');
    file = await app.vault.create(path, template);
  }
  return file;
}

function parseSections(content, settings) {
  const lines = content.split('\n');
  const tasks = [];
  let journal = '';
  let mode = null;
  for (const line of lines) {
    if (/^##\s/.test(line)) {
      const stripped = line.trim();
      if (stripped === settings.tasksHeading) { mode = 'tasks'; continue; }
      if (stripped === settings.journalHeading) { mode = 'journal'; continue; }
      mode = null;
      continue;
    }
    if (mode === 'tasks') {
      if (/^\s*-\s\[(x|X| )\]\s/.test(line)) tasks.push(line);
    } else if (mode === 'journal') {
      journal += (journal ? '\n' : '') + line;
    }
  }
  return { tasks, journal: journal.replace(/\s+$/, ''), raw: content };
}

function replaceSection(content, heading, newBody) {
  const lines = content.split('\n');
  const headIdx = lines.findIndex((l) => l.trim() === heading);
  if (headIdx === -1) {
    return content.replace(/\s*$/, '') + `\n\n${heading}\n${newBody}\n`;
  }
  let endIdx = lines.length;
  for (let i = headIdx + 1; i < lines.length; i++) {
    if (/^##\s/.test(lines[i])) { endIdx = i; break; }
  }
  const before = lines.slice(0, headIdx + 1);
  const after = lines.slice(endIdx);
  const bodyLines = newBody.split('\n');
  return [...before, ...bodyLines, '', ...after].join('\n').replace(/\n{3,}/g, '\n\n');
}

/* ─────────── Reminders ─────────── */
function reminderId() { return 'rem_' + Math.random().toString(36).slice(2, 10) + Date.now().toString(36).slice(-4); }

function nextRepeat(when, repeat) {
  if (!when) return null;
  const d = when instanceof Date ? when : new Date(when);
  if (repeat === 'daily')  return new Date(d.getTime() + 86400000);
  if (repeat === 'weekly') return new Date(d.getTime() + 7 * 86400000);
  return null;
}

function reminderBucket(when) {
  if (!when) return 'later';
  const now = Date.now();
  const w = new Date(when).getTime();
  if (w <= now + 60 * 60 * 1000) return 'now';            // due now or within next hour
  const today = startOfDay(new Date()).getTime();
  const tomorrow = today + 86400000;
  if (w < tomorrow) return 'today';
  const weekEnd = today + 7 * 86400000;
  if (w < weekEnd) return 'week';
  return 'later';
}

/* Resolve a project's display name from its file path. */
function projectNameFromPath(app, path) {
  if (!path) return null;
  const file = app.vault.getAbstractFileByPath(path);
  if (!file) return path.split('/').pop().replace(/\.md$/, '');
  const cache = app.metadataCache.getFileCache(file);
  const fmName = cache && cache.frontmatter && cache.frontmatter.name;
  return fmName || file.basename;
}

/* Find an existing reminder linked to a specific (project, task-text) pair. */
function findProjectTaskReminder(plugin, projectPath, taskText) {
  if (!projectPath || !taskText) return null;
  const all = plugin.settings.reminders || [];
  return all.find((r) => !r.done && r.project === projectPath && r.text === taskText) || null;
}

function reminderTimeStr(when) {
  if (!when) return '';
  const d = new Date(when);
  if (isNaN(d.getTime())) return '';
  const today = startOfDay(new Date()).getTime();
  const dDay = startOfDay(d).getTime();
  const time = d.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' });
  if (dDay === today) return time;
  if (dDay === today + 86400000) return `Tomorrow ${time}`;
  if (dDay - today < 7 * 86400000 && dDay > today) {
    return d.toLocaleDateString(undefined, { weekday: 'short' }) + ' ' + time;
  }
  return d.toLocaleDateString(undefined, { month: 'short', day: 'numeric' }) + ' ' + time;
}

/* ─── Generic required-field validation helper ───────────────────────────
   Disables the submit button until every required input has a non-empty value.
   Wires `input` and `change` listeners so the state updates live as the user types.
*/
function attachRequiredValidation(submitBtn, requiredInputs) {
  if (!submitBtn || !requiredInputs?.length) return;
  const check = () => {
    const allFilled = requiredInputs.every(inp => {
      if (!inp) return true;
      if (inp.type === 'checkbox' || inp.type === 'radio') return inp.checked;
      return (inp.value || '').trim().length > 0;
    });
    submitBtn.disabled = !allFilled;
    submitBtn.classList.toggle('cad-btn-disabled', !allFilled);
  };
  requiredInputs.forEach(inp => {
    if (!inp) return;
    inp.addEventListener('input', check);
    inp.addEventListener('change', check);
  });
  check();
}

/* ─────────── Quick-capture modal ─────────── */
class CadenceCaptureModal extends obsidian.Modal {
  constructor(app, opts) {
    super(app);
    this.onSubmit = opts.onSubmit;
    this.defaultText = opts.defaultText || '';
    this.defaultWhen = opts.defaultWhen || null; // ISO or null
    this.defaultRepeat = opts.defaultRepeat || 'none';
    this._submitted = false;
  }
  onOpen() {
    const { contentEl } = this;
    contentEl.empty();
    contentEl.addClass('cad-capture-modal');
    contentEl.createEl('h3', { text: 'Quick capture' });

    const textRow = contentEl.createDiv({ cls: 'cad-form-row' });
    textRow.createDiv({ cls: 'cad-form-label', text: 'WHAT' });
    const textInput = textRow.createEl('input', { type: 'text', cls: 'cad-form-input' });
    textInput.placeholder = 'What needs doing?';
    textInput.value = this.defaultText;

    // Schedule toggle
    const schedToggleRow = contentEl.createDiv();
    schedToggleRow.style.marginTop = '14px';
    schedToggleRow.style.display = 'flex';
    schedToggleRow.style.alignItems = 'center';
    schedToggleRow.style.gap = '8px';
    const schedCb = schedToggleRow.createEl('input', { type: 'checkbox' });
    const schedLbl = schedToggleRow.createEl('label', { text: 'Remind me' });
    schedLbl.style.fontSize = '13px';
    schedLbl.style.cursor = 'pointer';
    schedLbl.addEventListener('click', () => { schedCb.checked = !schedCb.checked; schedCb.dispatchEvent(new Event('change')); });

    // Schedule fields (hidden until toggled)
    const schedFields = contentEl.createDiv({ cls: 'cad-capture-sched' });
    schedFields.style.display = 'none';
    schedFields.style.marginTop = '12px';
    schedFields.style.gap = '12px';
    schedFields.style.display = 'none';

    const dateRow = schedFields.createDiv({ cls: 'cad-form-row' });
    dateRow.createDiv({ cls: 'cad-form-label', text: 'WHEN' });
    const dateInput = dateRow.createEl('input', { type: 'datetime-local', cls: 'cad-form-input' });
    if (this.defaultWhen) {
      const d = new Date(this.defaultWhen);
      if (!isNaN(d.getTime())) dateInput.value = toLocalDatetimeValue(d);
    } else {
      // Default to now + 1 hour, rounded to next 15min
      const dft = new Date(Date.now() + 60 * 60 * 1000);
      dft.setMinutes(Math.ceil(dft.getMinutes() / 15) * 15, 0, 0);
      dateInput.value = toLocalDatetimeValue(dft);
    }

    // Quick-pick buttons
    const quick = schedFields.createDiv();
    quick.style.display = 'flex';
    quick.style.gap = '6px';
    quick.style.marginTop = '8px';
    quick.style.flexWrap = 'wrap';
    const setQuick = (deltaMs) => {
      const d = new Date(Date.now() + deltaMs);
      d.setSeconds(0, 0);
      dateInput.value = toLocalDatetimeValue(d);
    };
    const mkQ = (label, deltaMs) => {
      const b = quick.createEl('button', { cls: 'cad-btn cad-btn-sm', text: label });
      b.type = 'button';
      b.addEventListener('click', () => setQuick(deltaMs));
    };
    mkQ('+15m', 15 * 60 * 1000);
    mkQ('+1h',  60 * 60 * 1000);
    mkQ('+3h',  3 * 60 * 60 * 1000);
    mkQ('Tomorrow 9am', () => {});
    quick.lastChild.addEventListener('click', () => {
      const d = new Date();
      d.setDate(d.getDate() + 1);
      d.setHours(9, 0, 0, 0);
      dateInput.value = toLocalDatetimeValue(d);
    });

    const repeatRow = schedFields.createDiv({ cls: 'cad-form-row' });
    repeatRow.style.marginTop = '10px';
    repeatRow.createDiv({ cls: 'cad-form-label', text: 'REPEAT' });
    const repeatSelect = repeatRow.createEl('select', { cls: 'cad-form-input' });
    [['none', 'No repeat'], ['daily', 'Daily'], ['weekly', 'Weekly']].forEach(([v, l]) => {
      const o = repeatSelect.createEl('option', { value: v, text: l });
      if (v === this.defaultRepeat) o.selected = true;
    });

    schedCb.addEventListener('change', () => {
      schedFields.style.display = schedCb.checked ? 'block' : 'none';
    });
    if (this.defaultWhen) { schedCb.checked = true; schedFields.style.display = 'block'; }

    // Action row
    const row = contentEl.createDiv();
    row.style.display = 'flex';
    row.style.justifyContent = 'flex-end';
    row.style.gap = '8px';
    row.style.marginTop = '18px';
    const cancel = row.createEl('button', { cls: 'cad-btn', text: 'Cancel' });
    cancel.type = 'button';
    cancel.addEventListener('click', () => this.close());
    const ok = row.createEl('button', { cls: 'cad-btn primary', text: 'Capture' });
    ok.type = 'button';
    attachRequiredValidation(ok, [textInput]);

    const submit = () => {
      const text = textInput.value.trim();
      if (!text) { textInput.focus(); return; }
      const result = { text, when: null, repeat: 'none' };
      if (schedCb.checked && dateInput.value) {
        const d = fromLocalDatetimeValue(dateInput.value);
        if (d && !isNaN(d.getTime())) {
          result.when = d.toISOString();
          result.repeat = repeatSelect.value || 'none';
        }
      }
      this._submitted = true;
      this.close();
      this.onSubmit(result);
    };
    ok.addEventListener('click', submit);
    textInput.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') { e.preventDefault(); submit(); }
      if (e.key === 'Escape') this.close();
    });

    setTimeout(() => textInput.focus(), 0);
  }
  onClose() {
    if (!this._submitted && this.onSubmit) this.onSubmit(null);
    this.contentEl.empty();
  }
}

/* Helpers for <input type="datetime-local"> ↔ Date in local TZ */
function toLocalDatetimeValue(d) {
  const pad = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}
function fromLocalDatetimeValue(s) {
  if (!s) return null;
  // datetime-local has no timezone — interpret as local time
  return new Date(s);
}

/* ─────────── Reminder edit modal (text/when/repeat/notes/delete) ─────────── */
class CadenceReminderEditModal extends obsidian.Modal {
  constructor(app, plugin, reminder, opts) {
    super(app);
    this.plugin = plugin;
    this.reminder = reminder;
    this.isNew = (opts && opts.isNew) || false;
    this._submitted = false;
  }

  onOpen() {
    const { contentEl } = this;
    contentEl.empty();
    contentEl.addClass('cad-create-modal');
    contentEl.addClass('cad-reminder-edit-modal');
    contentEl.createEl('h3', { cls: 'cad-create-title', text: this.isNew ? 'New reminder' : 'Edit reminder' });

    const form = contentEl.createDiv({ cls: 'cad-create-form' });

    /* Text */
    const textRow = form.createDiv({ cls: 'cad-create-row' });
    textRow.createDiv({ cls: 'cad-create-label', text: 'WHAT *' });
    const textInput = textRow.createEl('input', { type: 'text', cls: 'cad-create-input' });
    textInput.value = this.reminder.text || '';
    textInput.placeholder = 'What needs doing?';

    /* When */
    const whenRow = form.createDiv({ cls: 'cad-create-row' });
    whenRow.createDiv({ cls: 'cad-create-label', text: 'WHEN' });
    const whenWrap = whenRow.createDiv();
    whenWrap.style.display = 'flex';
    whenWrap.style.gap = '8px';
    whenWrap.style.alignItems = 'center';
    const dateInput = whenWrap.createEl('input', { type: 'datetime-local', cls: 'cad-create-input' });
    dateInput.style.flex = '1';
    if (this.reminder.when) {
      const d = new Date(this.reminder.when);
      if (!isNaN(d.getTime())) dateInput.value = toLocalDatetimeValue(d);
    }
    const clearBtn = whenWrap.createEl('button', { cls: 'cad-btn cad-btn-sm', text: 'Clear' });
    clearBtn.type = 'button';
    clearBtn.title = 'Move to unscheduled';
    clearBtn.addEventListener('click', () => { dateInput.value = ''; });

    /* Repeat */
    const repeatRow = form.createDiv({ cls: 'cad-create-row' });
    repeatRow.createDiv({ cls: 'cad-create-label', text: 'REPEAT' });
    const repeatSel = repeatRow.createEl('select', { cls: 'cad-create-input' });
    [['none', 'No repeat'], ['daily', 'Daily'], ['weekly', 'Weekly']].forEach(([v, l]) => {
      const o = repeatSel.createEl('option', { value: v, text: l });
      if (v === (this.reminder.repeat || 'none')) o.selected = true;
    });

    /* Project link */
    const projectRow = form.createDiv({ cls: 'cad-create-row' });
    projectRow.createDiv({ cls: 'cad-create-label', text: 'PROJECT' });
    const projectField = projectRow.createDiv({ cls: 'cad-rem-project-field' });
    const renderProjectField = () => {
      projectField.empty();
      if (this.reminder.project) {
        const chip = projectField.createEl('a', { cls: 'cad-rem-project-chip', text: '📁 ' + (projectNameFromPath(this.app, this.reminder.project) || 'Project') });
        chip.title = 'Open project (closes this modal)';
        chip.addEventListener('click', (e) => {
          e.preventDefault();
          const file = this.app.vault.getAbstractFileByPath(this.reminder.project);
          if (file && file instanceof obsidian.TFile) {
            this._submitted = true;
            this.close();
            const leaf = this.app.workspace.getLeavesOfType(VIEW_TYPE_CADENCE_APP)[0];
            if (leaf && leaf.view && typeof leaf.view.openEntityDetail === 'function') {
              leaf.view.openEntityDetail('project', file);
            }
          }
        });
        const changeBtn = projectField.createEl('button', { cls: 'cad-btn cad-btn-sm', text: 'Change' });
        changeBtn.type = 'button';
        changeBtn.addEventListener('click', () => this._openReminderProjectPicker(renderProjectField));
        const removeBtn = projectField.createEl('button', { cls: 'cad-btn cad-btn-sm cad-btn-danger', text: 'Remove' });
        removeBtn.type = 'button';
        removeBtn.addEventListener('click', () => {
          this.reminder.project = null;
          renderProjectField();
        });
      } else {
        const linkBtn = projectField.createEl('button', { cls: 'cad-btn cad-btn-sm', text: '📁 Link to project' });
        linkBtn.type = 'button';
        linkBtn.addEventListener('click', () => this._openReminderProjectPicker(renderProjectField));
      }
    };
    renderProjectField();

    /* Notes */
    const notesRow = form.createDiv({ cls: 'cad-create-row' });
    notesRow.style.alignItems = 'flex-start';
    notesRow.createDiv({ cls: 'cad-create-label', text: 'NOTES' });
    const notesArea = notesRow.createEl('textarea', { cls: 'cad-create-input' });
    notesArea.rows = 6;
    notesArea.placeholder = 'Context, follow-ups, what happened, related links…';
    notesArea.value = this.reminder.notes || '';
    notesArea.style.resize = 'vertical';
    notesArea.style.fontFamily = 'inherit';

    /* Actions */
    const actions = contentEl.createDiv({ cls: 'cad-create-actions' });
    if (!this.isNew) {
      const del = actions.createEl('button', { cls: 'cad-btn cad-btn-danger', text: 'Delete' });
      del.type = 'button';
      del.style.marginRight = 'auto';
      del.addEventListener('click', async () => {
        if (!confirm('Delete this reminder?')) return;
        await this.plugin.deleteReminder(this.reminder.id);
        this._submitted = true;
        this.close();
      });
    }
    const cancel = actions.createEl('button', { cls: 'cad-btn', text: 'Cancel' });
    cancel.type = 'button';
    cancel.addEventListener('click', () => this.close());
    const save = actions.createEl('button', { cls: 'cad-btn primary', text: this.isNew ? 'Create reminder' : 'Save' });
    save.type = 'button';
    attachRequiredValidation(save, [textInput]);

    const submit = async () => {
      const text = textInput.value.trim();
      if (!text) { textInput.focus(); return; }
      const fields = {
        text,
        notes: notesArea.value,
        repeat: repeatSel.value || 'none',
        project: this.reminder.project || null,
      };
      if (dateInput.value) {
        const d = fromLocalDatetimeValue(dateInput.value);
        if (d && !isNaN(d.getTime())) {
          fields.when = d.toISOString();
          if (fields.when !== this.reminder.when) fields.notified = false;
        }
      } else {
        fields.when = null;
        fields.notified = false;
      }
      if (this.isNew) {
        await this.plugin.addReminder(fields);
        new obsidian.Notice(fields.when
          ? `Reminder set · ${reminderTimeStr(fields.when)}`
          : 'Captured to Inbox');
      } else {
        await this.plugin.updateReminder(this.reminder.id, fields);
      }
      this._submitted = true;
      this.close();
    };
    save.addEventListener('click', submit);

    // Submit on Cmd/Ctrl+Enter from notes area; Esc cancels
    notesArea.addEventListener('keydown', (e) => {
      if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') { e.preventDefault(); submit(); }
      if (e.key === 'Escape') this.close();
    });
    textInput.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') { e.preventDefault(); submit(); }
      if (e.key === 'Escape') this.close();
    });

    setTimeout(() => textInput.focus(), 0);
  }

  onClose() { this.contentEl.empty(); }

  _openReminderProjectPicker(rerender) {
    const projectFiles = listEntityFiles(this.app, 'project');
    if (!projectFiles.length) {
      new obsidian.Notice('No projects yet. Create one in Planner → Projects first.');
      return;
    }
    const projects = projectFiles.map((f) => ({ file: f, name: projectNameFromPath(this.app, f.path) }));
    const reminder = this.reminder;
    const picker = new (class extends obsidian.SuggestModal {
      constructor(app, projs) {
        super(app);
        this.projs = projs;
        this.setPlaceholder('Search projects to link this reminder to…');
      }
      getSuggestions(query) {
        const q = (query || '').toLowerCase();
        return this.projs.filter((p) => p.name.toLowerCase().includes(q));
      }
      renderSuggestion(item, el) { el.setText('📁  ' + item.name); }
      onChooseSuggestion(item) {
        reminder.project = item.file.path;
        rerender();
      }
    })(this.app, projects);
    picker.open();
  }
}

/* ─────────── CSV parser (handles quoted fields, escaped quotes, newlines) ─────────── */
function parseCSV(text) {
  if (!text) return [];
  // Strip BOM
  if (text.charCodeAt(0) === 0xFEFF) text = text.slice(1);

  const rows = [];
  let row = [];
  let field = '';
  let inQuote = false;
  let i = 0;
  while (i < text.length) {
    const ch = text[i];
    if (inQuote) {
      if (ch === '"') {
        if (text[i + 1] === '"') { field += '"'; i += 2; continue; }
        inQuote = false; i++; continue;
      }
      field += ch; i++; continue;
    }
    if (ch === '"') { inQuote = true; i++; continue; }
    if (ch === ',') { row.push(field); field = ''; i++; continue; }
    if (ch === '\r') {
      row.push(field); rows.push(row); row = []; field = '';
      i += (text[i + 1] === '\n') ? 2 : 1;
      continue;
    }
    if (ch === '\n') {
      row.push(field); rows.push(row); row = []; field = '';
      i++; continue;
    }
    field += ch; i++;
  }
  if (field !== '' || row.length) { row.push(field); rows.push(row); }
  // Drop trailing empty row(s)
  return rows.filter((r) => !(r.length === 1 && r[0] === ''));
}

function csvEscape(value) {
  const s = value == null ? '' : String(value);
  return /[",\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

function sampleValueForField(field, def, idx) {
  const type = field.type || 'text';
  if (idx === 0 || field.primary) return `Example ${def.label}`;
  if (type === 'email') return 'name@example.com';
  if (type === 'number') return '10';
  if (type === 'currency') return '1000';
  if (type === 'date') return ymd();
  if (type === 'enum') return (field.options || [])[0] || '';
  if (type === 'tags') return 'tag1; tag2';
  return `Example ${field.label || field.key}`;
}

function csvTemplateForEntity(entityKey) {
  const def = ENTITIES[entityKey];
  const fields = def?.fields || [];
  const headers = fields.map((f) => f.key);
  const example = fields.map((f, i) => sampleValueForField(f, def, i));
  return `${headers.map(csvEscape).join(',')}\n${example.map(csvEscape).join(',')}\n`;
}

let XLSX_LIB = null;
function getXLSX(app) {
  if (XLSX_LIB) return XLSX_LIB;
  const relPath = `${PLUGIN_DIR || '.obsidian/plugins/bob-workspace'}/vendor/xlsx.full.min.js`;
  const candidates = [
    './vendor/xlsx.full.min.js',
    relPath,
  ];
  try {
    if (app?.vault?.adapter?.getFullPath) candidates.push(app.vault.adapter.getFullPath(relPath));
  } catch (_) {}
  const errors = [];
  for (const candidate of candidates) {
    try {
      XLSX_LIB = require(candidate);
      return XLSX_LIB;
    } catch (e) {
      errors.push(`${candidate}: ${e.message}`);
    }
  }
  throw new Error(`XLSX library not found at ${relPath}. Install vendor/xlsx.full.min.js with the plugin. ${errors.join(' | ')}`);
}

function safeSheetName(raw, used = new Set()) {
  const base = String(raw || 'Sheet')
    .replace(/[\[\]:*?/\\]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 31) || 'Sheet';
  let name = base;
  let n = 2;
  while (used.has(name)) {
    const suffix = ` ${n}`;
    name = `${base.slice(0, Math.max(1, 31 - suffix.length))}${suffix}`;
    n++;
  }
  used.add(name);
  return name;
}

function workbookEntityKeyFromSheet(sheetName) {
  const norm = (s) => String(s || '').toLowerCase().replace(/[^a-z0-9]/g, '');
  const n = norm(sheetName);
  for (const [key, def] of Object.entries(ENTITIES)) {
    if (n === norm(key) || n === norm(def.label) || n === norm(def.plural)) return key;
  }
  return null;
}

function xlsxCellValue(value) {
  if (value == null) return '';
  if (Array.isArray(value)) return value.join('; ');
  if (value instanceof Date) return value.toISOString().slice(0, 10);
  if (typeof value === 'object') return JSON.stringify(value);
  return value;
}

function entityRowsForWorkbook(app, entityKey) {
  const def = ENTITIES[entityKey];
  if (!def) return [];
  return listEntities(app, entityKey).map((entity) => {
    const row = {};
    row.file_path = entity.file.path;
    row.created = new Date(entity.file.stat.ctime).toISOString();
    row.modified = new Date(entity.file.stat.mtime).toISOString();
    def.fields.forEach((f) => {
      row[f.key] = xlsxCellValue(entityValue(entity, f.key, def));
    });
    return row;
  });
}

function worksheetRowsForEntity(app, entityKey) {
  const def = ENTITIES[entityKey];
  const headers = ['file_path', 'created', 'modified', ...(def?.fields || []).map((f) => f.key)];
  const rows = entityRowsForWorkbook(app, entityKey);
  return rows.length ? rows : [Object.fromEntries(headers.map((h) => [h, '']))];
}

async function writeWorkbookToVault(app, workbook, path) {
  const XLSX = getXLSX(app);
  const data = XLSX.write(workbook, { bookType: 'xlsx', type: 'array' });
  await ensureFolderSync(app, path.split('/').slice(0, -1).join('/'));
  await app.vault.adapter.writeBinary(path, data);
}

function workbookExportFolder(settings = {}) {
  return (settings.workbookExportFolder || DEFAULT_SETTINGS.workbookExportFolder || 'BOB Workspace/Exports')
    .replace(/^\/+/, '')
    .replace(/\/+$/, '');
}

function workbookExportGroups() {
  return WORKBOOK_EXPORT_GROUPS
    .map((group) => ({
      id: group.id,
      label: group.label,
      entityKeys: group.entityKeys.filter((key) => ENTITIES[key]),
    }))
    .filter((group) => group.entityKeys.length);
}

function entityKeysForWorkbookGroups(groupIds) {
  const selected = new Set(groupIds || []);
  const keys = [];
  workbookExportGroups().forEach((group) => {
    if (!selected.has(group.id)) return;
    group.entityKeys.forEach((key) => {
      if (ENTITIES[key] && !keys.includes(key)) keys.push(key);
    });
  });
  return keys;
}

function selectedWorkbookEntityKeys(groupIds) {
  if (!groupIds || !groupIds.length) return [];
  return entityKeysForWorkbookGroups(groupIds);
}

async function exportEntitiesXLSX(app, entityKeys, suffix = '', settings = {}) {
  const XLSX = getXLSX(app);
  const wb = XLSX.utils.book_new();
  const used = new Set();
  const included = entityKeys?.length ? new Set(entityKeys) : null;
  const sortedEntities = Object.entries(ENTITIES)
    .filter(([key]) => !included || included.has(key))
    .sort(([, a], [, b]) => String(a.plural || a.label || '').localeCompare(String(b.plural || b.label || '')));
  if (!sortedEntities.length) throw new Error('No entities selected for export.');
  for (const [entityKey, def] of sortedEntities) {
    const rows = worksheetRowsForEntity(app, entityKey);
    const headers = ['file_path', 'created', 'modified', ...def.fields.map((f) => f.key)];
    const ws = XLSX.utils.json_to_sheet(rows, { header: headers });
    XLSX.utils.book_append_sheet(wb, ws, safeSheetName(def.plural || entityKey, used));
  }
  const nameSuffix = suffix ? `-${suffix}` : '';
  const path = `${workbookExportFolder(settings)}/bob-workspace-export${nameSuffix}-${ymd()}.xlsx`;
  await writeWorkbookToVault(app, wb, path);
  return path;
}

async function exportAllEntitiesXLSX(app, settings = {}) {
  return exportEntitiesXLSX(app, null, '', settings);
}

function rowValue(row, key) {
  const target = normalizedImportHeader(key);
  for (const [k, v] of Object.entries(row)) {
    if (normalizedImportHeader(k) === target) return v;
  }
  return '';
}

function normalizedImportHeader(value) {
  return String(value || '').toLowerCase().replace(/[^a-z0-9]/g, '');
}

function configuredFieldAliases(def) {
  const aliases = {};
  Object.entries(def?.fieldAliases || {}).forEach(([fieldKey, values]) => {
    if (!Array.isArray(values) || !def.fields?.some((field) => field.key === fieldKey)) return;
    values.forEach((value) => {
      const normalized = normalizedImportHeader(value);
      if (normalized) aliases[normalized] = fieldKey;
    });
  });
  return aliases;
}

function rowValueForField(row, field, def) {
  const candidates = [field.key, field.label, ...(def?.fieldAliases?.[field.key] || [])];
  for (const candidate of candidates) {
    const value = rowValue(row, candidate);
    if (value !== '') return value;
  }
  return '';
}

function normalizeImportValue(value, field) {
  let val = value == null ? '' : value;
  if (typeof val === 'string') val = val.trim();
  if (val === '') return null;
  if (field.type === 'number' || field.type === 'currency') {
    const n = Number(String(val).replace(/[^\d.\-]/g, ''));
    return isNaN(n) ? null : n;
  }
  if (field.type === 'tags') {
    if (Array.isArray(val)) return val.filter(Boolean);
    const tags = String(val).split(/[,;]/).map((s) => s.trim()).filter(Boolean);
    return tags.length ? tags : null;
  }
  if (field.type === 'date') {
    if (val instanceof Date && !isNaN(val.getTime())) return val.toISOString().slice(0, 10);
    const d = new Date(val);
    return isNaN(d.getTime()) ? String(val) : d.toISOString().slice(0, 10);
  }
  return val;
}

async function importEntityRows(app, entityKey, rows) {
  const def = ENTITIES[entityKey];
  if (!def) return { created: 0, failed: rows.length };
  const primary = primaryField(def);
  if (!primary) return { created: 0, failed: rows.length };
  let created = 0;
  let updated = 0;
  let failed = 0;
  for (const row of rows) {
    const primaryValue = String(rowValueForField(row, primary, def) || '').trim();
    if (!primaryValue) { failed++; continue; }
    try {
      const explicitPath = String(rowValue(row, 'file_path') || '').trim();
      let file = explicitPath ? app.vault.getAbstractFileByPath(explicitPath) : null;
      let isUpdate = file instanceof obsidian.TFile;
      if (!isUpdate) file = await createEntity(app, entityKey, primaryValue, { values: row });
      await app.fileManager.processFrontMatter(file, (fm) => {
        def.fields.forEach((field) => {
          if (field.key === primary.key) return;
          const imported = normalizeImportValue(rowValueForField(row, field, def), field);
          if (imported == null || imported === '') return;
          if (Array.isArray(imported) && !imported.length) return;
          fm[field.key] = imported;
        });
      });
      if (isUpdate) updated++;
      else created++;
    } catch (_) {
      failed++;
    }
  }
  return { created, updated, failed };
}

async function importWorkbookEntities(app, file) {
  const XLSX = getXLSX(app);
  const data = await app.vault.readBinary(file);
  const wb = XLSX.read(data, { type: 'array', cellDates: true });
  const result = { created: 0, updated: 0, failed: 0, sheets: 0, skippedSheets: [] };
  for (const sheetName of wb.SheetNames) {
    const entityKey = workbookEntityKeyFromSheet(sheetName);
    if (!entityKey) {
      result.skippedSheets.push(sheetName);
      continue;
    }
    const rows = XLSX.utils.sheet_to_json(wb.Sheets[sheetName], { defval: '', raw: false });
    const nonEmptyRows = rows.filter((row) => Object.values(row).some((v) => String(v || '').trim()));
    const imported = await importEntityRows(app, entityKey, nonEmptyRows);
    result.created += imported.created;
    result.updated += imported.updated || 0;
    result.failed += imported.failed;
    result.sheets++;
  }
  return result;
}

async function promptImportWorkbook(app, onDone = () => {}) {
  const workbookFiles = app.vault.getFiles().filter((f) => {
    const p = f.path.toLowerCase();
    return p.endsWith('.xlsx') || p.endsWith('.xlsm') || p.endsWith('.xlsb') || p.endsWith('.xls');
  });
  if (!workbookFiles.length) {
    new obsidian.Notice('No Excel workbooks found in vault.');
    return;
  }
  const picker = new (class extends obsidian.SuggestModal {
    constructor(app, files, onPick) { super(app); this.files = files; this.onPick = onPick; this.setPlaceholder('Import workbook…'); }
    getSuggestions(q) { return this.files.filter((f) => f.path.toLowerCase().includes(q.toLowerCase())); }
    renderSuggestion(file, el) { el.setText(file.path); }
    onChooseSuggestion(file) { this.onPick(file); }
  })(app, workbookFiles, async (file) => {
    try {
      const result = await importWorkbookEntities(app, file);
      await onDone(result);
      const skipped = result.skippedSheets.length ? ` · skipped sheets: ${result.skippedSheets.join(', ')}` : '';
      new obsidian.Notice(`BOB Workspace: imported ${result.created} created, ${result.updated || 0} updated from ${result.sheets} sheet${result.sheets === 1 ? '' : 's'}${result.failed ? ` · ${result.failed} skipped` : ''}${skipped}`, 8000);
    } catch (e) {
      new obsidian.Notice(`BOB Workspace: XLSX import failed — ${e.message}`, 8000);
    }
  });
  picker.open();
}

/* ─────────── CSV import modal ─────────── */
class CadenceImportModal extends obsidian.Modal {
  constructor(app, opts) {
    super(app);
    this.entityKey = (opts && opts.entityKey) || 'contact';
    this.onSubmit = (opts && opts.onSubmit) || (() => {});
    this.csvText = '';
    this.headers = [];
    this.rows = [];
    this.mapping = {}; // csv-header → entity-field-key | null
  }

  onOpen() {
    const { contentEl, modalEl } = this;
    contentEl.empty();
    contentEl.addClass('cad-import-modal');
    if (modalEl) modalEl.addClass('cad-import-modal-shell');
    contentEl.createEl('h3', { cls: 'cad-create-title', text: 'Import from CSV' });

    /* Entity selector */
    const entityRow = contentEl.createDiv({ cls: 'cad-create-row' });
    entityRow.createDiv({ cls: 'cad-create-label', text: 'IMPORT AS' });
    const entitySelect = entityRow.createEl('select', { cls: 'cad-create-input' });
    Object.entries(ENTITIES)
      .sort(([, a], [, b]) => String(a.plural || a.label || '').localeCompare(String(b.plural || b.label || '')))
      .forEach(([key, def]) => {
      const o = entitySelect.createEl('option', { value: key, text: def.plural });
      if (key === this.entityKey) o.selected = true;
    });
    entitySelect.addEventListener('change', () => {
      this.entityKey = entitySelect.value;
      this._autoDetectMapping();
      this._renderFieldReference();
      this._renderPreview();
    });

    this.fieldInfoEl = contentEl.createDiv({ cls: 'cad-import-field-ref' });
    this._renderFieldReference();

    /* CSV input */
    const csvRow = contentEl.createDiv({ cls: 'cad-create-row' });
    csvRow.style.alignItems = 'flex-start';
    csvRow.createDiv({ cls: 'cad-create-label', text: 'CSV DATA' });
    const csvWrap = csvRow.createDiv();
    csvWrap.style.display = 'flex';
    csvWrap.style.flexDirection = 'column';
    csvWrap.style.gap = '8px';

    const tabs = csvWrap.createDiv();
    tabs.style.display = 'flex';
    tabs.style.gap = '6px';
    tabs.style.flexWrap = 'wrap';
    const pasteBtn = tabs.createEl('button', { cls: 'cad-btn cad-btn-sm', text: 'Paste' });
    pasteBtn.type = 'button';
    const fileBtn  = tabs.createEl('button', { cls: 'cad-btn cad-btn-sm', text: 'Pick .csv from vault' });
    fileBtn.type = 'button';
    const xlsxBtn = tabs.createEl('button', { cls: 'cad-btn cad-btn-sm', text: 'Pick .xlsx from vault' });
    xlsxBtn.type = 'button';
    const exportBtn = tabs.createEl('button', { cls: 'cad-btn cad-btn-sm', text: 'Export CSV template' });
    exportBtn.type = 'button';
    const exportXlsxBtn = tabs.createEl('button', { cls: 'cad-btn cad-btn-sm', text: 'Export XLSX template' });
    exportXlsxBtn.type = 'button';

    const ta = csvWrap.createEl('textarea', { cls: 'cad-create-input' });
    ta.rows = 8;
    ta.placeholder = 'Paste CSV here, including a header row…';
    ta.style.fontFamily = 'var(--font-monospace-theme, var(--font-monospace))';
    ta.style.fontSize = '12px';
    ta.style.resize = 'vertical';
    ta.addEventListener('input', () => {
      this.csvText = ta.value;
      this._parse();
      this._renderPreview();
    });

    pasteBtn.addEventListener('click', () => ta.focus());
    exportBtn.addEventListener('click', () => this._exportTemplateCSV());
    exportXlsxBtn.addEventListener('click', () => this._exportTemplateXLSX());
    xlsxBtn.addEventListener('click', () => this._pickXLSXFromVault(ta));
    fileBtn.addEventListener('click', async () => {
      // Intentional vault-wide enumeration: the user is explicitly picking a
      // .csv file they've placed somewhere in their vault. Limiting this
      // would defeat the feature. All other entity reads are folder-scoped.
      const csvFiles = this.app.vault.getFiles().filter((f) => f.path.toLowerCase().endsWith('.csv'));
      if (!csvFiles.length) {
        new obsidian.Notice('No .csv files found in vault. Drop one in the vault first.');
        return;
      }
      const picker = new (class extends obsidian.SuggestModal {
        constructor(app, files, onPick) { super(app); this.files = files; this.onPick = onPick; this.setPlaceholder('Search .csv files…'); }
        getSuggestions(q) { return this.files.filter((f) => f.path.toLowerCase().includes(q.toLowerCase())); }
        renderSuggestion(file, el) { el.setText(file.path); }
        onChooseSuggestion(file) { this.onPick(file); }
      })(this.app, csvFiles, async (file) => {
        try {
          const text = await this.app.vault.read(file);
          ta.value = text;
          this.csvText = text;
          this._parse();
          this._renderPreview();
        } catch (e) {
          new obsidian.Notice(`Failed to read ${file.path}: ${e.message}`);
        }
      });
      picker.open();
    });

    /* Preview area */
    this.previewEl = contentEl.createDiv({ cls: 'cad-import-preview' });
    this._renderPreview();

    /* Action row */
    const actions = contentEl.createDiv({ cls: 'cad-create-actions' });
    const cancel = actions.createEl('button', { cls: 'cad-btn', text: 'Cancel' });
    cancel.type = 'button';
    cancel.addEventListener('click', () => this.close());
    this.importBtn = actions.createEl('button', { cls: 'cad-btn primary', text: 'Import' });
    this.importBtn.type = 'button';
    this.importBtn.disabled = true;
    this.importBtn.addEventListener('click', () => this._submitImport());
  }

  _renderFieldReference() {
    if (!this.fieldInfoEl) return;
    this.fieldInfoEl.empty();
    const def = ENTITIES[this.entityKey];
    if (!def) return;

    const head = this.fieldInfoEl.createDiv({ cls: 'cad-import-field-ref-head' });
    head.createDiv({ cls: 'cad-create-label', text: 'EXPECTED FIELDS' });
    const hint = head.createDiv({ cls: 'cad-import-field-hint' });
    hint.appendText('Use field keys as CSV headers for automatic mapping. ');
    hint.createEl('code', { text: def.fields.map((f) => f.key).join(', ') });

    const list = this.fieldInfoEl.createDiv({ cls: 'cad-import-field-list' });
    def.fields.forEach((f, idx) => {
      const required = idx === 0 || f.required === true;
      const item = list.createDiv({ cls: 'cad-import-field-item' + (required ? ' required' : '') });
      item.createDiv({ cls: 'cad-import-field-key', text: f.key });
      item.createDiv({ cls: 'cad-import-field-label', text: f.label || f.key });
      const meta = [f.type || 'text'];
      if (required) meta.push('required');
      if (f.type === 'enum' && f.options?.length) meta.push(f.options.join(' / '));
      if (def.fieldAliases?.[f.key]?.length) meta.push(`aliases: ${def.fieldAliases[f.key].join(' / ')}`);
      item.createDiv({ cls: 'cad-import-field-meta', text: meta.join(' · ') });
    });
  }

  async _exportTemplateCSV() {
    const def = ENTITIES[this.entityKey];
    if (!def) return;
    const folder = 'Cadence/Imports';
    const safeKey = this.entityKey.replace(/[^a-z0-9_-]/gi, '-').toLowerCase();
    const path = `${folder}/${safeKey}-import-template.csv`;
    try {
      await ensureFolderSync(this.app, 'Cadence');
      await ensureFolderSync(this.app, folder);
      await this.app.vault.adapter.write(path, csvTemplateForEntity(this.entityKey));
      new obsidian.Notice(`Exported CSV template to ${path}`);
    } catch (e) {
      new obsidian.Notice(`BOB Workspace: failed to export CSV template — ${e.message}`);
    }
  }

  async _exportTemplateXLSX() {
    const def = ENTITIES[this.entityKey];
    if (!def) return;
    try {
      const XLSX = getXLSX(this.app);
      const wb = XLSX.utils.book_new();
      const rows = [Object.fromEntries(def.fields.map((f, i) => [f.key, sampleValueForField(f, def, i)]))];
      const ws = XLSX.utils.json_to_sheet(rows, { header: def.fields.map((f) => f.key) });
      XLSX.utils.book_append_sheet(wb, ws, safeSheetName(def.plural || this.entityKey));
      const folder = 'Cadence/Imports';
      const safeKey = this.entityKey.replace(/[^a-z0-9_-]/gi, '-').toLowerCase();
      const path = `${folder}/${safeKey}-import-template.xlsx`;
      await writeWorkbookToVault(this.app, wb, path);
      new obsidian.Notice(`Exported XLSX template to ${path}`);
    } catch (e) {
      new obsidian.Notice(`BOB Workspace: failed to export XLSX template — ${e.message}`);
    }
  }

  async _pickXLSXFromVault(textarea) {
    const xlsxFiles = this.app.vault.getFiles().filter((f) => {
      const p = f.path.toLowerCase();
      return p.endsWith('.xlsx') || p.endsWith('.xlsm') || p.endsWith('.xlsb') || p.endsWith('.xls');
    });
    if (!xlsxFiles.length) {
      new obsidian.Notice('No Excel files found in vault. Drop one in the vault first.');
      return;
    }
    const picker = new (class extends obsidian.SuggestModal {
      constructor(app, files, onPick) { super(app); this.files = files; this.onPick = onPick; this.setPlaceholder('Search Excel files…'); }
      getSuggestions(q) { return this.files.filter((f) => f.path.toLowerCase().includes(q.toLowerCase())); }
      renderSuggestion(file, el) { el.setText(file.path); }
      onChooseSuggestion(file) { this.onPick(file); }
    })(this.app, xlsxFiles, async (file) => {
      try {
        const XLSX = getXLSX(this.app);
        const data = await this.app.vault.readBinary(file);
        const wb = XLSX.read(data, { type: 'array', cellDates: true });
        const matchingSheet = wb.SheetNames.find((s) => workbookEntityKeyFromSheet(s) === this.entityKey);
        const sheetName = matchingSheet || wb.SheetNames[0];
        if (!sheetName) throw new Error('Workbook has no sheets');
        const csv = XLSX.utils.sheet_to_csv(wb.Sheets[sheetName]);
        textarea.value = csv;
        this.csvText = csv;
        this._parse();
        this._renderPreview();
        if (!matchingSheet && wb.SheetNames.length > 1) {
          new obsidian.Notice(`Loaded sheet "${sheetName}".`);
        }
      } catch (e) {
        new obsidian.Notice(`Failed to read ${file.path}: ${e.message}`);
      }
    });
    picker.open();
  }

  _parse() {
    if (!this.csvText.trim()) { this.headers = []; this.rows = []; return; }
    const all = parseCSV(this.csvText);
    if (!all.length) { this.headers = []; this.rows = []; return; }
    this.headers = all[0].map((h) => String(h).trim());
    this.rows = all.slice(1);
    this._autoDetectMapping();
  }

  _autoDetectMapping() {
    this.mapping = {};
    const def = ENTITIES[this.entityKey];
    if (!def || !this.headers.length) return;

    const norm = normalizedImportHeader;
    const keyByNorm = {};
    def.fields.forEach((f) => {
      keyByNorm[norm(f.key)] = f.key;
      keyByNorm[norm(f.label)] = f.key;
    });
    Object.entries(configuredFieldAliases(def)).forEach(([header, fieldKey]) => {
      if (!keyByNorm[header]) keyByNorm[header] = fieldKey;
    });
    // Common synonyms
    const synonyms = {
      'fullname': 'name', 'displayname': 'name', 'contact': ['contact_ref', 'contact_name', 'name'],
      'companyname': ['company_name', 'company'], 'organisation': ['company_name', 'company'], 'organization': ['company_name', 'company'],
      'phone': 'phone', 'phonenumber': 'phone', 'mobile': 'phone',
      'mail': 'email', 'emailaddress': 'email',
      'subject': 'title', 'activitysubject': 'title',
      'type': ['channel', 'type'], 'activitytype': ['channel', 'type'],
      'when': ['date', 'next_action_date'], 'activitydate': 'date',
      'with': ['contact_ref', 'contact_name'],
      'assigned': 'owner', 'assignee': 'owner', 'assignedto': 'owner',
      'owner': 'owner',
      'followup': 'next_action', 'followupdate': 'next_action_date',
      'amount': ['deal_value', 'amount', 'value'], 'price': ['deal_value', 'amount', 'value'], 'mrr': ['deal_value', 'amount', 'value'], 'arr': ['deal_value', 'amount', 'value'],
      'value': 'deal_value', 'dealvalue': 'deal_value',
      'closedate': 'expected_close', 'expectedclose': 'expected_close',
      'lastcontacted': 'last_contact', 'lastcontact': 'last_contact',
      'supplier': ['supplier_id', 'supplier_name'], 'supplierid': 'supplier_id', 'suppliername': 'supplier_name',
      'po': ['po_ref', 'po_id'], 'purchaseorder': ['po_ref', 'po_id'], 'poref': 'po_ref', 'poid': 'po_id',
      'pr': ['pr_ref', 'pr_id'], 'purchaserequisition': ['pr_ref', 'pr_id'], 'prref': 'pr_ref', 'prid': 'pr_id',
      'duedate': 'due_date', 'due': 'due_date',
      'invoicedate': 'invoice_date',
      'paymentstatus': 'payment_status',
      'approvalstatus': 'approval_status',
      'matchstatus': 'match_status',
      'total': ['total_amount', 'amount'], 'totalamount': 'total_amount',
      'estimatedamount': 'estimated_amount', 'estimate': 'estimated_amount',
      'client': ['client_id', 'client_name'], 'clientid': 'client_id', 'clientname': 'client_name',
      'currencycode': 'currency',
      'glaccount': 'gl_account_code', 'glaccountcode': 'gl_account_code',
      'bankstatementbalance': 'bank_statement_balance', 'statementbalance': 'bank_statement_balance',
      'glbalance': 'gl_balance',
      'adjustedbank': 'adjusted_bank_balance', 'adjustedbankbalance': 'adjusted_bank_balance',
      'adjustedgl': 'adjusted_gl_balance', 'adjustedglbalance': 'adjusted_gl_balance',
      'accountcode': 'account_code', 'accountname': 'account_name', 'accounttype': 'account_type',
      'normalbalance': 'normal_balance',
      'ifrs': 'ifrs_classification', 'ifrsclassification': 'ifrs_classification',
      'statementtype': 'statement_type', 'trialbalance': 'trial_balance',
      'totalassets': 'total_assets', 'totalliabilities': 'total_liabilities', 'totalequity': 'total_equity',
      'closingdr': 'total_closing_dr', 'totalclosingdr': 'total_closing_dr',
      'closingcr': 'total_closing_cr', 'totalclosingcr': 'total_closing_cr',
      'outputvat': 'output_vat', 'inputvat': 'input_vat', 'netpayable': 'net_payable',
      'taxableincome': 'taxable_income', 'taxrate': ['tax_rate', 'tax_rate_used'], 'taxpayable': 'tax_payable',
      'smallbusinessrelief': 'small_business_relief',
      'recoverability': 'recoverability_assessment', 'recoverabilityassessment': 'recoverability_assessment',
      'relatedparty': 'related_party', 'transactiontype': 'transaction_type', 'transactionamount': 'transaction_amount',
      'armlengthmethod': 'arm_length_method', 'documented': 'documented',
      'freezoneauthority': 'free_zone_authority', 'qualifyingincome': 'qualifying_income', 'nonqualifyingincome': 'non_qualifying_income',
      'substancetest': 'substance_test_passed', 'substancetestpassed': 'substance_test_passed',
      'nexus': 'nexus_maintained', 'nexusmaintained': 'nexus_maintained',
      'ruleid': 'rule_identifier', 'ruleidentifier': 'rule_identifier', 'jurisdiction': 'rule_jurisdiction',
      'ruletype': 'rule_source_type', 'rulesourcetype': 'rule_source_type', 'authority': 'rule_authority',
      'effectivefrom': 'rule_effective_from', 'asof': 'as_of_date', 'asofdate': 'as_of_date',
      'lastverified': 'last_verified',
    };

    this.headers.forEach((h) => {
      const n = norm(h);
      if (!n) { this.mapping[h] = null; return; }
      if (keyByNorm[n]) { this.mapping[h] = keyByNorm[n]; return; }
      // Synonyms — only take if the target key is a real field
      const candidates = Array.isArray(synonyms[n]) ? synonyms[n] : [synonyms[n]];
      const target = candidates.find((candidate) => candidate && def.fields.some((f) => f.key === candidate));
      if (target) {
        this.mapping[h] = target; return;
      }
      // Fuzzy contains
      const fuzzy = def.fields.find((f) => n.includes(norm(f.key)) || norm(f.key).includes(n));
      this.mapping[h] = fuzzy ? fuzzy.key : null;
    });
  }

  _renderPreview() {
    this.previewEl.empty();
    if (!this.headers.length) {
      this.previewEl.createDiv({ cls: 'cad-empty', text: 'Paste or pick a CSV to preview…' });
      if (this.importBtn) { this.importBtn.disabled = true; this.importBtn.classList.add('cad-btn-disabled'); }
      return;
    }

    const def = ENTITIES[this.entityKey];

    /* Mapping table */
    const head = this.previewEl.createDiv({ cls: 'cad-create-label' });
    head.style.marginTop = '14px';
    head.setText('COLUMN MAPPING');

    const tableWrap = this.previewEl.createDiv({ cls: 'cad-import-table-wrap' });
    const table = tableWrap.createEl('table', { cls: 'cad-import-table' });
    const thr = table.createEl('thead').createEl('tr');
    thr.createEl('th', { text: 'CSV column' });
    thr.createEl('th', { text: 'Maps to' });
    thr.createEl('th', { text: 'Sample' });
    const tbody = table.createEl('tbody');

    this.headers.forEach((h, i) => {
      const tr = tbody.createEl('tr');
      tr.createEl('td', { text: h });
      const mc = tr.createEl('td');
      const sel = mc.createEl('select', { cls: 'cad-create-input cad-import-select' });
      sel.createEl('option', { value: '', text: '— skip —' });
      def.fields.forEach((f) => {
        const o = sel.createEl('option', { value: f.key, text: f.label });
        if (this.mapping[h] === f.key) o.selected = true;
      });
      sel.addEventListener('change', () => {
        this.mapping[h] = sel.value || null;
        this._renderPreview(); // re-render to update warning state
      });
      const sample = tr.createEl('td');
      const samples = this.rows.slice(0, 2).map((r) => String(r[i] || '').trim()).filter(Boolean);
      sample.setText(samples.join(' · ').slice(0, 60));
      sample.title = samples.join('\n');
    });

    /* Summary */
    const summary = this.previewEl.createDiv({ cls: 'cad-import-summary' });
    // Required = explicit primary + any field with required: true
    const primary = primaryField(def);
    const requiredFields = def.fields.filter((f) => f.key === primary?.key || f.required === true);
    const mappedKeys = new Set(Object.values(this.mapping).filter(Boolean));
    const missing = requiredFields.filter(f => !mappedKeys.has(f.key));
    if (missing.length) {
      summary.addClass('cad-import-summary-warn');
      summary.setText(`Missing required column${missing.length === 1 ? '' : 's'}: ${missing.map(f => `"${f.label}"`).join(', ')}. Map ${missing.length === 1 ? 'it' : 'them'} above to enable import.`);
      if (this.importBtn) {
        this.importBtn.disabled = true;
        this.importBtn.classList.add('cad-btn-disabled');
      }
    } else {
      const mappedCount = mappedKeys.size;
      summary.setText(`Will create ${this.rows.length} ${this.rows.length === 1 ? def.label.toLowerCase() : def.plural.toLowerCase()} in ${entityFolder(this.entityKey)}/  ·  ${mappedCount} column${mappedCount === 1 ? '' : 's'} mapped`);
      if (this.importBtn) {
        this.importBtn.disabled = false;
        this.importBtn.classList.remove('cad-btn-disabled');
      }
    }
  }

  async _submitImport() {
    const def = ENTITIES[this.entityKey];
    const primaryKey = primaryFieldKey(def);
    if (!primaryKey) return;
    const primaryHeader = Object.entries(this.mapping).find(([_, v]) => v === primaryKey);
    if (!primaryHeader) return;
    const primaryColIdx = this.headers.indexOf(primaryHeader[0]);

    this.importBtn.disabled = true;
    this.importBtn.setText('Importing…');
    const start = Date.now();
    let created = 0;
    let failed = 0;

    for (const row of this.rows) {
      const primaryValue = String(row[primaryColIdx] || '').trim();
      if (!primaryValue) { failed++; continue; }
      try {
        const contextValues = {};
        Object.entries(this.mapping).forEach(([header, key]) => {
          if (!key) return;
          const idx = this.headers.indexOf(header);
          const val = String(row[idx] || '').trim();
          if (val) contextValues[key] = val;
        });
        const file = await createEntity(this.app, this.entityKey, primaryValue, { values: contextValues });
        const extras = {};
        Object.entries(this.mapping).forEach(([header, key]) => {
          if (!key || key === primaryKey) return;
          const idx = this.headers.indexOf(header);
          let val = String(row[idx] || '').trim();
          if (!val) return;
          const fdef = def.fields.find((f) => f.key === key);
          if (fdef) {
            if (fdef.type === 'number' || fdef.type === 'currency') {
              const cleaned = val.replace(/[^\d.\-]/g, '');
              const n = Number(cleaned);
              if (isNaN(n)) return;
              val = n;
            } else if (fdef.type === 'tags') {
              val = val.split(/[,;]/).map((s) => s.trim()).filter(Boolean);
              if (!val.length) return;
            } else if (fdef.type === 'date') {
              // Try to normalise to YYYY-MM-DD
              const d = new Date(val);
              if (!isNaN(d.getTime())) val = d.toISOString().slice(0, 10);
            }
          }
          extras[key] = val;
        });
        if (Object.keys(extras).length) {
          await this.app.fileManager.processFrontMatter(file, (fm) => {
            Object.entries(extras).forEach(([k, v]) => {
              if (v == null || v === '') return;
              if (Array.isArray(v) && v.length === 0) return;
              fm[k] = v;
            });
          });
        }
        created++;
      } catch (e) {
        failed++;
      }
    }

    const elapsed = ((Date.now() - start) / 1000).toFixed(1);
    new obsidian.Notice(`Imported ${created} ${def.plural.toLowerCase()} in ${elapsed}s${failed ? ` · ${failed} skipped` : ''}`, 5000);
    this.close();
    this.onSubmit({ created, failed, entityKey: this.entityKey });
  }

  onClose() { this.contentEl.empty(); }
}

/* ─────────── Entity create modal (rich, all fields up-front) ─────────── */
class CadenceEntityCreateModal extends obsidian.Modal {
  constructor(app, entityKey, opts) {
    super(app);
    this.entityKey = entityKey;
    this.def = ENTITIES[entityKey];
    this.onSubmit = opts.onSubmit;
    this._submitted = false;
  }

  onOpen() {
    const { contentEl, modalEl } = this;
    contentEl.empty();
    contentEl.addClass('cad-create-modal');
    if (modalEl) modalEl.addClass('cad-create-modal-shell');

    contentEl.createEl('h3', { cls: 'cad-create-title', text: `New ${this.def.label}` });

    const form = contentEl.createDiv({ cls: 'cad-create-form' });
    const inputs = [];

    const requiredInputs = [];

    const primaryKey = primaryFieldKey(this.def);
    this.def.fields.forEach((f) => {
      const isPrimary = f.key === primaryKey;
      const isRequired = isPrimary || f.required === true;
      const row = form.createDiv({ cls: 'cad-create-row' });
      const label = row.createDiv({ cls: 'cad-create-label' });
      label.setText(f.label.toUpperCase() + (isRequired ? ' *' : ''));

      let input;
      const fieldType = f.type || 'text';

      if (fieldType === 'enum') {
        input = row.createEl('select', { cls: 'cad-create-input' });
        input.createEl('option', { value: '', text: '— —' });
        (f.options || []).forEach((opt) => input.createEl('option', { value: opt, text: opt }));
      } else if (fieldType === 'date') {
        input = row.createEl('input', { type: 'date', cls: 'cad-create-input' });
        input.lang = navigator.language || '';
      } else if (fieldType === 'number' || fieldType === 'currency') {
        input = row.createEl('input', { type: 'number', cls: 'cad-create-input' });
        input.placeholder = '0';
      } else if (fieldType === 'email') {
        input = row.createEl('input', { type: 'email', cls: 'cad-create-input' });
        input.placeholder = 'name@example.com';
      } else if (fieldType === 'tags') {
        input = row.createEl('input', { type: 'text', cls: 'cad-create-input' });
        input.placeholder = 'tag1, tag2';
      } else {
        input = row.createEl('input', { type: 'text', cls: 'cad-create-input' });
        input.placeholder = this._placeholderFor(f, isPrimary);
      }
      const defaultValue = resolveEntityFieldDefault(f);
      if (!isPrimary && defaultValue !== undefined) {
        input.value = Array.isArray(defaultValue) ? defaultValue.join(', ') : String(defaultValue);
      }
      input.dataset.fieldKey = f.key;
      input.dataset.fieldType = fieldType;
      if (isRequired) {
        input.required = true;
        requiredInputs.push(input);
      }
      inputs.push(input);
    });

    /* Action row */
    const actions = contentEl.createDiv({ cls: 'cad-create-actions' });
    const cancel = actions.createEl('button', { cls: 'cad-btn', text: 'Cancel' });
    cancel.type = 'button';
    cancel.addEventListener('click', () => this.close());

    const submitBtn = actions.createEl('button', { cls: 'cad-btn primary', text: `Create ${this.def.label}` });
    submitBtn.type = 'button';
    attachRequiredValidation(submitBtn, requiredInputs);

    const submit = () => {
      const values = {};
      let primaryValue = null;
      inputs.forEach((el, idx) => {
        const key = el.dataset.fieldKey;
        const type = el.dataset.fieldType;
        let raw = el.value;
        if (key === primaryKey) primaryValue = (raw || '').trim();
        if (raw === '' || raw == null) return;
        if (type === 'tags') raw = raw.split(',').map((t) => t.trim()).filter(Boolean);
        else if (type === 'number' || type === 'currency') {
          const n = Number(raw);
          raw = isNaN(n) ? null : n;
        }
        if (raw == null) return;
        if (Array.isArray(raw) && raw.length === 0) return;
        values[key] = raw;
      });
      if (!primaryValue) {
        const primaryInput = inputs.find((input) => input.dataset.fieldKey === primaryKey);
        if (primaryInput) primaryInput.focus();
        return;
      }
      this._submitted = true;
      this.close();
      this.onSubmit({ name: primaryValue, values });
    };
    submitBtn.addEventListener('click', submit);

    // Submit on Enter from any text input
    inputs.forEach((el) => {
      el.addEventListener('keydown', (e) => {
        if (e.key === 'Enter' && el.tagName === 'INPUT') { e.preventDefault(); submit(); }
        if (e.key === 'Escape') this.close();
      });
    });

    setTimeout(() => { if (inputs[0]) { inputs[0].focus(); } }, 0);
  }

  _placeholderFor(field, isPrimary) {
    if (!isPrimary) return '';
    const ek = this.entityKey;
    const examples = {
      contact:      'e.g. Jane Smith',
      company:      'e.g. Acme Corp',
      partner:      'e.g. Acme Distribution',
      deal:         'e.g. Acme — FTTH expansion',
      registration: 'e.g. Vodacom 12-site FTTB',
      commission:   'e.g. C-2026-Q2-0042',
      lead:         'e.g. Sarah from Vodacom',
      certification:'e.g. Cisco CCNP — May 2026',
      activity:     'e.g. Discovery call with Jane',
      sequence:     'e.g. Outbound — SMB',
      project:      'e.g. Q3 Cadence launch',
    };
    return examples[ek] || '';
  }

  onClose() {
    if (!this._submitted && this.onSubmit) this.onSubmit(null);
    this.contentEl.empty();
  }
}

/* ─────────── Prompt modal (replaces blocked window.prompt) ─────────── */
class CadencePromptModal extends obsidian.Modal {
  constructor(app, opts) {
    super(app);
    this.title = opts.title || 'Enter a name';
    this.placeholder = opts.placeholder || '';
    this.defaultValue = opts.defaultValue || '';
    this.cta = opts.cta || 'Create';
    this.onSubmit = opts.onSubmit;
    this._submitted = false;
  }
  onOpen() {
    const { contentEl } = this;
    contentEl.empty();
    contentEl.addClass('cad-prompt-modal');
    contentEl.createEl('h3', { text: this.title });

    const input = contentEl.createEl('input', { type: 'text' });
    input.placeholder = this.placeholder;
    input.value = this.defaultValue;
    input.style.width = '100%';
    input.style.padding = '8px 10px';
    input.style.fontSize = '14px';
    input.style.marginTop = '4px';

    const submit = () => {
      const v = input.value.trim();
      if (!v) { input.focus(); return; }
      this._submitted = true;
      this.close();
      this.onSubmit(v);
    };

    input.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') { e.preventDefault(); submit(); }
      if (e.key === 'Escape') { e.preventDefault(); this.close(); }
    });

    const row = contentEl.createDiv();
    row.style.display = 'flex';
    row.style.justifyContent = 'flex-end';
    row.style.gap = '8px';
    row.style.marginTop = '14px';
    const cancel = row.createEl('button', { text: 'Cancel' });
    cancel.addEventListener('click', () => this.close());
    const ok = row.createEl('button', { text: this.cta, cls: 'mod-cta' });
    ok.addEventListener('click', submit);

    setTimeout(() => { input.focus(); input.select(); }, 0);
  }
  onClose() {
    if (!this._submitted && this.onSubmit) this.onSubmit(null);
    this.contentEl.empty();
  }
}

/* ─────────── Obsidian icon picker ─────────── */
class CadenceIconPickerModal extends obsidian.SuggestModal {
  constructor(app, currentIcon, onChoose) {
    super(app);
    this.currentIcon = currentIcon || '';
    this.onChoose = onChoose;
    this.iconIds = typeof obsidian.getIconIds === 'function'
      ? obsidian.getIconIds().slice().sort()
      : [];
    this.setPlaceholder('Search Obsidian icons by name...');
  }

  getSuggestions(query) {
    const q = String(query || '').trim().toLowerCase();
    const matches = this.iconIds
      .filter((iconId) => !q || iconId.toLowerCase().includes(q))
      .sort((a, b) => {
        const aStarts = q && a.toLowerCase().startsWith(q) ? 0 : 1;
        const bStarts = q && b.toLowerCase().startsWith(q) ? 0 : 1;
        return aStarts - bStarts || a.localeCompare(b);
      })
      .slice(0, 150)
      .map((iconId) => ({ iconId }));
    if (!q || 'none'.includes(q) || 'clear'.includes(q) || 'remove'.includes(q)) {
      matches.unshift({ iconId: '', clear: true });
    }
    return matches;
  }

  renderSuggestion(item, el) {
    el.addClass('cad-icon-picker-result');
    const preview = el.createSpan({ cls: 'cad-icon-picker-preview' });
    try { obsidian.setIcon(preview, item.clear ? 'circle-x' : item.iconId); } catch (_) {}
    el.createSpan({ cls: 'cad-icon-picker-name', text: item.clear ? 'No icon' : item.iconId });
    if (!item.clear && item.iconId === this.currentIcon) {
      el.createSpan({ cls: 'cad-icon-picker-current', text: 'current' });
    }
  }

  onChooseSuggestion(item) {
    if (this.onChoose) this.onChoose(item.iconId || '');
  }
}

/* ─────────── The unified Cadence app view ─────────── */
class CadenceAppView extends obsidian.ItemView {
  constructor(leaf, plugin) {
    super(leaf);
    this.plugin = plugin;
    // Migrate legacy mode IDs from older versions
    const raw = plugin.settings.defaultTab || 'planner.today';
    this.mode = this._migrateModeId(raw);
    // Today state
    this.todayFile = null;
    this.todayParsed = null;
    this._journalSaveTimer = null;
    // Planner state
    this.plannerAnchor = startOfDay(new Date());
    // Detail-view state — when set, renders the entity form instead of the surface
    this.detailFile = null;
    this.detailEntityKey = null;
    // Mobile nav drawer state (ephemeral, not persisted)
    this.mobileNavOpen = false;
  }

  _toggleMobileNav(force) {
    const root = this.containerEl.children[1];
    this.mobileNavOpen = (typeof force === 'boolean') ? force : !this.mobileNavOpen;
    if (root) root.toggleClass('cad-mobile-nav-open', this.mobileNavOpen);
  }

  async openEntityDetail(entityKey, file) {
    if (!file || !entityKey) return;
    this.detailEntityKey = entityKey;
    this.detailFile = file;
    await this.render();
  }

  async openEntityDetailFromFile(file) {
    const key = entityKeyFromFile(this.app, file);
    if (!key) {
      // Not a Cadence entity — fall back to opening the markdown
      this.app.workspace.openLinkText(file.path, '', false);
      return;
    }
    return this.openEntityDetail(key, file);
  }

  async closeEntityDetail() {
    this.detailFile = null;
    this.detailEntityKey = null;
    await this.render();
  }

  _migrateModeId(id) {
    if (id === 'today')   return 'planner.today';
    if (id === 'planner') return 'planner.calendar';
    if (id === 'srm.suppliers') return 'procurement.suppliers';
    if (id === 'finance.supplier-invoices') return 'procurement.supplier-invoices';
    return SURFACE_BY_ID[id] ? id : (SURFACE_BY_ID.home ? 'home' : (ALL_SURFACES[0]?.id || 'home'));
  }

  /* Toggle Cadence-app dark mode. Scoped to `.cadence-app` only —
     does not affect Obsidian's overall light/dark mode. Persisted in settings. */
  async _toggleCadenceDark() {
    this.plugin.settings.cadenceAppDark = !this.plugin.settings.cadenceAppDark;
    await this.plugin.saveSettings();
    this.render();
  }

  _visibleNavGroups() {
    const mods = this.plugin.settings.modules || { crm: true, prm: true, srm: true, finance: true, procurement: true, tax: true, planner: true };
    const disabled = new Set(this.plugin.settings.disabledSurfaces || []);
    const showSecondary = !!this.plugin.settings.showSecondaryNav;
    const showSetup = !!this.plugin.settings.showSetupNav;
    return NAV_GROUPS
      .map((g) => {
        if (g.module && mods[g.module] === false) return null;
        const items = g.items.filter((it) => {
          if (it.module && mods[it.module] === false) return false;
          if (disabled.has(it.id)) return false;
          if (it.placement === 'navigation') return true;
          if (WORKSPACE_HAS_NAVIGATION && isTabBackedSurface(it)) return false;
          if (it.navLevel === 'secondary' && !showSecondary) return false;
          if (it.navLevel === 'setup' && !showSetup) return false;
          return true;
        });
        if (!items.length) return null;
        return Object.assign({}, g, { items });
      })
      .filter(Boolean);
  }

  /* Link a daily-note task to a project. Keyed by (dailyPath, taskText). */
  _taskLinkKey(dailyPath, text) { return `${dailyPath}::${(text || '').trim()}`; }

  _getTaskProjectLink(dailyPath, text) {
    const map = (this.plugin.settings && this.plugin.settings.taskProjectLinks) || {};
    return map[this._taskLinkKey(dailyPath, text)] || null;
  }

  async _setTaskProjectLink(dailyPath, text, projectPath) {
    if (!this.plugin.settings.taskProjectLinks) this.plugin.settings.taskProjectLinks = {};
    const key = this._taskLinkKey(dailyPath, text);
    if (projectPath) {
      this.plugin.settings.taskProjectLinks[key] = projectPath;
    } else {
      delete this.plugin.settings.taskProjectLinks[key];
    }
    await this.plugin.saveSettings();
    this.render();
  }

  _openTaskProjectPicker(dailyPath, text, currentLink) {
    const projectFiles = listEntityFiles(this.app, 'project');
    if (!projectFiles.length) {
      new obsidian.Notice('No projects yet. Create one in Planner → Projects first.');
      return;
    }
    const view = this;
    const projects = projectFiles.map((f) => ({
      file: f,
      name: projectNameFromPath(this.app, f.path),
    }));

    const picker = new (class extends obsidian.SuggestModal {
      constructor(app, projs, hasLink) {
        super(app);
        this.projs = projs;
        this.hasLink = hasLink;
        this.setPlaceholder(hasLink ? 'Pick a project (or type "unlink" to remove)' : 'Pick a project to link this task to');
      }
      getSuggestions(query) {
        const q = (query || '').toLowerCase();
        const matches = this.projs.filter((p) => p.name.toLowerCase().includes(q));
        if (this.hasLink && (q === '' || 'unlink'.includes(q))) {
          return [{ unlink: true, name: '— Remove link —' }, ...matches];
        }
        return matches;
      }
      renderSuggestion(item, el) {
        if (item.unlink) {
          el.setText(item.name);
          el.style.color = 'var(--text-error, #c0392b)';
        } else {
          el.setText('📁  ' + item.name);
        }
      }
      onChooseSuggestion(item) {
        if (item.unlink) view._setTaskProjectLink(dailyPath, text, null);
        else view._setTaskProjectLink(dailyPath, text, item.file.path);
      }
    })(this.app, projects, !!currentLink);
    picker.open();
  }

  _inboxOverdueCount() {
    const reminders = (this.plugin.settings.reminders || []).filter((r) => !r.done);
    const now = Date.now();
    return reminders.filter((r) => r.when && new Date(r.when).getTime() <= now).length;
  }

  getViewType()    { return VIEW_TYPE_CADENCE_APP; }
  getDisplayText() { return 'BOB Workspace Cadence'; }
  getIcon()        { return 'sparkles'; }

  async setMode(m) {
    this.mode = this._migrateModeId(m);
    if (this.mode === 'client-work.overview') {
      const state = this._secondaryTabState || (this._secondaryTabState = {});
      state['client-work.overview'] = 'client-work.dashboard';
    }
    // Switching surfaces clears any open detail form
    this.detailFile = null;
    this.detailEntityKey = null;
    await this.render();
  }

  async toggleGroup(groupId) {
    const collapsed = this.plugin.settings.collapsedGroups || {};
    collapsed[groupId] = !collapsed[groupId];
    this.plugin.settings.collapsedGroups = collapsed;
    await this.plugin.saveSettings();
    await this.render();
  }

  async onOpen() {
    this.containerEl.children[1].empty();
    await this.render();

    this.registerEvent(this.app.vault.on('modify', (file) => {
      // Skip refresh while the user is editing this exact file in detail view —
      // re-rendering would steal focus from inputs they're still typing in.
      if (this.detailFile && file && file.path === this.detailFile.path) return;
      if (this.mode === 'planner.today' && this.todayFile && file.path === this.todayFile.path) {
        return this.render();
      }
      if (this.mode === 'planner.calendar') {
        const days = weekDates(this.plannerAnchor, this.plugin.settings.weekStartsOn);
        const paths = days.map((d) => dailyNotePath(this.plugin.settings, d));
        if (paths.includes(file.path)) return this.render();
      }
      if (this._modeUsesEntityFolder(file.path)) return this.render();
    }));

    const entityRefresh = (file) => {
      if (this.detailFile && file && file.path === this.detailFile.path) return;
      if (this._modeUsesEntityFolder(file && file.path)) this.render();
    };
    this.registerEvent(this.app.vault.on('create', entityRefresh));
    this.registerEvent(this.app.vault.on('delete', entityRefresh));
    this.registerEvent(this.app.vault.on('rename', (file, oldPath) => {
      if (this.detailFile && file && file.path === this.detailFile.path) return;
      if (this._modeUsesEntityFolder(file && file.path) || this._modeUsesEntityFolder(oldPath)) this.render();
    }));
    this.registerEvent(this.app.metadataCache.on('changed', (file) => {
      if (this.detailFile && file && file.path === this.detailFile.path) return;
      if (this._modeUsesEntityFolder(file && file.path)) this.render();
    }));
  }

  _modeUsesEntityFolder(path) {
    if (!path) return false;
    // Entity surfaces can now show secondary tabs backed by folders outside
    // the old Cadence/* tree, so refresh if the touched path belongs to any
    // configured entity folder.
    return Object.keys(ENTITIES).some((key) => {
      const folder = entityFolder(key);
      return folder && (path === folder || path.startsWith(folder + '/'));
    });
  }

  async render() {
    const root = this.containerEl.children[1];
    root.empty();
    root.addClass('cadence-app');
    root.toggleClass('cad-dark', !!this.plugin.settings.cadenceAppDark);

    if (!SURFACE_BY_ID[this.mode]) this.mode = this._migrateModeId(this.mode);
    const active = SURFACE_BY_ID[this.mode] || SURFACE_BY_ID.home || ALL_SURFACES[0] || {
      id: 'home', label: 'Workspace', icon: 'layout-dashboard', desc: 'No configured surfaces.',
    };
    const activeParentId = active?.parent || null;

    /* ── Top brand bar ──────────────────────── */
    const topbar = root.createDiv({ cls: 'cad-app-topbar' });

    /* Hamburger — visible only on mobile via CSS, toggles the nav drawer */
    const burger = topbar.createEl('button', { cls: 'cad-mobile-burger' });
    try { obsidian.setIcon(burger, 'menu'); } catch (_) {}
    burger.title = 'Show nav';
    burger.addEventListener('click', () => this._toggleMobileNav());

    const brand = topbar.createDiv({ cls: 'cad-app-brand' });
    brand.createSpan({ cls: 'cad-app-brand-mark', text: '◐' });
    brand.createSpan({ cls: 'cad-app-brand-text', text: 'BOB Workspace Cadence' });

    const topRight = topbar.createDiv({ cls: 'cad-app-topbar-right' });

    /* Cadence-app dark mode toggle (scoped — does NOT touch Obsidian's mode) */
    const dark = !!this.plugin.settings.cadenceAppDark;
    const themeBtn = topRight.createEl('button', { cls: 'cad-topbar-icon-btn' });
    try { obsidian.setIcon(themeBtn, dark ? 'sun' : 'moon'); } catch (_) {}
    themeBtn.title = dark ? 'BOB Workspace: switch to light' : 'BOB Workspace: switch to dark';
    themeBtn.addEventListener('click', () => this._toggleCadenceDark());

    const eyebrow = topRight.createDiv({ cls: 'cad-app-topbar-meta' });
    eyebrow.setText(active.label.toUpperCase());

    /* ── Body: left grouped nav + main content ──────── */
    const body = root.createDiv({ cls: 'cad-app-body' });

    /* Backdrop — only visible on mobile when drawer is open; tapping dismisses. */
    const backdrop = body.createDiv({ cls: 'cad-mobile-backdrop' });
    backdrop.addEventListener('click', () => this._toggleMobileNav(false));

    const nav = body.createDiv({ cls: 'cad-app-nav' });
    const collapsed = this.plugin.settings.collapsedGroups || {};

    const visibleGroups = this._visibleNavGroups();
    visibleGroups.forEach((group) => {
      const groupEl = nav.createDiv({ cls: 'cad-nav-group' });
      const isCollapsed = !!collapsed[group.id];

      if (group.label) {
        const head = groupEl.createDiv({ cls: 'cad-nav-group-head' });
        const chev = head.createSpan({ cls: 'cad-nav-group-chev' });
        try { obsidian.setIcon(chev, isCollapsed ? 'chevron-right' : 'chevron-down'); } catch (_) {}
        if (group.icon) {
          const groupIcon = head.createSpan({ cls: 'cad-nav-group-icon' });
          try { obsidian.setIcon(groupIcon, group.icon); } catch (_) {}
        }
        head.createSpan({ cls: 'cad-nav-group-label', text: group.label.toUpperCase() });
        head.addEventListener('click', () => this.toggleGroup(group.id));
      }

      if (!isCollapsed || !group.label) {
        const list = groupEl.createDiv({ cls: 'cad-nav-group-items' });
        group.items.forEach((s) => {
          const isActive = this.mode === s.id;
          const isActiveParent = activeParentId === s.id;
          const item = list.createDiv({
            cls: 'cad-app-nav-item' + (isActive ? ' active' : '') + (isActiveParent ? ' active-parent' : ''),
          });
          if (isActive) item.setAttribute('aria-current', 'page');
          const ic = item.createSpan({ cls: 'cad-app-nav-icon' });
          try { obsidian.setIcon(ic, s.icon); } catch (_) {}
          item.createSpan({ cls: 'cad-app-nav-label', text: s.label });
          if (!BUILT_SURFACES.has(s.id) && !s.entityKey) {
            item.createSpan({ cls: 'cad-app-nav-badge', text: 'soon' });
          }
          // Inbox: badge with overdue count
          if (s.id === 'planner.inbox') {
            const overdue = this._inboxOverdueCount();
            if (overdue > 0) item.createSpan({ cls: 'cad-app-nav-badge cad-nav-badge-alert', text: String(overdue) });
          }
          item.addEventListener('click', () => {
            this.setMode(s.id);
            // On mobile, picking a nav item closes the drawer.
            if (this.mobileNavOpen) this._toggleMobileNav(false);
          });
        });
      }
    });

    const content = body.createDiv({ cls: 'cad-app-content' });

    // Detail view trumps the normal surface routing
    if (this.detailFile && this.detailEntityKey) {
      await this.renderEntityDetail(content, this.detailEntityKey, this.detailFile);
      return;
    }

	    const route = {
	      'home':                () => this.renderHome(content),
	      'planner.inbox':       () => this.renderInbox(content),
	      'planner.today':       () => this.renderTodayPane(content),
	      'planner.calendar':    () => this.renderPlannerPane(content),
	      'planner.projects':    () => this.renderProjectsView(content),
	      'crm.dashboard':       () => this.renderDashboard(content),
	      'crm.pipeline':        () => this.renderEntityKanban(content, 'deal', dealStageField(ENTITIES.deal), getDealStages(ENTITIES.deal)),
	      'crm.contacts':        () => this.renderEntityList(content, 'contact'),
	      'crm.clients':         () => this.renderEntityList(content, 'client'),
	      'crm.companies':       () => this.renderEntityList(content, 'company'),
	      'crm.activities':      () => this.renderEntityList(content, 'activity'),
	      'prm.partners':        () => this.renderEntityTabs(content, 'prm.partners', 'prm.partners.overview'),
	      'prm.registrations':   () => this.renderEntityList(content, 'registration'),
	      'prm.commissions':     () => this.renderEntityList(content, 'commission'),
	      'crm.leads':           () => this.renderEntityList(content, 'lead'),
	      'crm.campaigns':       () => this.renderEntityTabs(content, 'crm.campaigns', 'crm.campaigns.overview'),
	      'crm.sequences':       () => this.renderEntityList(content, 'sequence'),
	      'prm.certifications':  () => this.renderEntityList(content, 'certification'),
	      'prm.analytics':       () => this.renderPRMAnalytics(content),
	      'reports.pipeline':    () => this.renderReportPipeline(content),
	      'reports.sales':       () => this.renderReportSales(content),
	      'reports.partners':    () => this.renderReportPartners(content),
	      'reports.activity':    () => this.renderReportActivity(content),
	      'reports.productivity':() => this.renderProductivity(content),
	      'team':                () => this.renderTeam(content),
	      'settings':            () => this.openSettingsTab(content),
	      'ai.playbooks':        () => this.renderEntityList(content, 'playbook'),
	      'ai.skills':           () => this.renderEntityList(content, 'skill'),
	      'finance.invoices':    () => this.renderEntityTabs(content, 'finance.invoices', 'invoice'),
	      'finance.gl':          () => this.renderEntityTabs(content, 'finance.gl', 'finance.gl.overview'),
	      'finance.setup':       () => this.renderEntityTabs(content, 'finance.setup', 'finance.setup.overview'),
	      'client-work.overview': () => this.renderClientWorkWorkspace(content),
	      // Client Work: always render the internal table for these list pages so they don't go blank when
	      // the underlying Base view is non-table (calendar/board/etc). Users can still use "Open Base".
	      'client-work.meetings': () => this._renderClientWorkEntityList(content, 'meeting'),
	      'client-work.comms': () => this._renderClientWorkEntityList(content, 'comms-thread'),
	      'client-work.deliverables': () => this._renderClientWorkEntityList(content, 'deliverable'),
	      'client-work.feedback': () => this._renderClientWorkEntityList(content, 'feedback'),
	      'client-work.surveys': () => this._renderClientWorkEntityList(content, 'survey'),
	      'client-work.testimonials': () => this._renderClientWorkEntityList(content, 'testimonial'),
	      'client-work.decisions': () => this._renderClientWorkEntityList(content, 'decision'),
	      'procurement.suppliers': () => this.renderEntityTabs(content, 'procurement.suppliers', 'procurement.overview'),
	      'tax.overview':        () => this.renderEntityTabs(content, 'tax.overview', 'tax.dashboard'),
	    };
    if (route[this.mode]) {
      await route[this.mode]();
    } else if (SECONDARY_TABS[this.mode]?.length) {
      const firstTab = this._tabsForParent(this.mode)[0] || {};
      await this.renderEntityTabs(content, this.mode, firstTab.entityKey || firstTab.route);
    } else if (active && active.entityKey && ENTITIES[active.entityKey]) {
      await this.renderEntityList(content, active.entityKey);
    } else if (this.mode && this.mode.startsWith('custom.')) {
      const entityKey = this.mode.slice('custom.'.length);
      if (ENTITIES[entityKey]) await this.renderEntityList(content, entityKey);
      else this.renderComingSoon(content, active);
    } else {
      this.renderComingSoon(content, active);
    }
  }

  renderComingSoon(root, surface) {
    root.addClass('cadence-soon');
    const wrap = root.createDiv({ cls: 'cad-soon-wrap' });
    wrap.createDiv({ cls: 'cad-eyebrow', text: 'COMING SOON' });
    wrap.createDiv({ cls: 'cad-soon-title', text: surface.label });
    wrap.createDiv({ cls: 'cad-soon-desc', text: surface.desc });

    const ic = wrap.createDiv({ cls: 'cad-soon-icon' });
    try { obsidian.setIcon(ic, surface.icon); } catch (_) {}

    const meta = wrap.createDiv({ cls: 'cad-soon-meta' });
    meta.setText('This surface is scaffolded but not yet built. Tell the team to flesh it out next.');
  }

  /* ── Generic page header ────────────────── */
  _renderPageHeader(root, title, subtitle, actions) {
    const head = root.createDiv({ cls: 'cad-page-header' });
    const left = head.createDiv({ cls: 'cad-page-header-left' });
    left.createDiv({ cls: 'cad-eyebrow', text: 'CADENCE' });
    left.createDiv({ cls: 'cad-page-title', text: title });
    if (subtitle) left.createDiv({ cls: 'cad-page-subtitle', text: subtitle });
    const right = head.createDiv({ cls: 'cad-page-header-right' });
    if (typeof actions === 'function') actions(right);
    return head;
  }

  _renderEntityViewSelect(container, entityKey) {
    const basePath = entityBasePath(this.plugin.settings, entityKey);
    if (!basePath) return;

    const select = container.createEl('select', {
      cls: 'dropdown cad-page-view-select',
      attr: { 'aria-label': 'Base view' },
    });
    select.title = 'Base view';
    select.createEl('option', { value: '', text: 'Loading views...' });
    select.disabled = true;

    const currentView = entityBaseViewName(this.plugin.settings, entityKey);
    const baseFile = this.app.vault.getAbstractFileByPath(basePath);
    if (!(baseFile instanceof obsidian.TFile)) {
      select.empty();
      select.createEl('option', { value: '', text: 'Base not found' });
      return;
    }

    readBaseSummary(this.app, baseFile).then((summary) => {
      const views = summary?.views || [];
      if (!views.length) {
        select.remove();
        return;
      }
      select.empty();
      select.createEl('option', { value: '', text: 'All properties' });
      views.forEach((viewName) => {
        select.createEl('option', { value: viewName, text: viewName });
      });
      select.value = views.includes(currentView) ? currentView : '';
      select.disabled = false;
    });

    select.addEventListener('change', async () => {
      const viewName = select.value;
      if (!this.plugin.settings.baseViews) this.plugin.settings.baseViews = {};
      if (viewName) this.plugin.settings.baseViews[entityKey] = viewName;
      else delete this.plugin.settings.baseViews[entityKey];
      await this.plugin.saveSettings();
      await reloadEntityConfiguration(this.app, this.plugin.settings);
      this.plugin.refreshOpenViews();
    });
  }

  async _openEntityBase(entityKey) {
    const basePath = entityBasePath(this.plugin.settings, entityKey) || ENTITIES[entityKey]?.externalBaseView?.basePath;
    if (!basePath) return;
    const viewName = entityBaseViewName(this.plugin.settings, entityKey) || ENTITIES[entityKey]?.baseView?.name || '';
    const baseFile = this.app.vault.getAbstractFileByPath(basePath);
    if (!(baseFile instanceof obsidian.TFile)) {
      new obsidian.Notice(`BOB Workspace: Base not found: ${basePath}`);
      return;
    }
    const leaf = this.app.workspace.getLeaf('tab');
    await leaf.openFile(baseFile, viewName ? { eState: { subpath: `#${viewName}` } } : {});
    this.app.workspace.setActiveLeaf(leaf, { focus: true });
  }

  _renderExternalBaseView(root, entityKey) {
    const def = ENTITIES[entityKey];
    const external = def?.externalBaseView;
    if (!external) return false;
    const wrap = root.createDiv({ cls: 'cad-empty-state' });
    wrap.createDiv({ cls: 'cad-empty-state-title', text: external.name || 'External Base view' });
    wrap.createDiv({
      cls: 'cad-empty-state-desc',
      text: `This view uses ${external.type}, so BOB Workspace delegates rendering to Obsidian Bases/TaskNotes instead of duplicating that UI.`,
    });
    const btn = wrap.createEl('button', { cls: 'cad-btn primary', text: 'Open in Base' });
    btn.addEventListener('click', () => this._openEntityBase(entityKey));
    return true;
  }

  _renderUnsupportedBaseFilters(root, def) {
    const unsupported = def?.unsupportedBaseFilters || [];
    if (!unsupported.length) return;
    const details = root.createEl('details', { cls: 'cad-base-filter-warnings' });
    details.createEl('summary', { text: `${unsupported.length} Base filter${unsupported.length === 1 ? '' : 's'} not applied` });
    const list = details.createEl('ul');
    unsupported.forEach((filter) => {
      list.createEl('li').createEl('code', { text: filter });
    });
  }

  _groupEntitiesForView(entities, def) {
    const groupBy = def?.baseGroupBy;
    if (!groupBy?.property) return null;
    const groups = new Map();
    entities.forEach((entity) => {
      const raw = entityValue(entity, groupBy.property, def);
      const values = Array.isArray(raw) ? raw : [raw];
      const nonEmpty = values.map((v) => String(v ?? '').trim()).filter(Boolean);
      const keys = nonEmpty.length ? nonEmpty : ['(blank)'];
      keys.forEach((key) => {
        if (!groups.has(key)) groups.set(key, []);
        groups.get(key).push(entity);
      });
    });
    const sorted = Array.from(groups.entries()).sort(([a], [b]) =>
      a.localeCompare(b, undefined, { numeric: true, sensitivity: 'base' })
    );
    if (groupBy.direction === 'DESC') sorted.reverse();
    return sorted;
  }

  _renderEntityTable(root, entities, entityKey, cols) {
    const def = ENTITIES[entityKey];
    const selected = new Set(); // selected file paths

    const bulkBar = root.createDiv({ cls: 'cad-bulk-bar cad-bulk-bar-hidden' });
    const bulkCount = bulkBar.createSpan({ cls: 'cad-bulk-count' });
    const bulkDelete = bulkBar.createEl('button', { cls: 'cad-btn cad-btn-danger', text: 'Delete selected' });
    bulkDelete.addEventListener('click', async () => {
      // Resolve all files before any deletion so paths can't shift mid-loop
      const filesToDelete = [...selected]
        .map((path) => this.app.vault.getAbstractFileByPath(path))
        .filter(Boolean);
      if (!filesToDelete.length) return;
      const names = filesToDelete.map((f) => f.basename).join('\n• ');
      if (!confirm(`Move to trash:\n• ${names}\n\n${filesToDelete.length} ${filesToDelete.length === 1 ? def.label.toLowerCase() : def.plural.toLowerCase()} will be deleted.`)) return;
      for (const file of filesToDelete) {
        try { await this.app.vault.trash(file, true); } catch (e) { new obsidian.Notice(`Delete failed for ${file.basename}: ${e.message}`); }
      }
      await this.render();
    });

    const updateBulkBar = () => {
      if (selected.size > 0) {
        bulkBar.removeClass('cad-bulk-bar-hidden');
        bulkCount.setText(`${selected.size} selected`);
      } else {
        bulkBar.addClass('cad-bulk-bar-hidden');
      }
    };

    // filterState: fieldKey → Set of included values (missing = no filter)
    const filterState = new Map();
    const applyFilters = (arr) => {
      if (filterState.size === 0) return arr;
      return arr.filter((e) => {
        for (const [key, vals] of filterState) {
          if (!vals || vals.size === 0) continue;
          const v = String(entityValue(e, key, def) ?? '');
          if (!vals.has(v)) return false;
        }
        return true;
      });
    };

    const openFilterDropdown = (th, field, filterBtn) => {
      document.querySelector('.cad-filter-dropdown')?.remove();
      const current = filterState.get(field.key); // Set or undefined
      const dropdown = document.createElement('div');
      dropdown.className = 'cad-filter-dropdown';
      // Prevent clicks inside dropdown from bubbling to th (which would trigger sort)
      dropdown.addEventListener('click', (ev) => ev.stopPropagation());

      const hdr = document.createElement('div');
      hdr.className = 'cad-filter-header';
      hdr.textContent = field.label;
      const clearBtn = document.createElement('button');
      clearBtn.className = 'cad-filter-clear';
      clearBtn.textContent = 'Clear';
      clearBtn.addEventListener('click', () => {
        filterState.delete(field.key);
        filterBtn.classList.remove('cad-filter-btn-active');
        dropdown.remove();
        renderBody(applyFilters(sortEntities([...entities])));
      });
      hdr.appendChild(clearBtn);
      dropdown.appendChild(hdr);

      // Keep a live ref to current selection so checkboxes stay in sync
      let sel = current ? new Set(current) : null; // null = all
      field.options.forEach((opt) => {
        const label = document.createElement('label');
        label.className = 'cad-filter-option';
        const cb = document.createElement('input');
        cb.type = 'checkbox';
        cb.checked = !sel || sel.has(opt);
        cb.addEventListener('change', () => {
          if (!sel) sel = new Set(field.options); // expand from "all"
          if (cb.checked) sel.add(opt); else sel.delete(opt);
          const isAll = sel.size === field.options.length;
          if (isAll) { filterState.delete(field.key); sel = null; }
          else filterState.set(field.key, new Set(sel));
          filterBtn.classList.toggle('cad-filter-btn-active', filterState.has(field.key));
          renderBody(applyFilters(sortEntities([...entities])));
        });
        label.appendChild(cb);
        label.append(` ${opt}`);
        dropdown.appendChild(label);
      });

      const rect = th.getBoundingClientRect();
      dropdown.style.position = 'fixed';
      dropdown.style.top = rect.bottom + 'px';
      dropdown.style.left = rect.left + 'px';
      document.body.appendChild(dropdown);

      const close = (ev) => {
        if (!dropdown.contains(ev.target)) {
          dropdown.remove();
          document.removeEventListener('click', close);
        }
      };
      setTimeout(() => document.addEventListener('click', close), 0);
    };

    const tableWrap = root.createDiv({ cls: 'cad-table-wrap' });
    const table = tableWrap.createEl('table', { cls: 'cad-table' });

    const thead = table.createEl('thead');
    const trh = thead.createEl('tr');
    const sortState = this._tableSortState || (this._tableSortState = {});
    const stateKey = `${this.mode || ''}::${entityKey}`;
    const currentSort = sortState[stateKey] || { key: null, dir: 'ASC' };

    const normSortVal = (val, type) => {
      if (val == null) return null;
      if (Array.isArray(val)) val = val.join(', ');
      if (type === 'currency' || type === 'number') {
        const n = Number(val);
        return isNaN(n) ? null : n;
      }
      if (type === 'date') {
        const t = new Date(String(val).slice(0, 10)).getTime();
        return isNaN(t) ? null : t;
      }
      return String(val).toLowerCase();
    };

    const sortEntities = (arr) => {
      if (!currentSort.key) return arr;
      const field = cols.find((c) => c.key === currentSort.key);
      if (!field) return arr;
      const dirMul = currentSort.dir === 'DESC' ? -1 : 1;
      const withIdx = arr.map((e, i) => ({ e, i }));
      withIdx.sort((a, b) => {
        const av = normSortVal(entityValue(a.e, field.key, def), field.type);
        const bv = normSortVal(entityValue(b.e, field.key, def), field.type);
        if (av == null && bv == null) return a.i - b.i;
        if (av == null) return 1;
        if (bv == null) return -1;
        if (typeof av === 'number' && typeof bv === 'number') return (av - bv) * dirMul || (a.i - b.i);
        return String(av).localeCompare(String(bv), undefined, { numeric: true, sensitivity: 'base' }) * dirMul || (a.i - b.i);
      });
      return withIdx.map((x) => x.e);
    };

    let selectAllCb = null;
    let currentArr = [];
    const tbody = table.createEl('tbody');
    const renderBody = (arr) => {
      currentArr = arr;
      tbody.empty();
      selected.clear();
      updateBulkBar();
      if (selectAllCb) { selectAllCb.checked = false; selectAllCb.indeterminate = false; }
      arr.forEach((e) => {
        const tr = tbody.createEl('tr', { cls: 'cad-row' });
        tr.addEventListener('dblclick', () => {
          tr.querySelectorAll('td').forEach((cell) => {
            clearTimeout(cell._cadEditTimer);
            delete cell._cadEditTimer;
          });
          this.openEntityDetail(entityKey, e.file);
        });

        // Checkbox cell
        const tdCb = tr.createEl('td', { cls: 'cad-col-cb' });
        const cb = tdCb.createEl('input', { type: 'checkbox', cls: 'cad-row-cb' });
        cb.addEventListener('change', () => {
          if (cb.checked) selected.add(e.file.path); else selected.delete(e.file.path);
          tr.toggleClass('cad-row-selected', cb.checked);
          updateBulkBar();
          if (selectAllCb) {
            selectAllCb.indeterminate = selected.size > 0 && selected.size < arr.length;
            selectAllCb.checked = selected.size === arr.length;
          }
        });
        // Prevent checkbox click from triggering dblclick-to-detail
        tdCb.addEventListener('dblclick', (ev) => ev.stopPropagation());

        cols.forEach((f, i) => {
          const td = tr.createEl('td');
          const val = entityValue(e, f.key, def);
          const formatted = fmtValue(val, f.type);
          if (i === 0) {
            const a = td.createEl('a', { cls: 'cad-row-primary', text: formatted || e.basename });
            a.addEventListener('click', (ev) => {
              ev.preventDefault();
              this.openEntityDetail(entityKey, e.file);
            });
          } else {
            this._makeInlineEditable(td, e, f, def, formatted);
          }
        });
      });
    };

    const renderHeader = () => {
      trh.empty();
      // Select-all checkbox header
      const thCb = trh.createEl('th', { cls: 'cad-col-cb' });
      selectAllCb = thCb.createEl('input', { type: 'checkbox', cls: 'cad-row-cb' });
      selectAllCb.addEventListener('change', () => {
        if (selectAllCb.checked) currentArr.forEach((e) => selected.add(e.file.path));
        else selected.clear();
        tbody.querySelectorAll('tr').forEach((tr, idx) => {
          const cb = tr.querySelector('.cad-row-cb');
          if (cb) cb.checked = selectAllCb.checked;
          tr.toggleClass('cad-row-selected', selectAllCb.checked);
        });
        selectAllCb.indeterminate = false;
        updateBulkBar();
      });
      cols.forEach((f) => {
        const isActive = currentSort.key === f.key;
        const th = trh.createEl('th', {
          cls: 'cad-th-sortable' + (isActive ? ' cad-th-sorted' : ''),
        });
        const label = th.createSpan({ cls: 'cad-th-label' });
        label.createSpan({ text: f.label });
        const ind = label.createSpan({ cls: 'cad-th-indicator' });
        if (isActive) ind.setText(currentSort.dir === 'DESC' ? 'v' : '^');
        else ind.setText('');
        th.addEventListener('click', () => {
          if (currentSort.key === f.key) currentSort.dir = currentSort.dir === 'ASC' ? 'DESC' : 'ASC';
          else { currentSort.key = f.key; currentSort.dir = 'ASC'; }
          sortState[stateKey] = { key: currentSort.key, dir: currentSort.dir };
          renderHeader();
          renderBody(applyFilters(sortEntities([...entities])));
        });
        if (f.type === 'enum' && f.options?.length) {
          const isFiltered = filterState.has(f.key);
          const filterBtn = th.createEl('button', {
            cls: 'cad-filter-btn' + (isFiltered ? ' cad-filter-btn-active' : ''),
            text: '▾',
          });
          filterBtn.addEventListener('click', (ev) => {
            ev.stopPropagation();
            openFilterDropdown(th, f, filterBtn);
          });
        }
      });
    };
    renderHeader();

    renderBody(applyFilters(sortEntities([...entities])));
  }

  _makeInlineEditable(td, entity, field, def, initialFormatted) {
    td.addClass('cad-cell-editable');
    td.setText(initialFormatted || '');
    td._cadEditing = false;

    const refreshCell = () => {
      const cache = this.app.metadataCache.getFileCache(entity.file);
      const fm = cache?.frontmatter || {};
      const newVal = entityValue({ file: entity.file, frontmatter: fm, basename: entity.basename }, field.key, def);
      td.empty();
      td.removeClass('cad-cell-editing');
      td._cadEditing = false;
      td.setText(fmtValue(newVal, field.type) || '');
    };

    const saveField = async (raw) => {
      const fieldType = field.type || 'text';
      let value = raw;
      if (fieldType === 'tags') {
        value = (raw || '').split(',').map((t) => t.trim()).filter(Boolean);
      } else if (fieldType === 'number' || fieldType === 'currency') {
        const n = Number(raw);
        value = isNaN(n) ? null : n;
      } else if (raw === '' || raw == null) {
        value = null;
      }
      try {
        await this.app.fileManager.processFrontMatter(entity.file, (fm) => {
          if (value == null || (Array.isArray(value) && value.length === 0)) {
            delete fm[field.key];
          } else {
            fm[field.key] = value;
          }
        });
      } catch (err) {
        new obsidian.Notice(`Save failed: ${err.message}`);
      }
      refreshCell();
    };

    const activateEdit = () => {
      if (td._cadEditing) return;
      td._cadEditing = true;
      const cache = this.app.metadataCache.getFileCache(entity.file);
      const currentVal = entityValue(
        { file: entity.file, frontmatter: cache?.frontmatter || {}, basename: entity.basename },
        field.key, def
      );
      const fieldType = field.type || 'text';
      td.empty();
      td.addClass('cad-cell-editing');

      const cancel = () => {
        td.empty();
        td.removeClass('cad-cell-editing');
        td._cadEditing = false;
        td.setText(fmtValue(currentVal, field.type) || '');
      };

      if (fieldType === 'enum') {
        const sel = td.createEl('select', { cls: 'cad-cell-input' });
        sel.createEl('option', { value: '', text: '—' });
        (field.options || []).forEach((opt) => {
          const o = sel.createEl('option', { value: opt, text: opt });
          if (String(currentVal || '') === opt) o.selected = true;
        });
        let committed = false;
        sel.addEventListener('change', () => { committed = true; saveField(sel.value); });
        sel.addEventListener('blur', () => { if (!committed) { committed = true; cancel(); } });
        sel.addEventListener('keydown', (ev) => { if (ev.key === 'Escape') { committed = true; cancel(); } });
        sel.focus();
      } else if (fieldType === 'date') {
        const inp = td.createEl('input', { type: 'date', cls: 'cad-cell-input' });
        inp.lang = navigator.language || '';
        if (currentVal) {
          const d = new Date(String(currentVal).slice(0, 10));
          if (!isNaN(d.getTime())) inp.value = d.toISOString().slice(0, 10);
        }
        let committed = false;
        inp.addEventListener('change', () => { committed = true; saveField(inp.value); });
        inp.addEventListener('blur', () => { if (!committed) { committed = true; cancel(); } });
        inp.addEventListener('keydown', (ev) => {
          if (ev.key === 'Enter') { if (!committed) { committed = true; saveField(inp.value); } }
          if (ev.key === 'Escape') { committed = true; cancel(); }
        });
        inp.focus();
      } else {
        const inputType = fieldType === 'email' ? 'email' : (fieldType === 'number' || fieldType === 'currency') ? 'number' : 'text';
        const inp = td.createEl('input', { type: inputType, cls: 'cad-cell-input' });
        if (fieldType === 'tags' && Array.isArray(currentVal)) inp.value = currentVal.join(', ');
        else if (currentVal != null) inp.value = String(currentVal);
        let committed = false;
        inp.addEventListener('blur', () => { if (!committed) { committed = true; saveField(inp.value); } });
        inp.addEventListener('keydown', (ev) => {
          if (ev.key === 'Enter') { if (!committed) { committed = true; saveField(inp.value); } }
          if (ev.key === 'Escape') { committed = true; cancel(); }
        });
        inp.focus();
        inp.select();
      }
    };

    td.addEventListener('click', () => {
      if (td._cadEditing) return;
      clearTimeout(td._cadEditTimer);
      td._cadEditTimer = setTimeout(() => activateEdit(), 250);
    });
  }

  _tabsForParent(parentId) {
    const tabs = SECONDARY_TABS[parentId] || [];
    return tabs.flatMap((tab) => {
      if (!tab.children) return [tab];
      return tab.children.map((child) => Object.assign({}, child, { label: `${tab.label} · ${child.label}` }));
    }).filter((tab) => {
      const surface = ALL_SURFACES.find((item) => item.parent === parentId && surfaceMatchesTab(item, tab));
      return surface?.placement !== 'navigation';
    });
  }

  async renderEntityTabs(root, parentId, defaultEntityKey, opts = {}) {
    const tabs = this._tabsForParent(parentId);
    const state = this._secondaryTabState || (this._secondaryTabState = {});
    const current = state[parentId] || defaultEntityKey;
    const activeTab = tabs.find((tab) => tab.entityKey === current || tab.route === current) || tabs[0];
    const activeKey = activeTab?.entityKey || activeTab?.route || defaultEntityKey;
    state[parentId] = activeKey;

    const tabWrap = root.createDiv({ cls: 'cad-secondary-tabs' });
    tabs.forEach((tab) => {
      const key = tab.entityKey || tab.route;
      const btn = tabWrap.createEl('button', {
        cls: 'cad-secondary-tab' + (key === activeKey ? ' active' : ''),
        text: tab.label,
      });
      btn.addEventListener('click', async () => {
        state[parentId] = key;
        await this.render();
      });
    });

    if (activeTab?.route) return this._renderSecondaryRoute(root, activeTab.route, opts);
    return this.renderEntityList(root, activeTab?.entityKey || defaultEntityKey, opts);
  }

  async _renderSecondaryRoute(root, route, opts = {}) {
    if (route === 'client-work.dashboard') return this.renderClientWorkDashboard(root, opts);
    if (route === 'finance.gl.overview') return this.renderFinanceGLDashboard(root);
    if (route === 'finance.setup.overview') return this.renderFinanceSetupDashboard(root);
    if (route === 'procurement.overview') return this.renderProcurementDashboard(root);
    if (route === 'tax.dashboard') return this.renderTaxDashboard(root);
    if (route === 'prm.partners.overview') return this.renderPartnerWorkspaceDashboard(root);
    if (route === 'crm.campaigns.overview') return this.renderCampaignWorkspaceDashboard(root);
    if (route === 'prm.analytics') return this.renderPRMAnalytics(root);
    return this.renderComingSoon(root, { label: route, icon: 'layout-dashboard', desc: 'Workspace overview.' });
  }

  _clientWorkOptions() {
    const seen = new Set();
    return listEntities(this.app, 'client')
      .map((client) => {
        const id = String(entityValue(client, 'client_id', ENTITIES.client) || '').trim();
        if (!id) return null;
        const name = String(entityValue(client, 'client_name', ENTITIES.client) || entityValue(client, 'name', ENTITIES.client) || client.basename || id).trim();
        return { id, label: name && name !== id ? `${name} (${id})` : id };
      })
      .filter(Boolean)
      .filter((client) => {
        if (seen.has(client.id)) return false;
        seen.add(client.id);
        return true;
      })
      .sort((a, b) => a.label.localeCompare(b.label, undefined, { numeric: true, sensitivity: 'base' }));
  }

  _clientWorkProjectOptions() {
    const seen = new Set();
    return listEntities(this.app, 'project')
      .map((project) => {
        const id = String(entityValue(project, 'project_id', ENTITIES.project) || project.basename || '').trim();
        if (!id) return null;
        const name = String(entityValue(project, 'project', ENTITIES.project) || entityValue(project, 'name', ENTITIES.project) || project.basename || id).trim();
        const client = String(entityValue(project, 'client_id', ENTITIES.project) || '').trim();
        const label = name && name !== id ? `${name} (${id})` : id;
        return { id, label: client ? `${label} · ${client}` : label };
      })
      .filter(Boolean)
      .filter((project) => {
        if (seen.has(project.id)) return false;
        seen.add(project.id);
        return true;
      })
      .sort((a, b) => a.label.localeCompare(b.label, undefined, { numeric: true, sensitivity: 'base' }));
  }

  _entityMatchesClient(entity, clientId) {
    if (!clientId) return true;
    const direct = entity.frontmatter?.client_id;
    const endClient = entity.frontmatter?.end_client_id;
    const values = [
      ...(Array.isArray(direct) ? direct : [direct]),
      ...(Array.isArray(endClient) ? endClient : [endClient]),
    ];
    return values.some((value) => String(value ?? '').trim() === clientId);
  }

  _entityMatchesProject(entity, projectId) {
    if (!projectId) return true;
    const ids = entity.frontmatter?.project_id;
    const legacy = entity.frontmatter?.project;
    const values = [
      ...(Array.isArray(ids) ? ids : [ids]),
      ...(Array.isArray(legacy) ? legacy : [legacy]),
    ];
    return values.some((value) => String(value ?? '').trim() === projectId);
  }

  _renderClientWorkSelector(container) {
    const wrap = container.createDiv({ cls: 'cad-client-work-filter' });
    const clientSelect = wrap.createEl('select', { cls: 'dropdown cad-client-work-client-select' });
    clientSelect.createEl('option', { value: '', text: 'All clients' });
    const clients = this._clientWorkOptions();
    clients.forEach((client) => {
      clientSelect.createEl('option', { value: client.id, text: client.label });
    });
    if (this._clientWorkClientId && !clients.some((client) => client.id === this._clientWorkClientId)) {
      this._clientWorkClientId = '';
    }
    clientSelect.value = this._clientWorkClientId || '';
    clientSelect.addEventListener('change', async () => {
      this._clientWorkClientId = clientSelect.value;
      await this.render();
    });

    const projectSelect = wrap.createEl('select', { cls: 'dropdown cad-client-work-project-select' });
    projectSelect.createEl('option', { value: '', text: 'All projects' });
    const projects = this._clientWorkProjectOptions();
    projects.forEach((project) => {
      projectSelect.createEl('option', { value: project.id, text: project.label });
    });
    if (this._clientWorkProjectId && !projects.some((project) => project.id === this._clientWorkProjectId)) {
      this._clientWorkProjectId = '';
    }
    projectSelect.value = this._clientWorkProjectId || '';
    projectSelect.addEventListener('change', async () => {
      this._clientWorkProjectId = projectSelect.value;
      await this.render();
    });
  }

	  async renderClientWorkWorkspace(root) {
	    if (this._clientWorkClientId && !this._clientWorkOptions().some((client) => client.id === this._clientWorkClientId)) {
	      this._clientWorkClientId = '';
	    }
	    if (this._clientWorkProjectId && !this._clientWorkProjectOptions().some((project) => project.id === this._clientWorkProjectId)) {
	      this._clientWorkProjectId = '';
	    }
	    const selectedClientId = this._clientWorkClientId || '';
	    const selectedProjectId = this._clientWorkProjectId || '';
	    const titleParts = [selectedClientId, selectedProjectId].filter(Boolean);
	    return this.renderEntityTabs(root, 'client-work.overview', 'client-work.dashboard', {
	      filter: (entity) => this._entityMatchesClient(entity, selectedClientId) && this._entityMatchesProject(entity, selectedProjectId),
	      forceInternal: true,
	      titleSuffix: titleParts.length ? ` · ${titleParts.join(' · ')}` : '',
	      renderHeaderControls: (right) => this._renderClientWorkSelector(right),
	      emptyDescription: titleParts.length
	        ? `No records matching ${titleParts.join(' / ')} in this tab.`
	        : null,
	    });
	  }

	  async _renderClientWorkEntityList(root, entityKey) {
	    if (this._clientWorkClientId && !this._clientWorkOptions().some((client) => client.id === this._clientWorkClientId)) {
	      this._clientWorkClientId = '';
	    }
	    if (this._clientWorkProjectId && !this._clientWorkProjectOptions().some((project) => project.id === this._clientWorkProjectId)) {
	      this._clientWorkProjectId = '';
	    }
	    const selectedClientId = this._clientWorkClientId || '';
	    const selectedProjectId = this._clientWorkProjectId || '';
	    const titleParts = [selectedClientId, selectedProjectId].filter(Boolean);
	    return this.renderEntityList(root, entityKey, {
	      filter: (entity) => this._entityMatchesClient(entity, selectedClientId) && this._entityMatchesProject(entity, selectedProjectId),
	      // Always show the internal list here so it doesn't "disappear" when the Base view is non-table.
	      forceInternal: true,
	      titleSuffix: titleParts.length ? ` · ${titleParts.join(' · ')}` : '',
	      renderHeaderControls: (right) => this._renderClientWorkSelector(right),
	      emptyDescription: titleParts.length
	        ? `No records matching ${titleParts.join(' / ')} in this list.`
	        : null,
	    });
	  }

  _isOpenEntity(entity, entityKey) {
    const def = ENTITIES[entityKey];
    const status = String(entityValue(entity, 'status', def) || '').toLowerCase().replace(/[\s_]+/g, '-');
    if (!status) return true;
    return !['done', 'completed', 'closed', 'cancelled', 'canceled', 'archived', 'paid', 'filed', 'submitted', 'approved'].includes(status);
  }

  _dateValue(entity, entityKey, fields) {
    const def = ENTITIES[entityKey];
    for (const field of fields) {
      const value = entityValue(entity, field, def);
      if (value) {
        const date = new Date(String(value).slice(0, 10));
        if (!isNaN(date.getTime())) return date;
      }
    }
    return null;
  }

  _dashboardStats(root, stats) {
    const grid = root.createDiv({ cls: 'cad-stat-grid' });
    stats.forEach((item) => {
      const card = grid.createDiv({ cls: 'cad-stat-card' });
      if (item.accent) card.dataset.accent = item.accent;
      card.createDiv({ cls: 'cad-stat-label', text: item.label });
      card.createDiv({ cls: 'cad-stat-value', text: String(item.value) });
      if (item.sub) card.createDiv({ cls: 'cad-stat-sub', text: item.sub });
      if (item.mode) {
        card.style.cursor = 'pointer';
        card.addEventListener('click', () => this.setMode(item.mode));
      }
    });
  }

  _recentRows(entityKey, entities, titleFields = ['title', 'name'], metaFields = ['status']) {
    const def = ENTITIES[entityKey];
    return [...entities]
      .sort((a, b) => (b.file?.stat?.mtime || 0) - (a.file?.stat?.mtime || 0))
      .slice(0, 6)
      .map((entity) => {
        const titleField = titleFields.find((field) => entityValue(entity, field, def));
        const title = (titleField ? entityValue(entity, titleField, def) : '') || entity.basename;
        const meta = metaFields.map((field) => fmtValue(entityValue(entity, field, def), def.fields.find((f) => f.key === field)?.type)).filter(Boolean).join(' · ');
        return { title, meta: meta || 'No status', file: entity.file };
      });
  }

  _dueRows(entityKey, entities, dateFields, titleFields = ['title', 'name']) {
    const today = startOfDay(new Date());
    const horizon = addDays(today, 30);
    const def = ENTITIES[entityKey];
    return entities
      .map((entity) => ({ entity, date: this._dateValue(entity, entityKey, dateFields) }))
      .filter((item) => item.date && item.date.getTime() <= horizon.getTime())
      .sort((a, b) => a.date - b.date)
      .slice(0, 6)
      .map(({ entity, date }) => {
        const titleField = titleFields.find((field) => entityValue(entity, field, def));
        return {
          title: (titleField ? entityValue(entity, titleField, def) : '') || entity.basename,
          meta: `${fmtValue(date, 'date')} · ${entityValue(entity, 'status', def) || 'open'}`,
          file: entity.file,
        };
      });
  }

  _renderFinanceStatementLegend(root) {
    const card = root.createDiv({ cls: 'cad-dash-card cad-finance-legend' });
    card.createDiv({ cls: 'cad-dash-card-head' }).createDiv({ cls: 'cad-dash-card-title', text: 'FINANCIAL STATEMENT LEGEND' });
    const body = card.createDiv({ cls: 'cad-dash-card-body cad-finance-legend-grid' });
    [
      ['SOFP', 'Statement of Financial Position', 'Balance sheet: assets, liabilities and equity at a date.'],
      ['SOPL', 'Statement of Profit or Loss', 'Income statement / P&L for the period.'],
      ['SOCI', 'Statement of Comprehensive Income', 'Profit or loss plus other comprehensive income.'],
      ['SOCF', 'Statement of Cash Flows', 'Operating, investing and financing cash movements.'],
      ['SOCE', 'Statement of Changes in Equity', 'Opening equity, profit/loss, contributions, distributions and closing equity.'],
    ].forEach(([code, title, desc]) => {
      const item = body.createDiv({ cls: 'cad-finance-legend-item' });
      item.createDiv({ cls: 'cad-finance-legend-code', text: code });
      const text = item.createDiv({ cls: 'cad-finance-legend-text' });
      text.createDiv({ cls: 'cad-finance-legend-title', text: title });
      text.createDiv({ cls: 'cad-finance-legend-desc', text: desc });
    });
  }

  async renderClientWorkDashboard(root, opts = {}) {
    const selectedClientId = this._clientWorkClientId || '';
    const selectedProjectId = this._clientWorkProjectId || '';
    const titleParts = [selectedClientId, selectedProjectId].filter(Boolean);
    const matches = (entity) => this._entityMatchesClient(entity, selectedClientId) && this._entityMatchesProject(entity, selectedProjectId);
    const get = (key) => listEntities(this.app, key).filter(matches);
    const meetings = get('meeting');
    const comms = get('comms-thread');
    const deliverables = get('deliverable');
    const feedback = get('feedback');
    const surveys = get('survey');
    const testimonials = get('testimonial');
    const decisions = get('decision');

    this._renderPageHeader(root, `Client Work${titleParts.length ? ` · ${titleParts.join(' · ')}` : ''}`, 'Delivery overview across meetings, comms, deliverables, feedback and decisions', (right) => {
      this._renderClientWorkSelector(right);
    });
    this._dashboardStats(root, [
      { label: 'MEETINGS', value: meetings.length, sub: 'client conversations', accent: 'sky', mode: 'client-work.meetings' },
      { label: 'OPEN DELIVERABLES', value: deliverables.filter((e) => this._isOpenEntity(e, 'deliverable')).length, sub: `${deliverables.length} total`, accent: 'emerald' },
      { label: 'OPEN COMMS', value: comms.filter((e) => this._isOpenEntity(e, 'comms-thread')).length, sub: `${comms.length} threads`, accent: 'mint' },
      { label: 'FEEDBACK', value: feedback.length, sub: 'items captured', accent: 'warn' },
      { label: 'DECISIONS', value: decisions.length, sub: 'decision records', accent: 'rose' },
    ]);
    const cols = root.createDiv({ cls: 'cad-dash-cols' });
    const left = cols.createDiv({ cls: 'cad-dash-col' });
    const right = cols.createDiv({ cls: 'cad-dash-col' });
    this._dashCardSection(left, 'RECENT MEETINGS', this._recentRows('meeting', meetings, ['context', 'name', 'title'], ['date', 'status', 'client_id', 'project_id']), 'No meetings.');
    this._dashCardSection(left, 'OPEN DELIVERABLES', this._recentRows('deliverable', deliverables.filter((e) => this._isOpenEntity(e, 'deliverable')), ['title', 'project'], ['status', 'client_id', 'project_id']), 'No open deliverables.');
    this._dashCardSection(left, 'RECENT COMMS', this._recentRows('comms-thread', comms, ['subject', 'thread_id'], ['channel', 'status', 'last_message_at']), 'No communication threads.');
    this._dashCardSection(right, 'RECENT FEEDBACK', this._recentRows('feedback', feedback, ['respondent', 'feedback_type'], ['score', 'status', 'client_id']), 'No feedback captured.');
    this._dashCardSection(right, 'RECENT DECISIONS', this._recentRows('decision', decisions, ['title', 'status'], ['status', 'client_id', 'project_id']), 'No decisions recorded.');
    if (surveys.length || testimonials.length) {
      const extra = root.createDiv({ cls: 'cad-dash-cols' });
      this._dashCardSection(extra.createDiv({ cls: 'cad-dash-col' }), 'SURVEYS', this._recentRows('survey', surveys, ['title'], ['status', 'response_count', 'response_rate']), 'No surveys.');
      this._dashCardSection(extra.createDiv({ cls: 'cad-dash-col' }), 'TESTIMONIALS', this._recentRows('testimonial', testimonials, ['respondent_name', 'respondent'], ['status', 'permission_level']), 'No testimonials.');
    }
  }

  async renderFinanceGLDashboard(root) {
    const coa = listEntities(this.app, 'chart-of-accounts');
    const journals = listEntities(this.app, 'journal-entry');
    const recs = listEntities(this.app, 'bank-reconciliation');
    const tbs = listEntities(this.app, 'trial-balance');
    const statements = listEntities(this.app, 'financial-statement');
    const notes = listEntities(this.app, 'fs-notes');
    this._renderPageHeader(root, 'General Ledger', 'Posting, reconciliation, trial balance and reporting overview');
    this._dashboardStats(root, [
      { label: 'ACCOUNTS', value: coa.length, sub: 'chart records', accent: 'sky' },
      { label: 'OPEN JOURNALS', value: journals.filter((e) => this._isOpenEntity(e, 'journal-entry')).length, sub: `${journals.length} total`, accent: 'mint' },
      { label: 'RECONCILIATIONS', value: recs.length, sub: 'bank rec records', accent: 'emerald' },
      { label: 'TRIAL BALANCES', value: tbs.length, sub: 'period snapshots', accent: 'warn' },
      { label: 'STATEMENTS', value: statements.length, sub: `${notes.length} FS notes`, accent: 'rose' },
    ]);
    const cols = root.createDiv({ cls: 'cad-dash-cols' });
    this._dashCardSection(cols.createDiv({ cls: 'cad-dash-col' }), 'RECENT JOURNALS', this._recentRows('journal-entry', journals, ['journal_id', 'title'], ['status', 'period_id', 'client_id']), 'No journal entries.');
    this._dashCardSection(cols.createDiv({ cls: 'cad-dash-col' }), 'RECENT RECONCILIATIONS', this._recentRows('bank-reconciliation', recs, ['reconciliation_id', 'account_id'], ['status', 'period_id', 'difference']), 'No bank reconciliations.');
    const cols2 = root.createDiv({ cls: 'cad-dash-cols' });
    this._dashCardSection(cols2.createDiv({ cls: 'cad-dash-col' }), 'TRIAL BALANCES', this._recentRows('trial-balance', tbs, ['trial_balance_id', 'period_id'], ['status', 'period_id', 'client_id']), 'No trial balances.');
    this._dashCardSection(cols2.createDiv({ cls: 'cad-dash-col' }), 'FINANCIAL STATEMENTS', this._recentRows('financial-statement', statements, ['statement_id', 'statement_type', 'period_id'], ['statement_type', 'status', 'period_id', 'client_id']), 'No financial statements.');
    this._renderFinanceStatementLegend(root);
  }

  async renderFinanceSetupDashboard(root) {
    const periods = listEntities(this.app, 'accounting-period');
    const banks = listEntities(this.app, 'bank-account');
    const fx = listEntities(this.app, 'fx-rates-table');
    const inventory = listEntities(this.app, 'inventory');
    this._renderPageHeader(root, 'Finance Setup', 'Configuration records required before finance workflows run cleanly');
    this._dashboardStats(root, [
      { label: 'PERIODS', value: periods.length, sub: `${periods.filter((e) => this._isOpenEntity(e, 'accounting-period')).length} open`, accent: 'sky' },
      { label: 'BANK ACCOUNTS', value: banks.length, sub: 'configured accounts', accent: 'mint' },
      { label: 'FX TABLES', value: fx.length, sub: 'rate tables', accent: 'warn' },
      { label: 'INVENTORY ITEMS', value: inventory.length, sub: 'tracked records', accent: 'emerald' },
    ]);
    const cols = root.createDiv({ cls: 'cad-dash-cols' });
    this._dashCardSection(cols.createDiv({ cls: 'cad-dash-col' }), 'OPEN PERIODS', this._recentRows('accounting-period', periods.filter((e) => this._isOpenEntity(e, 'accounting-period')), ['period_id'], ['status', 'start_date', 'end_date']), 'No open periods.');
    this._dashCardSection(cols.createDiv({ cls: 'cad-dash-col' }), 'RECENT SETUP CHANGES', [
      ...this._recentRows('bank-account', banks, ['account_name', 'account_id'], ['currency', 'status']),
      ...this._recentRows('fx-rates-table', fx, ['rate_table_id', 'base_currency'], ['period_id', 'source']),
    ].sort((a, b) => (b.file?.stat?.mtime || 0) - (a.file?.stat?.mtime || 0)).slice(0, 6), 'No setup records.');
  }

  async renderProcurementDashboard(root) {
    const suppliers = listEntities(this.app, 'supplier');
    const invoices = listEntities(this.app, 'supplier-invoice');
    const reqs = listEntities(this.app, 'purchase-requisition');
    const pos = listEntities(this.app, 'purchase-order');
    const openInvoices = invoices.filter((e) => this._isOpenEntity(e, 'supplier-invoice'));
    this._renderPageHeader(root, 'Suppliers & Procurement', 'Supplier, invoice, requisition and purchase order overview');
    this._dashboardStats(root, [
      { label: 'SUPPLIERS', value: suppliers.length, sub: 'supplier records', accent: 'sky' },
      { label: 'OPEN INVOICES', value: openInvoices.length, sub: `${invoices.length} total`, accent: 'rose' },
      { label: 'REQUISITIONS', value: reqs.filter((e) => this._isOpenEntity(e, 'purchase-requisition')).length, sub: `${reqs.length} total`, accent: 'warn' },
      { label: 'OPEN POS', value: pos.filter((e) => this._isOpenEntity(e, 'purchase-order')).length, sub: `${pos.length} total`, accent: 'mint' },
    ]);
    const cols = root.createDiv({ cls: 'cad-dash-cols' });
    this._dashCardSection(cols.createDiv({ cls: 'cad-dash-col' }), 'OPEN SUPPLIER INVOICES', this._dueRows('supplier-invoice', openInvoices, ['due_date', 'invoice_date'], ['invoice_id', 'supplier_id']), 'No open supplier invoices.');
    this._dashCardSection(cols.createDiv({ cls: 'cad-dash-col' }), 'PENDING REQUISITIONS', this._recentRows('purchase-requisition', reqs.filter((e) => this._isOpenEntity(e, 'purchase-requisition')), ['requisition_id', 'title'], ['status', 'requester', 'amount']), 'No pending requisitions.');
    const cols2 = root.createDiv({ cls: 'cad-dash-cols' });
    this._dashCardSection(cols2.createDiv({ cls: 'cad-dash-col' }), 'OPEN PURCHASE ORDERS', this._dueRows('purchase-order', pos.filter((e) => this._isOpenEntity(e, 'purchase-order')), ['expected_delivery', 'order_date'], ['po_id', 'supplier_id']), 'No open purchase orders.');
    this._dashCardSection(cols2.createDiv({ cls: 'cad-dash-col' }), 'RECENT SUPPLIERS', this._recentRows('supplier', suppliers, ['supplier_name', 'name'], ['status', 'category']), 'No suppliers.');
  }

  async renderTaxDashboard(root) {
    const vat = listEntities(this.app, 'vat-return');
    const ct = listEntities(this.app, 'corporate-tax-return');
    const deferred = listEntities(this.app, 'deferred-tax');
    const tp = listEntities(this.app, 'transfer-pricing');
    const fz = listEntities(this.app, 'free-zone-status');
    const rules = listEntities(this.app, 'legal-rule');
    const retention = listEntities(this.app, 'document-retention');
    this._renderPageHeader(root, 'Tax', 'Filing, tax review, legal rule and retention overview');
    this._dashboardStats(root, [
      { label: 'OPEN VAT', value: vat.filter((e) => this._isOpenEntity(e, 'vat-return')).length, sub: `${vat.length} returns`, accent: 'sky' },
      { label: 'OPEN CT', value: ct.filter((e) => this._isOpenEntity(e, 'corporate-tax-return')).length, sub: `${ct.length} returns`, accent: 'mint' },
      { label: 'TP FILES', value: tp.length, sub: 'transfer pricing', accent: 'warn' },
      { label: 'LEGAL RULES', value: rules.length, sub: `${retention.length} retention records`, accent: 'rose' },
    ]);
    const cols = root.createDiv({ cls: 'cad-dash-cols' });
    this._dashCardSection(cols.createDiv({ cls: 'cad-dash-col' }), 'UPCOMING VAT RETURNS', this._dueRows('vat-return', vat.filter((e) => this._isOpenEntity(e, 'vat-return')), ['filing_due_date', 'due_date', 'period_end'], ['return_id', 'period_id']), 'No open VAT returns.');
    this._dashCardSection(cols.createDiv({ cls: 'cad-dash-col' }), 'UPCOMING CORPORATE TAX', this._dueRows('corporate-tax-return', ct.filter((e) => this._isOpenEntity(e, 'corporate-tax-return')), ['filing_due_date', 'due_date', 'period_end'], ['return_id', 'period_id']), 'No open corporate tax returns.');
    const cols2 = root.createDiv({ cls: 'cad-dash-cols' });
    this._dashCardSection(cols2.createDiv({ cls: 'cad-dash-col' }), 'TAX REVIEWS', [
      ...this._recentRows('deferred-tax', deferred, ['assessment_id', 'period_id'], ['status', 'period_id']),
      ...this._recentRows('free-zone-status', fz, ['assessment_id', 'entity_id'], ['status', 'period_id']),
    ].slice(0, 6), 'No deferred tax or free-zone reviews.');
    this._dashCardSection(cols2.createDiv({ cls: 'cad-dash-col' }), 'RECENT LEGAL / RETENTION', [
      ...this._recentRows('legal-rule', rules, ['rule_id', 'title'], ['jurisdiction', 'status']),
      ...this._recentRows('document-retention', retention, ['document_type', 'retention_id'], ['status', 'destroy_after_date']),
    ].slice(0, 6), 'No legal or retention records.');
  }

  async renderPartnerWorkspaceDashboard(root) {
    const partners = listEntities(this.app, 'partner');
    const regs = listEntities(this.app, 'registration');
    const commissions = listEntities(this.app, 'commission');
    const certs = listEntities(this.app, 'certification');
    const deals = listEntities(this.app, 'deal').filter((e) => entityValue(e, 'partner', ENTITIES.deal));
    this._renderPageHeader(root, 'Partners', 'Partner operations overview across registrations, commissions and certifications');
    this._dashboardStats(root, [
      { label: 'PARTNERS', value: partners.length, sub: 'partner records', accent: 'sky' },
      { label: 'REGISTRATIONS', value: regs.filter((e) => this._isOpenEntity(e, 'registration')).length, sub: `${regs.length} total`, accent: 'mint' },
      { label: 'COMMISSIONS', value: commissions.filter((e) => this._isOpenEntity(e, 'commission')).length, sub: `${commissions.length} total`, accent: 'warn' },
      { label: 'CERTIFICATIONS', value: certs.length, sub: 'cert records', accent: 'emerald' },
      { label: 'PARTNER DEALS', value: deals.length, sub: 'attributed deals', accent: 'rose' },
    ]);
    const cols = root.createDiv({ cls: 'cad-dash-cols' });
    this._dashCardSection(cols.createDiv({ cls: 'cad-dash-col' }), 'PENDING REGISTRATIONS', this._recentRows('registration', regs.filter((e) => this._isOpenEntity(e, 'registration')), ['deal_name', 'registration_id'], ['status', 'partner_ref', 'expiry_date']), 'No pending registrations.');
    this._dashCardSection(cols.createDiv({ cls: 'cad-dash-col' }), 'OPEN COMMISSIONS', this._recentRows('commission', commissions.filter((e) => this._isOpenEntity(e, 'commission')), ['commission_id', 'partner_ref'], ['status', 'amount', 'currency']), 'No open commissions.');
    const cols2 = root.createDiv({ cls: 'cad-dash-cols' });
    this._dashCardSection(cols2.createDiv({ cls: 'cad-dash-col' }), 'CERTIFICATIONS EXPIRING', this._dueRows('certification', certs, ['expires_date', 'renewal_date'], ['name', 'certification_id']), 'No certifications expiring soon.');
    this._dashCardSection(cols2.createDiv({ cls: 'cad-dash-col' }), 'RECENT PARTNERS', this._recentRows('partner', partners, ['partner_name', 'name'], ['tier', 'status']), 'No partners.');
  }

  async renderCampaignWorkspaceDashboard(root) {
    const campaigns = listEntities(this.app, 'campaign');
    const sequences = listEntities(this.app, 'sequence');
    const leads = listEntities(this.app, 'lead');
    const activeCampaigns = campaigns.filter((e) => this._isOpenEntity(e, 'campaign'));
    const activeSequences = sequences.filter((e) => this._isOpenEntity(e, 'sequence'));
    this._renderPageHeader(root, 'Campaigns', 'Campaign and outbound sequence overview');
    this._dashboardStats(root, [
      { label: 'ACTIVE CAMPAIGNS', value: activeCampaigns.length, sub: `${campaigns.length} total`, accent: 'sky' },
      { label: 'ACTIVE SEQUENCES', value: activeSequences.length, sub: `${sequences.length} total`, accent: 'mint' },
      { label: 'LEADS', value: leads.length, sub: 'lead records', accent: 'warn' },
    ]);
    const cols = root.createDiv({ cls: 'cad-dash-cols' });
    this._dashCardSection(cols.createDiv({ cls: 'cad-dash-col' }), 'ACTIVE CAMPAIGNS', this._recentRows('campaign', activeCampaigns, ['campaign_name', 'title'], ['status', 'campaign_type', 'launch_date']), 'No active campaigns.');
    this._dashCardSection(cols.createDiv({ cls: 'cad-dash-col' }), 'ACTIVE SEQUENCES', this._recentRows('sequence', activeSequences, ['sequence_name', 'title'], ['status', 'channel', 'campaign_id']), 'No active sequences.');
    this._dashCardSection(root.createDiv({ cls: 'cad-dash-cols' }).createDiv({ cls: 'cad-dash-col' }), 'RECENT LEADS', this._recentRows('lead', leads, ['company_name', 'contact_name'], ['status', 'owner', 'next_action_date']), 'No leads captured.');
  }

  /* ── Generic entity LIST view ───────────── */
  async renderEntityList(root, entityKey, opts = {}) {
    root.addClass('cadence-list');
    const def = ENTITIES[entityKey];
    if (!def) { this.renderComingSoon(root, SURFACE_BY_ID[this.mode]); return; }

    const entities = listEntities(this.app, entityKey);
    const filtered = opts.filter ? entities.filter(opts.filter) : entities;
    const unsupported = def.unsupportedBaseFilters || [];
    const unsupportedText = unsupported.length
      ? ` · ${unsupported.length} Base filter${unsupported.length === 1 ? '' : 's'} not applied`
      : '';

    const title = `${opts.title || def.plural}${opts.titleSuffix || ''}`;
    this._renderPageHeader(root, title, `${filtered.length} ${filtered.length === 1 ? def.label.toLowerCase() : def.plural.toLowerCase()} in ${entityFolder(entityKey)}${unsupportedText}`, (right) => {
      if (opts.renderHeaderControls) opts.renderHeaderControls(right, entityKey);
      this._renderEntityViewSelect(right, entityKey);
      if (def.externalBaseView) {
        const openBaseBtn = right.createEl('button', { cls: 'cad-btn', text: 'Open Base' });
        openBaseBtn.addEventListener('click', () => this._openEntityBase(entityKey));
      }
      const importBtn = right.createEl('button', { cls: 'cad-btn', text: 'Import CSV' });
      importBtn.addEventListener('click', () => new CadenceImportModal(this.app, { entityKey }).open());
      const btn = right.createEl('button', { cls: 'cad-btn primary', text: `+ New ${def.label}` });
      btn.addEventListener('click', () => this._createEntityFromPrompt(entityKey));
    });

    if (!opts.forceInternal && this._renderExternalBaseView(root, entityKey)) return;
    this._renderUnsupportedBaseFilters(root, def);

    if (!filtered.length) {
      const empty = root.createDiv({ cls: 'cad-empty-state' });
      empty.createDiv({ cls: 'cad-empty-state-title', text: `No ${def.plural.toLowerCase()} yet` });
      empty.createDiv({ cls: 'cad-empty-state-desc', text: opts.emptyDescription || `Drop a markdown note in ${entityFolder(entityKey)}/ with frontmatter, or hit "+ New" above.` });
      return;
    }

    const cols = opts.columns
      ? opts.columns.map((k) => def.fields.find((f) => f.key === k)).filter(Boolean)
      : def.fields;
    const groups = this._groupEntitiesForView(filtered, def);
    if (groups) {
      groups.forEach(([label, items]) => {
        root.createDiv({ cls: 'cad-section-label-lg', text: `${label} · ${items.length}` });
        this._renderEntityTable(root, items, entityKey, cols);
      });
    } else {
      this._renderEntityTable(root, filtered, entityKey, cols);
    }
  }

  /* ── Entity DETAIL view (in-app form, autosaves to frontmatter) ── */
  async renderEntityDetail(root, entityKey, file) {
    // Projects get a richer PM-style detail view
    if (entityKey === 'project') return this.renderProjectDetail(root, file);

    root.addClass('cadence-detail');
    const def = ENTITIES[entityKey];
    if (!def || !file) { this.closeEntityDetail(); return; }

    // Read current entity
    const cache = this.app.metadataCache.getFileCache(file) || {};
    const fm = Object.assign({}, cache.frontmatter || {});
    const primaryKey = primaryFieldKey(def);
    const titleVal = primaryKey ? entityValue({ file, frontmatter: fm, basename: file.basename }, primaryKey, def) : file.basename;

    // Header: back / breadcrumb / title / actions
    const head = root.createDiv({ cls: 'cad-detail-header' });
    const headLeft = head.createDiv({ cls: 'cad-detail-header-left' });

    const back = headLeft.createEl('button', { cls: 'cad-btn cad-detail-back', text: '← ' + def.plural });
    back.addEventListener('click', () => this.closeEntityDetail());

    const breadcrumb = headLeft.createDiv({ cls: 'cad-detail-breadcrumb' });
    breadcrumb.createSpan({ cls: 'cad-eyebrow', text: def.plural.toUpperCase() });
    breadcrumb.createSpan({ cls: 'cad-detail-title', text: String(titleVal) });
    breadcrumb.createDiv({ cls: 'cad-detail-path', text: file.path });

    const headRight = head.createDiv({ cls: 'cad-detail-header-right' });
    const savedBadge = headRight.createSpan({ cls: 'cad-detail-saved', text: '' });
    const openNote = headRight.createEl('button', { cls: 'cad-btn', text: 'Open as note' });
    openNote.addEventListener('click', () => this.app.workspace.openLinkText(file.path, '', false));
    const deleteBtn = headRight.createEl('button', { cls: 'cad-btn cad-btn-danger', text: 'Delete' });
    deleteBtn.addEventListener('click', async () => {
      if (!confirm(`Delete this ${def.label.toLowerCase()}? This moves the file to trash.`)) return;
      try {
        await this.app.vault.trash(file, true);
        new obsidian.Notice(`Deleted ${def.label}: ${file.basename}`);
        this.closeEntityDetail();
      } catch (e) {
        new obsidian.Notice(`Delete failed: ${e.message}`);
      }
    });

    // Form
    const form = root.createDiv({ cls: 'cad-detail-form' });
    let saveTimer = null;
    const flashSaved = () => {
      savedBadge.setText('Saved');
      savedBadge.addClass('show');
      clearTimeout(savedBadge._t);
      savedBadge._t = setTimeout(() => savedBadge.removeClass('show'), 1400);
    };
    const writeField = async (key, raw) => {
      try {
        let value = raw;
        // Coerce based on field type
        const fdef = def.fields.find((f) => f.key === key);
        if (fdef) {
          if (fdef.type === 'tags') {
            value = (raw || '').split(',').map((t) => t.trim()).filter(Boolean);
          } else if (fdef.type === 'number' || fdef.type === 'currency') {
            const n = Number(raw);
            value = isNaN(n) ? null : n;
          } else if (raw === '') {
            value = null;
          }
        }
        await this.app.fileManager.processFrontMatter(file, (frontmatter) => {
          if (value == null || (Array.isArray(value) && value.length === 0)) {
            delete frontmatter[key];
          } else {
            frontmatter[key] = value;
          }
        });
        flashSaved();
      } catch (e) {
        new obsidian.Notice(`Save failed: ${e.message}`);
      }
    };
    const debouncedWrite = (key, val) => {
      clearTimeout(saveTimer);
      saveTimer = setTimeout(() => writeField(key, val), 350);
    };

    // Render each field as a labelled row
    def.fields.forEach((f) => {
      const row = form.createDiv({ cls: 'cad-form-row' });
      row.createDiv({ cls: 'cad-form-label', text: f.label.toUpperCase() });

      const current = fm[f.key];
      const fieldType = f.type || 'text';

      if (fieldType === 'enum') {
        const sel = row.createEl('select', { cls: 'cad-form-input' });
        // Allow empty
        sel.createEl('option', { value: '', text: '—' });
        (f.options || []).forEach((opt) => {
          const o = sel.createEl('option', { value: opt, text: opt });
          if (String(current || '') === opt) o.selected = true;
        });
        sel.addEventListener('change', () => writeField(f.key, sel.value));
      } else if (fieldType === 'date') {
        const inp = row.createEl('input', { type: 'date', cls: 'cad-form-input' });
        inp.lang = navigator.language || '';
        if (current) {
          const d = new Date(current);
          if (!isNaN(d.getTime())) inp.value = d.toISOString().slice(0, 10);
        }
        inp.addEventListener('change', () => writeField(f.key, inp.value));
      } else if (fieldType === 'number' || fieldType === 'currency') {
        const inp = row.createEl('input', { type: 'number', cls: 'cad-form-input' });
        if (current != null) inp.value = String(current);
        if (fieldType === 'currency') inp.placeholder = `${this.plugin.settings.currency || 'USD'} amount`;
        inp.addEventListener('input', () => debouncedWrite(f.key, inp.value));
        inp.addEventListener('blur', () => writeField(f.key, inp.value));
      } else if (fieldType === 'email') {
        const inp = row.createEl('input', { type: 'email', cls: 'cad-form-input' });
        if (current) inp.value = String(current);
        inp.addEventListener('input', () => debouncedWrite(f.key, inp.value));
        inp.addEventListener('blur', () => writeField(f.key, inp.value));
      } else if (fieldType === 'tags') {
        const inp = row.createEl('input', { type: 'text', cls: 'cad-form-input', placeholder: 'tag1, tag2, tag3' });
        if (Array.isArray(current)) inp.value = current.join(', ');
        else if (current) inp.value = String(current);
        inp.addEventListener('input', () => debouncedWrite(f.key, inp.value));
        inp.addEventListener('blur', () => writeField(f.key, inp.value));
      } else {
        const inp = row.createEl('input', { type: 'text', cls: 'cad-form-input' });
        if (current) inp.value = String(current);
        if (f.key === primaryKey) inp.placeholder = `${def.label} name`;
        inp.addEventListener('input', () => debouncedWrite(f.key, inp.value));
        inp.addEventListener('blur', () => writeField(f.key, inp.value));
      }
    });

    // Body section — link out for full editing
    const bodyHint = root.createDiv({ cls: 'cad-detail-body-hint' });
    bodyHint.createDiv({ cls: 'cad-eyebrow', text: 'NOTE BODY' });
    bodyHint.createDiv({ cls: 'cad-detail-body-desc', text: 'Brief, milestones, notes and any other markdown lives in the note body.' });
    const openBody = bodyHint.createEl('button', { cls: 'cad-btn primary', text: 'Open as note for full editing' });
    openBody.addEventListener('click', () => this.app.workspace.openLinkText(file.path, '', false));
  }

  /* ── Project DETAIL view (real PM surface) ─────── */
  async renderProjectDetail(root, file) {
    root.addClass('cadence-project-detail');
    const def = ENTITIES.project;
    const cache = this.app.metadataCache.getFileCache(file) || {};
    const fm = Object.assign({}, cache.frontmatter || {});
    const meta = await readProjectMeta(this.app, file);
    const primaryKey = def.fields?.find((f) => f.primary)?.key || 'name';
    const titleVal = fm[primaryKey] || fm.name || fm.title || file.basename;

    const status = String(fm.status || 'active');
    const priority = String(fm.priority || '');

    /* Header */
    const head = root.createDiv({ cls: 'cad-detail-header' });
    const headLeft = head.createDiv({ cls: 'cad-detail-header-left' });
    const back = headLeft.createEl('button', { cls: 'cad-btn cad-detail-back', text: '← Projects' });
    back.addEventListener('click', () => this.closeEntityDetail());
    const breadcrumb = headLeft.createDiv({ cls: 'cad-detail-breadcrumb' });
    breadcrumb.createSpan({ cls: 'cad-eyebrow', text: 'PROJECT' });
    breadcrumb.createSpan({ cls: 'cad-detail-title', text: String(titleVal) });
    breadcrumb.createDiv({ cls: 'cad-detail-path', text: file.path });

    const headRight = head.createDiv({ cls: 'cad-detail-header-right' });
    const savedBadge = headRight.createSpan({ cls: 'cad-detail-saved', text: '' });
    const flashSaved = () => {
      savedBadge.setText('Saved');
      savedBadge.addClass('show');
      clearTimeout(savedBadge._t);
      savedBadge._t = setTimeout(() => savedBadge.removeClass('show'), 1400);
    };
    const openNote = headRight.createEl('button', { cls: 'cad-btn', text: 'Open as note' });
    openNote.addEventListener('click', () => this.app.workspace.openLinkText(file.path, '', false));
    const deleteBtn = headRight.createEl('button', { cls: 'cad-btn cad-btn-danger', text: 'Delete' });
    deleteBtn.addEventListener('click', async () => {
      if (!confirm(`Delete this project? This moves the file to trash.`)) return;
      try {
        await this.app.vault.trash(file, true);
        new obsidian.Notice(`Deleted project: ${file.basename}`);
        this.closeEntityDetail();
      } catch (e) {
        new obsidian.Notice(`Delete failed: ${e.message}`);
      }
    });

    /* Hero — name (already in breadcrumb), pills, meta, progress */
    const hero = root.createDiv({ cls: 'cad-pd-hero' });
    const pillRow = hero.createDiv({ cls: 'cad-pd-pills' });
    const mkSelect = (cls, options, current, onChange) => {
      const wrap = pillRow.createDiv({ cls: `cad-pd-select-wrap ${cls}` });
      const sel = wrap.createEl('select', { cls: 'cad-pd-select' });
      options.forEach((opt) => {
        const o = sel.createEl('option', { value: opt, text: opt });
        if (String(current) === opt) o.selected = true;
      });
      sel.addEventListener('change', () => onChange(sel.value));
      return sel;
    };
    const statusOptions   = def.fields?.find((f) => f.key === 'status')?.options   || ['active', 'on_hold', 'backlog', 'done', 'cancelled'];
    const priorityOptions = def.fields?.find((f) => f.key === 'priority')?.options || ['low', 'medium', 'high'];
    mkSelect('cad-pill cad-pill-' + status.toLowerCase().replace(/\s+/g, '-'),
      statusOptions, status,
      (v) => this._writeProjectFrontmatter(file, { status: v }, flashSaved));
    mkSelect('cad-pill cad-pill-prio-' + (priority || priorityOptions[1] || 'medium').toLowerCase(),
      priorityOptions, priority || priorityOptions[1] || 'medium',
      (v) => this._writeProjectFrontmatter(file, { priority: v }, flashSaved));

    const metaRow = hero.createDiv({ cls: 'cad-pd-meta' });
    const mkMeta = (label, key, type) => {
      const cell = metaRow.createDiv({ cls: 'cad-pd-meta-cell' });
      cell.createDiv({ cls: 'cad-pd-meta-label', text: label });
      const inp = cell.createEl('input', { type: type || 'text', cls: 'cad-pd-meta-input' });
      const cur = fm[key];
      if (type === 'date' && cur) {
        const d = new Date(cur);
        if (!isNaN(d.getTime())) inp.value = d.toISOString().slice(0, 10);
      } else if (cur != null) {
        inp.value = String(cur);
      }
      let t;
      const commit = () => this._writeProjectFrontmatter(file, { [key]: inp.value || null }, flashSaved);
      inp.addEventListener('input', () => { clearTimeout(t); t = setTimeout(commit, 350); });
      inp.addEventListener('blur', commit);
    };
    const defaultMetaFields = [
      { key: 'owner',   label: 'OWNER' },
      { key: 'started', label: 'STARTED', type: 'date' },
      { key: 'due',     label: 'DUE',     type: 'date' },
    ];
    (def.detailMetaFields || defaultMetaFields).forEach((mf) => mkMeta(mf.label, mf.key, mf.type));

    const progWrap = hero.createDiv({ cls: 'cad-proj-progress-wrap cad-pd-progress' });
    progWrap.dataset.pctBand = pctBand(meta.percent);
    const progLabel = progWrap.createDiv({ cls: 'cad-proj-progress-label' });
    progLabel.createSpan({ text: `${meta.done}/${meta.total} milestones complete` });
    progLabel.createSpan({ cls: 'cad-proj-progress-pct', text: `${meta.percent}%` });
    const bar = progWrap.createDiv({ cls: 'cad-proj-progress-bar' });
    const fill = bar.createDiv({ cls: 'cad-proj-progress-fill' });
    fill.style.width = `${meta.percent}%`;

    /* Two-column body */
    const cols = root.createDiv({ cls: 'cad-pd-cols' });
    const left = cols.createDiv({ cls: 'cad-pd-col' });
    const right = cols.createDiv({ cls: 'cad-pd-col' });

    /* ── Milestones ── */
    this._renderMilestoneSection(left, file, meta.milestones, flashSaved);

    /* ── Tasks ── */
    const taskList = parseTasksList(meta.sections['Tasks'] || '');
    this._renderTaskSection(left, file, taskList, flashSaved);

    /* ── Body sections (right column) ── */
    const defaultBodySections = [
      { key: 'Brief',        label: 'BRIEF',        rows: 4, placeholder: 'The outcome we want, why now.' },
      { key: 'Scope',        label: 'SCOPE',        rows: 5, placeholder: 'In scope / out of scope.' },
      { key: 'Risks',        label: 'RISKS',        rows: 4, placeholder: 'What could go wrong.' },
      { key: 'Stakeholders', label: 'STAKEHOLDERS', rows: 3, placeholder: 'Who cares about this project.' },
      { key: 'Notes',        label: 'NOTES',        rows: 5, placeholder: 'Anything else.' },
    ];
    const bodySections = def.detailSections || defaultBodySections;
    bodySections.forEach((s) => this._renderProjectTextSection(right, file, meta.sections, s, flashSaved));
  }

  _renderMilestoneSection(parent, file, milestones, flashSaved) {
    const card = parent.createDiv({ cls: 'cad-pd-card' });
    const head = card.createDiv({ cls: 'cad-pd-card-head' });
    head.createDiv({ cls: 'cad-pd-card-title', text: `MILESTONES · ${milestones.filter((m) => m.done).length}/${milestones.length}` });
    const addBtn = head.createEl('button', { cls: 'cad-btn cad-btn-sm', text: '+ Add' });

    const list = card.createDiv({ cls: 'cad-pd-checklist' });
    const renderRows = (items) => {
      list.empty();
      if (!items.length) {
        list.createDiv({ cls: 'cad-empty', text: 'No milestones yet — add the first one.' });
        return;
      }
      items.forEach((m, idx) => {
        const wrapper = list.createDiv({ cls: 'cad-mile-wrapper' });
        const row = wrapper.createDiv({ cls: 'cad-pd-mile-row' + (m.done ? ' done' : '') });
        const cb = row.createEl('input', { type: 'checkbox' });
        cb.checked = !!m.done;
        cb.addEventListener('change', async () => {
          items[idx].done = cb.checked;
          await this._commitMilestones(file, items, flashSaved);
        });
        const dateInp = row.createEl('input', { type: 'date', cls: 'cad-pd-mile-date' });
        dateInp.lang = navigator.language || '';
        if (m.date instanceof Date && !isNaN(m.date.getTime())) {
          dateInp.value = m.date.toISOString().slice(0, 10);
        }
        let dt;
        dateInp.addEventListener('input', () => {
          clearTimeout(dt);
          dt = setTimeout(async () => {
            items[idx].date = dateInp.value ? new Date(dateInp.value) : null;
            await this._commitMilestones(file, items, flashSaved, true);
          }, 350);
        });
        const titleInp = row.createEl('input', { type: 'text', cls: 'cad-pd-mile-title' });
        titleInp.value = m.title || '';
        titleInp.placeholder = 'Milestone title';
        let tt;
        titleInp.addEventListener('input', () => {
          clearTimeout(tt);
          tt = setTimeout(async () => {
            items[idx].title = titleInp.value;
            await this._commitMilestones(file, items, flashSaved, true);
          }, 400);
        });
        const del = row.createEl('button', { cls: 'cad-btn cad-btn-sm cad-btn-danger', text: '×' });
        del.title = 'Delete milestone';
        del.addEventListener('click', async () => {
          items.splice(idx, 1);
          await this._commitMilestones(file, items, flashSaved);
        });

        // Notes section — preview ⇄ textarea, indented under the milestone in markdown
        const notesEl = wrapper.createDiv({ cls: 'cad-mile-notes-section' });
        const renderNotesIdle = () => {
          notesEl.empty();
          const hasNotes = (items[idx].notes || '').trim().length > 0;
          if (hasNotes) {
            const preview = notesEl.createDiv({ cls: 'cad-mile-notes-preview' });
            preview.setText(items[idx].notes);
            preview.title = 'Click to edit notes';
            preview.addEventListener('click', openNotesEditor);
          } else {
            const addBtn = notesEl.createEl('a', { cls: 'cad-mile-notes-add', text: '+ Add notes' });
            addBtn.addEventListener('click', (e) => { e.preventDefault(); openNotesEditor(); });
          }
        };
        const openNotesEditor = () => {
          notesEl.empty();
          const ta = notesEl.createEl('textarea', { cls: 'cad-mile-notes-textarea' });
          ta.value = items[idx].notes || '';
          ta.placeholder = 'Notes — context, follow-ups, what happened…';
          const autosize = () => {
            ta.style.height = 'auto';
            ta.style.height = Math.max(60, ta.scrollHeight + 2) + 'px';
          };
          let nt;
          ta.addEventListener('input', () => {
            autosize();
            clearTimeout(nt);
            nt = setTimeout(async () => {
              items[idx].notes = ta.value;
              await this._commitMilestones(file, items, flashSaved, true);
            }, 400);
          });
          ta.addEventListener('blur', async () => {
            items[idx].notes = ta.value;
            await this._commitMilestones(file, items, flashSaved, true);
            renderNotesIdle();
          });
          setTimeout(() => { ta.focus(); autosize(); }, 0);
        };
        renderNotesIdle();
      });
    };

    renderRows(milestones);

    addBtn.addEventListener('click', async () => {
      const today = new Date();
      milestones.push({ done: false, date: today, title: '' });
      await this._commitMilestones(file, milestones, flashSaved);
    });
  }

  async _commitMilestones(file, items, flashSaved, skipRender = false) {
    const body = stringifyMilestones(items);
    const content = await this.app.vault.read(file);
    const next = replaceSection(content, '## Milestones', body || '');
    await this.app.vault.modify(file, next);
    if (typeof flashSaved === 'function') flashSaved();
    // Re-render only when needed (checkbox toggle, add, delete) — text/date
    // edits skip render so the user's input keeps focus.
    if (!skipRender) this.render();
  }

  _renderTaskSection(parent, file, tasks, flashSaved) {
    const card = parent.createDiv({ cls: 'cad-pd-card' });
    const head = card.createDiv({ cls: 'cad-pd-card-head' });
    const open = tasks.filter((t) => !t.done).length;
    head.createDiv({ cls: 'cad-pd-card-title', text: `TASKS · ${open} open · ${tasks.length - open} done` });
    const addBtn = head.createEl('button', { cls: 'cad-btn cad-btn-sm', text: '+ Add' });

    const list = card.createDiv({ cls: 'cad-pd-checklist' });
    const renderRows = (items) => {
      list.empty();
      if (!items.length) {
        list.createDiv({ cls: 'cad-empty', text: 'No tasks yet.' });
        return;
      }
      items.forEach((t, idx) => {
        const row = list.createDiv({ cls: 'cad-pd-task-row' + (t.done ? ' done' : '') });
        const cb = row.createEl('input', { type: 'checkbox' });
        cb.checked = !!t.done;
        cb.addEventListener('change', async () => {
          items[idx].done = cb.checked;
          await this._commitTasks(file, items, flashSaved);
          const txt = (items[idx].title || '').trim();
          if (txt) await this._propagateTaskComplete(txt, cb.checked, { kind: 'project', file });
        });
        const titleInp = row.createEl('input', { type: 'text', cls: 'cad-pd-task-title' });
        titleInp.value = t.title || '';
        titleInp.placeholder = 'Task description';
        let tt;
        titleInp.addEventListener('input', () => {
          clearTimeout(tt);
          tt = setTimeout(async () => {
            items[idx].title = titleInp.value;
            await this._commitTasks(file, items, flashSaved, true);
          }, 400);
        });

        /* Bell — set or edit a reminder linked to this task. */
        const linked = findProjectTaskReminder(this.plugin, file.path, t.title || '');
        const bell = row.createEl('button', {
          cls: 'cad-btn cad-btn-sm cad-pd-task-bell' + (linked ? ' linked' : ''),
          text: linked ? '🔔' : '🔕',
        });
        bell.title = linked
          ? `Edit reminder${linked.when ? ' · ' + reminderTimeStr(linked.when) : ''}`
          : 'Set a reminder for this task';
        bell.addEventListener('click', async () => {
          // Always commit any pending title edit first so the link key is fresh
          items[idx].title = titleInp.value;
          await this._commitTasks(file, items, flashSaved, true);

          const taskText = titleInp.value.trim();
          if (!taskText) {
            new obsidian.Notice('Add a task title first.');
            titleInp.focus();
            return;
          }
          const existing = findProjectTaskReminder(this.plugin, file.path, taskText);
          if (existing) {
            new CadenceReminderEditModal(this.app, this.plugin, existing).open();
          } else {
            new CadenceReminderEditModal(this.app, this.plugin, {
              text: taskText,
              when: null,
              repeat: 'none',
              notes: '',
              project: file.path,
            }, { isNew: true }).open();
          }
        });

        const del = row.createEl('button', { cls: 'cad-btn cad-btn-sm cad-btn-danger', text: '×' });
        del.addEventListener('click', async () => {
          items.splice(idx, 1);
          await this._commitTasks(file, items, flashSaved);
        });
      });
    };

    renderRows(tasks);

    addBtn.addEventListener('click', async () => {
      tasks.push({ done: false, title: '' });
      await this._commitTasks(file, tasks, flashSaved);
    });
  }

  async _commitTasks(file, items, flashSaved, skipRender = false) {
    const body = stringifyTasks(items);
    const content = await this.app.vault.read(file);
    const next = replaceSection(content, '## Tasks', body || '');
    await this.app.vault.modify(file, next);
    if (typeof flashSaved === 'function') flashSaved();
    if (!skipRender) this.render();
  }

  _renderProjectTextSection(parent, file, sections, def, flashSaved) {
    const card = parent.createDiv({ cls: 'cad-pd-card' });
    card.createDiv({ cls: 'cad-pd-card-head' }).createDiv({ cls: 'cad-pd-card-title', text: def.label });
    const ta = card.createEl('textarea', { cls: 'cad-pd-textarea' });
    ta.placeholder = def.placeholder || '';
    ta.rows = def.rows || 4;
    const initial = (sections[def.key] || '').replace(/^\s+|\s+$/g, '');
    ta.value = initial;
    let tmr;
    ta.addEventListener('input', () => {
      clearTimeout(tmr);
      tmr = setTimeout(async () => {
        const content = await this.app.vault.read(file);
        const next = replaceSection(content, `## ${def.key}`, ta.value || '');
        await this.app.vault.modify(file, next);
        flashSaved();
      }, 500);
    });
  }

  async _writeProjectFrontmatter(file, patch, flashSaved) {
    try {
      await this.app.fileManager.processFrontMatter(file, (fm) => {
        Object.entries(patch).forEach(([k, v]) => {
          if (v == null || v === '') delete fm[k];
          else fm[k] = v;
        });
      });
      if (typeof flashSaved === 'function') flashSaved();
    } catch (e) {
      new obsidian.Notice(`Save failed: ${e.message}`);
    }
  }

  /* ── Projects: rich card grid with milestone progress ─ */
  async renderProjectsView(root) {
    root.addClass('cadence-projects');
    const def = ENTITIES.project;
    const files = listEntityFiles(this.app, 'project');

    const projectFolderLabel = ENTITIES.project.folders ? ENTITIES.project.folders.join(', ') : entityFolder('project');
    const unsupported = def.unsupportedBaseFilters || [];
    const unsupportedText = unsupported.length
      ? ` · ${unsupported.length} Base filter${unsupported.length === 1 ? '' : 's'} not applied`
      : '';
    this._renderPageHeader(root, 'Projects', `${files.length} ${files.length === 1 ? 'project' : 'projects'} in ${projectFolderLabel}${unsupportedText}`, (right) => {
      this._renderEntityViewSelect(right, 'project');
      if (def.externalBaseView) {
        const openBaseBtn = right.createEl('button', { cls: 'cad-btn', text: 'Open Base' });
        openBaseBtn.addEventListener('click', () => this._openEntityBase('project'));
      }
      const importBtn = right.createEl('button', { cls: 'cad-btn', text: 'Import CSV' });
      importBtn.addEventListener('click', () => new CadenceImportModal(this.app, { entityKey: 'project' }).open());
      const btn = right.createEl('button', { cls: 'cad-btn primary', text: '+ New Project' });
      btn.addEventListener('click', () => this._createEntityFromPrompt('project'));
    });

    if (this._renderExternalBaseView(root, 'project')) return;
    this._renderUnsupportedBaseFilters(root, def);

    if (!files.length) {
      const empty = root.createDiv({ cls: 'cad-empty-state' });
      empty.createDiv({ cls: 'cad-empty-state-title', text: 'No projects yet' });
      empty.createDiv({ cls: 'cad-empty-state-desc', text: 'Hit "+ New Project" — you\'ll get a templated note with Brief, Scope, Milestones, Tasks, Risks and Stakeholders sections ready to fill in.' });
      return;
    }

    const projects = await Promise.all(files.map(async (f) => {
      const e = readEntity(this.app, f);
      const meta = await readProjectMeta(this.app, f);
      return { entity: e, meta };
    }));

    // Group by status — keys derived from entity definition
    const statusOpts = def.fields?.find((f) => f.key === 'status')?.options || ['active', 'on_hold', 'backlog', 'done', 'cancelled'];
    const groups = Object.fromEntries(statusOpts.map((s) => [s, []]));
    const fallbackStatus = statusOpts[0] || 'active';
    projects.forEach((p) => {
      const status = String(entityValue(p.entity, 'status', def) || fallbackStatus).toLowerCase().replace(/[-\s]+/g, '_');
      const key = groups[status] !== undefined ? status : fallbackStatus;
      groups[key].push(p);
    });

    const grid = root.createDiv({ cls: 'cad-proj-grid' });
    const renderCard = (p) => {
      const card = grid.createDiv({ cls: 'cad-proj-card' });
      const head = card.createDiv({ cls: 'cad-proj-card-head' });
      const title = head.createEl('a', { cls: 'cad-proj-title', text: entityValue(p.entity, 'name', def) || p.entity.basename });
      title.addEventListener('click', (ev) => { ev.preventDefault(); this.openEntityDetail('project', p.entity.file); });
      const status = String(entityValue(p.entity, 'status', def) || 'active');
      const priority = String(entityValue(p.entity, 'priority', def) || '');
      const pillRow = head.createDiv({ cls: 'cad-proj-pills' });
      pillRow.createSpan({ cls: `cad-pill cad-pill-${status.toLowerCase().replace(/\s+/g, '-')}`, text: status });
      if (priority) pillRow.createSpan({ cls: `cad-pill cad-pill-prio-${priority.toLowerCase()}`, text: priority });

      const metaRow = card.createDiv({ cls: 'cad-proj-meta' });
      const owner = entityValue(p.entity, 'owner', def);
      const due = entityValue(p.entity, 'due', def);
      if (owner) metaRow.createSpan({ text: `Owner: ${owner}` });
      if (due) metaRow.createSpan({ text: `Due: ${fmtValue(due, 'date')}` });

      // Progress
      const progWrap = card.createDiv({ cls: 'cad-proj-progress-wrap' });
      progWrap.dataset.pctBand = pctBand(p.meta.percent);
      const progLabel = progWrap.createDiv({ cls: 'cad-proj-progress-label' });
      progLabel.createSpan({ text: `${p.meta.done}/${p.meta.total} milestones` });
      progLabel.createSpan({ cls: 'cad-proj-progress-pct', text: `${p.meta.percent}%` });
      const bar = progWrap.createDiv({ cls: 'cad-proj-progress-bar' });
      const fill = bar.createDiv({ cls: 'cad-proj-progress-fill' });
      fill.style.width = `${p.meta.percent}%`;

      // Next milestone
      if (p.meta.next) {
        const nextRow = card.createDiv({ cls: 'cad-proj-next' });
        nextRow.createSpan({ cls: 'cad-proj-next-label', text: 'NEXT · ' });
        nextRow.createSpan({ cls: 'cad-proj-next-date', text: fmtValue(p.meta.next.date, 'date') });
        if (p.meta.next.title) nextRow.createSpan({ text: ` — ${p.meta.next.title}` });
      }
    };

    const renderSection = (label, list) => {
      if (!list.length) return;
      root.createDiv({ cls: 'cad-section-label-lg', text: label });
      list.forEach(renderCard);
    };

    // We render section labels by intercepting renderCard placement
    // Reset grid: render in groups
    grid.remove();
    const order = ['active', 'on_hold', 'backlog', 'done', 'cancelled'];
    const sectionLabels = { active: 'ACTIVE', on_hold: 'ON HOLD', backlog: 'BACKLOG', done: 'DONE', cancelled: 'CANCELLED' };
    order.forEach((key) => {
      const list = groups[key];
      if (!list.length) return;
      root.createDiv({ cls: 'cad-section-label-lg', text: sectionLabels[key] });
      const section = root.createDiv({ cls: 'cad-proj-grid' });
      list.forEach((p) => {
        const card = section.createDiv({ cls: 'cad-proj-card' });
        const head = card.createDiv({ cls: 'cad-proj-card-head' });
        const title = head.createEl('a', { cls: 'cad-proj-title', text: entityValue(p.entity, 'name', def) || p.entity.basename });
        title.addEventListener('click', (ev) => { ev.preventDefault(); this.openEntityDetail('project', p.entity.file); });
        const status = String(entityValue(p.entity, 'status', def) || 'active');
        const priority = String(entityValue(p.entity, 'priority', def) || '');
        const pillRow = head.createDiv({ cls: 'cad-proj-pills' });
        pillRow.createSpan({ cls: `cad-pill cad-pill-${status.toLowerCase().replace(/\s+/g, '-')}`, text: status });
        if (priority) pillRow.createSpan({ cls: `cad-pill cad-pill-prio-${priority.toLowerCase()}`, text: priority });

        const metaRow = card.createDiv({ cls: 'cad-proj-meta' });
        const owner = entityValue(p.entity, 'owner', def);
        const due = entityValue(p.entity, 'due', def);
        if (owner) metaRow.createSpan({ text: `Owner: ${owner}` });
        if (due) metaRow.createSpan({ text: `Due: ${fmtValue(due, 'date')}` });

        const progWrap = card.createDiv({ cls: 'cad-proj-progress-wrap' });
        const progLabel = progWrap.createDiv({ cls: 'cad-proj-progress-label' });
        progLabel.createSpan({ text: `${p.meta.done}/${p.meta.total} milestones` });
        progLabel.createSpan({ cls: 'cad-proj-progress-pct', text: `${p.meta.percent}%` });
        const bar = progWrap.createDiv({ cls: 'cad-proj-progress-bar' });
        const fill = bar.createDiv({ cls: 'cad-proj-progress-fill' });
        fill.style.width = `${p.meta.percent}%`;

        if (p.meta.next) {
          const nextRow = card.createDiv({ cls: 'cad-proj-next' });
          nextRow.createSpan({ cls: 'cad-proj-next-label', text: 'NEXT · ' });
          nextRow.createSpan({ cls: 'cad-proj-next-date', text: fmtValue(p.meta.next.date, 'date') });
          if (p.meta.next.title) nextRow.createSpan({ text: ` — ${p.meta.next.title}` });
        }
      });
    });
  }

  /* ── Home / Command Centre ───────────────── */
  async renderHome(root) {
    root.addClass('cadence-home');
    const settings = this.plugin.settings;

    /* Header */
    const today = new Date();
    const dateStr = today.toLocaleDateString(undefined, { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric' });
    this._renderPageHeader(root, `${greeting()}.`, dateStr, (right) => {
      const mk = (label, fn) => {
        const b = right.createEl('button', { cls: 'cad-btn', text: label });
        b.addEventListener('click', fn);
        return b;
      };
      mk('+ Task', () => this._quickAddTodayTask());
      mk('+ Deal', () => this._createEntityFromPrompt('deal'));
      mk('+ Contact', () => this._createEntityFromPrompt('contact'));
      mk('+ Project', () => this._createEntityFromPrompt('project'));
      const newInbox = mk('+ Inbox', () => this.plugin.openQuickCapture());
      newInbox.classList.add('primary');
    });

    /* Top of the day — assistant-style briefing */
    await this._renderBriefing(root);

    /* Two-column grid */
    const cols = root.createDiv({ cls: 'cad-home-cols' });
    const left = cols.createDiv({ cls: 'cad-home-col' });
    const right = cols.createDiv({ cls: 'cad-home-col' });

    /* ─── LEFT: Inbox + Today + Week + Upcoming + Partners ─── */
    await this._homeInboxCard(left);
    await this._homeTodayCard(left);
    await this._homeWeekCard(left);
    await this._homeUpcomingCard(left);
    await this._homePartnersCard(left);

    /* ─── RIGHT: Projects + Pipeline + Activities ─── */
    await this._homeProjectsCard(right);
    await this._homePipelineCard(right);
    await this._homeActivitiesCard(right);

  }

  async _getBaseResults(basePath, ttlMs = 60000) {
    // In-memory cache: instant on subsequent renders within the TTL
    if (!this._basesCache) this._basesCache = new Map();
    const cached = this._basesCache.get(basePath);
    if (cached && Date.now() - cached.ts < ttlMs) return cached.results;

    // Reuse an already-open leaf if available
    const existing = this.app.workspace.getLeavesOfType('bases')
      .find(l => l.view?.file?.path === basePath);
    if (existing?.view?.controller?.results) {
      const results = existing.view.controller.results;
      this._basesCache.set(basePath, { results, ts: Date.now() });
      return results;
    }

    const baseFile = this.app.vault.getAbstractFileByPath(basePath);
    if (!baseFile) return null;

    const previousLeaf = this.app.workspace.getLeaf(false);
    const leaf = this.app.workspace.getRightLeaf(false);
    await leaf.openFile(baseFile);
    if (previousLeaf) this.app.workspace.setActiveLeaf(previousLeaf, { focus: false });

    await new Promise(r => setTimeout(r, 1500));
    const results = leaf.view?.controller?.results ?? null;
    if (results) this._basesCache.set(basePath, { results, ts: Date.now() });
    return results;
  }

  async _homeBasesDemoCard(parent) {
    const BASE_PATH = '00-CORE/Bases/Clients.base';
    const body = this._homeCard(parent, 'BASES DEMO — Clients.base', null, 'sky');

    const baseFile = this.app.vault.getAbstractFileByPath(BASE_PATH);
    if (!baseFile) {
      body.createDiv({ cls: 'cad-empty', text: `Base not found: ${BASE_PATH}` });
      return;
    }

    try {
      const results = await this._getBaseResults(BASE_PATH);
      if (!results) {
        body.createDiv({ cls: 'cad-empty', text: 'No results — base may not have rendered yet.' });
        return;
      }

      body.createDiv({ cls: 'cad-empty', text: `✓ ${results.size} rows from Bases engine` });

      [...results.keys()].slice(0, 8).forEach(file => {
        const row = body.createDiv({ cls: 'cad-home-row' });
        const entry = results.get(file);
        const name = entry?.frontmatter?.client_name || file.basename;
        const status = entry?.frontmatter?.status || '';
        row.createDiv({ cls: 'cad-home-row-date', text: status });
        row.createDiv({ cls: 'cad-home-row-main', text: name });
      });
    } catch (e) {
      body.createDiv({ cls: 'cad-empty', text: `Error: ${e.message}` });
    }
  }

  _homeCard(parent, title, action, tone) {
    const card = parent.createDiv({ cls: 'cad-home-card' });
    if (tone) card.dataset.tone = tone;
    const head = card.createDiv({ cls: 'cad-home-card-head' });
    head.createDiv({ cls: 'cad-home-card-title', text: title });
    if (typeof action === 'function') action(head);
    return card.createDiv({ cls: 'cad-home-card-body' });
  }

  /* ── Top of the day — assistant-style daily briefing ── */
  async _renderBriefing(root) {
    let items = await this._computeBriefing();
    const card = root.createDiv({ cls: 'cad-briefing' });

    const head = card.createDiv({ cls: 'cad-briefing-head' });
    head.createDiv({ cls: 'cad-briefing-eyebrow', text: 'TOP OF THE DAY' });
    head.createDiv({ cls: 'cad-briefing-headline', text: this._briefingHeadline(items) });

    if (!items.length) {
      card.createDiv({ cls: 'cad-briefing-empty', text: 'Nothing flagged. Make today count.' });
      return;
    }

    // On mobile, trim to the top 3 most urgent. _computeBriefing already
    // emits items in priority order (overdue → time → opportunity → wins),
    // so a simple slice keeps what matters most.
    const isMobile = !!(obsidian.Platform && obsidian.Platform.isMobile);
    const hiddenCount = isMobile && items.length > 3 ? items.length - 3 : 0;
    if (isMobile && items.length > 3) items = items.slice(0, 3);

    const list = card.createDiv({ cls: 'cad-briefing-list' });
    items.forEach((it) => {
      const row = list.createDiv({ cls: `cad-briefing-row cad-tone-${it.tone || 'emerald'}` });
      row.createSpan({ cls: 'cad-briefing-icon', text: it.icon });
      row.createSpan({ cls: 'cad-briefing-text', text: it.text });
      if (it.action) {
        row.classList.add('clickable');
        row.addEventListener('click', it.action);
      }
    });
    if (hiddenCount > 0) {
      const more = card.createDiv({ cls: 'cad-briefing-more' });
      more.setText(`+${hiddenCount} more · scroll down for the full picture`);
    }
  }

  _briefingHeadline(items) {
    const hasOverdue = items.some((i) => i.tone === 'rose');
    if (hasOverdue) return 'A couple of things need attention this morning.';
    if (items.length >= 4) return "Here's what's worth your attention today.";
    if (items.length === 0) return 'Inbox zero. Clear runway.';
    return "Here's what's on your radar.";
  }

  async _computeBriefing() {
    const items = [];
    const settings = this.plugin.settings;
    const dealDef = ENTITIES.deal;
    const contactDef = ENTITIES.contact;
    const today = startOfDay(new Date());
    const todayMs = today.getTime();
    const nowMs = Date.now();

    /* 1. Open tasks today */
    try {
      const file = await ensureDailyNote(this.app, settings);
      const content = await this.app.vault.read(file);
      const parsed = parseSections(content, settings);
      const openTasks = parsed.tasks.filter((l) => / \[ \] /.test(l)).length;
      if (openTasks > 0) {
        items.push({
          icon: '🎯',
          tone: 'emerald',
          text: `${openTasks} open ${openTasks === 1 ? 'task' : 'tasks'} on today's note`,
          action: () => this.setMode('planner.today'),
        });
      }
    } catch (_) {}

    /* 2. Overdue reminders */
    const reminders = (settings.reminders || []).filter((r) => !r.done);
    const overdue = reminders.filter((r) => r.when && new Date(r.when).getTime() <= nowMs);
    if (overdue.length) {
      const ex = overdue[0];
      const exTxt = ex.text.length > 50 ? ex.text.slice(0, 47) + '…' : ex.text;
      items.push({
        icon: '⚠',
        tone: 'rose',
        text: overdue.length === 1
          ? `Overdue reminder — "${exTxt}"`
          : `${overdue.length} overdue reminders — "${exTxt}" + ${overdue.length - 1} more`,
        action: () => this.setMode('planner.inbox'),
      });
    }

    /* 3. Reminders due later today */
    const dueToday = reminders.filter((r) => {
      if (!r.when) return false;
      const w = new Date(r.when).getTime();
      return w > nowMs && w < todayMs + 86400000;
    });
    if (dueToday.length) {
      items.push({
        icon: '⏰',
        tone: 'mint',
        text: `${dueToday.length} ${dueToday.length === 1 ? 'reminder' : 'reminders'} due later today`,
        action: () => this.setMode('planner.inbox'),
      });
    }

    /* 4. Deals closing this week */
    const deals = listEntities(this.app, 'deal');
    const weekEnd = todayMs + 7 * 86400000;
    const closingThisWeek = deals.filter((e) => {
      const stage = String(entityValue(e, 'stage', dealDef));
      if (['Won', 'Lost'].includes(stage)) return false;
      const closeBy = entityValue(e, 'closeBy', dealDef);
      if (!closeBy) return false;
      const d = new Date(closeBy);
      return !isNaN(d.getTime()) && d.getTime() >= todayMs && d.getTime() <= weekEnd;
    });
    if (closingThisWeek.length) {
      const value = closingThisWeek.reduce((s, e) => s + (Number(entityValue(e, 'value', dealDef)) || 0), 0);
      items.push({
        icon: '💼',
        tone: 'sky',
        text: `${closingThisWeek.length} ${closingThisWeek.length === 1 ? 'deal closes' : 'deals close'} this week · ${fmtValue(value, 'currency')}`,
        action: () => this.setMode('crm.pipeline'),
      });
    }

    /* 5. Stale contacts on open deals (>30 days since lastContact) */
    const contacts = listEntities(this.app, 'contact');
    const openDeals = deals.filter((e) => !['Won', 'Lost'].includes(String(entityValue(e, 'stage', dealDef))));
    const dealContactNames = new Set(
      openDeals.map((d) => String(entityValue(d, 'contact', dealDef) || '').trim()).filter(Boolean)
    );
    const staleCutoffMs = todayMs - 30 * 86400000;
    let staleSample = null;
    let staleCount = 0;
    contacts.forEach((c) => {
      const name = String(entityValue(c, 'name', contactDef) || '').trim();
      if (!name || !dealContactNames.has(name)) return;
      const lc = entityValue(c, 'lastContact', contactDef);
      const lcMs = lc ? new Date(lc).getTime() : null;
      if (lcMs != null && !isNaN(lcMs) && lcMs >= staleCutoffMs) return;
      staleCount++;
      if (!staleSample) staleSample = { contact: c, name, lcMs };
    });
    if (staleSample) {
      const days = staleSample.lcMs ? Math.floor((todayMs - staleSample.lcMs) / 86400000) : null;
      const linkedDeal = openDeals.find((d) => String(entityValue(d, 'contact', dealDef) || '').trim() === staleSample.name);
      const dealName = linkedDeal ? entityValue(linkedDeal, 'title', dealDef) || '' : '';
      const ago = days === null ? 'never contacted' : `${days} ${days === 1 ? 'day' : 'days'} quiet`;
      const more = staleCount > 1 ? ` (+${staleCount - 1} more)` : '';
      items.push({
        icon: '👤',
        tone: 'warn',
        text: `${staleSample.name} — ${ago}${dealName ? ` · ${dealName}` : ''}${more}`,
        action: () => this.openEntityDetailFromFile(staleSample.contact.file),
      });
    }

    /* 6. Upcoming project milestones (next 14 days) */
    const projectFiles = listEntityFiles(this.app, 'project');
    const upcoming = [];
    for (const f of projectFiles) {
      try {
        const meta = await readProjectMeta(this.app, f);
        if (meta.next && meta.next.date) {
          const ms = meta.next.date.getTime();
          if (ms >= todayMs && ms <= todayMs + 14 * 86400000) {
            upcoming.push({ file: f, milestone: meta.next, name: projectNameFromPath(this.app, f.path) });
          }
        }
      } catch (_) {}
    }
    upcoming.sort((a, b) => a.milestone.date - b.milestone.date);
    if (upcoming.length) {
      const m = upcoming[0];
      const days = Math.max(0, Math.ceil((m.milestone.date.getTime() - todayMs) / 86400000));
      const dayStr = days === 0 ? 'today' : days === 1 ? 'tomorrow' : `in ${days} days`;
      const title = m.milestone.title || 'milestone';
      items.push({
        icon: '📅',
        tone: 'mint',
        text: `${m.name} · "${title}" — due ${dayStr}`,
        action: () => this.openEntityDetail('project', m.file),
      });
    }

    /* 7. Recent wins (deals moved to Won in last 7 days) */
    const winCutoff = nowMs - 7 * 86400000;
    const recentWins = deals.filter((e) => {
      if (String(entityValue(e, 'stage', dealDef)) !== 'Won') return false;
      return e.file && e.file.stat && e.file.stat.mtime >= winCutoff;
    });
    if (recentWins.length) {
      const value = recentWins.reduce((s, e) => s + (Number(entityValue(e, 'value', dealDef)) || 0), 0);
      items.push({
        icon: '🎉',
        tone: 'emerald',
        text: `${recentWins.length} ${recentWins.length === 1 ? 'deal won' : 'deals won'} this week · ${fmtValue(value, 'currency')}`,
        action: () => this.setMode('reports.sales'),
      });
    }

    return items;
  }

  async _homeInboxCard(parent) {
    const reminders = (this.plugin.settings.reminders || []).filter((r) => !r.done);
    const overdueCount = reminders.filter((r) => r.when && new Date(r.when).getTime() <= Date.now()).length;
    const tone = overdueCount > 0 ? 'rose' : 'sky';

    const headTitle = `INBOX — ${reminders.length} item${reminders.length === 1 ? '' : 's'}${overdueCount > 0 ? ` · ${overdueCount} overdue` : ''}`;
    const body = this._homeCard(parent, headTitle, (head) => {
      const cap = head.createEl('a', { cls: 'cad-home-card-link', text: '+ Capture' });
      cap.style.marginRight = '12px';
      cap.addEventListener('click', (e) => { e.preventDefault(); this.plugin.openQuickCapture(); });
      const link = head.createEl('a', { cls: 'cad-home-card-link', text: 'Open Inbox →' });
      link.addEventListener('click', (e) => { e.preventDefault(); this.setMode('planner.inbox'); });
    }, tone);

    if (!reminders.length) {
      body.createDiv({ cls: 'cad-empty', text: 'Inbox zero — capture anything with + Inbox above (or Cmd+Shift+I).' });
      return;
    }

    // Sort: scheduled by when ascending, unscheduled fall to the end
    const sorted = [...reminders].sort((a, b) => {
      const wa = a.when ? new Date(a.when).getTime() : Infinity;
      const wb = b.when ? new Date(b.when).getTime() : Infinity;
      return wa - wb;
    });

    sorted.slice(0, 5).forEach((r) => {
      const row = body.createDiv({ cls: 'cad-home-row' });
      const isOverdue = r.when && new Date(r.when).getTime() <= Date.now();
      if (isOverdue) row.classList.add('overdue');
      row.createDiv({ cls: 'cad-home-row-date', text: r.when ? reminderTimeStr(r.when) : 'unscheduled' });
      const main = row.createDiv({ cls: 'cad-home-row-main' });
      main.createDiv({ cls: 'cad-home-row-title', text: r.text });
      const metaBits = [];
      if (r.project) metaBits.push(`📁 ${projectNameFromPath(this.app, r.project) || 'project'}`);
      if (r.repeat && r.repeat !== 'none') metaBits.push(r.repeat === 'daily' ? '↻ daily' : '↻ weekly');
      if (r.notes) {
        const firstLine = String(r.notes).split('\n').find((l) => l.trim()) || '';
        if (firstLine) metaBits.push(`📝 ${firstLine.length > 60 ? firstLine.slice(0, 57) + '…' : firstLine}`);
      }
      if (metaBits.length) main.createDiv({ cls: 'cad-home-row-meta', text: metaBits.join('  ·  ') });
      row.addEventListener('click', () => new CadenceReminderEditModal(this.app, this.plugin, r).open());
    });
  }

  async _homeTodayCard(parent) {
    const file = await ensureDailyNote(this.app, this.plugin.settings);
    const content = await this.app.vault.read(file);
    const parsed = parseSections(content, this.plugin.settings);
    const open = parsed.tasks.filter((l) => / \[ \] /.test(l));
    const done = parsed.tasks.filter((l) => / \[(x|X)\] /.test(l));

    const body = this._homeCard(parent, `TODAY — ${open.length} open · ${done.length} done`, (head) => {
      const link = head.createEl('a', { cls: 'cad-home-card-link', text: 'Open Today →' });
      link.addEventListener('click', (e) => { e.preventDefault(); this.setMode('planner.today'); });
    }, 'emerald');

    if (!parsed.tasks.length) {
      body.createDiv({ cls: 'cad-empty', text: 'No tasks yet — add one with + Task above.' });
      return;
    }
    parsed.tasks.forEach((rawLine, idx) => {
      const checked = / \[(x|X)\] /.test(rawLine);
      const text = rawLine.replace(/^\s*-\s\[(x|X| )\]\s/, '');
      const row = body.createDiv({ cls: 'cad-home-task' + (checked ? ' done' : '') });
      const cb = row.createEl('input', { type: 'checkbox' });
      cb.checked = checked;
      cb.addEventListener('change', async () => {
        const cur = await this.app.vault.read(file);
        const cp = parseSections(cur, this.plugin.settings);
        const taskLine = cp.tasks[idx] || '';
        const taskText = taskLine.replace(/^\s*-\s\[(x|X| )\]\s/, '').trim();
        const newTasks = cp.tasks.map((line, i) => {
          if (i !== idx) return line;
          return cb.checked
            ? line.replace(/^\s*-\s\[\s\]\s/, '- [x] ')
            : line.replace(/^\s*-\s\[(x|X)\]\s/, '- [ ] ');
        });
        const next = replaceSection(cur, this.plugin.settings.tasksHeading, newTasks.join('\n'));
        await this.app.vault.modify(file, next);
        if (taskText) {
          await this._propagateTaskComplete(taskText, cb.checked, { kind: 'daily', file, date: new Date() });
        }
      });
      row.createSpan({ cls: 'cad-task-text', text });

      /* Project link button + chip */
      const dailyPath = file.path;
      const linkedProject = this._getTaskProjectLink(dailyPath, text);
      if (linkedProject) {
        const chip = row.createEl('a', { cls: 'cad-task-proj-chip', text: '📁 ' + (projectNameFromPath(this.app, linkedProject) || 'Project') });
        chip.title = 'Open linked project';
        chip.addEventListener('click', (ev) => {
          ev.preventDefault();
          ev.stopPropagation();
          const f = this.app.vault.getAbstractFileByPath(linkedProject);
          if (f && f instanceof obsidian.TFile) this.openEntityDetail('project', f);
        });
      }
      const linkBtn = row.createEl('button', { cls: 'cad-task-link-btn' + (linkedProject ? ' linked' : ''), text: linkedProject ? '✎' : '📁' });
      linkBtn.title = linkedProject ? 'Change linked project' : 'Link to a project';
      linkBtn.addEventListener('click', (ev) => {
        ev.stopPropagation();
        this._openTaskProjectPicker(dailyPath, text, linkedProject);
      });
    });
  }

  async _homeWeekCard(parent) {
    const settings = this.plugin.settings;
    const taskMode = settings.taskMode || 'checkbox';
    const includeCheckboxTasks = taskMode === 'checkbox' || taskMode === 'hybrid';
    const includeTaskNotes = taskMode === 'tasknotes' || taskMode === 'hybrid';
    const weekStart = startOfWeek(new Date(), settings.weekStartsOn);
    let open = 0, done = 0;
    const weekEnd = addDays(weekStart, 6);
    const taskNotes = includeTaskNotes ? listTaskNotesForProductivity(this.app, settings, weekStart, weekEnd) : [];
    for (let i = 0; i < 7; i++) {
      const d = addDays(weekStart, i);
      const f = this.app.vault.getAbstractFileByPath(dailyNotePath(settings, d));
      if (includeCheckboxTasks && f && f instanceof obsidian.TFile) {
        const c = await this.app.vault.read(f);
        const p = parseSections(c, settings);
        p.tasks.forEach((l) => { if (/ \[(x|X)\] /.test(l)) done++; else if (/ \[ \] /.test(l)) open++; });
      }
    }
    taskNotes.forEach((task) => {
      if (task.done) done++;
      else open++;
    });
    const total = open + done;
    const pct = total === 0 ? 0 : Math.round((done / total) * 100);

    const body = this._homeCard(parent, `THIS WEEK — ${done}/${total} done`, (head) => {
      const link = head.createEl('a', { cls: 'cad-home-card-link', text: 'Open Calendar →' });
      link.addEventListener('click', (e) => { e.preventDefault(); this.setMode('planner.calendar'); });
    }, 'mint');

    const wrap = body.createDiv({ cls: 'cad-proj-progress-wrap' });
    wrap.dataset.pctBand = pctBand(pct);
    const lbl = wrap.createDiv({ cls: 'cad-proj-progress-label' });
    lbl.createSpan({ text: total ? `${done} of ${total} tasks completed` : 'No tasks logged this week yet' });
    lbl.createSpan({ cls: 'cad-proj-progress-pct', text: `${pct}%` });
    const bar = wrap.createDiv({ cls: 'cad-proj-progress-bar' });
    const fill = bar.createDiv({ cls: 'cad-proj-progress-fill' });
    fill.style.width = `${pct}%`;
  }

  async _homeUpcomingCard(parent) {
    const today = startOfDay(new Date());
    const horizon = addDays(today, 7);
    const items = [];

    // Project deadlines
    const projects = listEntities(this.app, 'project');
    projects.forEach((e) => {
      const due = entityValue(e, 'due', ENTITIES.project);
      if (!due) return;
      const d = new Date(due);
      if (isNaN(d.getTime())) return;
      if (d >= today && d <= horizon) {
        items.push({ date: d, title: entityValue(e, 'name', ENTITIES.project) || e.basename, type: 'Project due', file: e.file });
      }
    });
    // Project milestones (next upcoming per project)
    for (const e of projects) {
      try {
        const meta = await readProjectMeta(this.app, e.file);
        if (meta.next && meta.next.date && meta.next.date >= today && meta.next.date <= horizon) {
          items.push({ date: meta.next.date, title: `${entityValue(e, 'name', ENTITIES.project) || e.basename} — ${meta.next.title || 'milestone'}`, type: 'Milestone', file: e.file });
        }
      } catch (_) {}
    }
    // Registration expiries
    listEntities(this.app, 'registration').forEach((e) => {
      const exp = entityValue(e, 'expires_date', ENTITIES.registration);
      if (!exp) return;
      const d = new Date(exp);
      if (isNaN(d.getTime())) return;
      if (d >= today && d <= horizon) {
        items.push({ date: d, title: entityValue(e, 'title', ENTITIES.registration) || e.basename, type: 'Registration expires', file: e.file });
      }
    });
    // Cert expiries
    listEntities(this.app, 'certification').forEach((e) => {
      const exp = entityValue(e, 'expires_date', ENTITIES.certification);
      if (!exp) return;
      const d = new Date(exp);
      if (isNaN(d.getTime())) return;
      if (d >= today && d <= horizon) {
        items.push({ date: d, title: entityValue(e, 'name', ENTITIES.certification) || e.basename, type: 'Cert expires', file: e.file });
      }
    });

    items.sort((a, b) => a.date - b.date);
    const body = this._homeCard(parent, `UPCOMING · NEXT 7 DAYS — ${items.length}`, undefined, 'warn');
    if (!items.length) {
      body.createDiv({ cls: 'cad-empty', text: 'Nothing on the radar.' });
      return;
    }
    items.slice(0, 6).forEach((it) => {
      const row = body.createDiv({ cls: 'cad-home-row' });
      row.createDiv({ cls: 'cad-home-row-date', text: fmtValue(it.date, 'date') });
      const main = row.createDiv({ cls: 'cad-home-row-main' });
      main.createDiv({ cls: 'cad-home-row-title', text: it.title });
      main.createDiv({ cls: 'cad-home-row-meta', text: it.type });
      row.addEventListener('click', () => this.openEntityDetailFromFile(it.file));
    });
  }

  async _homePartnersCard(parent) {
    const partners = listEntities(this.app, 'partner');
    const body = this._homeCard(parent, `PARTNERS — ${partners.length}`, (head) => {
      const link = head.createEl('a', { cls: 'cad-home-card-link', text: 'Open Partners →' });
      link.addEventListener('click', (e) => { e.preventDefault(); this.setMode('prm.partners'); });
    }, 'sky');
    if (!partners.length) {
      body.createDiv({ cls: 'cad-empty', text: 'No partners on the books yet.' });
      return;
    }
    partners.slice(0, 5).forEach((e) => {
      const row = body.createDiv({ cls: 'cad-home-row' });
      const main = row.createDiv({ cls: 'cad-home-row-main' });
      main.createDiv({ cls: 'cad-home-row-title', text: entityValue(e, 'name', ENTITIES.partner) || e.basename });
      const tier = entityValue(e, 'tier', ENTITIES.partner) || '';
      const status = entityValue(e, 'status', ENTITIES.partner) || '';
      main.createDiv({ cls: 'cad-home-row-meta', text: [tier, status].filter(Boolean).join(' · ') });
      row.addEventListener('click', () => this.openEntityDetailFromFile(e.file));
    });
  }

  async _homeProjectsCard(parent) {
    const def = ENTITIES.project;
    const files = listEntityFiles(this.app, 'project');
    const body = this._homeCard(parent, `ACTIVE PROJECTS — ${files.length}`, (head) => {
      const link = head.createEl('a', { cls: 'cad-home-card-link', text: 'Open Projects →' });
      link.addEventListener('click', (e) => { e.preventDefault(); this.setMode('planner.projects'); });
    }, 'emerald');
    if (!files.length) {
      body.createDiv({ cls: 'cad-empty', text: 'No projects yet — hit + Project above.' });
      return;
    }
    const projects = await Promise.all(files.map(async (f) => {
      const e = readEntity(this.app, f);
      const status = String(entityValue(e, 'status', def) || 'active').toLowerCase().replace(/[-\s]+/g, '_');
      const terminalStatuses = def.terminalStatuses || ['done', 'cancelled', 'completed', 'archived'];
      if (terminalStatuses.map((s) => s.replace(/[-\s]+/g, '_')).includes(status)) return null;
      const meta = await readProjectMeta(this.app, f);
      return { entity: e, meta };
    }));
    const active = projects.filter(Boolean).slice(0, 3);
    if (!active.length) {
      body.createDiv({ cls: 'cad-empty', text: 'No active projects right now.' });
      return;
    }
    active.forEach((p) => {
      const row = body.createDiv({ cls: 'cad-home-proj' });
      row.dataset.pctBand = pctBand(p.meta.percent);
      const head = row.createDiv({ cls: 'cad-home-proj-head' });
      head.createSpan({ cls: 'cad-home-proj-title', text: entityValue(p.entity, 'name', def) || p.entity.basename });
      head.createSpan({ cls: 'cad-home-proj-pct', text: `${p.meta.percent}%` });
      const bar = row.createDiv({ cls: 'cad-proj-progress-bar' });
      const fill = bar.createDiv({ cls: 'cad-proj-progress-fill' });
      fill.style.width = `${p.meta.percent}%`;
      if (p.meta.next) {
        row.createDiv({ cls: 'cad-home-row-meta', text: `NEXT · ${fmtValue(p.meta.next.date, 'date')}${p.meta.next.title ? ' — ' + p.meta.next.title : ''}` });
      }
      row.addEventListener('click', () => this.openEntityDetail('project', p.entity.file));
    });
  }

  async _homePipelineCard(parent) {
    const def = ENTITIES.deal;
    const deals = listEntities(this.app, 'deal');
    const open = deals.filter((e) => !dealTerminalStages(def).includes(String(entityValue(e, dealStageField(def), def))));
    const value = open.reduce((s, e) => s + (Number(entityValue(e, dealValueField(def), def)) || 0), 0);

    const body = this._homeCard(parent, `PIPELINE — ${open.length} open · ${fmtValue(value, 'currency')}`, (head) => {
      const link = head.createEl('a', { cls: 'cad-home-card-link', text: 'Open Pipeline →' });
      link.addEventListener('click', (e) => { e.preventDefault(); this.setMode('crm.pipeline'); });
    }, 'sky');
    if (!open.length) {
      body.createDiv({ cls: 'cad-empty', text: 'No open deals — hit + Deal above.' });
      return;
    }
    const top = [...open].sort((a, b) => (Number(entityValue(b, dealValueField(def), def)) || 0) - (Number(entityValue(a, dealValueField(def), def)) || 0)).slice(0, 4);
    top.forEach((e) => {
      const row = body.createDiv({ cls: 'cad-home-row' });
      const main = row.createDiv({ cls: 'cad-home-row-main' });
      main.createDiv({ cls: 'cad-home-row-title', text: entityValue(e, 'title', def) || e.basename });
      const stage = entityValue(e, dealStageField(def), def);
      main.createDiv({ cls: 'cad-home-row-meta', text: `${stage || '—'} · ${fmtValue(entityValue(e, dealValueField(def), def), 'currency')}` });
      row.addEventListener('click', () => this.openEntityDetailFromFile(e.file));
    });
  }

  async _homeActivitiesCard(parent) {
    const def = ENTITIES.activity;
    const acts = listEntities(this.app, 'activity');
    const body = this._homeCard(parent, `RECENT ACTIVITY — ${acts.length}`, (head) => {
      const link = head.createEl('a', { cls: 'cad-home-card-link', text: 'Open Activities →' });
      link.addEventListener('click', (e) => { e.preventDefault(); this.setMode('crm.activities'); });
    }, 'rose');
    if (!acts.length) {
      body.createDiv({ cls: 'cad-empty', text: 'No activities logged yet.' });
      return;
    }
    const sorted = [...acts].sort((a, b) => {
      const da = new Date(activityDate(a, def) || 0).getTime();
      const db = new Date(activityDate(b, def) || 0).getTime();
      return db - da;
    }).slice(0, 5);
    sorted.forEach((e) => {
      const row = body.createDiv({ cls: 'cad-home-row' });
      const main = row.createDiv({ cls: 'cad-home-row-main' });
      main.createDiv({ cls: 'cad-home-row-title', text: activityTitle(e, def) });
      main.createDiv({ cls: 'cad-home-row-meta', text: `${entityValue(e, 'channel', def) || '—'} · ${fmtValue(activityDate(e, def), 'date')}` });
      row.addEventListener('click', () => this.openEntityDetailFromFile(e.file));
    });
  }

  /* ── Inbox (Planner reminders + captures) ── */
  async renderInbox(root) {
    root.addClass('cadence-inbox');
    const all = (this.plugin.settings.reminders || []).filter((r) => !r.done);

    // Sort: scheduled by when, captures by createdAt
    all.sort((a, b) => {
      const wa = a.when ? new Date(a.when).getTime() : Infinity;
      const wb = b.when ? new Date(b.when).getTime() : Infinity;
      if (wa !== wb) return wa - wb;
      const ca = a.createdAt ? new Date(a.createdAt).getTime() : 0;
      const cb = b.createdAt ? new Date(b.createdAt).getTime() : 0;
      return cb - ca;
    });

    // Bucket
    const buckets = { now: [], today: [], week: [], later: [] };
    all.forEach((r) => buckets[reminderBucket(r.when)].push(r));

    this._renderPageHeader(root, 'Inbox', `${all.length} ${all.length === 1 ? 'item' : 'items'} · capture once, surface at the right time`, (right) => {
      const captureBtn = right.createEl('button', { cls: 'cad-btn primary', text: '+ Quick capture' });
      captureBtn.addEventListener('click', () => this.plugin.openQuickCapture());
    });

    if (!all.length) {
      const empty = root.createDiv({ cls: 'cad-empty-state' });
      empty.createDiv({ cls: 'cad-empty-state-title', text: 'Inbox zero' });
      empty.createDiv({ cls: 'cad-empty-state-desc', text: 'Capture anything with + Quick capture above (or Cmd+Shift+I). Add a time and BOB Workspace will remind you.' });
      return;
    }

    const sectionLabels = { now: 'NOW · OVERDUE OR DUE WITHIN 1 HOUR', today: 'TODAY', week: 'THIS WEEK', later: 'LATER · UNSCHEDULED' };
    ['now', 'today', 'week', 'later'].forEach((key) => {
      const items = buckets[key];
      if (!items.length) return;
      root.createDiv({ cls: 'cad-section-label-lg', text: `${sectionLabels[key]} · ${items.length}` });
      const list = root.createDiv({ cls: 'cad-inbox-list' });
      items.forEach((r) => this._renderInboxRow(list, r, key));
    });

    /* ── PROJECT TASKS — every open `- [ ]` from every project's ## Tasks ── */
    await this._renderProjectTasksSection(root);
  }

  async _renderProjectTasksSection(root) {
    const projectFiles = listEntityFiles(this.app, 'project');
    if (!projectFiles.length) return;

    /* Read each project's Tasks section + collect open tasks */
    const groups = [];
    let totalOpen = 0;
    for (const file of projectFiles) {
      let content;
      try { content = await this.app.vault.read(file); }
      catch (_) { continue; }
      const sections = parseH2Sections(content);
      const tasksText = sections['Tasks'] || '';
      if (!tasksText.trim()) continue;
      const tasks = parseTasksList(tasksText);
      const open = tasks.filter((t) => !t.done && t.title);
      if (!open.length) continue;
      totalOpen += open.length;
      groups.push({
        file,
        name: projectNameFromPath(this.app, file.path),
        tasks: open,
      });
    }

    if (!totalOpen) return;

    root.createDiv({ cls: 'cad-section-label-lg', text: `PROJECT TASKS · ${totalOpen} open across ${groups.length} ${groups.length === 1 ? 'project' : 'projects'}` });
    const wrap = root.createDiv({ cls: 'cad-pt-wrap' });

    groups.forEach((g) => {
      const card = wrap.createDiv({ cls: 'cad-pt-group' });
      const head = card.createDiv({ cls: 'cad-pt-group-head' });
      const link = head.createEl('a', { cls: 'cad-pt-group-link', text: '📁 ' + g.name });
      link.addEventListener('click', (e) => { e.preventDefault(); this.openEntityDetail('project', g.file); });
      head.createSpan({ cls: 'cad-pt-group-meta', text: `${g.tasks.length} open` });

      const list = card.createDiv({ cls: 'cad-pt-list' });
      g.tasks.forEach((t) => {
        const linked = findProjectTaskReminder(this.plugin, g.file.path, t.title);
        const row = list.createDiv({ cls: 'cad-pt-row' });
        row.createSpan({ cls: 'cad-pt-bullet', text: '•' });
        const txt = row.createSpan({ cls: 'cad-pt-text', text: t.title });
        void txt;
        if (linked && linked.when) {
          row.createSpan({ cls: 'cad-pt-when', text: reminderTimeStr(linked.when) });
        }
        const bell = row.createEl('button', {
          cls: 'cad-btn cad-btn-sm cad-pt-bell' + (linked ? ' linked' : ''),
          text: linked ? '🔔' : '🔕',
        });
        bell.title = linked ? 'Edit reminder' : 'Set a reminder';
        bell.addEventListener('click', (ev) => {
          ev.stopPropagation();
          const existing = findProjectTaskReminder(this.plugin, g.file.path, t.title);
          if (existing) {
            new CadenceReminderEditModal(this.app, this.plugin, existing).open();
          } else {
            new CadenceReminderEditModal(this.app, this.plugin, {
              text: t.title,
              when: null,
              repeat: 'none',
              notes: '',
              project: g.file.path,
            }, { isNew: true }).open();
          }
        });
        row.addEventListener('click', () => this.openEntityDetail('project', g.file));
      });
    });
  }

  _renderInboxRow(parent, r, bucket) {
    const row = parent.createDiv({ cls: 'cad-inbox-row' + (bucket === 'now' ? ' overdue' : '') });

    const left = row.createDiv({ cls: 'cad-inbox-row-left' });
    const tWrap = left.createDiv({ cls: 'cad-inbox-time' });
    if (r.when) {
      tWrap.createSpan({ cls: 'cad-inbox-time-text', text: reminderTimeStr(r.when) });
      if (r.repeat && r.repeat !== 'none') {
        tWrap.createSpan({ cls: 'cad-inbox-repeat', text: r.repeat === 'daily' ? '↻ daily' : '↻ weekly' });
      }
    } else {
      tWrap.createSpan({ cls: 'cad-inbox-time-text muted', text: 'unscheduled' });
    }

    const main = row.createDiv({ cls: 'cad-inbox-row-main' });
    main.createDiv({ cls: 'cad-inbox-row-text', text: r.text });

    if (r.project) {
      const chipRow = main.createDiv({ cls: 'cad-inbox-row-meta-row' });
      const chip = chipRow.createEl('a', { cls: 'cad-rem-project-chip', text: '📁 ' + (projectNameFromPath(this.app, r.project) || 'Project') });
      chip.title = 'Open project';
      chip.addEventListener('click', (ev) => {
        ev.preventDefault();
        ev.stopPropagation();
        const file = this.app.vault.getAbstractFileByPath(r.project);
        if (file && file instanceof obsidian.TFile) this.openEntityDetail('project', file);
      });
    }

    if (r.notes) {
      const previewLine = String(r.notes).split('\n').find((l) => l.trim()) || '';
      if (previewLine) {
        const note = main.createDiv({ cls: 'cad-inbox-row-notes' });
        note.createSpan({ cls: 'cad-inbox-row-notes-icon', text: '📝 ' });
        note.appendText(previewLine.length > 120 ? previewLine.slice(0, 117) + '…' : previewLine);
      }
    }

    // Row body click → open edit modal
    const openEdit = () => new CadenceReminderEditModal(this.app, this.plugin, r).open();
    left.addEventListener('click', openEdit);
    main.addEventListener('click', openEdit);
    left.style.cursor = 'pointer';
    main.style.cursor = 'pointer';

    const actions = row.createDiv({ cls: 'cad-inbox-actions' });
    const mk = (label, title, fn) => {
      const b = actions.createEl('button', { cls: 'cad-btn cad-btn-sm', text: label });
      b.title = title;
      b.addEventListener('click', (ev) => { ev.stopPropagation(); fn(); });
      return b;
    };
    if (r.when) {
      mk('+15m',  'Snooze 15 minutes', () => this.plugin.snoozeReminder(r.id, 15 * 60 * 1000));
      mk('+1h',   'Snooze 1 hour',     () => this.plugin.snoozeReminder(r.id, 60 * 60 * 1000));
      mk('Tom.',  'Snooze to tomorrow 9am', () => {
        const d = new Date(); d.setDate(d.getDate() + 1); d.setHours(9, 0, 0, 0);
        this.plugin.updateReminder(r.id, { when: d.toISOString(), notified: false });
      });
    } else {
      mk('Schedule', 'Add a time', () => openEdit());
    }
    mk('Edit', 'Edit details + notes', () => openEdit());
    const doneBtn = mk('Done', 'Mark done', async () => {
      await this.plugin.completeReminder(r.id);
      if (r.text) await this._propagateTaskComplete(r.text, true, { kind: 'reminder', id: r.id });
    });
    doneBtn.classList.add('primary');
    const delBtn = mk('×', 'Delete', () => {
      if (confirm('Delete this reminder?')) this.plugin.deleteReminder(r.id);
    });
    delBtn.classList.add('cad-btn-danger');
  }

  async _quickAddTodayTask() {
    const text = await this._prompt({
      title: 'Quick add — today',
      placeholder: 'What needs doing?',
      cta: 'Add task',
    });
    if (!text) return;
    const file = await ensureDailyNote(this.app, this.plugin.settings);
    const content = await this.app.vault.read(file);
    const parsed = parseSections(content, this.plugin.settings);
    const newTasks = [...parsed.tasks, `- [ ] ${text}`];
    const next = replaceSection(content, this.plugin.settings.tasksHeading, newTasks.join('\n'));
    await this.app.vault.modify(file, next);
    new obsidian.Notice('Added to today');
  }

  /* ── Pipeline kanban (deals grouped by stage) ───── */
  async renderEntityKanban(root, entityKey, groupBy, groups) {
    root.addClass('cadence-kanban');
    const def = ENTITIES[entityKey];
    const entities = listEntities(this.app, entityKey);
    const totalValue = entities.reduce((sum, e) => sum + (Number(entityValue(e, dealValueField(def), def)) || 0), 0);

    const unsupported = def.unsupportedBaseFilters || [];
    const unsupportedText = unsupported.length
      ? ` · ${unsupported.length} Base filter${unsupported.length === 1 ? '' : 's'} not applied`
      : '';
    this._renderPageHeader(root, def.plural, `${entities.length} ${entities.length === 1 ? def.label.toLowerCase() : def.plural.toLowerCase()} · ${fmtValue(totalValue, 'currency')} total${unsupportedText}`, (right) => {
      this._renderEntityViewSelect(right, entityKey);
      if (def.externalBaseView) {
        const openBaseBtn = right.createEl('button', { cls: 'cad-btn', text: 'Open Base' });
        openBaseBtn.addEventListener('click', () => this._openEntityBase(entityKey));
      }
      const importBtn = right.createEl('button', { cls: 'cad-btn', text: 'Import CSV' });
      importBtn.addEventListener('click', () => new CadenceImportModal(this.app, { entityKey }).open());
      const btn = right.createEl('button', { cls: 'cad-btn primary', text: `+ New ${def.label}` });
      btn.addEventListener('click', () => this._createEntityFromPrompt(entityKey));
    });

    if (this._renderExternalBaseView(root, entityKey)) return;
    this._renderUnsupportedBaseFilters(root, def);

    const board = root.createDiv({ cls: 'cad-kanban-board' });
    groups.forEach((stage) => {
      const items = entities.filter((e) => String(entityValue(e, groupBy, def) || '') === stage);
      const stageValue = items.reduce((s, e) => s + (Number(entityValue(e, dealValueField(def), def)) || 0), 0);

      const col = board.createDiv({ cls: 'cad-kanban-col' });
      col.dataset.stage = stage;
      const head = col.createDiv({ cls: 'cad-kanban-col-head' });
      head.createDiv({ cls: 'cad-kanban-col-title', text: stage });
      head.createDiv({ cls: 'cad-kanban-col-meta', text: `${items.length} · ${fmtValue(stageValue, 'currency')}` });

      const list = col.createDiv({ cls: 'cad-kanban-col-list' });

      // Drop target: drop a card here to update its `groupBy` field to this stage.
      list.addEventListener('dragover', (ev) => {
        ev.preventDefault();
        try { ev.dataTransfer.dropEffect = 'move'; } catch (_) {}
        col.addClass('drag-over');
      });
      list.addEventListener('dragleave', (ev) => {
        // Only clear when leaving the column entirely
        if (!col.contains(ev.relatedTarget)) col.removeClass('drag-over');
      });
      list.addEventListener('drop', async (ev) => {
        ev.preventDefault();
        col.removeClass('drag-over');
        const path = ev.dataTransfer.getData('text/cadence-entity');
        const fromStage = ev.dataTransfer.getData('text/cadence-stage');
        if (!path || fromStage === stage) return;
        const file = this.app.vault.getAbstractFileByPath(path);
        if (!file || !(file instanceof obsidian.TFile)) return;
        try {
          await this.app.fileManager.processFrontMatter(file, (fm) => { fm[groupBy] = stage; });
          new obsidian.Notice(`Moved to ${stage}`);
          // The metadataCache.changed listener re-renders for us.
        } catch (e) {
          new obsidian.Notice(`Failed to move: ${e.message}`);
        }
      });

      if (!items.length) {
        list.createDiv({ cls: 'cad-empty', text: '—' });
      } else {
        const isMobile = !!(obsidian.Platform && obsidian.Platform.isMobile);
        items.forEach((e) => {
          const card = list.createDiv({ cls: 'cad-kanban-card' });
          card.dataset.path = e.file.path;
          card.createDiv({ cls: 'cad-kanban-card-title', text: entityPrimaryValue(e, def) });
          const meta = card.createDiv({ cls: 'cad-kanban-card-meta' });
          const v = entityValue(e, dealValueField(def), def);
          if (v) meta.createSpan({ cls: 'cad-kanban-card-value', text: fmtValue(v, 'currency') });
          const co = entityValue(e, 'company', def);
          if (co) meta.createSpan({ cls: 'cad-kanban-card-company', text: ' · ' + co });

          /* Drag-to-move is a desktop-only affordance. On mobile, HTML5 drag
             doesn't reliably fire from touch and the `draggable` attribute
             can interfere with native scrolling. Mobile users instead tap
             the card to open detail, then change the stage from there. */
          if (!isMobile) {
            card.draggable = true;
            card.addEventListener('dragstart', (ev) => {
              card.addClass('dragging');
              try {
                ev.dataTransfer.effectAllowed = 'move';
                ev.dataTransfer.setData('text/cadence-entity', e.file.path);
                ev.dataTransfer.setData('text/cadence-stage', stage);
                // Plain text payload too, so dropping into editors yields a link
                ev.dataTransfer.setData('text/plain', `[[${e.file.basename}]]`);
              } catch (_) {}
            });
            card.addEventListener('dragend', () => card.removeClass('dragging'));
          } else {
            card.addClass('cad-kanban-card-touch');
          }
          card.addEventListener('click', () => this.openEntityDetail(entityKey, e.file));
        });
      }
    });
  }

  /* ── CRM Dashboard ──────────────────────── */
  async renderDashboard(root) {
    root.addClass('cadence-dashboard');

    // ─── Read all the relevant data ────────────────────
    const dealDef = ENTITIES.deal;
    const allDeals = listEntities(this.app, 'deal');
    const open = allDeals.filter((e) => !dealTerminalStages(dealDef).includes(String(entityValue(e, dealStageField(dealDef), dealDef))));
    const won  = allDeals.filter((e) => dealWonStages(dealDef).includes(String(entityValue(e, dealStageField(dealDef), dealDef))));
    const lost = allDeals.filter((e) => dealLostStages(dealDef).includes(String(entityValue(e, dealStageField(dealDef), dealDef))));
    const dealValue = (e) => Number(entityValue(e, dealValueField(dealDef), dealDef)) || 0;
    const sumVal = (arr) => arr.reduce((s, e) => s + dealValue(e), 0);
    const winRate = won.length + lost.length === 0 ? 0 : Math.round((won.length / (won.length + lost.length)) * 100);
    const avgDeal = won.length === 0 ? 0 : sumVal(won) / won.length;

    const contacts  = listEntityFiles(this.app, 'contact');
    const companies = listEntityFiles(this.app, 'company');
    const partners  = listEntityFiles(this.app, 'partner');
    const activities = listEntities(this.app, 'activity');

    // ─── Header ────────────────────────────────────────
    this._renderPageHeader(root, 'CRM Dashboard', 'Pipeline · momentum · recent activity', (right) => {
      const newDeal = right.createEl('button', { cls: 'cad-btn primary', text: '+ New Deal' });
      newDeal.addEventListener('click', () => this._createEntityFromPrompt('deal'));
    });

    // ─── Top stats (5 cards) ───────────────────────────
    const grid = root.createDiv({ cls: 'cad-stat-grid' });
    const stat = (label, value, sub, accent) => {
      const c = grid.createDiv({ cls: 'cad-stat-card' });
      if (accent) c.dataset.accent = accent;
      c.createDiv({ cls: 'cad-stat-label', text: label });
      c.createDiv({ cls: 'cad-stat-value', text: String(value) });
      if (sub) c.createDiv({ cls: 'cad-stat-sub', text: sub });
    };
    stat('OPEN PIPELINE', open.length, fmtValue(sumVal(open), 'currency'), 'sky');
    stat('WON',           won.length,  fmtValue(sumVal(won),  'currency'), 'emerald');
    stat('LOST',          lost.length, fmtValue(sumVal(lost), 'currency'), 'rose');
    stat('WIN RATE',      `${winRate}%`, `${won.length}/${won.length + lost.length} closed`, 'mint');
    stat('AVG DEAL',      fmtValue(avgDeal, 'currency'), `${won.length} won deals`, 'warn');

    // ─── Pipeline by stage ─────────────────────────────
    root.createDiv({ cls: 'cad-section-label-lg', text: 'PIPELINE BY STAGE' });
    const stageData = getDealStages(dealDef).map((stage) => {
      const items = allDeals.filter((e) => String(entityValue(e, dealStageField(dealDef), dealDef)) === stage);
      return { stage, items, value: sumVal(items) };
    });
    const maxStageVal = Math.max(1, ...stageData.map((s) => s.value));
    const stageWrap = root.createDiv({ cls: 'cad-stage-bars' });
    stageData.forEach(({ stage, items, value }) => {
      const row = stageWrap.createDiv({ cls: 'cad-stage-bar-row' });
      row.dataset.stage = stage;
      row.createDiv({ cls: 'cad-stage-bar-name', text: stage });
      row.createDiv({ cls: 'cad-stage-bar-count', text: `${items.length}` });
      const barWrap = row.createDiv({ cls: 'cad-stage-bar' });
      const fill = barWrap.createDiv({ cls: 'cad-stage-bar-fill' });
      fill.style.width = `${(value / maxStageVal) * 100}%`;
      row.createDiv({ cls: 'cad-stage-bar-value', text: fmtValue(value, 'currency') });
      row.addEventListener('click', () => this.setMode('crm.pipeline'));
    });

    // ─── Two-column body ───────────────────────────────
    const cols = root.createDiv({ cls: 'cad-dash-cols' });
    const left  = cols.createDiv({ cls: 'cad-dash-col' });
    const right = cols.createDiv({ cls: 'cad-dash-col' });

    // Hot deals — top by value, open only
    const topHot = [...open]
      .sort((a, b) => dealValue(b) - dealValue(a))
      .slice(0, 5)
      .map((e) => ({
        title: entityValue(e, 'title', dealDef) || e.basename,
        meta: `${entityValue(e, dealStageField(dealDef), dealDef) || '—'} · ${fmtValue(dealValue(e), 'currency')}`,
        file: e.file,
      }));
    this._dashCardSection(left, 'HOT DEALS · top 5 by value', topHot, 'No open deals yet — hit + New Deal above.');

    // Stale deals — open, not touched in 14+ days (file mtime)
    const staleCutoff = Date.now() - 14 * 86400000;
    const stale = open
      .filter((e) => e.file && e.file.stat && e.file.stat.mtime < staleCutoff)
      .sort((a, b) => (a.file.stat.mtime || 0) - (b.file.stat.mtime || 0))
      .slice(0, 5)
      .map((e) => {
        const days = Math.round((Date.now() - e.file.stat.mtime) / 86400000);
        return {
          title: entityValue(e, 'title', dealDef) || e.basename,
          meta: `${entityValue(e, dealStageField(dealDef), dealDef) || '—'} · ${days}d quiet · ${fmtValue(dealValue(e), 'currency')}`,
          file: e.file,
        };
      });
    this._dashCardSection(left, 'STALE DEALS · 14+ days no edits', stale, 'No stale deals — momentum is good.');

    // Recent activity
    const recentAct = [...activities]
      .sort((a, b) => {
        const da = new Date(activityDate(a, ENTITIES.activity) || 0).getTime();
        const db = new Date(activityDate(b, ENTITIES.activity) || 0).getTime();
        return db - da;
      })
      .slice(0, 6)
      .map((e) => ({
        title: activityTitle(e, ENTITIES.activity),
        meta: `${entityValue(e, 'channel', ENTITIES.activity) || '—'} · ${fmtValue(activityDate(e, ENTITIES.activity), 'date')}`,
        file: e.file,
      }));
    this._dashCardSection(right, `RECENT ACTIVITY · ${activities.length} total`, recentAct, 'No activity logged yet. Capture a call or meeting under CRM > Activities.');

    // Customer base — mini stat row inside a card
    const baseCard = right.createDiv({ cls: 'cad-dash-card' });
    baseCard.createDiv({ cls: 'cad-dash-card-head' }).createDiv({ cls: 'cad-dash-card-title', text: `CUSTOMER BASE · ${contacts.length + companies.length + partners.length} records` });
    const baseBody = baseCard.createDiv({ cls: 'cad-dash-card-body cad-mini-stat-row' });
    const mkMini = (label, val, accent, mode) => {
      const c = baseBody.createDiv({ cls: 'cad-mini-stat' });
      if (accent) c.dataset.accent = accent;
      c.createDiv({ cls: 'cad-mini-stat-value', text: String(val) });
      c.createDiv({ cls: 'cad-mini-stat-label', text: label });
      if (mode) {
        c.style.cursor = 'pointer';
        c.addEventListener('click', () => this.setMode(mode));
      }
    };
    mkMini('CONTACTS',  contacts.length,  'warn', 'crm.contacts');
    mkMini('COMPANIES', companies.length, 'sky',  'crm.companies');
    mkMini('PARTNERS',  partners.length,  'rose', 'prm.partners');
  }

  /* Reusable list card on the dashboard. */
  _dashCardSection(parent, title, rows, emptyMsg) {
    const card = parent.createDiv({ cls: 'cad-dash-card' });
    card.createDiv({ cls: 'cad-dash-card-head' }).createDiv({ cls: 'cad-dash-card-title', text: title });
    const body = card.createDiv({ cls: 'cad-dash-card-body' });
    if (!rows || !rows.length) {
      body.createDiv({ cls: 'cad-empty', text: emptyMsg || 'Nothing here yet.' });
      return;
    }
    rows.forEach((r) => {
      const row = body.createDiv({ cls: 'cad-dash-row' });
      row.createDiv({ cls: 'cad-dash-row-title', text: r.title });
      row.createDiv({ cls: 'cad-dash-row-meta', text: r.meta });
      if (r.file) row.addEventListener('click', () => this.openEntityDetailFromFile(r.file));
    });
  }

  /* ── Reports: Productivity (over daily notes) ── */
  async renderProductivity(root) {
    root.addClass('cadence-report');
    const settings = this.plugin.settings;
    const taskMode = settings.taskMode || 'checkbox';
    const includeCheckboxTasks = taskMode === 'checkbox' || taskMode === 'hybrid';
    const includeTaskNotes = taskMode === 'tasknotes' || taskMode === 'hybrid';

    // Walk last 30 days
    const today = startOfDay(new Date());
    const days = Array.from({ length: 30 }, (_, i) => addDays(today, -i));
    const oldestDay = days[days.length - 1];
    const weekStart = startOfWeek(today, this.plugin.settings.weekStartsOn);
    const oldestWeekStart = addDays(weekStart, -11 * 7);
    const taskNoteStart = oldestWeekStart.getTime() < oldestDay.getTime() ? oldestWeekStart : oldestDay;
    const taskNotes = includeTaskNotes ? listTaskNotesForProductivity(this.app, settings, taskNoteStart, today) : [];
    const taskNotesByDate = new Map();
    taskNotes.forEach((task) => {
      if (!taskNotesByDate.has(task.date)) taskNotesByDate.set(task.date, []);
      taskNotesByDate.get(task.date).push(task);
    });
    let totalOpen = 0, totalDone = 0, totalJournalChars = 0;
    let activeDays = 0;
    let streak = 0, streakBroken = false;
    const perDay = [];
    for (const d of days) {
      const f = this.app.vault.getAbstractFileByPath(dailyNotePath(settings, d));
      let open = 0, done = 0, jChars = 0, hasNote = false;
      if (includeCheckboxTasks && f && f instanceof obsidian.TFile) {
        hasNote = true;
        const c = await this.app.vault.read(f);
        const p = parseSections(c, settings);
        open = p.tasks.filter((l) => / \[ \] /.test(l)).length;
        done = p.tasks.filter((l) => / \[(x|X)\] /.test(l)).length;
        jChars = (p.journal || '').length;
      } else if (f && f instanceof obsidian.TFile) {
        hasNote = true;
        const c = await this.app.vault.read(f);
        const p = parseSections(c, settings);
        jChars = (p.journal || '').length;
      }
      const dayTaskNotes = taskNotesByDate.get(ymd(d)) || [];
      if (includeTaskNotes) {
        done += dayTaskNotes.filter((task) => task.done).length;
        open += dayTaskNotes.filter((task) => !task.done).length;
      }
      const hasTaskNote = dayTaskNotes.length > 0;
      perDay.push({ date: d, open, done, jChars, hasNote, hasTaskNote });
      totalOpen += open; totalDone += done; totalJournalChars += jChars;
      if (hasNote || hasTaskNote) activeDays++;
      if (!streakBroken) {
        if ((hasNote || hasTaskNote) && (done > 0 || jChars > 0)) streak++;
        else streakBroken = true;
      }
    }

    const completion = totalOpen + totalDone === 0 ? 0 : Math.round((totalDone / (totalOpen + totalDone)) * 100);

    const taskSource = taskMode === 'tasknotes' ? 'TaskNotes' : taskMode === 'hybrid' ? 'daily notes + TaskNotes' : 'daily notes';
    this._renderPageHeader(root, 'Productivity', `Last 30 days · ${taskSource}`);

    const grid = root.createDiv({ cls: 'cad-stat-grid' });
    const stat = (label, value, sub, accent) => {
      const c = grid.createDiv({ cls: 'cad-stat-card' });
      if (accent) c.dataset.accent = accent;
      c.createDiv({ cls: 'cad-stat-label', text: label });
      c.createDiv({ cls: 'cad-stat-value', text: String(value) });
      if (sub) c.createDiv({ cls: 'cad-stat-sub', text: sub });
    };
    stat('COMPLETION', `${completion}%`,                       `${totalDone}/${totalOpen + totalDone} tasks`, 'emerald');
    stat('STREAK',     `${streak}d`,                            'consecutive active days',                     'mint');
    stat('ACTIVE',     `${activeDays}/30`,                      'days with a note',                            'sky');
    stat('JOURNAL',    totalJournalChars.toLocaleString(),      'characters written',                          'warn');

    // Bar chart of completed tasks per day (last 14 days, oldest left)
    root.createDiv({ cls: 'cad-section-label-lg', text: 'TASKS DONE — LAST 14 DAYS' });
    const last14 = perDay.slice(0, 14).reverse();
    const max = Math.max(1, ...last14.map((p) => p.done));
    const chart = root.createDiv({ cls: 'cad-bar-chart' });
    last14.forEach((p) => {
      const col = chart.createDiv({ cls: 'cad-bar-col' });
      const bar = col.createDiv({ cls: 'cad-bar' });
      bar.style.height = `${(p.done / max) * 100}%`;
      const ratio = p.done / max;
      bar.dataset.band = p.done === 0 ? 'empty' : ratio < 0.34 ? 'low' : ratio < 0.67 ? 'mid' : 'high';
      const lbl = col.createDiv({ cls: 'cad-bar-label', text: String(p.date.getDate()) });
      bar.title = `${p.date.toLocaleDateString()} — ${p.done} done, ${p.open} open`;
      void lbl;
    });

    /* 12-week completion trend */
    const weeks = [];
    for (let w = 11; w >= 0; w--) {
      const ws = addDays(weekStart, -w * 7);
      const we = addDays(ws, 7);
      let wd = 0, wo = 0, anyNote = false;
      for (let i = 0; i < 7; i++) {
        const d = addDays(ws, i);
        if (d.getTime() > today.getTime()) break;
        const f = this.app.vault.getAbstractFileByPath(dailyNotePath(settings, d));
        if (includeCheckboxTasks && f && f instanceof obsidian.TFile) {
          anyNote = true;
          const c = await this.app.vault.read(f);
          const p = parseSections(c, settings);
          p.tasks.forEach((l) => { if (/ \[(x|X)\] /.test(l)) wd++; else if (/ \[ \] /.test(l)) wo++; });
        }
        if (includeTaskNotes) {
          const dayTaskNotes = taskNotesByDate.get(ymd(d)) || [];
          wd += dayTaskNotes.filter((task) => task.done).length;
          wo += dayTaskNotes.filter((task) => !task.done).length;
          if (dayTaskNotes.length) anyNote = true;
        }
      }
      weeks.push({ start: ws, done: wd, open: wo, any: anyNote, label: ws.toLocaleDateString(undefined, { month: 'short', day: 'numeric' }) });
    }
    const maxWeek = Math.max(1, ...weeks.map((w) => w.done));
    root.createDiv({ cls: 'cad-section-label-lg', text: 'COMPLETION TREND — LAST 12 WEEKS' });
    const wkChart = root.createDiv({ cls: 'cad-bar-chart cad-bar-chart-tall' });
    weeks.forEach((w) => {
      const col = wkChart.createDiv({ cls: 'cad-bar-col' });
      const bar = col.createDiv({ cls: 'cad-bar' });
      bar.style.height = `${(w.done / maxWeek) * 100}%`;
      const ratio = w.done / maxWeek;
      bar.dataset.band = w.done === 0 ? 'empty' : ratio < 0.34 ? 'low' : ratio < 0.67 ? 'mid' : 'high';
      bar.title = `Week of ${w.label} — ${w.done} done, ${w.open} open`;
      col.createDiv({ cls: 'cad-bar-label', text: w.label });
    });

    /* Completion by weekday (Mon-Sun aggregated over the 30 days) */
    const wsOn = settings.weekStartsOn;
    const dayBuckets = Array.from({ length: 7 }, () => ({ done: 0, open: 0 }));
    perDay.forEach((p) => {
      // p.date.getDay() returns 0 (Sun) .. 6 (Sat). Re-index based on weekStartsOn.
      const idx = (p.date.getDay() - wsOn + 7) % 7;
      dayBuckets[idx].done += p.done;
      dayBuckets[idx].open += p.open;
    });
    const dayLabels = wsOn === 1
      ? ['MON', 'TUE', 'WED', 'THU', 'FRI', 'SAT', 'SUN']
      : ['SUN', 'MON', 'TUE', 'WED', 'THU', 'FRI', 'SAT'];
    root.createDiv({ cls: 'cad-section-label-lg', text: 'COMPLETION BY WEEKDAY · LAST 30 DAYS' });
    const dayCard = root.createDiv({ cls: 'cad-dash-card' });
    dayCard.style.margin = '0 36px 24px 36px';
    const dayBody = dayCard.createDiv({ cls: 'cad-dash-card-body cad-mini-stat-row' });
    const dayAccents = ['emerald', 'mint', 'sky', 'warn', 'rose', 'mint', 'sky'];
    dayBuckets.forEach((b, i) => {
      const total = b.done + b.open;
      const pct = total === 0 ? 0 : Math.round((b.done / total) * 100);
      const mini = dayBody.createDiv({ cls: 'cad-mini-stat' });
      mini.dataset.accent = dayAccents[i];
      mini.createDiv({ cls: 'cad-mini-stat-value', text: total === 0 ? '—' : `${pct}%` });
      mini.createDiv({ cls: 'cad-mini-stat-label', text: dayLabels[i] });
      const sub = mini.createDiv({ cls: 'cad-stat-sub' });
      sub.style.marginTop = '4px';
      sub.setText(total === 0 ? 'no data' : `${b.done}/${total}`);
    });
  }

  /* ── Reports: Pipeline (deals breakdown) ──────── */
  async renderReportPipeline(root) {
    root.addClass('cadence-report');
    const def = ENTITIES.deal;
    const deals = listEntities(this.app, 'deal');
    const open = deals.filter((e) => !dealTerminalStages(def).includes(String(entityValue(e, dealStageField(def), def))));
    const won  = deals.filter((e) => dealWonStages(def).includes(String(entityValue(e, dealStageField(def), def))));
    const lost = deals.filter((e) => dealLostStages(def).includes(String(entityValue(e, dealStageField(def), def))));
    const dealValue = (e) => Number(entityValue(e, dealValueField(def), def)) || 0;
    const sumVal = (arr) => arr.reduce((s, e) => s + dealValue(e), 0);
    const winRate = won.length + lost.length === 0 ? 0 : Math.round((won.length / (won.length + lost.length)) * 100);

    // Weighted forecast — confidence per stage applied to open deal value.
    const stageConfidenceRaw = def.stageConfidence || { 'lead': 0.10, 'qualified': 0.25, 'proposal': 0.50, 'negotiation': 0.75 };
    const stageConfidence = Object.fromEntries(Object.entries(stageConfidenceRaw).map(([k, v]) => [k.toLowerCase(), v]));
    const weighted = open.reduce((s, e) => s + dealValue(e) * (stageConfidence[String(entityValue(e, dealStageField(def), def)).toLowerCase()] || 0), 0);

    this._renderPageHeader(root, 'Pipeline report', 'Coverage, forecast and aging across all deals');

    const grid = root.createDiv({ cls: 'cad-stat-grid' });
    const stat = (label, value, sub, accent) => {
      const c = grid.createDiv({ cls: 'cad-stat-card' });
      if (accent) c.dataset.accent = accent;
      c.createDiv({ cls: 'cad-stat-label', text: label });
      c.createDiv({ cls: 'cad-stat-value', text: String(value) });
      if (sub) c.createDiv({ cls: 'cad-stat-sub', text: sub });
    };
    stat('OPEN',       open.length,                     fmtValue(sumVal(open), 'currency'),  'sky');
    stat('WEIGHTED',   fmtValue(weighted, 'currency'),  'forecast on open',                  'mint');
    stat('WON',        won.length,                      fmtValue(sumVal(won),  'currency'),  'emerald');
    stat('LOST',       lost.length,                     fmtValue(sumVal(lost), 'currency'),  'rose');
    stat('WIN RATE',   `${winRate}%`,                   `${won.length}/${won.length + lost.length} closed`, 'warn');

    /* By stage table (existing, kept) */
    root.createDiv({ cls: 'cad-section-label-lg', text: 'BY STAGE' });
    const tableWrap = root.createDiv({ cls: 'cad-table-wrap' });
    const table = tableWrap.createEl('table', { cls: 'cad-table' });
    const trh = table.createEl('thead').createEl('tr');
    ['Stage', 'Count', 'Value'].forEach((h) => trh.createEl('th', { text: h }));
    const tbody = table.createEl('tbody');
    getDealStages(def).forEach((stage) => {
      const items = deals.filter((e) => String(entityValue(e, dealStageField(def), def)) === stage);
      const tr = tbody.createEl('tr');
      tr.createEl('td', { text: stage });
      tr.createEl('td', { text: String(items.length) });
      tr.createEl('td', { text: fmtValue(sumVal(items), 'currency') });
    });

    /* Two-col body: by owner + aging cohorts */
    const cols = root.createDiv({ cls: 'cad-dash-cols' });
    const left  = cols.createDiv({ cls: 'cad-dash-col' });
    const right = cols.createDiv({ cls: 'cad-dash-col' });

    // Pipeline by owner
    const byOwner = new Map();
    open.forEach((e) => {
      const owner = String(entityValue(e, 'owner', def) || '(unassigned)');
      if (!byOwner.has(owner)) byOwner.set(owner, { count: 0, value: 0 });
      const o = byOwner.get(owner);
      o.count++; o.value += dealValue(e);
    });
    const ownerRows = [...byOwner.entries()]
      .sort((a, b) => b[1].value - a[1].value)
      .slice(0, 8)
      .map(([owner, data]) => ({
        title: owner,
        meta: `${data.count} deal${data.count === 1 ? '' : 's'} · ${fmtValue(data.value, 'currency')}`,
      }));
    this._dashCardSection(left, `OPEN PIPELINE BY OWNER · top ${Math.min(8, byOwner.size)}`, ownerRows, 'No open deals to attribute.');

    // Aging cohorts (file mtime)
    const now = Date.now();
    const cohorts = [
      { label: '0–7 DAYS',  cutoff: 7,        count: 0, value: 0, accent: 'emerald' },
      { label: '8–30 DAYS', cutoff: 30,       count: 0, value: 0, accent: 'mint' },
      { label: '31–90 DAYS', cutoff: 90,      count: 0, value: 0, accent: 'warn' },
      { label: '90+ DAYS',  cutoff: Infinity, count: 0, value: 0, accent: 'rose' },
    ];
    open.forEach((e) => {
      const mtime = e.file && e.file.stat ? e.file.stat.mtime : now;
      const days = (now - mtime) / 86400000;
      for (const c of cohorts) {
        if (days <= c.cutoff) { c.count++; c.value += dealValue(e); break; }
      }
    });
    const agingCard = right.createDiv({ cls: 'cad-dash-card' });
    agingCard.createDiv({ cls: 'cad-dash-card-head' }).createDiv({ cls: 'cad-dash-card-title', text: 'AGING · OPEN DEALS BY LAST EDIT' });
    const agingBody = agingCard.createDiv({ cls: 'cad-dash-card-body cad-mini-stat-row' });
    cohorts.forEach((c) => {
      const mini = agingBody.createDiv({ cls: 'cad-mini-stat' });
      mini.dataset.accent = c.accent;
      mini.createDiv({ cls: 'cad-mini-stat-value', text: String(c.count) });
      mini.createDiv({ cls: 'cad-mini-stat-label', text: c.label });
      const sub = mini.createDiv({ cls: 'cad-stat-sub' });
      sub.style.marginTop = '4px';
      sub.setText(fmtValue(c.value, 'currency'));
    });

    // Stale top-5 list under aging
    const staleCutoff = now - 30 * 86400000;
    const stale = open
      .filter((e) => e.file && e.file.stat && e.file.stat.mtime < staleCutoff)
      .sort((a, b) => (a.file.stat.mtime || 0) - (b.file.stat.mtime || 0))
      .slice(0, 5)
      .map((e) => ({
        title: entityValue(e, 'title', def) || e.basename,
        meta: `${entityValue(e, dealStageField(def), def) || '—'} · ${Math.round((now - e.file.stat.mtime) / 86400000)}d quiet · ${fmtValue(dealValue(e), 'currency')}`,
        file: e.file,
      }));
    this._dashCardSection(right, 'STALE · 30+ DAYS NO EDITS', stale, 'No deals over 30 days quiet — nice.');
  }

  /* ── Reports: Sales (closed deals) ─────────────── */
  async renderReportSales(root) {
    root.addClass('cadence-report');
    const def = ENTITIES.deal;
    const deals = listEntities(this.app, 'deal');
    const won  = deals.filter((e) => dealWonStages(def).includes(String(entityValue(e, dealStageField(def), def))));
    const lost = deals.filter((e) => dealLostStages(def).includes(String(entityValue(e, dealStageField(def), def))));
    const dealValue = (e) => Number(entityValue(e, dealValueField(def), def)) || 0;
    const sumVal = (arr) => arr.reduce((s, e) => s + dealValue(e), 0);

    this._renderPageHeader(root, 'Sales report', 'Closed-won and lost · performance over time');

    const grid = root.createDiv({ cls: 'cad-stat-grid' });
    const stat = (label, value, sub, accent) => {
      const c = grid.createDiv({ cls: 'cad-stat-card' });
      if (accent) c.dataset.accent = accent;
      c.createDiv({ cls: 'cad-stat-label', text: label });
      c.createDiv({ cls: 'cad-stat-value', text: String(value) });
      if (sub) c.createDiv({ cls: 'cad-stat-sub', text: sub });
    };
    stat('REVENUE',     fmtValue(sumVal(won), 'currency'),  `${won.length} deals`,             'emerald');
    stat('LOST',        fmtValue(sumVal(lost), 'currency'), `${lost.length} deals`,            'rose');
    const total = sumVal(won) + sumVal(lost);
    const captureRate = total === 0 ? 0 : Math.round((sumVal(won) / total) * 100);
    stat('CAPTURE',     `${captureRate}%`,                  'of closed value',                  'mint');
    const avg = won.length === 0 ? 0 : sumVal(won) / won.length;
    stat('AVG DEAL',    fmtValue(avg, 'currency'),          'won deals',                        'sky');

    /* Revenue by month (last 6 months, by file mtime as close proxy) */
    const now = new Date();
    const months = [];
    for (let i = 5; i >= 0; i--) {
      const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
      months.push({
        date: d,
        label: d.toLocaleDateString(undefined, { month: 'short' }),
        revenue: 0,
        count: 0,
      });
    }
    won.forEach((e) => {
      const t = e.file && e.file.stat ? e.file.stat.mtime : null;
      if (!t) return;
      const d = new Date(t);
      const idx = months.findIndex((m) => m.date.getFullYear() === d.getFullYear() && m.date.getMonth() === d.getMonth());
      if (idx >= 0) { months[idx].revenue += dealValue(e); months[idx].count++; }
    });
    const maxRev = Math.max(1, ...months.map((m) => m.revenue));
    root.createDiv({ cls: 'cad-section-label-lg', text: 'REVENUE — LAST 6 MONTHS' });
    const chart = root.createDiv({ cls: 'cad-bar-chart cad-bar-chart-tall' });
    months.forEach((m) => {
      const col = chart.createDiv({ cls: 'cad-bar-col' });
      const bar = col.createDiv({ cls: 'cad-bar' });
      bar.style.height = `${(m.revenue / maxRev) * 100}%`;
      const ratio = m.revenue / maxRev;
      bar.dataset.band = m.revenue === 0 ? 'empty' : ratio < 0.34 ? 'low' : ratio < 0.67 ? 'mid' : 'high';
      bar.title = `${m.label} — ${fmtValue(m.revenue, 'currency')} · ${m.count} deals`;
      col.createDiv({ cls: 'cad-bar-label', text: m.label });
    });

    /* Two-col: top wins + top owners */
    const cols = root.createDiv({ cls: 'cad-dash-cols' });
    const left  = cols.createDiv({ cls: 'cad-dash-col' });
    const right = cols.createDiv({ cls: 'cad-dash-col' });

    const topWins = [...won]
      .sort((a, b) => dealValue(b) - dealValue(a))
      .slice(0, 6)
      .map((e) => ({
        title: entityValue(e, 'title', def) || e.basename,
        meta: `${entityValue(e, 'company', def) || '—'} · ${fmtValue(dealValue(e), 'currency')}`,
        file: e.file,
      }));
    this._dashCardSection(left, 'TOP WINS · top 6', topWins, 'No wins logged yet — close one and tag it Won.');

    // Top owners by revenue
    const byOwner = new Map();
    won.forEach((e) => {
      const owner = String(entityValue(e, 'owner', def) || '(unassigned)');
      if (!byOwner.has(owner)) byOwner.set(owner, { count: 0, revenue: 0 });
      const o = byOwner.get(owner);
      o.count++; o.revenue += dealValue(e);
    });
    const ownerRows = [...byOwner.entries()]
      .sort((a, b) => b[1].revenue - a[1].revenue)
      .slice(0, 6)
      .map(([owner, data]) => ({
        title: owner,
        meta: `${data.count} won · ${fmtValue(data.revenue, 'currency')}`,
      }));
    this._dashCardSection(right, 'OWNER LEADERBOARD · top 6 by revenue', ownerRows, 'No revenue attributed to owners yet.');
  }

  /* ── Reports: Partners (deals attributed to partners) ─ */
  async renderReportPartners(root) {
    root.addClass('cadence-report');
    const dealDef = ENTITIES.deal;
    const partnerDef = ENTITIES.partner;
    const certDef = ENTITIES.certification;
    const deals = listEntities(this.app, 'deal');
    const partners = listEntities(this.app, 'partner');
    const certs = listEntities(this.app, 'certification');
    const dealValue = (e) => Number(entityValue(e, dealValueField(dealDef), dealDef)) || 0;

    this._renderPageHeader(root, 'Partners report', 'Partner-sourced revenue, tier mix, certification health');

    // Group deals by 'partner' frontmatter
    const byPartner = new Map();
    deals.forEach((e) => {
      const p = entityValue(e, 'partner', dealDef) || '(direct)';
      if (!byPartner.has(p)) byPartner.set(p, []);
      byPartner.get(p).push(e);
    });
    const partnerSourced = deals.filter((e) => entityValue(e, 'partner', dealDef));
    const partnerWon = partnerSourced.filter((e) => dealWonStages(dealDef).includes(String(entityValue(e, dealStageField(dealDef), dealDef))));

    const grid = root.createDiv({ cls: 'cad-stat-grid' });
    const stat = (label, value, sub, accent) => {
      const c = grid.createDiv({ cls: 'cad-stat-card' });
      if (accent) c.dataset.accent = accent;
      c.createDiv({ cls: 'cad-stat-label', text: label });
      c.createDiv({ cls: 'cad-stat-value', text: String(value) });
      if (sub) c.createDiv({ cls: 'cad-stat-sub', text: sub });
    };
    stat('PARTNERS',       partners.length,                                                  'on the books',                       'sky');
    stat('PARTNER DEALS',  partnerSourced.length,                                            fmtValue(partnerSourced.reduce((s, e) => s + dealValue(e), 0), 'currency'), 'mint');
    stat('PARTNER REV',    fmtValue(partnerWon.reduce((s, e) => s + dealValue(e), 0), 'currency'), `${partnerWon.length} won`,        'emerald');
    stat('UNIQUE SOURCES', byPartner.size,                                                   'including direct',                   'warn');

    /* Tier breakdown */
    const tierMap = new Map();
    partners.forEach((p) => {
      const t = String(entityValue(p, 'tier', partnerDef) || 'Untiered');
      if (!tierMap.has(t)) tierMap.set(t, 0);
      tierMap.set(t, tierMap.get(t) + 1);
    });
    if (tierMap.size) {
      root.createDiv({ cls: 'cad-section-label-lg', text: 'PARTNERS BY TIER' });
      const tierCard = root.createDiv({ cls: 'cad-dash-card' });
      tierCard.style.margin = '0 36px 18px 36px';
      const tierBody = tierCard.createDiv({ cls: 'cad-dash-card-body cad-mini-stat-row' });
      const tierAccent = { 'Gold': 'warn', 'Silver': 'sky', 'Bronze': 'rose', 'Standard': 'mint' };
      [...tierMap.entries()].sort((a, b) => b[1] - a[1]).forEach(([tier, count]) => {
        const mini = tierBody.createDiv({ cls: 'cad-mini-stat' });
        mini.dataset.accent = tierAccent[tier] || 'sky';
        mini.createDiv({ cls: 'cad-mini-stat-value', text: String(count) });
        mini.createDiv({ cls: 'cad-mini-stat-label', text: tier.toUpperCase() });
      });
    }

    /* Two-col: deals-by-partner table + cert expiries */
    const cols = root.createDiv({ cls: 'cad-dash-cols' });
    const left  = cols.createDiv({ cls: 'cad-dash-col' });
    const right = cols.createDiv({ cls: 'cad-dash-col' });

    // Deals by partner — keep table style
    const dealsByPartnerCard = left.createDiv({ cls: 'cad-dash-card' });
    dealsByPartnerCard.createDiv({ cls: 'cad-dash-card-head' }).createDiv({ cls: 'cad-dash-card-title', text: 'DEALS BY PARTNER' });
    const dbpBody = dealsByPartnerCard.createDiv({ cls: 'cad-dash-card-body' });
    if (!byPartner.size) {
      dbpBody.createDiv({ cls: 'cad-empty', text: 'No deals attributed to partners yet.' });
    } else {
      [...byPartner.entries()]
        .sort((a, b) => b[1].length - a[1].length)
        .slice(0, 10)
        .forEach(([p, items]) => {
          const v = items.reduce((s, e) => s + dealValue(e), 0);
          const row = dbpBody.createDiv({ cls: 'cad-dash-row' });
          row.createDiv({ cls: 'cad-dash-row-title', text: p });
          row.createDiv({ cls: 'cad-dash-row-meta', text: `${items.length} deal${items.length === 1 ? '' : 's'} · ${fmtValue(v, 'currency')}` });
        });
    }

    // Cert expiries upcoming (next 90 days)
    const now = Date.now();
    const horizon = now + 90 * 86400000;
    const upcomingCerts = certs
      .map((e) => {
        const exp = entityValue(e, 'expires_date', certDef);
        if (!exp) return null;
        const d = new Date(exp);
        if (isNaN(d.getTime())) return null;
        return { entity: e, date: d };
      })
      .filter((x) => x && x.date.getTime() >= now && x.date.getTime() <= horizon)
      .sort((a, b) => a.date - b.date)
      .slice(0, 8)
      .map((x) => ({
        title: entityValue(x.entity, 'name', certDef) || x.entity.basename,
        meta: `${entityValue(x.entity, 'partner_ref', certDef) || '—'} · expires ${fmtValue(x.date, 'date')}`,
        file: x.entity.file,
      }));
    this._dashCardSection(right, 'CERTS EXPIRING · NEXT 90 DAYS', upcomingCerts, 'No certifications expiring in the next 90 days.');
  }

  /* ── Reports: Activity (mix of activity types) ─ */
  async renderReportActivity(root) {
    root.addClass('cadence-report');
    const def = ENTITIES.activity;
    const acts = listEntities(this.app, 'activity');

    this._renderPageHeader(root, 'Activity report', 'Calls, meetings, emails and notes — mix and momentum');

    const counts = new Map();
    acts.forEach((e) => {
      const t = String(entityValue(e, 'channel', def) || 'unspecified');
      counts.set(t, (counts.get(t) || 0) + 1);
    });

    const grid = root.createDiv({ cls: 'cad-stat-grid' });
    const stat = (label, value, sub, accent) => {
      const c = grid.createDiv({ cls: 'cad-stat-card' });
      if (accent) c.dataset.accent = accent;
      c.createDiv({ cls: 'cad-stat-label', text: label });
      c.createDiv({ cls: 'cad-stat-value', text: String(value) });
      if (sub) c.createDiv({ cls: 'cad-stat-sub', text: sub });
    };
    stat('TOTAL', acts.length, 'all activities', 'emerald');
    const accents = ['sky', 'mint', 'warn', 'rose'];
    let i = 0;
    counts.forEach((v, k) => stat(k.toUpperCase(), v, '', accents[i++ % accents.length]));

    /* Activity by week (last 8 weeks) */
    const now = new Date();
    const weekStart = startOfWeek(now, this.plugin.settings.weekStartsOn);
    const weeks = [];
    for (let w = 7; w >= 0; w--) {
      const ws = addDays(weekStart, -w * 7);
      const we = addDays(ws, 7);
      weeks.push({ start: ws, end: we, count: 0, label: ws.toLocaleDateString(undefined, { month: 'short', day: 'numeric' }) });
    }
    acts.forEach((e) => {
      const when = activityDate(e, def);
      if (!when) return;
      const t = new Date(when).getTime();
      if (isNaN(t)) return;
      const idx = weeks.findIndex((w) => t >= w.start.getTime() && t < w.end.getTime());
      if (idx >= 0) weeks[idx].count++;
    });
    const maxWeek = Math.max(1, ...weeks.map((w) => w.count));
    root.createDiv({ cls: 'cad-section-label-lg', text: 'ACTIVITY — LAST 8 WEEKS' });
    const chart = root.createDiv({ cls: 'cad-bar-chart cad-bar-chart-tall' });
    weeks.forEach((w) => {
      const col = chart.createDiv({ cls: 'cad-bar-col' });
      const bar = col.createDiv({ cls: 'cad-bar' });
      bar.style.height = `${(w.count / maxWeek) * 100}%`;
      const ratio = w.count / maxWeek;
      bar.dataset.band = w.count === 0 ? 'empty' : ratio < 0.34 ? 'low' : ratio < 0.67 ? 'mid' : 'high';
      bar.title = `Week of ${w.label} — ${w.count} activities`;
      col.createDiv({ cls: 'cad-bar-label', text: w.label });
    });

    /* Two-col: top contacts + recent activity */
    const cols = root.createDiv({ cls: 'cad-dash-cols' });
    const left  = cols.createDiv({ cls: 'cad-dash-col' });
    const right = cols.createDiv({ cls: 'cad-dash-col' });

    // Top contacts by activity count
    const contactCounts = new Map();
    acts.forEach((e) => {
      const w = String(entityValue(e, 'client_id', def) || '').trim();
      if (!w) return;
      contactCounts.set(w, (contactCounts.get(w) || 0) + 1);
    });
    const topContactRows = [...contactCounts.entries()]
      .sort((a, b) => b[1] - a[1])
      .slice(0, 8)
      .map(([who, count]) => ({
        title: who,
        meta: `${count} activit${count === 1 ? 'y' : 'ies'}`,
      }));
    this._dashCardSection(left, 'TOP CLIENTS · by activity count', topContactRows, 'No activities tagged with a client yet.');

    // Recent activity (last 10)
    const recent = [...acts]
      .sort((a, b) => {
        const da = new Date(activityDate(a, def) || 0).getTime();
        const db = new Date(activityDate(b, def) || 0).getTime();
        return db - da;
      })
      .slice(0, 10)
      .map((e) => ({
        title: activityTitle(e, def),
        meta: `${entityValue(e, 'channel', def) || '—'} · ${entityValue(e, 'client_id', def) || '—'} · ${fmtValue(activityDate(e, def), 'date')}`,
        file: e.file,
      }));
    this._dashCardSection(right, 'RECENT ACTIVITY · last 10', recent, 'No activities yet — log one under CRM > Activities.');
  }

  /* ── PRM Analytics ──────────────────────── */
  async renderPRMAnalytics(root) {
    root.addClass('cadence-report');
    const partnerDef = ENTITIES.partner;
    const dealDef = ENTITIES.deal;
    const partners = listEntities(this.app, 'partner');
    const deals = listEntities(this.app, 'deal');
    const dealValue = (e) => Number(entityValue(e, dealValueField(dealDef), dealDef)) || 0;
    const sumVal = (arr) => arr.reduce((s, e) => s + dealValue(e), 0);
    const partnerSourced = deals.filter((e) => entityValue(e, 'partner', dealDef));
    const partnerWon = partnerSourced.filter((e) => dealWonStages(dealDef).includes(String(entityValue(e, dealStageField(dealDef), dealDef))));

    this._renderPageHeader(root, 'PRM analytics', 'Partner programme health, tier mix and revenue contribution');

    const grid = root.createDiv({ cls: 'cad-stat-grid' });
    const stat = (label, value, sub, accent) => {
      const c = grid.createDiv({ cls: 'cad-stat-card' });
      if (accent) c.dataset.accent = accent;
      c.createDiv({ cls: 'cad-stat-label', text: label });
      c.createDiv({ cls: 'cad-stat-value', text: String(value) });
      if (sub) c.createDiv({ cls: 'cad-stat-sub', text: sub });
    };
    stat('PARTNERS',         partners.length,                            'on the books',                              'sky');
    stat('SOURCED DEALS',    partnerSourced.length,                      fmtValue(sumVal(partnerSourced), 'currency'),'mint');
    stat('PARTNER REVENUE',  fmtValue(sumVal(partnerWon), 'currency'),   `${partnerWon.length} won`,                  'emerald');
    const totalSourcedValue = sumVal(partnerSourced);
    const totalDealValue = sumVal(deals);
    const sharePct = totalDealValue === 0 ? 0 : Math.round((totalSourcedValue / totalDealValue) * 100);
    stat('PARTNER SHARE',    `${sharePct}%`,                             'of total pipeline value',                   'warn');

    /* Tier breakdown */
    const tierMap = new Map();
    const tierValueMap = new Map();
    partners.forEach((p) => {
      const t = String(entityValue(p, 'tier', partnerDef) || 'Untiered');
      tierMap.set(t, (tierMap.get(t) || 0) + 1);
      tierValueMap.set(t, tierValueMap.get(t) || 0);
    });
    // Add tier-attributed revenue: deals where partner matches partner-name and partner.tier is known
    const partnerByName = new Map();
    partners.forEach((p) => partnerByName.set(String(entityValue(p, 'name', partnerDef) || p.basename), p));
    partnerWon.forEach((d) => {
      const pname = String(entityValue(d, 'partner', dealDef) || '');
      const partner = partnerByName.get(pname);
      if (!partner) return;
      const tier = String(entityValue(partner, 'tier', partnerDef) || 'Untiered');
      tierValueMap.set(tier, (tierValueMap.get(tier) || 0) + dealValue(d));
    });

    if (tierMap.size) {
      root.createDiv({ cls: 'cad-section-label-lg', text: 'PARTNERS BY TIER' });
      const tierCard = root.createDiv({ cls: 'cad-dash-card' });
      tierCard.style.margin = '0 36px 18px 36px';
      const tierBody = tierCard.createDiv({ cls: 'cad-dash-card-body cad-mini-stat-row' });
      const tierAccent = { 'Gold': 'warn', 'Silver': 'sky', 'Bronze': 'rose', 'Standard': 'mint', 'Untiered': 'mint' };
      [...tierMap.entries()].sort((a, b) => b[1] - a[1]).forEach(([tier, count]) => {
        const value = tierValueMap.get(tier) || 0;
        const mini = tierBody.createDiv({ cls: 'cad-mini-stat' });
        mini.dataset.accent = tierAccent[tier] || 'sky';
        mini.createDiv({ cls: 'cad-mini-stat-value', text: String(count) });
        mini.createDiv({ cls: 'cad-mini-stat-label', text: tier.toUpperCase() });
        const sub = mini.createDiv({ cls: 'cad-stat-sub' });
        sub.style.marginTop = '4px';
        sub.setText(value > 0 ? fmtValue(value, 'currency') : '—');
      });
    }

    /* Two-col: top partners by revenue + funnel */
    const cols = root.createDiv({ cls: 'cad-dash-cols' });
    const left  = cols.createDiv({ cls: 'cad-dash-col' });
    const right = cols.createDiv({ cls: 'cad-dash-col' });

    // Top partners by won revenue
    const partnerRevenue = new Map();
    partnerWon.forEach((d) => {
      const p = String(entityValue(d, 'partner', dealDef) || '(direct)');
      partnerRevenue.set(p, (partnerRevenue.get(p) || 0) + dealValue(d));
    });
    const topPartnerRows = [...partnerRevenue.entries()]
      .sort((a, b) => b[1] - a[1])
      .slice(0, 8)
      .map(([p, v]) => {
        const partner = partnerByName.get(p);
        const file = partner ? partner.file : null;
        return {
          title: p,
          meta: fmtValue(v, 'currency'),
          file,
        };
      });
    this._dashCardSection(left, 'TOP PARTNERS · by won revenue', topPartnerRows, 'No partner-attributed wins yet.');

    // Funnel: Sourced → Open → Won
    const sourcedOpen = partnerSourced.filter((e) => !dealTerminalStages(dealDef).includes(String(entityValue(e, dealStageField(dealDef), dealDef))));
    const sourcedLost = partnerSourced.filter((e) => dealLostStages(dealDef).includes(String(entityValue(e, dealStageField(dealDef), dealDef))));
    const conv = partnerSourced.length === 0 ? 0 : Math.round((partnerWon.length / partnerSourced.length) * 100);
    const funnelCard = right.createDiv({ cls: 'cad-dash-card' });
    funnelCard.createDiv({ cls: 'cad-dash-card-head' }).createDiv({ cls: 'cad-dash-card-title', text: 'PARTNER FUNNEL' });
    const funnelBody = funnelCard.createDiv({ cls: 'cad-dash-card-body cad-mini-stat-row' });
    const mkF = (label, val, sub, accent) => {
      const m = funnelBody.createDiv({ cls: 'cad-mini-stat' });
      m.dataset.accent = accent;
      m.createDiv({ cls: 'cad-mini-stat-value', text: String(val) });
      m.createDiv({ cls: 'cad-mini-stat-label', text: label });
      const s = m.createDiv({ cls: 'cad-stat-sub' });
      s.style.marginTop = '4px';
      s.setText(sub);
    };
    mkF('SOURCED', partnerSourced.length, fmtValue(sumVal(partnerSourced), 'currency'), 'sky');
    mkF('OPEN',    sourcedOpen.length,    fmtValue(sumVal(sourcedOpen),    'currency'), 'mint');
    mkF('WON',     partnerWon.length,     fmtValue(sumVal(partnerWon),     'currency'), 'emerald');
    mkF('LOST',    sourcedLost.length,    fmtValue(sumVal(sourcedLost),    'currency'), 'rose');

    const convCard = right.createDiv({ cls: 'cad-dash-card' });
    convCard.createDiv({ cls: 'cad-dash-card-head' }).createDiv({ cls: 'cad-dash-card-title', text: `CONVERSION · sourced → won` });
    const convBody = convCard.createDiv({ cls: 'cad-dash-card-body' });
    convBody.style.padding = '20px 16px';
    const convWrap = convBody.createDiv({ cls: 'cad-proj-progress-wrap' });
    convWrap.dataset.pctBand = pctBand(conv);
    const convLabel = convWrap.createDiv({ cls: 'cad-proj-progress-label' });
    convLabel.createSpan({ text: `${partnerWon.length}/${partnerSourced.length} sourced deals won` });
    convLabel.createSpan({ cls: 'cad-proj-progress-pct', text: `${conv}%` });
    const convBar = convWrap.createDiv({ cls: 'cad-proj-progress-bar' });
    const convFill = convBar.createDiv({ cls: 'cad-proj-progress-fill' });
    convFill.style.width = `${conv}%`;
  }

  /* ── Team (configurable People categories) ─ */
  async renderTeam(root) {
    const configured = Array.isArray(this.plugin.settings.teamPersonCategories)
      ? this.plugin.settings.teamPersonCategories
      : DEFAULT_SETTINGS.teamPersonCategories;
    const categories = new Set(configured.map((v) => String(v || '').toLowerCase()).filter(Boolean));
    return this.renderEntityList(root, 'contact', {
      title: 'Team',
      filter: (e) => {
        const category = String(entityValue(e, 'person_category', ENTITIES.contact) || '').toLowerCase();
        return categories.has(category);
      },
      columns: ['name', 'person_category', 'role', 'email', 'company'],
    });
  }

  /* ── Settings (opens Obsidian settings → Cadence) ─ */
  async openSettingsTab(root) {
    root.addClass('cadence-soon');
    const wrap = root.createDiv({ cls: 'cad-soon-wrap' });
    const ic = wrap.createDiv({ cls: 'cad-soon-icon' });
    try { obsidian.setIcon(ic, 'settings-2'); } catch (_) {}
    wrap.createDiv({ cls: 'cad-eyebrow', text: 'CADENCE' });
    wrap.createDiv({ cls: 'cad-soon-title', text: 'Settings' });
    wrap.createDiv({ cls: 'cad-soon-desc', text: 'Configure folders, headings, week start, default tab, and the (future) Cadence API connection.' });
    const btn = wrap.createEl('button', { cls: 'cad-btn primary', text: 'Open BOB Workspace settings' });
    btn.style.marginTop = '12px';
    btn.addEventListener('click', () => {
      this.app.setting.open();
      this.app.setting.openTabById(this.plugin.manifest.id);
    });
  }

  /* ── Task completion propagation ──
     When a task is ticked or unticked anywhere, mirror the state to:
       - matching reminders by text (and via reminder.project to the linked project)
       - matching task lines in today's daily note + the linked reminder's date note
     Match is by exact (trimmed) task text. Renaming a task breaks the link. */
  async _propagateTaskComplete(text, done, source) {
    const t = String(text || '').trim();
    if (!t) return;
    source = source || {};

    const reminders = (this.plugin.settings.reminders || []).slice();
    const matches = reminders.filter((r) => r.text && r.text.trim() === t);

    /* 1. Sync matching reminders (skip the source reminder) */
    for (const r of matches) {
      if (source.kind === 'reminder' && r.id === source.id) continue;
      if (!!r.done === !!done) continue;
      await this.plugin.updateReminder(r.id, { done: !!done });
    }

    /* 2. For any matching reminder linked to a project, tick that project's task line */
    const projectsTouched = new Set();
    for (const r of matches) {
      if (!r.project) continue;
      if (source.kind === 'project' && source.file && source.file.path === r.project) continue;
      if (projectsTouched.has(r.project)) continue;
      projectsTouched.add(r.project);
      const file = this.app.vault.getAbstractFileByPath(r.project);
      if (!file || !(file instanceof obsidian.TFile)) continue;
      await this._tickProjectTaskByText(file, t, !!done);
    }

    /* 3. Tick matching task line in relevant daily notes (today + each match's date note + source date) */
    const datesToCheck = new Set([ymd(new Date())]);
    matches.forEach((r) => {
      if (r.when) {
        const d = new Date(r.when);
        if (!isNaN(d.getTime())) datesToCheck.add(ymd(d));
      }
      if (r.createdAt) {
        const d = new Date(r.createdAt);
        if (!isNaN(d.getTime())) datesToCheck.add(ymd(d));
      }
    });
    if (source.kind === 'daily' && source.date) datesToCheck.add(ymd(source.date));
    const settings = this.plugin.settings;
    for (const dateStr of datesToCheck) {
      const path = settings.dailyNoteFolder
        ? `${settings.dailyNoteFolder.replace(/\/$/, '')}/${dateStr}.md`
        : `${dateStr}.md`;
      const file = this.app.vault.getAbstractFileByPath(path);
      if (!file || !(file instanceof obsidian.TFile)) continue;
      if (source.kind === 'daily' && source.file && source.file.path === file.path) continue;
      await this._tickDailyNoteTaskByText(file, t, !!done);
    }
  }

  async _tickProjectTaskByText(file, text, done) {
    let content;
    try { content = await this.app.vault.read(file); } catch (_) { return; }
    const sections = parseH2Sections(content);
    const tasks = parseTasksList(sections['Tasks'] || '');
    let changed = false;
    const updated = tasks.map((tk) => {
      if (tk.title.trim() === text && !!tk.done !== !!done) {
        changed = true;
        return Object.assign({}, tk, { done: !!done });
      }
      return tk;
    });
    if (!changed) return;
    const newSection = stringifyTasks(updated);
    const next = replaceSection(content, '## Tasks', newSection);
    await this.app.vault.modify(file, next);
  }

  async _tickDailyNoteTaskByText(file, text, done) {
    let content;
    try { content = await this.app.vault.read(file); } catch (_) { return; }
    const parsed = parseSections(content, this.plugin.settings);
    let changed = false;
    const updatedTasks = parsed.tasks.map((line) => {
      const lineText = line.replace(/^\s*-\s\[(x|X| )\]\s/, '').trim();
      if (lineText !== text) return line;
      const isDone = / \[(x|X)\] /.test(line);
      if (isDone === !!done) return line;
      changed = true;
      return done
        ? line.replace(/^\s*-\s\[\s\]\s/, '- [x] ')
        : line.replace(/^\s*-\s\[(x|X)\]\s/, '- [ ] ');
    });
    if (!changed) return;
    const newSection = updatedTasks.join('\n');
    const next = replaceSection(content, this.plugin.settings.tasksHeading, newSection);
    await this.app.vault.modify(file, next);
  }

  /* ── Cadence-styled prompt modal ─ */
  _prompt(opts) {
    return new Promise((resolve) => {
      new CadencePromptModal(this.app, {
        title: opts.title || 'Enter a name',
        placeholder: opts.placeholder || '',
        defaultValue: opts.defaultValue || '',
        cta: opts.cta || 'Create',
        onSubmit: resolve,
      }).open();
    });
  }

  async _createEntityFromPrompt(entityKey) {
    const def = ENTITIES[entityKey];
    new CadenceEntityCreateModal(this.app, entityKey, {
      onSubmit: async (result) => {
        if (!result) return;
        try {
          const file = await createEntity(this.app, entityKey, result.name, { values: result.values });
          // Patch frontmatter with whatever else the user filled in (skip primary key — already set by template).
          const primaryKey = primaryFieldKey(def);
          const extras = Object.assign({}, result.values);
          delete extras[primaryKey];
          if (Object.keys(extras).length) {
            await this.app.fileManager.processFrontMatter(file, (fm) => {
              Object.entries(extras).forEach(([k, v]) => {
                if (v == null || v === '' || (Array.isArray(v) && v.length === 0)) return;
                fm[k] = v;
              });
            });
          }
          new obsidian.Notice(`Created ${def.label}: ${file.basename}\nSaved to ${file.path}`, 4000);
          await this.openEntityDetail(entityKey, file);
        } catch (e) {
          new obsidian.Notice(`BOB Workspace: failed to create ${def.label} — ${e.message}`);
        }
      },
    }).open();
  }

  /* ── Today pane ─────────────────────────── */
  async renderTodayPane(root) {
    root.addClass('cadence-today');
    this.todayFile = await ensureDailyNote(this.app, this.plugin.settings);
    const fileContent = await this.app.vault.read(this.todayFile);
    this.todayParsed = parseSections(fileContent, this.plugin.settings);

    const info = dateInfo();
    root.createDiv({ cls: 'cad-eyebrow', text: info.weekday.toUpperCase() });
    const hero = root.createDiv({ cls: 'cad-date-hero' });
    hero.createSpan({ cls: 'cad-day', text: String(info.day) });
    const monthCol = hero.createDiv();
    monthCol.createDiv({ cls: 'cad-month', text: info.month });
    monthCol.createDiv({ cls: 'cad-year',  text: String(info.year) });

    const taskCount = this.todayParsed.tasks.filter((l) => / \[ \] /.test(l)).length;
    root.createDiv({
      cls: 'cad-greet',
      text: taskCount === 0
        ? `${greeting()}. Nothing on the books — your day is clear.`
        : `${greeting()}. You have ${taskCount} ${taskCount === 1 ? 'thing' : 'things'} to handle.`,
    });

    /* Tasks */
    const taskMode = this.plugin.settings.taskMode || 'checkbox';
    const taskSection = root.createDiv({ cls: 'cad-section' });
    const taskLabel = taskSection.createDiv({ cls: 'cad-section-label' });
    taskLabel.createSpan({ text: 'TODAY' });

    /* ── Checkbox tasks (checkbox + hybrid) ── */
    if (taskMode === 'checkbox' || taskMode === 'hybrid') {
      const total = this.todayParsed.tasks.length;
      const open  = this.todayParsed.tasks.filter((l) => / \[ \] /.test(l)).length;
      taskLabel.createSpan({ cls: 'cad-count', text: `${open} open · ${total - open} done` });

      if (!this.todayParsed.tasks.length) {
        taskSection.createDiv({ cls: 'cad-empty', text: 'No tasks in today\'s note yet.' });
      } else {
        const dailyPath = this.todayFile.path;
        this.todayParsed.tasks.forEach((rawLine, idx) => {
          const checked = / \[(x|X)\] /.test(rawLine);
          const text    = rawLine.replace(/^\s*-\s\[(x|X| )\]\s/, '');
          const row = taskSection.createDiv({ cls: 'cad-task-row' + (checked ? ' done' : '') });
          const cb = row.createEl('input', { type: 'checkbox' });
          cb.checked = checked;
          cb.addEventListener('change', () => this.toggleTodayTask(idx, cb.checked));
          row.createSpan({ cls: 'cad-task-text', text });

          /* Project link */
          const linkedProject = this._getTaskProjectLink(dailyPath, text);
          if (linkedProject) {
            const chip = row.createEl('a', { cls: 'cad-task-proj-chip', text: '📁 ' + (projectNameFromPath(this.app, linkedProject) || 'Project') });
            chip.title = 'Open linked project';
            chip.addEventListener('click', (ev) => {
              ev.preventDefault(); ev.stopPropagation();
              const f = this.app.vault.getAbstractFileByPath(linkedProject);
              if (f instanceof obsidian.TFile) this.openEntityDetail('project', f);
            });
          }
          const linkBtn = row.createEl('button', { cls: 'cad-task-link-btn' + (linkedProject ? ' linked' : ''), text: linkedProject ? '✎' : '📁' });
          linkBtn.title = linkedProject ? 'Change linked project' : 'Link to a project';
          linkBtn.addEventListener('click', (ev) => { ev.stopPropagation(); this._openTaskProjectPicker(dailyPath, text, linkedProject); });

          /* Promote button (hybrid only) */
          if (taskMode === 'hybrid') {
            const promBtn = row.createEl('button', { cls: 'cad-task-link-btn', text: '↑', title: 'Promote to TaskNote' });
            promBtn.addEventListener('click', async (ev) => {
              ev.stopPropagation();
              await createTaskNote(this.app, this.plugin.settings, text);
              new obsidian.Notice(`TaskNote created: ${text}`);
            });
          }
        });
      }
    }

    /* ── TaskNotes (tasknotes + hybrid) ── */
    if (taskMode === 'tasknotes' || taskMode === 'hybrid') {
      if (taskMode === 'hybrid') taskSection.createDiv({ cls: 'cad-section-label', text: 'TASKNOTES TODAY' });
      const notes = listTodayTaskNotes(this.app, this.plugin.settings);
      if (!notes.length) {
        taskSection.createDiv({ cls: 'cad-empty', text: 'No TaskNotes due today.' });
      } else {
        if (taskMode === 'tasknotes') {
          taskLabel.createSpan({ cls: 'cad-count', text: `${notes.length} due today` });
        }
        notes.forEach(({ file, fm }) => {
          const done = fm.status === 'done';
          const row  = taskSection.createDiv({ cls: 'cad-task-row' + (done ? ' done' : '') });
          const cb   = row.createEl('input', { type: 'checkbox' });
          cb.checked = done;
          cb.addEventListener('change', async () => {
            await toggleTaskNoteStatus(this.app, file, cb.checked);
            this.render();
          });
          const lbl = row.createEl('a', { cls: 'cad-task-text', text: fm.title || file.basename });
          lbl.title = 'Open TaskNote';
          lbl.addEventListener('click', (ev) => { ev.preventDefault(); this.app.workspace.openLinkText(file.path, '', false); });
          if (fm.priority && fm.priority !== 'normal') {
            row.createSpan({ cls: 'cad-count', text: fm.priority });
          }
        });
      }
    }

    const quickWrap = taskSection.createDiv();
    quickWrap.style.marginTop = '8px';
    const quick = quickWrap.createEl('input', {
      type: 'text',
      placeholder: taskMode === 'checkbox' ? 'Quick add a task — Enter to save' : 'New TaskNote — Enter to create',
    });
    quick.style.width = '100%';
    quick.addEventListener('keydown', async (e) => {
      if (e.key === 'Enter' && quick.value.trim()) {
        const v = quick.value.trim();
        quick.value = '';
        if (taskMode === 'checkbox') {
          this.appendTodayTask(v);
        } else {
          await createTaskNote(this.app, this.plugin.settings, v);
          new obsidian.Notice(`TaskNote created: ${v}`);
          this.render();
        }
      }
    });

    /* Journal */
    const journalSection = root.createDiv({ cls: 'cad-section' });
    journalSection.createDiv({ cls: 'cad-section-label' }).setText('TODAY’S ENTRY');
    const ta = journalSection.createEl('textarea', { cls: 'cad-journal' });
    ta.value = this.todayParsed.journal;
    ta.placeholder = 'Write what’s on your mind…';
    ta.rows = Math.max(8, ta.value.split('\n').length + 2);
    ta.addEventListener('input', () => {
      ta.style.height = 'auto';
      ta.style.height = ta.scrollHeight + 'px';
      if (this._journalSaveTimer) clearTimeout(this._journalSaveTimer);
      this._journalSaveTimer = setTimeout(() => this.saveTodayJournal(ta.value), 800);
    });
    setTimeout(() => { ta.style.height = ta.scrollHeight + 'px'; }, 0);

    /* Footer */
    const footer = root.createDiv();
    footer.style.marginTop = '24px';
    footer.style.fontSize = '12px';
    footer.style.color = 'var(--cad-ink-4)';
    const link = footer.createEl('a', { text: 'Open today\'s daily note →' });
    link.style.color = 'var(--cad-emerald-deep)';
    link.style.cursor = 'pointer';
    link.addEventListener('click', () => {
      this.app.workspace.openLinkText(this.todayFile.path, '', false);
    });
  }

  async toggleTodayTask(idx, checked) {
    const content = await this.app.vault.read(this.todayFile);
    const parsed = parseSections(content, this.plugin.settings);
    const taskLine = parsed.tasks[idx] || '';
    const taskText = taskLine.replace(/^\s*-\s\[(x|X| )\]\s/, '').trim();
    const newTasks = parsed.tasks.map((line, i) => {
      if (i !== idx) return line;
      return checked
        ? line.replace(/^\s*-\s\[\s\]\s/, '- [x] ')
        : line.replace(/^\s*-\s\[(x|X)\]\s/, '- [ ] ');
    });
    const newContent = replaceSection(content, this.plugin.settings.tasksHeading, newTasks.join('\n'));
    await this.app.vault.modify(this.todayFile, newContent);
    if (taskText) {
      await this._propagateTaskComplete(taskText, checked, { kind: 'daily', file: this.todayFile, date: new Date() });
    }
    this.render();
  }

  async appendTodayTask(text) {
    const content = await this.app.vault.read(this.todayFile);
    const parsed = parseSections(content, this.plugin.settings);
    const newTasks = [...parsed.tasks, `- [ ] ${text}`];
    const newContent = replaceSection(content, this.plugin.settings.tasksHeading, newTasks.join('\n'));
    await this.app.vault.modify(this.todayFile, newContent);
    this.render();
  }

  async saveTodayJournal(body) {
    const content = await this.app.vault.read(this.todayFile);
    const newContent = replaceSection(content, this.plugin.settings.journalHeading, body || '');
    await this.app.vault.modify(this.todayFile, newContent);
  }

  /* ── Planner pane ───────────────────────── */
  async renderPlannerPane(root) {
    root.addClass('cadence-planner');
    const settings = this.plugin.settings;
    const days = weekDates(this.plannerAnchor, settings.weekStartsOn);
    const today = startOfDay(new Date());

    const header = root.createDiv({ cls: 'cad-pl-header' });
    const titleWrap = header.createDiv({ cls: 'cad-pl-title-wrap' });
    titleWrap.createDiv({ cls: 'cad-eyebrow', text: 'WEEK OF' });
    const startStr = days[0].toLocaleDateString(undefined, { month: 'long', day: 'numeric' });
    const endStr   = days[6].toLocaleDateString(undefined, { month: 'long', day: 'numeric', year: 'numeric' });
    titleWrap.createDiv({ cls: 'cad-pl-title', text: `${startStr} – ${endStr}` });

    const nav = header.createDiv({ cls: 'cad-pl-nav' });
    const mkBtn = (label, fn, cls = '') => {
      const b = nav.createEl('button', { text: label, cls: 'cad-pl-btn ' + cls });
      b.addEventListener('click', fn);
    };
    mkBtn('◀',     () => { this.plannerAnchor = addDays(this.plannerAnchor, -7); this.render(); });
    mkBtn('Today', () => { this.plannerAnchor = startOfDay(new Date());           this.render(); }, 'primary');
    mkBtn('▶',     () => { this.plannerAnchor = addDays(this.plannerAnchor,  7); this.render(); });

    let totalOpen = 0, totalDone = 0;
    const dayData = await Promise.all(days.map(async (d) => {
      const path = dailyNotePath(settings, d);
      const file = this.app.vault.getAbstractFileByPath(path);
      if (!file || !(file instanceof obsidian.TFile)) {
        return { date: d, path, exists: false, tasks: [] };
      }
      const content = await this.app.vault.read(file);
      const parsed = parseSections(content, settings);
      return { date: d, path, exists: true, file, tasks: parsed.tasks };
    }));
    dayData.forEach((d) => {
      d.tasks.forEach((l) => {
        if (/ \[(x|X)\] /.test(l)) totalDone++;
        else if (/ \[ \] /.test(l)) totalOpen++;
      });
    });

    const stats = root.createDiv({ cls: 'cad-pl-stats' });
    const mkStat = (label, value) => {
      const c = stats.createDiv({ cls: 'cad-pl-stat' });
      c.createDiv({ cls: 'cad-pl-stat-label', text: label });
      c.createDiv({ cls: 'cad-pl-stat-value', text: String(value) });
    };
    mkStat('OPEN', totalOpen);
    mkStat('DONE', totalDone);
    mkStat('TOTAL', totalOpen + totalDone);

    const grid = root.createDiv({ cls: 'cad-pl-grid' });
    dayData.forEach((d) => {
      const isToday = sameDay(d.date, today);
      const col = grid.createDiv({ cls: 'cad-pl-day' + (isToday ? ' today' : '') });

      const colHead = col.createDiv({ cls: 'cad-pl-day-head' });
      colHead.createDiv({
        cls: 'cad-pl-weekday',
        text: d.date.toLocaleDateString(undefined, { weekday: 'short' }).toUpperCase(),
      });
      colHead.createDiv({ cls: 'cad-pl-daynum', text: String(d.date.getDate()) });
      const open = d.tasks.filter((l) => / \[ \] /.test(l)).length;
      const done = d.tasks.filter((l) => / \[(x|X)\] /.test(l)).length;
      colHead.createDiv({
        cls: 'cad-pl-meta',
        text: d.exists ? `${open} open · ${done} done` : 'no note',
      });
      colHead.addEventListener('click', async () => {
        if (!d.exists) {
          await ensureDailyNote(this.app, settings, d.date);
        }
        this.app.workspace.openLinkText(d.path, '', false);
      });

      const list = col.createDiv({ cls: 'cad-pl-tasks' });
      if (!d.tasks.length) {
        list.createDiv({ cls: 'cad-empty', text: d.exists ? '—' : '' });
      } else {
        d.tasks.forEach((rawLine, idx) => {
          const checked = / \[(x|X)\] /.test(rawLine);
          const text = rawLine.replace(/^\s*-\s\[(x|X| )\]\s/, '');
          const row = list.createDiv({ cls: 'cad-pl-task' + (checked ? ' done' : '') });
          const cb = row.createEl('input', { type: 'checkbox' });
          cb.checked = checked;
          cb.addEventListener('change', () => this.togglePlannerTask(d, idx, cb.checked));
          row.createSpan({ text });
        });
      }
    });
  }

  async togglePlannerTask(day, idx, checked) {
    if (!day.file) return;
    const content = await this.app.vault.read(day.file);
    const parsed = parseSections(content, this.plugin.settings);
    const taskLine = parsed.tasks[idx] || '';
    const taskText = taskLine.replace(/^\s*-\s\[(x|X| )\]\s/, '').trim();
    const newTasks = parsed.tasks.map((line, i) => {
      if (i !== idx) return line;
      return checked
        ? line.replace(/^\s*-\s\[\s\]\s/, '- [x] ')
        : line.replace(/^\s*-\s\[(x|X)\]\s/, '- [ ] ');
    });
    const newContent = replaceSection(content, this.plugin.settings.tasksHeading, newTasks.join('\n'));
    await this.app.vault.modify(day.file, newContent);
    if (taskText) {
      await this._propagateTaskComplete(taskText, checked, { kind: 'daily', file: day.file, date: day.date });
    }
    this.render();
  }

  async onClose() { /* nothing */ }
}

/* ─────────── Settings tab ─────────── */
class CadenceSettingTab extends obsidian.PluginSettingTab {
  constructor(app, plugin) { super(app, plugin); this.plugin = plugin; }

  display() {
    const { containerEl } = this;
    containerEl.empty();
    containerEl.createEl('h2', { text: 'BOB Workspace Cadence' });

    const fork = containerEl.createEl('p', { cls: 'setting-item-description' });
    fork.appendText('BOB Workspace is a fork of the ');
    fork.createEl('a', {
      text: 'Cadence Planner',
      href: 'https://github.com/iotool/obsidian-cadence-planner',
    }).setAttribute('target', '_blank');
    fork.appendText(' Obsidian plugin, extended with canonical schema editing, .base files, vault-aware entity mapping, and configurable folders. ');
    fork.createEl('strong', { text: 'Folder-structure compatibility with upstream Cadence is intended but not yet fully verified' });
    fork.appendText(' — if you switch between forks, back up your vault first.');

    /* ─── Settings tab bar ─── */
    const TAB_IDS = ['workspace', 'modules', 'data-model', 'planner', 'app', 'data'];
    const TAB_LABELS = ['Workspace', 'Modules', 'Data model', 'Planner', 'App', 'Data'];
    if (!this._activeSettingsTab) this._activeSettingsTab = 'workspace';
    if (!this._collapsedModules) this._collapsedModules = new Set();
    const tabBar = containerEl.createDiv({ cls: 'cad-settings-tabs' });
    const tabPanels = {};
    const tabBtns = {};
    TAB_IDS.forEach((id, i) => {
      const btn = tabBar.createEl('button', { cls: 'cad-settings-tab', text: TAB_LABELS[i] });
      if (id === this._activeSettingsTab) btn.addClass('is-active');
      btn.addEventListener('click', () => {
        TAB_IDS.forEach((tid) => {
          tabPanels[tid].style.display = tid === id ? '' : 'none';
          tabBtns[tid].toggleClass('is-active', tid === id);
        });
        this._activeSettingsTab = id;
      });
      tabBtns[id] = btn;
      const panel = containerEl.createDiv({ cls: 'cad-settings-tab-panel' });
      if (id !== this._activeSettingsTab) panel.style.display = 'none';
      tabPanels[id] = panel;
    });
    const pWs = tabPanels['workspace'];
    const pMod = tabPanels['modules'];
    const pDm = tabPanels['data-model'];
    const pPlanner = tabPanels['planner'];
    const pApp = tabPanels['app'];
    const pData = tabPanels['data'];

    /* ─── Workspace configuration (workspace.json) ─── */
    pWs.createEl('h3', { text: 'Workspace definition' });
    const workspaceDesc = pWs.createEl('p', { cls: 'setting-item-description' });
    workspaceDesc.appendText('Define schema loading, Base/view associations, templates, navigation groups, surfaces, secondary tabs and workbook groups in ');
    workspaceDesc.createEl('code', { text: 'workspace.json' });
    workspaceDesc.appendText(' next to plugin data. Entity-backed surfaces are rendered automatically; existing built-in surface IDs retain their specialized views.');

    const workspaceWrap = pWs.createDiv({ cls: 'cad-settings-entities' });
    const workspaceStatus = workspaceWrap.createDiv({ cls: 'cad-settings-entities-status' });
    const workspaceTa = workspaceWrap.createEl('textarea', { cls: 'cad-settings-entities-textarea' });
    workspaceTa.rows = 18;
    workspaceTa.spellcheck = false;
    workspaceTa.style.width = '100%';
    workspaceTa.style.fontFamily = 'var(--font-monospace)';
    workspaceTa.style.fontSize = '12px';
    const adapter = this.plugin.app.vault.adapter;
    (async () => {
      try {
        if (await adapter.exists(WORKSPACE_CONFIG_PATH)) {
          workspaceTa.value = await adapter.read(WORKSPACE_CONFIG_PATH);
          workspaceStatus.setText(`Loaded ${WORKSPACE_CONFIG_PATH}`);
        } else {
          workspaceTa.value = workspaceConfigTemplate(this.plugin.settings);
          workspaceStatus.setText('No workspace.json yet - edit and Save to make navigation/config file-managed.');
        }
        renderConfigurationDesigners();
      } catch (e) {
        workspaceStatus.setText(`Read error: ${e.message}`);
      }
    })();
    const setWorkspaceStatus = (message, ok) => {
      workspaceStatus.setText(message);
      workspaceStatus.style.color = ok ? 'var(--text-success)' : 'var(--text-error)';
    };
    workspaceTa.addEventListener('input', () => {
      try {
        const parsed = validateWorkspaceConfig(JSON.parse(workspaceTa.value));
        const count = parsed.navigation?.groups?.length || 0;
        setWorkspaceStatus(`Valid - ${count} navigation group${count === 1 ? '' : 's'}`, true);
      } catch (e) {
        setWorkspaceStatus(`Invalid JSON/config: ${e.message}`, false);
      }
    });
    const workspaceBtns = workspaceWrap.createDiv({ cls: 'cad-settings-entities-btns' });
    workspaceBtns.style.display = 'flex';
    workspaceBtns.style.gap = '8px';
    workspaceBtns.style.marginTop = '8px';
    const workspaceFormatBtn = workspaceBtns.createEl('button', { text: 'Format' });
    workspaceFormatBtn.addEventListener('click', () => {
      try {
        workspaceTa.value = JSON.stringify(validateWorkspaceConfig(JSON.parse(workspaceTa.value)), null, 2);
        setWorkspaceStatus('Formatted', true);
        renderConfigurationDesigners();
      } catch (e) {
        setWorkspaceStatus(`Cannot format: ${e.message}`, false);
      }
    });
    const workspaceSaveBtn = workspaceBtns.createEl('button', { text: 'Save and apply', cls: 'mod-cta' });
    workspaceSaveBtn.addEventListener('click', async () => {
      try {
        await saveWorkspaceConfig(this.plugin.app, workspaceTa.value);
        await reloadEntityConfiguration(this.plugin.app, this.plugin.settings);
        this.plugin.refreshOpenViews();
        new obsidian.Notice('BOB Workspace: workspace.json saved and applied.');
        this.display();
      } catch (e) {
        setWorkspaceStatus(`Save failed: ${e.message}`, false);
        new obsidian.Notice(`BOB Workspace: workspace.json save failed - ${e.message}`);
      }
    });
    const workspaceRestoreBtn = workspaceBtns.createEl('button', { text: 'Restore backup' });
    workspaceRestoreBtn.addEventListener('click', async () => {
      try {
        if (!(await adapter.exists(WORKSPACE_BACKUP_PATH))) {
          setWorkspaceStatus('No workspace backup file found', false);
          return;
        }
        workspaceTa.value = await adapter.read(WORKSPACE_BACKUP_PATH);
        setWorkspaceStatus('Backup loaded into editor - click Save and apply', true);
        renderConfigurationDesigners();
      } catch (e) {
        setWorkspaceStatus(`Restore failed: ${e.message}`, false);
      }
    });
    const workspaceMigrateBtn = workspaceBtns.createEl('button', { text: 'Import Bases from settings' });
    workspaceMigrateBtn.addEventListener('click', () => {
      try {
        const config = validateWorkspaceConfig(JSON.parse(workspaceTa.value));
        config.bases = config.bases || {};
        Object.entries(this.plugin.settings.baseFiles || {}).forEach(([entityKey, file]) => {
          if (!file) return;
          config.bases[entityKey] = { file };
          if ((this.plugin.settings.baseViews || {})[entityKey]) {
            config.bases[entityKey].view = this.plugin.settings.baseViews[entityKey];
          }
        });
        if (config.entities && !Object.keys(config.entities).length) delete config.entities;
        workspaceTa.value = JSON.stringify(config, null, 2);
        setWorkspaceStatus('Base associations imported into workspace draft - click Save and apply', true);
        renderConfigurationDesigners();
      } catch (e) {
        setWorkspaceStatus(`Import failed: ${e.message}`, false);
      }
    });

    const navDesigner = pWs.createDiv({ cls: 'cad-nav-designer' });
    const navDesignerHead = navDesigner.createDiv({ cls: 'cad-nav-designer-head' });
    navDesignerHead.createEl('h4', { text: 'Navigation designer' });
    navDesignerHead.createEl('p', {
      cls: 'setting-item-description',
      text: 'Drag unassigned tabs or record types into groups and move existing menu items between groups. Choose icons from Obsidian\'s registered icon library. Remove an item to return it to its available pool. Changes update the workspace JSON draft; use Save and apply above to persist them.',
    });
    const navDesignerBody = navDesigner.createDiv({ cls: 'cad-nav-designer-body' });
    const workbookDesigner = pWs.createDiv({ cls: 'cad-workbook-designer' });
    const workbookDesignerHead = workbookDesigner.createDiv({ cls: 'cad-nav-designer-head' });
    workbookDesignerHead.createEl('h4', { text: 'Workbook export groups' });
    workbookDesignerHead.createEl('p', {
      cls: 'setting-item-description',
      text: 'Define reusable XLSX export bundles in workspace.json. Assign a record type to more than one bundle when separate exports need overlapping data.',
    });
    const workbookDesignerBody = workbookDesigner.createDiv({ cls: 'cad-workbook-designer-body' });

    const readWorkspaceDraft = () => validateWorkspaceConfig(JSON.parse(workspaceTa.value));
    const renderConfigurationDesigners = () => {
      renderNavDesigner();
      renderWorkbookDesigner();
    };
    const updateWorkspaceDraft = (config, message) => {
      workspaceTa.value = JSON.stringify(config, null, 2);
      setWorkspaceStatus(message || 'Workspace changed - click Save and apply', true);
      renderConfigurationDesigners();
    };
    const saveWorkspaceBase = async (entityKey, file, view) => {
      const config = readWorkspaceDraft();
      config.bases = config.bases || {};
      if (file) {
        config.bases[entityKey] = { file };
        if (view) config.bases[entityKey].view = view;
      } else {
        delete config.bases[entityKey];
      }
      if (config.entities && !Object.keys(config.entities).length) delete config.entities;
      workspaceTa.value = JSON.stringify(config, null, 2);
      await saveWorkspaceConfig(this.plugin.app, workspaceTa.value);
      await reloadEntityConfiguration(this.plugin.app, this.plugin.settings);
      this.plugin.refreshOpenViews();
    };
    let activeDragPayload = null;
    const parseDragData = (event) => {
      if (activeDragPayload) return activeDragPayload;
      try {
        const raw = event.dataTransfer.getData('text/bob-workspace-nav') || event.dataTransfer.getData('text/plain');
        return raw ? JSON.parse(raw) : null;
      } catch (_) {
        return null;
      }
    };
    const dragPayload = (event, payload) => {
      activeDragPayload = payload;
      event.dataTransfer.effectAllowed = 'move';
      event.dataTransfer.setData('text/bob-workspace-nav', JSON.stringify(payload));
      event.dataTransfer.setData('text/plain', JSON.stringify(payload));
    };
    const clearDragPayload = () => {
      activeDragPayload = null;
      navDesigner.querySelectorAll('.drag-over').forEach((element) => element.removeClass('drag-over'));
    };
    const createIconPickerButton = (parent, initialIcon, onChange, emptyText = 'Choose icon') => {
      let currentIcon = initialIcon || '';
      const button = parent.createEl('button', {
        cls: 'cad-nav-designer-icon-button',
        attr: { type: 'button', title: 'Choose an Obsidian icon' },
      });
      button.draggable = false;
      const render = () => {
        button.empty();
        const preview = button.createSpan({ cls: 'cad-nav-designer-icon-preview' });
        try { obsidian.setIcon(preview, currentIcon || 'shapes'); } catch (_) {}
        button.createSpan({ cls: 'cad-nav-designer-icon-name', text: currentIcon || emptyText });
      };
      button.addEventListener('mousedown', (event) => event.stopPropagation());
      button.addEventListener('dragstart', (event) => event.stopPropagation());
      button.addEventListener('click', (event) => {
        event.preventDefault();
        event.stopPropagation();
        new CadenceIconPickerModal(this.plugin.app, currentIcon, (iconId) => {
          currentIcon = iconId;
          render();
          onChange(iconId);
        }).open();
      });
      render();
      return button;
    };
    const moveGroup = (config, sourceGroupIndex, targetGroupIndex) => {
      if (sourceGroupIndex === targetGroupIndex) return false;
      const groups = config.navigation.groups;
      const moved = groups.splice(sourceGroupIndex, 1)[0];
      if (!moved) return false;
      let destination = targetGroupIndex;
      if (sourceGroupIndex < targetGroupIndex) destination--;
      groups.splice(destination, 0, moved);
      return true;
    };
    const mutateGroupsForDrop = (config, payload, targetGroupIndex, targetItemIndex = null) => {
      const groups = config.navigation.groups;
      const target = groups[targetGroupIndex];
      if (!target) return false;
      let surface;
      if (payload.type === 'item') {
        const sourceGroup = groups[payload.groupIndex];
        if (!sourceGroup?.items?.[payload.itemIndex]) return false;
        surface = sourceGroup.items.splice(payload.itemIndex, 1)[0];
        if (payload.groupIndex === targetGroupIndex && targetItemIndex != null && payload.itemIndex < targetItemIndex) {
          targetItemIndex--;
        }
      } else if (payload.type === 'tab') {
        const tab = config.navigation.secondaryTabs?.[payload.parentId]?.[payload.tabIndex];
        if (!tab) return false;
        const all = groups.flatMap((group) => group.items || []);
        surface = navigationSurfaceFromTab(payload.parentId, tab, all);
        removeSurfaceFromGroups(groups, surface.id);
      } else if (payload.type === 'entity') {
        const def = Object.assign({}, ENTITIES[payload.entityKey] || {});
        if (!def.label) return false;
        surface = groups.flatMap((group) => group.items || []).find((item) => item.entityKey === payload.entityKey);
        if (surface) removeSurfaceFromGroups(groups, surface.id);
        else surface = {
          id: `records.${payload.entityKey}`,
          label: def.plural || pluralizeEntityLabel(def.label),
          icon: def.icon || 'file-text',
          entityKey: payload.entityKey,
          desc: def.desc || `${def.plural || pluralizeEntityLabel(def.label)} records`,
        };
        delete surface.navLevel;
        delete surface.parent;
      } else {
        return false;
      }
      if (target.module) surface.module = target.module;
      else delete surface.module;
      if (!Array.isArray(target.items)) target.items = [];
      if (targetItemIndex == null || targetItemIndex > target.items.length) target.items.push(surface);
      else target.items.splice(Math.max(0, targetItemIndex), 0, surface);
      return true;
    };
    const movePayloadToTabs = (config, payload, targetParentId) => {
      const tabsByParent = config.navigation.secondaryTabs || (config.navigation.secondaryTabs = {});
      const targetTabs = tabsByParent[targetParentId] || (tabsByParent[targetParentId] = []);
      let tab;
      if (payload.type === 'item') {
        const sourceGroup = config.navigation.groups[payload.groupIndex];
        const surface = sourceGroup?.items?.[payload.itemIndex];
        if (!surface || surface.id === targetParentId || !surface.entityKey) return false;
        sourceGroup.items.splice(payload.itemIndex, 1);
        for (const [parentId, tabs] of Object.entries(tabsByParent)) {
          const existingIndex = tabs.findIndex((candidate) => surfaceMatchesTab(surface, candidate));
          if (existingIndex >= 0) {
            if (parentId === targetParentId) return true;
            tab = tabs.splice(existingIndex, 1)[0];
            break;
          }
        }
        tab = tab || {
          label: surface.label,
          entityKey: surface.entityKey,
          route: surface.entityKey ? undefined : surface.id,
          icon: surface.icon,
        };
      } else if (payload.type === 'entity') {
        const def = Object.assign({}, ENTITIES[payload.entityKey] || {});
        if (!def.label || targetTabs.some((candidate) => candidate.entityKey === payload.entityKey)) return false;
        tab = {
          label: def.plural || pluralizeEntityLabel(def.label),
          entityKey: payload.entityKey,
          icon: def.icon,
        };
      } else if (payload.type === 'tab') {
        const sourceTabs = tabsByParent[payload.parentId];
        if (!sourceTabs?.[payload.tabIndex] || payload.parentId === targetParentId) return false;
        tab = sourceTabs.splice(payload.tabIndex, 1)[0];
      } else {
        return false;
      }
      if (!tab || targetTabs.some((candidate) =>
        (tab.entityKey && candidate.entityKey === tab.entityKey) || (tab.route && candidate.route === tab.route)
      )) return true;
      targetTabs.push(tab);
      return true;
    };

    const renderNavDesigner = () => {
      navDesignerBody.empty();
      let config;
      try {
        config = readWorkspaceDraft();
      } catch (e) {
        navDesignerBody.createDiv({ cls: 'setting-item-description', text: `Fix workspace JSON to use the designer: ${e.message}` });
        return;
      }
      if (!config.navigation?.groups) {
        navDesignerBody.createDiv({ cls: 'setting-item-description', text: 'Add navigation.groups to workspace.json to arrange navigation visually.' });
        return;
      }
      const groups = config.navigation.groups;
      if (normalizeStandaloneNavigationSurfaces(groups, config.navigation.secondaryTabs || {}, true)) {
        workspaceTa.value = JSON.stringify(config, null, 2);
        setWorkspaceStatus('Converted ungrouped secondary/setup items to primary navigation - click Save and apply', true);
      }
      const allSurfaces = groups.flatMap((group) => group.items || []);
      const assignedSurfaces = allSurfaces.filter((surface) =>
        !isTabBackedSurface(surface, config.navigation.secondaryTabs || {}) || surface.placement === 'navigation'
      );
      const addGroupRow = navDesignerBody.createDiv({ cls: 'cad-nav-designer-add-group' });
      const newGroupInput = addGroupRow.createEl('input', { type: 'text', placeholder: 'New group label' });
      let newGroupIcon = '';
      createIconPickerButton(addGroupRow, '', (iconId) => { newGroupIcon = iconId; });
      const addGroupBtn = addGroupRow.createEl('button', { text: '+ Add group' });
      addGroupBtn.addEventListener('click', () => {
        const label = newGroupInput.value.trim();
        if (!label) return;
        const seed = label.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'group';
        let id = seed;
        let suffix = 2;
        while (groups.some((group) => group.id === id)) id = `${seed}-${suffix++}`;
        const group = { id, label, module: id, items: [] };
        if (newGroupIcon) group.icon = newGroupIcon;
        groups.push(group);
        updateWorkspaceDraft(config, `${label} group added - click Save and apply`);
      });
      const palette = navDesignerBody.createDiv({ cls: 'cad-nav-designer-tabs' });
      palette.createDiv({ cls: 'cad-nav-designer-label', text: 'Tabs - drag a tab into navigation, or drop an item into a parent tab area' });
      const tabParents = palette.createDiv({ cls: 'cad-nav-designer-tab-parents' });
      const tabEntityKeys = new Set();
      Object.entries(config.navigation.secondaryTabs || {}).forEach(([parentId, tabs]) => {
        const parentSurface = allSurfaces.find((surface) => surface.id === parentId);
        const parentEl = tabParents.createDiv({ cls: 'cad-nav-designer-tab-parent' });
        const parentHead = parentEl.createDiv({ cls: 'cad-nav-designer-tab-parent-head' });
        parentHead.createSpan({ text: parentSurface?.label || parentId });
        if (!tabs.length) {
          const removeTabs = parentHead.createEl('button', { cls: 'cad-nav-designer-action danger', text: 'Remove' });
          removeTabs.addEventListener('click', () => {
            delete config.navigation.secondaryTabs[parentId];
            updateWorkspaceDraft(config, `${parentSurface?.label || parentId} tab area removed - click Save and apply`);
          });
        }
        const tabChips = parentEl.createDiv({ cls: 'cad-nav-designer-tab-chips' });
        tabs.forEach((tab, tabIndex) => {
          if (tab.entityKey) tabEntityKeys.add(tab.entityKey);
          const existing = assignedSurfaces.find((surface) =>
            surface.id !== parentId &&
            ((tab.entityKey && surface.entityKey === tab.entityKey) || (tab.route && surface.id === tab.route))
          );
          if (existing) return;
          const chip = tabChips.createDiv({ cls: 'cad-nav-designer-tab' });
          chip.draggable = true;
          chip.createSpan({ text: tab.label });
          const removeTab = chip.createEl('button', { cls: 'cad-nav-designer-tab-remove', text: '\u00d7' });
          removeTab.type = 'button';
          removeTab.title = `Remove ${tab.label} tab`;
          removeTab.draggable = false;
          removeTab.addEventListener('mousedown', (event) => event.stopPropagation());
          removeTab.addEventListener('dragstart', (event) => event.stopPropagation());
          removeTab.addEventListener('click', (event) => {
            event.preventDefault();
            event.stopPropagation();
            tabs.splice(tabIndex, 1);
            const primarySurface = groups.flatMap((group) => group.items || []).find((surface) =>
              surface.parent === parentId && surfaceMatchesTab(surface, tab)
            );
            makeNavigationSurfacePrimary(primarySurface);
            updateWorkspaceDraft(config, primarySurface
              ? `${tab.label} removed from ${parentSurface?.label || parentId} tabs and set as primary navigation - click Save and apply`
              : `${tab.label} removed from ${parentSurface?.label || parentId} tabs - click Save and apply`);
          });
          chip.addEventListener('dragstart', (event) => dragPayload(event, { type: 'tab', parentId, tabIndex }));
          chip.addEventListener('dragend', clearDragPayload);
        });
        if (!tabChips.childElementCount) tabChips.createSpan({ cls: 'cad-nav-designer-empty', text: 'Drop a child here' });
        parentEl.addEventListener('dragover', (event) => {
          const payload = parseDragData(event);
          const itemSurface = payload?.type === 'item'
            ? groups[payload.groupIndex]?.items?.[payload.itemIndex]
            : null;
          if (!payload || payload.type === 'group' ||
              (payload.type === 'tab' && payload.parentId === parentId) ||
              (payload.type === 'item' && (!itemSurface?.entityKey || itemSurface.id === parentId))) return;
          event.preventDefault();
          event.dataTransfer.dropEffect = 'move';
          parentEl.addClass('drag-over');
        });
        parentEl.addEventListener('dragleave', () => parentEl.removeClass('drag-over'));
        parentEl.addEventListener('drop', (event) => {
          event.preventDefault();
          event.stopPropagation();
          parentEl.removeClass('drag-over');
          const payload = parseDragData(event);
          if (payload && movePayloadToTabs(config, payload, parentId)) {
            updateWorkspaceDraft(config, `Tabs for ${parentSurface?.label || parentId} updated - click Save and apply`);
          }
          clearDragPayload();
        });
      });
      if (!tabParents.childElementCount) tabParents.createSpan({ cls: 'cad-nav-designer-empty', text: 'Create a tab area from a navigation parent to add tabs.' });
      const entityPalette = navDesignerBody.createDiv({ cls: 'cad-nav-designer-tabs' });
      entityPalette.createDiv({ cls: 'cad-nav-designer-label', text: 'Unassigned record types - drag into a navigation group' });
      const entityChips = entityPalette.createDiv({ cls: 'cad-nav-designer-tab-chips' });
      const entityDefs = Object.assign({}, ENTITIES);
      Object.entries(entityDefs).forEach(([entityKey, def]) => {
        if (!def || !def.label) return;
        const existing = assignedSurfaces.find((surface) => surface.entityKey === entityKey);
        if (existing || tabEntityKeys.has(entityKey)) return;
        const chip = entityChips.createDiv({ cls: 'cad-nav-designer-tab' });
        chip.draggable = true;
        chip.createSpan({ text: def.plural || pluralizeEntityLabel(def.label) });
        chip.addEventListener('dragstart', (event) => dragPayload(event, { type: 'entity', entityKey }));
        chip.addEventListener('dragend', clearDragPayload);
      });
      if (!entityChips.childElementCount) entityChips.createSpan({ cls: 'cad-nav-designer-empty', text: 'All record types are assigned.' });

      const removeZone = navDesignerBody.createDiv({ cls: 'cad-nav-designer-remove', text: 'Drop a navigation item here to remove it and return it to the available pool' });
      removeZone.addEventListener('dragover', (event) => {
        if (parseDragData(event)?.type !== 'item') return;
        event.preventDefault();
        event.dataTransfer.dropEffect = 'move';
        removeZone.addClass('drag-over');
      });
      removeZone.addEventListener('dragleave', () => removeZone.removeClass('drag-over'));
      removeZone.addEventListener('drop', (event) => {
        event.preventDefault();
        event.stopPropagation();
        removeZone.removeClass('drag-over');
        const payload = parseDragData(event);
        const surface = payload?.type === 'item' ? groups[payload.groupIndex]?.items?.splice(payload.itemIndex, 1)[0] : null;
        if (surface) updateWorkspaceDraft(config, `${surface.label} removed from navigation - click Save and apply`);
        clearDragPayload();
      });

      const board = navDesignerBody.createDiv({ cls: 'cad-nav-designer-board' });
      groups.forEach((group, groupIndex) => {
        const groupEl = board.createDiv({ cls: 'cad-nav-designer-group' });
        groupEl.dataset.groupIndex = String(groupIndex);
        groupEl.addEventListener('dragover', (event) => {
          if (!parseDragData(event)) return;
          event.preventDefault();
          event.dataTransfer.dropEffect = 'move';
          groupEl.addClass('drag-over');
        });
        groupEl.addEventListener('dragleave', () => groupEl.removeClass('drag-over'));
        groupEl.addEventListener('drop', (event) => {
          event.preventDefault();
          event.stopPropagation();
          groupEl.removeClass('drag-over');
          const payload = parseDragData(event);
          if (payload?.type === 'group') {
            if (moveGroup(config, payload.groupIndex, groupIndex)) updateWorkspaceDraft(config);
          } else if (payload && mutateGroupsForDrop(config, payload, groupIndex)) {
            updateWorkspaceDraft(config);
          }
          clearDragPayload();
        });
        const groupHead = groupEl.createDiv({ cls: 'cad-nav-designer-group-head' });
        groupHead.draggable = true;
        groupHead.addEventListener('dragstart', (event) => {
          event.stopPropagation();
          dragPayload(event, { type: 'group', groupIndex });
        });
        groupHead.addEventListener('dragend', clearDragPayload);
        groupHead.createSpan({ cls: 'cad-nav-designer-handle', text: '::' });
        groupHead.createSpan({ cls: 'cad-nav-designer-group-title', text: group.label || group.id });
        createIconPickerButton(groupHead, group.icon, (iconId) => {
          if (iconId) group.icon = iconId;
          else delete group.icon;
          updateWorkspaceDraft(config, `${group.label || group.id} icon updated - click Save and apply`);
        });
        if (!(group.items || []).length) {
          const removeGroup = groupHead.createEl('button', { cls: 'cad-nav-designer-action danger', text: 'Remove' });
          removeGroup.draggable = false;
          removeGroup.addEventListener('mousedown', (event) => event.stopPropagation());
          removeGroup.addEventListener('click', (event) => {
            event.stopPropagation();
            groups.splice(groupIndex, 1);
            updateWorkspaceDraft(config, `${group.label || group.id} group removed - click Save and apply`);
          });
        }
        const groupItems = groupEl.createDiv({ cls: 'cad-nav-designer-items' });
        (group.items || []).forEach((surface, itemIndex) => {
          const isTabBacked = isTabBackedSurface(surface, config.navigation.secondaryTabs || {});
          if (isTabBacked && surface.placement !== 'navigation') return;
          const item = groupItems.createDiv({ cls: 'cad-nav-designer-item' });
          item.draggable = true;
          item.addEventListener('dragstart', (event) => {
            event.stopPropagation();
            dragPayload(event, { type: 'item', groupIndex, itemIndex });
          });
          item.addEventListener('dragend', clearDragPayload);
          item.addEventListener('dragover', (event) => {
            if (!parseDragData(event)) return;
            event.preventDefault();
            event.stopPropagation();
            event.dataTransfer.dropEffect = 'move';
            item.addClass('drag-over');
          });
          item.addEventListener('dragleave', () => item.removeClass('drag-over'));
          item.addEventListener('drop', (event) => {
            event.preventDefault();
            event.stopPropagation();
            item.removeClass('drag-over');
            const payload = parseDragData(event);
            if (payload?.type === 'group') {
              if (moveGroup(config, payload.groupIndex, groupIndex)) updateWorkspaceDraft(config);
            } else if (payload && mutateGroupsForDrop(config, payload, groupIndex, itemIndex)) {
              updateWorkspaceDraft(config);
            }
            clearDragPayload();
          });
          item.createSpan({ cls: 'cad-nav-designer-handle', text: '::' });
          const itemText = item.createSpan({ cls: 'cad-nav-designer-item-text', text: surface.label });
          itemText.title = surface.id;
          createIconPickerButton(item, surface.icon, (iconId) => {
            if (iconId) surface.icon = iconId;
            else delete surface.icon;
            updateWorkspaceDraft(config, `${surface.label} icon updated - click Save and apply`);
          });
          if (surface.navLevel) item.createSpan({ cls: 'cad-nav-designer-level', text: surface.navLevel });
          if (!surface.parent && !Object.prototype.hasOwnProperty.call(config.navigation.secondaryTabs || {}, surface.id)) {
            const addTabs = item.createEl('button', { cls: 'cad-nav-designer-action', text: '+ Tabs' });
            addTabs.draggable = false;
            addTabs.addEventListener('mousedown', (event) => event.stopPropagation());
            addTabs.addEventListener('click', (event) => {
              event.stopPropagation();
              if (!config.navigation.secondaryTabs) config.navigation.secondaryTabs = {};
              config.navigation.secondaryTabs[surface.id] = surface.entityKey
                ? [{ label: surface.label, entityKey: surface.entityKey, icon: surface.icon }]
                : [];
              updateWorkspaceDraft(config, `Tab area added for ${surface.label} - click Save and apply`);
            });
          }
          const remove = item.createEl('button', {
            cls: 'cad-nav-designer-action danger',
            text: isTabBacked ? 'As tabs' : 'Remove',
          });
          remove.draggable = false;
          remove.addEventListener('mousedown', (event) => event.stopPropagation());
          remove.addEventListener('click', (event) => {
            event.stopPropagation();
            group.items.splice(itemIndex, 1);
            updateWorkspaceDraft(config, isTabBacked
              ? `${surface.label} moved to tabs - click Save and apply`
              : `${surface.label} removed from navigation - click Save and apply`);
          });
        });
        const empty = groupItems.createDiv({ cls: 'cad-nav-designer-dropzone', text: 'Drop available item here' });
        empty.addEventListener('dragover', (event) => {
          if (!parseDragData(event)) return;
          event.preventDefault();
          event.stopPropagation();
          event.dataTransfer.dropEffect = 'move';
          empty.addClass('drag-over');
        });
        empty.addEventListener('dragleave', () => empty.removeClass('drag-over'));
        empty.addEventListener('drop', (event) => {
          event.preventDefault();
          event.stopPropagation();
          empty.removeClass('drag-over');
          const payload = parseDragData(event);
          if (payload?.type === 'group') {
            if (moveGroup(config, payload.groupIndex, groupIndex)) updateWorkspaceDraft(config);
          } else if (payload && mutateGroupsForDrop(config, payload, groupIndex)) {
            updateWorkspaceDraft(config);
          }
          clearDragPayload();
        });
      });
    };
    const renderWorkbookDesigner = () => {
      workbookDesignerBody.empty();
      let config;
      try {
        config = readWorkspaceDraft();
      } catch (e) {
        workbookDesignerBody.createDiv({ cls: 'setting-item-description', text: `Fix workspace JSON to edit export groups: ${e.message}` });
        return;
      }
      if (!Array.isArray(config.workbookGroups)) config.workbookGroups = [];
      const addRow = workbookDesignerBody.createDiv({ cls: 'cad-nav-designer-add-group' });
      const newGroupInput = addRow.createEl('input', { type: 'text', placeholder: 'New export group label' });
      const addGroup = addRow.createEl('button', { text: '+ Add export group' });
      addGroup.addEventListener('click', () => {
        const label = newGroupInput.value.trim();
        if (!label) return;
        const seed = label.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'export';
        let id = seed;
        let suffix = 2;
        while (config.workbookGroups.some((group) => group.id === id)) id = `${seed}-${suffix++}`;
        config.workbookGroups.push({ id, label, entityKeys: [] });
        updateWorkspaceDraft(config, `${label} export group added - click Save and apply`);
      });
      if (!config.workbookGroups.length) {
        workbookDesignerBody.createDiv({ cls: 'cad-nav-designer-empty', text: 'No export groups defined. Add a group to make selected workbook exports available.' });
        return;
      }
      const entities = Object.entries(ENTITIES)
        .filter(([, def]) => def?.label)
        .sort(([, a], [, b]) => String(a.plural || a.label).localeCompare(String(b.plural || b.label)));
      const board = workbookDesignerBody.createDiv({ cls: 'cad-workbook-designer-board' });
      config.workbookGroups.forEach((group, groupIndex) => {
        const card = board.createDiv({ cls: 'cad-workbook-designer-group' });
        const head = card.createDiv({ cls: 'cad-workbook-designer-group-head' });
        const labelInput = head.createEl('input', { type: 'text', cls: 'cad-workbook-designer-title' });
        labelInput.value = group.label;
        labelInput.addEventListener('change', () => {
          const next = labelInput.value.trim();
          if (!next) {
            labelInput.value = group.label;
            return;
          }
          group.label = next;
          updateWorkspaceDraft(config, `${next} export group renamed - click Save and apply`);
        });
        const up = head.createEl('button', { cls: 'cad-nav-designer-action', text: 'Up' });
        up.disabled = groupIndex === 0;
        up.addEventListener('click', () => {
          if (groupIndex === 0) return;
          [config.workbookGroups[groupIndex - 1], config.workbookGroups[groupIndex]] =
            [config.workbookGroups[groupIndex], config.workbookGroups[groupIndex - 1]];
          updateWorkspaceDraft(config, 'Export group order updated - click Save and apply');
        });
        const down = head.createEl('button', { cls: 'cad-nav-designer-action', text: 'Down' });
        down.disabled = groupIndex === config.workbookGroups.length - 1;
        down.addEventListener('click', () => {
          if (groupIndex >= config.workbookGroups.length - 1) return;
          [config.workbookGroups[groupIndex], config.workbookGroups[groupIndex + 1]] =
            [config.workbookGroups[groupIndex + 1], config.workbookGroups[groupIndex]];
          updateWorkspaceDraft(config, 'Export group order updated - click Save and apply');
        });
        const remove = head.createEl('button', { cls: 'cad-nav-designer-action danger', text: 'Remove' });
        remove.addEventListener('click', () => {
          config.workbookGroups.splice(groupIndex, 1);
          updateWorkspaceDraft(config, `${group.label} export group removed - click Save and apply`);
        });
        const choices = card.createDiv({ cls: 'cad-workbook-designer-choices' });
        entities.forEach(([entityKey, def]) => {
          const row = choices.createEl('label', { cls: 'cad-workbook-designer-choice' });
          const checkbox = row.createEl('input', { type: 'checkbox' });
          checkbox.checked = group.entityKeys.includes(entityKey);
          row.createSpan({ text: def.plural || pluralizeEntityLabel(def.label) });
          checkbox.addEventListener('change', () => {
            if (checkbox.checked && !group.entityKeys.includes(entityKey)) group.entityKeys.push(entityKey);
            if (!checkbox.checked) group.entityKeys = group.entityKeys.filter((key) => key !== entityKey);
            updateWorkspaceDraft(config, `${group.label} export records updated - click Save and apply`);
          });
        });
      });
    };
    workspaceTa.addEventListener('input', renderConfigurationDesigners);
    setTimeout(renderConfigurationDesigners, 0);

    /* ─── Modules (consolidated: toggle + surfaces + folders + base files) ─── */
    pMod.createEl('p', {
      text: 'Each module groups its toggle, the surfaces it contains, and the folders/.base files that back them. Disable a module to hide its whole section; disable an individual surface to hide just that nav item.',
      cls: 'setting-item-description',
    });

    const ensureMods = () => {
      if (!this.plugin.settings.modules) {
        this.plugin.settings.modules = { crm: true, 'client-work': true, prm: true, srm: true, finance: true, procurement: true, tax: true, planner: true };
      }
      if (this.plugin.settings.modules['client-work'] == null) this.plugin.settings.modules['client-work'] = true;
      if (this.plugin.settings.modules.finance == null) this.plugin.settings.modules.finance = true;
      if (this.plugin.settings.modules.procurement == null) this.plugin.settings.modules.procurement = true;
      if (this.plugin.settings.modules.tax == null) this.plugin.settings.modules.tax = true;
      NAV_GROUPS.filter((group) => group.module).forEach((group) => {
        if (this.plugin.settings.modules[group.module] == null) this.plugin.settings.modules[group.module] = true;
      });
      return this.plugin.settings.modules;
    };
    const moduleLabels = {
      planner: 'Planner — daily planning, projects and capture.',
      crm:     'Customer Relationship Management — Contacts, Clients, My Companies, Pipeline, Activities.',
      'client-work': 'Client Work — Meetings, communications, deliverables, feedback, surveys, testimonials and decisions.',
      srm:     'Supplier Relationship Management — Suppliers, contracts, spend.',
      prm:     'Partner Relationship Management — Partners, Registrations, Commissions, Leads, Certifications, Analytics.',
      finance: 'Finance — periods, bank, journals, invoices, purchases, trial balances and statements.',
      procurement: 'Procurement — internal purchase requests and formal supplier purchase orders.',
      tax:     'Tax & Compliance — VAT, corporate tax, deferred tax, transfer pricing, legal rules and retention.',
      ai:      'AI Workspace — playbooks and installed skills.',
    };

    const baseFiles = this.plugin.app.vault.getFiles()
      .filter(f => f.extension === 'base')
      .sort((a, b) => a.path.localeCompare(b.path));
    const baseSummariesPromise = Promise.all(baseFiles.map((file) => readBaseSummary(this.plugin.app, file)))
      .then((items) => items.filter(Boolean).sort((a, b) => a.label.localeCompare(b.label)));

    NAV_GROUPS.forEach((group) => {
      const items = group.items.filter((s) => !['home', 'team', 'settings'].includes(s.id));
      if (!items.length) return;
      // Skip the empty-id 'misc' group and Reports/Workflow without a module
      const isModuleGroup = !!group.module;
      const headingText = group.label || (isModuleGroup ? group.id.toUpperCase() : '');
      if (!headingText) return;

      const moduleDisabled = isModuleGroup && ensureMods()[group.module] === false;

      const cardKey = group.module || group.id;
      const isCollapsed = this._collapsedModules.has(cardKey);
      const card = pMod.createDiv({ cls: 'cad-module-card' + (moduleDisabled ? ' is-off' : '') + (isCollapsed ? ' is-collapsed' : '') });
      const cardHead = card.createDiv({ cls: 'cad-module-card-head' });
      cardHead.createSpan({ text: headingText, cls: 'cad-module-card-label' });
      const chevron = cardHead.createSpan({ cls: 'cad-module-card-chevron', text: isCollapsed ? '›' : '⌄' });
      cardHead.addEventListener('click', () => {
        if (this._collapsedModules.has(cardKey)) {
          this._collapsedModules.delete(cardKey);
          card.removeClass('is-collapsed');
          chevron.setText('⌄');
        } else {
          this._collapsedModules.add(cardKey);
          card.addClass('is-collapsed');
          chevron.setText('›');
        }
      });
      const cardBody = card.createDiv({ cls: 'cad-module-card-body' });
      const settingGroup = cardBody.createDiv({ cls: 'setting-group' + (moduleDisabled ? ' cad-settings-panel-off' : '') });
      const panel = settingGroup.createDiv({ cls: 'setting-items' });

      // Module enable/disable toggle (only for groups with a module ID)
      if (isModuleGroup) {
        new obsidian.Setting(panel)
          .setName(`Enable ${headingText}`)
          .setDesc(moduleLabels[group.module] || `${headingText} module defined in workspace.json.`)
          .addToggle((t) => t
            .setValue(ensureMods()[group.module] !== false)
            .onChange(async (v) => {
              ensureMods()[group.module] = v;
              await this.plugin.saveSettings();
              this.plugin.refreshOpenViews();
              this.display();   // re-render to update surface row enabled state
            }));
      }

      // One row per surface: visibility toggle + folder text input + base file dropdown
      const disabled = new Set(this.plugin.settings.disabledSurfaces || []);
      items.forEach((surface) => {
        const eDef = surface.entityKey ? ENTITIES[surface.entityKey] : null;
        const overridden = eDef && (eDef.typeFilter || Array.isArray(eDef.folders));
        const level = surface.navLevel || 'primary';
        const levelLabel = level === 'secondary' ? 'Secondary tab'
          : level === 'setup' ? 'Setup'
          : 'Primary';
        const desc = [];
        desc.push(levelLabel);
        if (surface.parent) desc.push(`parent: ${SURFACE_BY_ID[surface.parent]?.label || surface.parent}`);
        if (overridden) {
          if (eDef.typeFilter)            desc.push(`type: "${eDef.typeFilter}"`);
          if (Array.isArray(eDef.folders))desc.push(`folders: [${eDef.folders.join(', ')}]`);
        } else {
          desc.push(surface.id);
        }
        const managedBase = !!configuredBaseDefinition(surface.entityKey);
        if (managedBase) desc.push('Base from workspace.json');
        const s = new obsidian.Setting(panel)
          .setName(`${surface.label} (${levelLabel})`)
          .setDesc(desc.join(' · '));
        if (moduleDisabled) s.settingEl.classList.add('cad-setting-disabled');

        // Visibility toggle
        s.addToggle((t) => {
          t.setValue(!disabled.has(surface.id))
            .onChange(async (v) => {
              const arr = this.plugin.settings.disabledSurfaces || [];
              if (!v) { if (!arr.includes(surface.id)) arr.push(surface.id); }
              else { const i = arr.indexOf(surface.id); if (i >= 0) arr.splice(i, 1); }
              this.plugin.settings.disabledSurfaces = arr;
              await this.plugin.saveSettings();
              this.plugin.refreshOpenViews();
            });
          if (moduleDisabled) t.setDisabled(true);
        });

        // Folder text input (if this surface has a folderKey and isn't overridden by schema or .base)
        if (surface.folderKey && !overridden) {
          const placeholder = eDef?.folders?.[0] || DEFAULT_SETTINGS[surface.folderKey] || '';
          s.addText((t) => {
            t.setPlaceholder(placeholder)
              .setValue(this.plugin.settings[surface.folderKey] || '')
              .onChange(async (v) => {
                const trimmed = v.trim();
                if (trimmed) this.plugin.settings[surface.folderKey] = trimmed;
                else delete this.plugin.settings[surface.folderKey];
                await this.plugin.saveSettings();
                syncEntityFolders(this.plugin.settings);
                this.plugin.refreshOpenViews();
              });
            if (moduleDisabled) t.setDisabled(true);
          });
        }

        // Base file dropdown (for surfaces backed by an entity)
        if (surface.entityKey) {
          const currentBase = entityBasePath(this.plugin.settings, surface.entityKey);
          const currentView = entityBaseViewName(this.plugin.settings, surface.entityKey);
          s.addDropdown((dd) => {
            dd.addOption('', 'Loading bases...');
            dd.setValue('');
            baseSummariesPromise.then((summaries) => {
              const compatible = summaries.filter((summary) => baseSummaryCompatibleWithEntity(summary, surface.entityKey));
              const selectedSummary = currentBase ? summaries.find((summary) => summary.path === currentBase) : null;
              const options = selectedSummary && !compatible.some((summary) => summary.path === selectedSummary.path)
                ? [selectedSummary, ...compatible]
                : compatible;
              dd.selectEl.empty();
              dd.addOption('', '— no base —');
              options.forEach((summary) => {
                const label = summary === selectedSummary && !baseSummaryCompatibleWithEntity(summary, surface.entityKey)
                  ? `[incompatible] ${summary.label}`
                  : summary.label;
                dd.addOption(summary.path, label);
              });
              dd.setValue(currentBase);
            });
            dd.onChange(async (v) => {
              await saveWorkspaceBase(surface.entityKey, v, '');
              this.display();
            });
            if (moduleDisabled) dd.setDisabled(true);
          });
          s.addDropdown((dd) => {
            dd.addOption('', currentBase ? 'Loading views...' : '— all properties —');
            dd.setValue('');
            if (!currentBase || moduleDisabled) dd.setDisabled(true);
            if (currentBase) {
              baseSummariesPromise.then((summaries) => {
                const summary = summaries.find((item) => item.path === currentBase);
                dd.selectEl.empty();
                dd.addOption('', '— all properties —');
                (summary?.views || []).forEach((viewName) => dd.addOption(viewName, viewName));
                dd.setValue(currentView);
                if (!moduleDisabled) dd.setDisabled(false);
              });
            }
            dd.onChange(async (v) => {
              await saveWorkspaceBase(surface.entityKey, currentBase, v);
              this.display();
            });
          });
        }
      });

      // Special case: Projects gets a multi-folder editor below its row
      if (group.id === 'planner') {
        const projectFoldersEl = panel.createDiv({ cls: 'cad-project-folders' });
        projectFoldersEl.style.cssText = 'padding:0 16px 12px;';
        const renderProjectFolders = () => {
          projectFoldersEl.empty();
          projectFoldersEl.createEl('div', { text: 'Project folders (first = default, additional = also scanned)', cls: 'setting-item-description' });
          const allFolders = [
            (this.plugin.settings.folderProjects || '30-CLIENTS'),
            ...(this.plugin.settings.projectFolders || []),
          ];
          allFolders.forEach((folder, idx) => {
            const row = projectFoldersEl.createDiv({ cls: 'cad-folder-row' });
            row.style.cssText = 'display:flex;align-items:center;gap:6px;margin:4px 0;';
            const inp = row.createEl('input', { type: 'text', cls: 'cad-folder-input' });
            inp.style.cssText = 'flex:1;';
            inp.value = folder;
            inp.placeholder = idx === 0 ? 'Default folder' : 'Additional folder';
            if (idx === 0) row.createEl('span', { text: 'default' }).style.cssText = 'font-size:10px;opacity:.6;';
            inp.addEventListener('change', async () => {
              const updated = [...allFolders];
              updated[idx] = inp.value.trim();
              this.plugin.settings.folderProjects = updated[0] || '30-CLIENTS';
              this.plugin.settings.projectFolders = updated.slice(1).filter(f => f);
              await this.plugin.saveSettings();
              syncEntityFolders(this.plugin.settings);
              this.plugin.refreshOpenViews();
            });
            if (idx > 0) {
              const rm = row.createEl('button', { text: '✕' });
              rm.addEventListener('click', async () => {
                const updated = allFolders.filter((_, i) => i !== idx);
                this.plugin.settings.folderProjects = updated[0] || '30-CLIENTS';
                this.plugin.settings.projectFolders = updated.slice(1).filter(f => f);
                await this.plugin.saveSettings();
                syncEntityFolders(this.plugin.settings);
                this.plugin.refreshOpenViews();
                renderProjectFolders();
              });
            }
          });
          const addBtn = projectFoldersEl.createEl('button', { text: '+ Add folder' });
          addBtn.style.marginTop = '4px';
          addBtn.addEventListener('click', async () => {
            if (!this.plugin.settings.projectFolders) this.plugin.settings.projectFolders = [];
            this.plugin.settings.projectFolders.push('');
            await this.plugin.saveSettings();
            renderProjectFolders();
          });
        };
        renderProjectFolders();
      }
    });

    pApp.createEl('h3', { text: 'Reminders' });
    const remindersGroup = pApp.createDiv({ cls: 'setting-group cad-settings-section' });
    const remindersPanel = remindersGroup.createDiv({ cls: 'setting-items' });
    new obsidian.Setting(remindersPanel)
      .setName('Desktop notifications')
      .setDesc('In addition to the in-app banner, fire a system notification when a reminder is due. Requires browser permission.')
      .addToggle((t) => t
        .setValue(!!this.plugin.settings.desktopNotifications)
        .onChange(async (v) => {
          this.plugin.settings.desktopNotifications = v;
          await this.plugin.saveSettings();
          if (v && typeof Notification !== 'undefined' && Notification.permission === 'default') {
            try { await Notification.requestPermission(); } catch (_) {}
          }
        }));

    new obsidian.Setting(remindersPanel)
      .setName('Notification permission')
      .setDesc(typeof Notification === 'undefined'
        ? 'Notifications API not available in this environment.'
        : `Current status: ${Notification.permission}`)
      .addButton((b) => b.setButtonText('Request permission').onClick(async () => {
        if (typeof Notification === 'undefined') return;
        try { await Notification.requestPermission(); this.display(); } catch (_) {}
      }));

    new obsidian.Setting(remindersPanel)
      .setName('Clear completed reminders')
      .setDesc(`${(this.plugin.settings.reminders || []).filter((r) => r.done).length} completed reminders stored.`)
      .addButton((b) => b.setButtonText('Clear').onClick(async () => {
        this.plugin.settings.reminders = (this.plugin.settings.reminders || []).filter((r) => !r.done);
        await this.plugin.saveSettings();
        this.plugin.refreshOpenViews();
        this.display();
      }));

    /* ─── App ─── */
    const appGroup = pApp.createDiv({ cls: 'setting-group cad-settings-section' });
    const appPanel = appGroup.createDiv({ cls: 'setting-items' });
    /* ─── Planner settings ─── */
    const plannerGroup = pPlanner.createDiv({ cls: 'setting-group cad-settings-section' });
    const plannerPanel = plannerGroup.createDiv({ cls: 'setting-items' });

    new obsidian.Setting(appPanel)
      .setName('Show secondary screens in left navigation')
      .setDesc('Shows lower-frequency child screens such as Sequences, Registrations, Commissions, Certifications, Journals, Statements and tax returns. They remain available as tabs on their parent screens when hidden.')
      .addToggle((t) => t
        .setValue(!!this.plugin.settings.showSecondaryNav)
        .onChange(async (v) => {
          this.plugin.settings.showSecondaryNav = v;
          await this.plugin.saveSettings();
          this.plugin.refreshOpenViews();
        }));

    new obsidian.Setting(appPanel)
      .setName('Show setup screens in left navigation')
      .setDesc('Shows setup/reference screens such as My Companies, Accounting Periods, Bank Accounts, Chart of Accounts, FX Rates, Legal Rules and Document Retention.')
      .addToggle((t) => t
        .setValue(!!this.plugin.settings.showSetupNav)
        .onChange(async (v) => {
          this.plugin.settings.showSetupNav = v;
          await this.plugin.saveSettings();
          this.plugin.refreshOpenViews();
        }));

    const peopleCategories = ENTITIES.contact.fields.find((f) => f.key === 'person_category')?.options
      || DEFAULT_SETTINGS.teamPersonCategories;
    const selectedTeamCategories = new Set(
      (Array.isArray(this.plugin.settings.teamPersonCategories)
        ? this.plugin.settings.teamPersonCategories
        : DEFAULT_SETTINGS.teamPersonCategories)
        .map((v) => String(v || '').toLowerCase())
    );
    const teamSetting = new obsidian.Setting(appPanel)
      .setName('Team person categories')
      .setDesc('People categories included on the Team screen.');
    const teamControls = teamSetting.controlEl.createDiv({ cls: 'cad-settings-checkboxes' });
    peopleCategories.forEach((category) => {
      const label = teamControls.createEl('label', { cls: 'cad-settings-checkbox' });
      const checkbox = label.createEl('input', { type: 'checkbox' });
      checkbox.checked = selectedTeamCategories.has(category);
      label.createEl('span', { text: category });
      checkbox.addEventListener('change', async () => {
        const next = new Set(
          (Array.isArray(this.plugin.settings.teamPersonCategories)
            ? this.plugin.settings.teamPersonCategories
            : DEFAULT_SETTINGS.teamPersonCategories)
            .map((v) => String(v || '').toLowerCase())
        );
        if (checkbox.checked) next.add(category);
        else next.delete(category);
        this.plugin.settings.teamPersonCategories = Array.from(next);
        await this.plugin.saveSettings();
        this.plugin.refreshOpenViews();
      });
    });

    new obsidian.Setting(plannerPanel)
      .setName('Daily note folder')
      .setDesc('Folder under which daily notes live, e.g. "daily" or "Journal/Daily".')
      .addText((t) => t
        .setPlaceholder('daily')
        .setValue(this.plugin.settings.dailyNoteFolder)
        .onChange(async (v) => { this.plugin.settings.dailyNoteFolder = v; await this.plugin.saveSettings(); }));

    /* ── Task mode ── */
    const taskModeEl = new obsidian.Setting(plannerPanel)
      .setName('Task mode')
      .setDesc('How tasks are stored and displayed in the Planner.')
      .addDropdown((d) => d
        .addOption('checkbox',  'Checkbox only — inline checkboxes in daily notes')
        .addOption('tasknotes', 'TaskNotes only — full markdown note per task')
        .addOption('hybrid',    'Hybrid — checkboxes with Promote ↑ to TaskNote')
        .setValue(this.plugin.settings.taskMode || 'checkbox')
        .onChange(async (v) => {
          this.plugin.settings.taskMode = v;
          await this.plugin.saveSettings();
          this.plugin.refreshOpenViews();
          this.display(); // re-render settings to show/hide folder field
        }));

    if ((this.plugin.settings.taskMode || 'checkbox') !== 'checkbox') {
      new obsidian.Setting(plannerPanel)
        .setName('TaskNotes folder')
        .setDesc('Vault path where TaskNote files are stored.')
        .addText((t) => t
          .setPlaceholder('00-CORE/TaskNotes/Tasks')
          .setValue(this.plugin.settings.taskNotesFolder || '00-CORE/TaskNotes/Tasks')
          .onChange(async (v) => {
            this.plugin.settings.taskNotesFolder = v.trim() || '00-CORE/TaskNotes/Tasks';
            await this.plugin.saveSettings();
          }));
      new obsidian.Setting(plannerPanel)
        .setName('TaskNotes archive folder')
        .setDesc('Vault path where archived TaskNote files are stored and included in productivity history.')
        .addText((t) => t
          .setPlaceholder('00-CORE/TaskNotes/Archive')
          .setValue(this.plugin.settings.taskNotesArchiveFolder || '00-CORE/TaskNotes/Archive')
          .onChange(async (v) => {
            this.plugin.settings.taskNotesArchiveFolder = v.trim() || '00-CORE/TaskNotes/Archive';
            await this.plugin.saveSettings();
          }));
    }

    new obsidian.Setting(plannerPanel)
      .setName('Tasks heading')
      .setDesc('The H2 inside each daily note where tasks live. Default "## Today".')
      .addText((t) => t
        .setValue(this.plugin.settings.tasksHeading)
        .onChange(async (v) => { this.plugin.settings.tasksHeading = v; await this.plugin.saveSettings(); }));

    new obsidian.Setting(plannerPanel)
      .setName('Journal heading')
      .setDesc('The H2 where today\'s journal entry lives. Default "## Journal".')
      .addText((t) => t
        .setValue(this.plugin.settings.journalHeading)
        .onChange(async (v) => { this.plugin.settings.journalHeading = v; await this.plugin.saveSettings(); }));

    new obsidian.Setting(appPanel)
      .setName('Currency')
      .setDesc('Used to format money values across Pipeline, Reports and Commissions.')
      .addDropdown((d) => {
        CURRENCY_OPTIONS.forEach((c) => d.addOption(c.code, c.label));
        d.setValue(this.plugin.settings.currency || 'USD');
        d.onChange(async (v) => {
          this.plugin.settings.currency = v;
          await this.plugin.saveSettings();
          // Re-render any open Cadence tabs so values reformat immediately
          this.app.workspace.getLeavesOfType(VIEW_TYPE_CADENCE_APP).forEach((leaf) => {
            if (leaf.view && typeof leaf.view.render === 'function') leaf.view.render();
          });
        });
      });

    new obsidian.Setting(appPanel)
      .setName('Week starts on')
      .setDesc('First day of the week shown in the Planner tab.')
      .addDropdown((d) => d
        .addOption('1', 'Monday')
        .addOption('0', 'Sunday')
        .setValue(String(this.plugin.settings.weekStartsOn))
        .onChange(async (v) => {
          this.plugin.settings.weekStartsOn = Number(v) === 0 ? 0 : 1;
          await this.plugin.saveSettings();
        }));

    new obsidian.Setting(appPanel)
      .setName('Open BOB Workspace on Obsidian startup')
      .setDesc('Auto-open the BOB Workspace Home command centre when Obsidian launches.')
      .addToggle((t) => t
        .setValue(!!this.plugin.settings.openOnStartup)
        .onChange(async (v) => { this.plugin.settings.openOnStartup = v; await this.plugin.saveSettings(); }));

    const defaultDrop = new obsidian.Setting(appPanel)
      .setName('Default tab')
      .setDesc('Which surface opens first when you launch BOB Workspace.');
    defaultDrop.addDropdown((d) => {
      NAV_GROUPS.forEach((g) => {
        g.items.forEach((s) => {
          const prefix = g.label ? `${g.label} · ` : '';
          d.addOption(s.id, prefix + s.label);
        });
      });
      d.setValue(this.plugin.settings.defaultTab || 'planner.today');
      d.onChange(async (v) => { this.plugin.settings.defaultTab = v; await this.plugin.saveSettings(); });
    });

    /* ─── Schemas ─── */
    pDm.createEl('h3', { text: 'Data model' });
    const schemasGroup = pDm.createDiv({ cls: 'setting-group cad-settings-section' });
    const schemasPanel = schemasGroup.createDiv({ cls: 'setting-items' });
    const configuredSchemas = WORKSPACE_CONFIG.schemas || {};
    const schemaSettings = effectiveSchemaSettings(this.plugin.settings);
    const schemasManaged = configuredSchemas.enabled != null || !!configuredSchemas.folder;
    new obsidian.Setting(schemasPanel)
      .setName('Use schema YAML files')
      .setDesc(`Read entity definitions (folders, type filters, field types, enum options) from Metadata Menu schema YAML files.${schemasManaged ? ' Managed by workspace.json.' : ''}`)
      .addToggle((t) => {
        t.setValue(!!schemaSettings.useSchemas);
        if (schemasManaged) t.setDisabled(true);
        return t.onChange(async (v) => {
          this.plugin.settings.useSchemas = v;
          await this.plugin.saveSettings();
          await reloadEntityConfiguration(this.plugin.app, this.plugin.settings);
          this.plugin.refreshOpenViews();
        });
      });
    new obsidian.Setting(schemasPanel)
      .setName('Schemas folder')
      .setDesc(`Vault path where schema YAML files live (one per entity).${schemasManaged ? ' Managed by workspace.json.' : ''}`)
      .addText((t) => {
        t.setPlaceholder('00-CORE/Schemas/source').setValue(schemaSettings.schemasFolder);
        if (schemasManaged) t.setDisabled(true);
        return t.onChange(async (v) => {
          this.plugin.settings.schemasFolder = v.trim() || '00-CORE/Schemas/source';
          await this.plugin.saveSettings();
        });
      });
    new obsidian.Setting(schemasPanel)
      .setName('Regenerate derived schema outputs')
      .setDesc('Validate canonical YAML sources and regenerate Metadata Menu FileClasses and JSON Schemas.')
      .addButton((button) => button
        .setButtonText('Regenerate outputs')
        .onClick(async () => {
          try {
            const result = await regenerateSchemaOutputs(this.plugin.app, this.plugin.settings);
            new obsidian.Notice(`BOB Workspace: generated ${result.count} FileClass and JSON Schema output(s); removed ${result.removed} stale output(s).`);
            await reloadEntityConfiguration(this.plugin.app, this.plugin.settings);
            this.plugin.refreshOpenViews();
          } catch (e) {
            new obsidian.Notice(`BOB Workspace: output generation failed - ${e.message}`);
          }
        }));

    const schemaDesigner = schemasPanel.createDiv({ cls: 'cad-schema-designer' });
    const schemaDesignerHead = schemaDesigner.createDiv({ cls: 'cad-schema-designer-head' });
    schemaDesignerHead.createEl('h4', { text: 'Data model designer' });
    schemaDesignerHead.createEl('p', {
      cls: 'setting-item-description',
      text: 'Edit canonical entity schema YAML visually. Schema sources define record structure and BOB display hints; generated JSON Schemas and Metadata Menu FileClasses are derived with one click.',
    });
    const schemaToolbar = schemaDesigner.createDiv({ cls: 'cad-schema-designer-toolbar' });
    const schemaSelect = schemaToolbar.createEl('select', { cls: 'dropdown' });
    const schemaNew = schemaToolbar.createEl('button', { text: '+ New entity' });
    const schemaReload = schemaToolbar.createEl('button', { text: 'Reload source' });
    const schemaSave = schemaToolbar.createEl('button', { text: 'Save schema source', cls: 'mod-cta' });
    const schemaSaveGenerate = schemaToolbar.createEl('button', { text: 'Save and regenerate', cls: 'mod-cta' });
    const schemaDelete = schemaToolbar.createEl('button', { text: 'Archive source', cls: 'mod-warning' });
    const schemaStatus = schemaDesigner.createDiv({ cls: 'cad-schema-designer-status setting-item-description' });
    const schemaForm = schemaDesigner.createDiv({ cls: 'cad-schema-designer-form' });
    let sourceSchema = null;
    let sourceSchemaPath = '';
    let schemaDirty = false;
    let schemaFiles = [];
    const initialSchemaPath = this._schemaDesignerSelectedPath || '';
    const schemaFolder = (schemaSettings.schemasFolder || SCHEMA_FOLDER_DEFAULT).replace(/\/$/, '');

    const setSchemaStatus = (text, ok = true) => {
      schemaStatus.setText(text || '');
      schemaStatus.toggleClass('cad-status-ok', !!ok);
      schemaStatus.toggleClass('cad-status-err', !ok);
    };
    const markSchemaDirty = () => {
      schemaDirty = true;
      setSchemaStatus('Unsaved schema changes', true);
    };
    const commaList = (value) => Array.isArray(value) ? value.join(', ') : '';
    const parseList = (value) => String(value || '').split(/[\n,]/).map((item) => item.trim()).filter(Boolean);
    const parsePairs = (value) => String(value || '').split(/\n/).map((line) => parseList(line)).filter((pair) => pair.length);
    const discriminatorText = (value) => Object.entries(value || {}).map(([key, item]) => `${key}: ${item}`).join('\n');
    const parseDiscriminator = (value) => {
      const parsed = {};
      String(value || '').split(/\n/).forEach((line) => {
        const separator = line.indexOf(':');
        if (separator < 0) return;
        const key = line.slice(0, separator).trim();
        const item = line.slice(separator + 1).trim();
        if (key && item) parsed[key] = item;
      });
      return parsed;
    };
    const fieldAliasesText = (value) => Object.entries(value || {})
      .map(([key, aliases]) => `${key}: ${(Array.isArray(aliases) ? aliases : []).join(', ')}`)
      .join('\n');
    const parseFieldAliases = (value) => {
      const parsed = {};
      String(value || '').split(/\n/).forEach((line) => {
        const separator = line.indexOf(':');
        if (separator < 0) return;
        const key = line.slice(0, separator).trim();
        const aliases = parseList(line.slice(separator + 1));
        if (key && aliases.length) parsed[key] = aliases;
      });
      return parsed;
    };
    const fieldRow = (parent, label) => {
      const row = parent.createDiv({ cls: 'cad-schema-designer-row' });
      row.createDiv({ cls: 'cad-schema-designer-label', text: label });
      return row.createDiv({ cls: 'cad-schema-designer-control' });
    };
    const textControl = (parent, label, value, onInput, multiline = false) => {
      const control = fieldRow(parent, label);
      const input = multiline
        ? control.createEl('textarea', { cls: 'cad-schema-designer-input' })
        : control.createEl('input', { type: 'text', cls: 'cad-schema-designer-input' });
      input.value = value || '';
      if (multiline) input.rows = 2;
      input.addEventListener('input', () => {
        onInput(input.value);
        markSchemaDirty();
      });
      return input;
    };
    const renderSourceSchema = () => {
      schemaForm.empty();
      if (!sourceSchema) {
        schemaForm.createDiv({ cls: 'setting-item-description', text: 'Select an entity schema, or create a new one.' });
        return;
      }
      const identity = schemaForm.createDiv({ cls: 'cad-schema-designer-section' });
      identity.createEl('h5', { text: sourceSchemaPath || sourceSchema.entity });
      textControl(identity, 'Entity key', sourceSchema.entity, (value) => { sourceSchema.entity = value.trim(); });
      textControl(identity, 'Label', sourceSchema.label, (value) => { sourceSchema.label = value; });
      textControl(identity, 'Plural label', sourceSchema.plural, (value) => {
        if (value.trim()) sourceSchema.plural = value.trim();
        else delete sourceSchema.plural;
      });
      const iconControl = fieldRow(identity, 'Default icon');
      const iconButton = iconControl.createEl('button', { cls: 'cad-nav-designer-icon-button', attr: { type: 'button' } });
      const renderSchemaIcon = () => {
        iconButton.empty();
        const preview = iconButton.createSpan({ cls: 'cad-nav-designer-icon-preview' });
        try { obsidian.setIcon(preview, sourceSchema.icon || 'file-text'); } catch (_) {}
        iconButton.createSpan({ cls: 'cad-nav-designer-icon-name', text: sourceSchema.icon || 'Choose icon' });
      };
      iconButton.addEventListener('click', () => new CadenceIconPickerModal(this.plugin.app, sourceSchema.icon, (iconId) => {
        if (iconId) sourceSchema.icon = iconId;
        else delete sourceSchema.icon;
        markSchemaDirty();
        renderSchemaIcon();
      }).open());
      renderSchemaIcon();
      textControl(identity, 'Type value', sourceSchema.type_value, (value) => { sourceSchema.type_value = value.trim(); });
      textControl(identity, 'Location pattern', sourceSchema.location_pattern, (value) => { sourceSchema.location_pattern = value.trim(); });
      textControl(identity, 'Description', sourceSchema.description, (value) => { sourceSchema.description = value; }, true);
      textControl(identity, 'Key fields', commaList(sourceSchema.key_fields), (value) => { sourceSchema.key_fields = parseList(value); });
      textControl(identity, 'Lifecycle', commaList(sourceSchema.status_lifecycle), (value) => { sourceSchema.status_lifecycle = parseList(value); });
      textControl(identity, 'Co-required pairs', (sourceSchema.co_required || []).map((pair) => pair.join(', ')).join('\n'), (value) => {
        const pairs = parsePairs(value);
        if (pairs.length) sourceSchema.co_required = pairs;
        else delete sourceSchema.co_required;
      }, true);
      textControl(identity, 'Discriminator', discriminatorText(sourceSchema.discriminator), (value) => {
        const discriminator = parseDiscriminator(value);
        if (Object.keys(discriminator).length) sourceSchema.discriminator = discriminator;
        else delete sourceSchema.discriminator;
      }, true);
      textControl(identity, 'Import field aliases', fieldAliasesText(sourceSchema.field_aliases), (value) => {
        const aliases = parseFieldAliases(value);
        if (Object.keys(aliases).length) sourceSchema.field_aliases = aliases;
        else delete sourceSchema.field_aliases;
      }, true);
      textControl(identity, 'BOB behavior JSON', sourceSchema.bob ? JSON.stringify(sourceSchema.bob, null, 2) : '', (value) => {
        if (!value.trim()) {
          delete sourceSchema.bob;
          return;
        }
        try {
          sourceSchema.bob = JSON.parse(value);
        } catch (_) {
          sourceSchema.bob = value;
        }
      }, true);

      const fieldsSection = schemaForm.createDiv({ cls: 'cad-schema-designer-section' });
      const fieldsHead = fieldsSection.createDiv({ cls: 'cad-schema-designer-fields-head' });
      fieldsHead.createEl('h5', { text: 'Fields' });
      const addField = fieldsHead.createEl('button', { text: '+ Add field' });
      addField.addEventListener('click', () => {
        if (!Array.isArray(sourceSchema.fields)) sourceSchema.fields = [];
        sourceSchema.fields.push({ name: '', type: 'string', required: false });
        markSchemaDirty();
        renderSourceSchema();
      });
      (sourceSchema.fields || []).forEach((field, index) => {
        const card = fieldsSection.createDiv({ cls: 'cad-schema-field' });
        const row = card.createDiv({ cls: 'cad-schema-field-main' });
        const nameInput = row.createEl('input', { type: 'text', cls: 'cad-schema-designer-input', placeholder: 'field_name' });
        nameInput.value = field.name || '';
        nameInput.addEventListener('input', () => { field.name = nameInput.value.trim(); markSchemaDirty(); });
        const typeSelect = row.createEl('select', { cls: 'dropdown cad-schema-field-type' });
        [['string', 'Text'], ['number', 'Number'], ['integer', 'Integer'], ['boolean', 'Boolean'], ['array', 'Array'], ['date', 'Date'], ['datetime', 'Date/time'], ['enum', 'Enum']].forEach(([value, label]) => {
          typeSelect.createEl('option', { value, text: label });
        });
        typeSelect.value = editableSchemaFieldType(field);
        typeSelect.addEventListener('change', () => {
          applyEditableSchemaFieldType(field, typeSelect.value);
          markSchemaDirty();
          renderSourceSchema();
        });
        const requiredWrap = row.createEl('label', { cls: 'cad-schema-required' });
        const required = requiredWrap.createEl('input', { type: 'checkbox' });
        required.checked = !!field.required;
        requiredWrap.appendText(' Required');
        required.addEventListener('change', () => { field.required = required.checked; markSchemaDirty(); });
        const up = row.createEl('button', { cls: 'cad-nav-designer-action', text: '\u2191', attr: { title: 'Move up' } });
        up.disabled = index === 0;
        up.addEventListener('click', () => {
          if (index === 0) return;
          [sourceSchema.fields[index - 1], sourceSchema.fields[index]] = [sourceSchema.fields[index], sourceSchema.fields[index - 1]];
          markSchemaDirty();
          renderSourceSchema();
        });
        const down = row.createEl('button', { cls: 'cad-nav-designer-action', text: '\u2193', attr: { title: 'Move down' } });
        down.disabled = index === sourceSchema.fields.length - 1;
        down.addEventListener('click', () => {
          if (index >= sourceSchema.fields.length - 1) return;
          [sourceSchema.fields[index], sourceSchema.fields[index + 1]] = [sourceSchema.fields[index + 1], sourceSchema.fields[index]];
          markSchemaDirty();
          renderSourceSchema();
        });
        const remove = row.createEl('button', { cls: 'cad-nav-designer-action danger', text: 'Remove' });
        remove.addEventListener('click', () => {
          sourceSchema.fields.splice(index, 1);
          markSchemaDirty();
          renderSourceSchema();
        });
        const detail = card.createDiv({ cls: 'cad-schema-field-detail' });
        const displayControl = fieldRow(detail, 'BOB display');
        const displayType = displayControl.createEl('select', { cls: 'dropdown cad-schema-field-type' });
        [['', 'Derived'], ['text', 'Text'], ['email', 'Email'], ['currency', 'Currency'], ['tags', 'Tags'], ['date', 'Date'], ['enum', 'Enum'], ['number', 'Number']].forEach(([value, label]) => {
          displayType.createEl('option', { value, text: label });
        });
        displayType.value = field.bob_type || '';
        displayType.addEventListener('change', () => {
          if (displayType.value) field.bob_type = displayType.value;
          else delete field.bob_type;
          markSchemaDirty();
        });
        if (typeSelect.value === 'enum') {
          textControl(detail, 'Options', commaList(field.enum), (value) => { field.enum = parseList(value); });
        }
        textControl(detail, 'Default value', editableSchemaFieldDefault(field), (value) => {
          applyEditableSchemaFieldDefault(field, value);
        });
        textControl(detail, 'Description', field.description, (value) => {
          if (value.trim()) field.description = value;
          else delete field.description;
        });
      });
    };
    const loadSourceSchema = async (path) => {
      if (!path) {
        sourceSchema = null;
        sourceSchemaPath = '';
        schemaDirty = false;
        renderSourceSchema();
        return;
      }
      try {
        sourceSchema = validateSourceSchemaDefinition(obsidian.parseYaml(await adapter.read(path)));
        sourceSchemaPath = path;
        this._schemaDesignerSelectedPath = path;
        schemaDirty = false;
        schemaSelect.value = path;
        setSchemaStatus(`Loaded ${path}`, true);
        renderSourceSchema();
      } catch (e) {
        sourceSchema = null;
        sourceSchemaPath = path;
        setSchemaStatus(`Cannot load ${path}: ${e.message}`, false);
        renderSourceSchema();
      }
    };
    const refreshSchemaSelect = async (preferredPath) => {
      try {
        const listed = await adapter.list(schemaFolder);
        schemaFiles = (listed.files || [])
          .filter((path) => /\.ya?ml$/i.test(path))
          .sort((a, b) => a.localeCompare(b));
      } catch (_) {
        schemaFiles = [];
      }
      schemaSelect.empty();
      schemaSelect.createEl('option', { value: '', text: '\u2014 select schema \u2014' });
      schemaFiles.forEach((path) => schemaSelect.createEl('option', { value: path, text: path.slice(schemaFolder.length + 1) }));
      const target = preferredPath || schemaFiles[0] || '';
      schemaSelect.value = target;
      await loadSourceSchema(target);
    };
    schemaSelect.addEventListener('change', async () => {
      if (schemaDirty && !confirm('Discard unsaved schema changes?')) {
        schemaSelect.value = sourceSchemaPath;
        return;
      }
      await loadSourceSchema(schemaSelect.value);
    });
    schemaReload.addEventListener('click', async () => {
      if (schemaDirty && !confirm('Discard unsaved schema changes?')) return;
      await refreshSchemaSelect(sourceSchemaPath);
    });
    schemaNew.addEventListener('click', () => {
      new CadencePromptModal(this.plugin.app, {
        title: 'New entity schema',
        placeholder: 'entity-key',
        cta: 'Create',
        onSubmit: async (value) => {
          if (!value) return;
          const entity = value.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
          if (!entity) return;
          const path = `${schemaFolder}/${entity}.yaml`;
          if (await adapter.exists(path)) {
            new obsidian.Notice(`BOB Workspace: schema already exists at ${path}.`);
            await loadSourceSchema(path);
            return;
          }
          sourceSchemaPath = path;
          sourceSchema = {
            entity,
            label: entity.split('-').map((word) => word.charAt(0).toUpperCase() + word.slice(1)).join(' '),
            type_value: entity,
            location_pattern: `20-COMPANY/${entity.toUpperCase()}/`,
            description: '',
            key_fields: [],
            fields: [{ name: 'type', type: 'string', required: true, enum: [entity] }],
            status_lifecycle: [],
          };
          sourceSchema.plural = pluralizeEntityLabel(sourceSchema.label);
          schemaDirty = true;
          setSchemaStatus(`New schema draft: ${path}`, true);
          renderSourceSchema();
        },
      }).open();
    });
    const saveSchemaSource = async (regenerate) => {
      if (!sourceSchema || !sourceSchemaPath) return;
      try {
        validateSourceSchemaDefinition(sourceSchema);
        await ensureFolderSync(this.plugin.app, schemaFolder);
        const renamedPath = `${schemaFolder}/${sourceSchema.entity}.yaml`;
        if (sourceSchemaPath !== renamedPath && await adapter.exists(sourceSchemaPath)) {
          if (!confirm(`Rename schema source file to ${sourceSchema.entity}.yaml to match its entity key?`)) {
            throw new Error('Entity key changes require renaming the canonical source file');
          }
          if (await adapter.exists(renamedPath)) throw new Error(`${renamedPath} already exists`);
          await adapter.write(`${sourceSchemaPath}.backup`, await adapter.read(sourceSchemaPath));
          await adapter.rename(sourceSchemaPath, renamedPath);
          sourceSchemaPath = renamedPath;
        } else if (!(await adapter.exists(sourceSchemaPath))) {
          sourceSchemaPath = renamedPath;
        }
        if (await adapter.exists(sourceSchemaPath)) {
          await adapter.write(`${sourceSchemaPath}.backup`, await adapter.read(sourceSchemaPath));
        }
        await adapter.write(sourceSchemaPath, obsidian.stringifyYaml(sourceSchema));
        let outputText = '';
        if (regenerate) {
          const result = await regenerateSchemaOutputs(this.plugin.app, this.plugin.settings);
          outputText = ` Generated ${result.count} FileClass and JSON Schema output(s); removed ${result.removed} stale output(s).`;
        }
        schemaDirty = false;
        this._schemaDesignerSelectedPath = sourceSchemaPath;
        if (!schemaFiles.includes(sourceSchemaPath)) schemaFiles.push(sourceSchemaPath);
        await reloadEntityConfiguration(this.plugin.app, this.plugin.settings);
        this.plugin.refreshOpenViews();
        new obsidian.Notice(`BOB Workspace: schema source saved and applied.${outputText}`);
        this.display();
      } catch (e) {
        setSchemaStatus(`Save failed: ${e.message}`, false);
        new obsidian.Notice(`BOB Workspace: schema source save failed - ${e.message}`);
      }
    };
    schemaSave.addEventListener('click', async () => saveSchemaSource(false));
    schemaSaveGenerate.addEventListener('click', async () => saveSchemaSource(true));
    schemaDelete.addEventListener('click', async () => {
      if (!sourceSchemaPath || !(await adapter.exists(sourceSchemaPath))) return;
      if (!confirm(`Archive ${sourceSchemaPath}? It will stop loading as a record type and remain available as a timestamped backup.`)) return;
      try {
        const archivedPath = `${sourceSchemaPath}.archived-${Date.now()}`;
        await adapter.rename(sourceSchemaPath, archivedPath);
        sourceSchema = null;
        sourceSchemaPath = '';
        schemaDirty = false;
        this._schemaDesignerSelectedPath = '';
        await reloadEntityConfiguration(this.plugin.app, this.plugin.settings);
        this.plugin.refreshOpenViews();
        new obsidian.Notice(`BOB Workspace: schema archived at ${archivedPath}.`);
        this.display();
      } catch (e) {
        setSchemaStatus(`Archive failed: ${e.message}`, false);
      }
    });
    setTimeout(() => refreshSchemaSelect(initialSchemaPath), 0);

    pData.createEl('h3', { text: 'Data import/export' });
    const dataGroup = pData.createDiv({ cls: 'setting-group cad-settings-section' });
    const dataPanel = dataGroup.createDiv({ cls: 'setting-items' });
    new obsidian.Setting(dataPanel)
      .setName('Workbook export folder')
      .setDesc('Vault folder where XLSX workbook exports are written.')
      .addText((t) => t
        .setPlaceholder(DEFAULT_SETTINGS.workbookExportFolder)
        .setValue(this.plugin.settings.workbookExportFolder || DEFAULT_SETTINGS.workbookExportFolder)
        .onChange(async (v) => {
          this.plugin.settings.workbookExportFolder = v.trim().replace(/^\/+/, '').replace(/\/+$/, '') || DEFAULT_SETTINGS.workbookExportFolder;
          await this.plugin.saveSettings();
        }));
    const exportGroups = workbookExportGroups();
    const exportSetting = new obsidian.Setting(dataPanel)
      .setName('Export entity groups to XLSX')
      .setDesc(`Select one or more configured export groups to create a limited workbook under ${workbookExportFolder(this.plugin.settings)}.`);
    const exportControl = exportSetting.controlEl.createDiv({ cls: 'cad-workbook-export-control' });
    const groupSelect = exportControl.createEl('select', { cls: 'dropdown cad-workbook-group-select', attr: { multiple: 'multiple' } });
    groupSelect.size = Math.min(Math.max(exportGroups.length, 6), 12);
    exportGroups.forEach((group) => {
      const option = groupSelect.createEl('option', {
        value: group.id,
        text: `${group.label} (${group.entityKeys.length})`,
      });
      option.selected = true;
    });
    const exportBtn = exportControl.createEl('button', { cls: 'mod-cta', text: 'Export workbook' });
    exportBtn.addEventListener('click', async () => {
      const selectedGroups = Array.from(groupSelect.selectedOptions).map((option) => option.value);
      const entityKeys = selectedWorkbookEntityKeys(selectedGroups);
      if (!entityKeys.length) {
        new obsidian.Notice('BOB Workspace: select at least one group to export.');
        return;
      }
      try {
        const suffix = selectedGroups.length === exportGroups.length ? '' : 'selected';
        const path = await exportEntitiesXLSX(this.plugin.app, entityKeys, suffix, this.plugin.settings);
        new obsidian.Notice(`BOB Workspace: exported workbook to ${path}`, 6000);
      } catch (e) {
        new obsidian.Notice(`BOB Workspace: XLSX export failed — ${e.message}`, 8000);
      }
    });
    new obsidian.Setting(dataPanel)
      .setName('Import entities from XLSX')
      .setDesc('Imports workbook sheets named after entity keys, labels or plurals, using field keys as column headers.')
      .addButton((b) => b
        .setButtonText('Import workbook')
        .onClick(async () => {
          await promptImportWorkbook(this.plugin.app, async () => this.plugin.refreshOpenViews());
        }));

    pData.createEl('h3', { text: 'Cloud sync — coming soon' });
    const syncGroup = pData.createDiv({ cls: 'setting-group cad-settings-section cad-settings-panel-off cad-sync-disabled' });
    const syncPanel = syncGroup.createDiv({ cls: 'setting-items' });
    const cloudDesc = syncPanel.createEl('p', { cls: 'setting-item-description cad-sync-disabled-desc' });
    cloudDesc.appendText('Future option to two-way sync your vault with a live BOB Workspace / Cadence backend, so contacts, deals and partners stay aligned across desktop and mobile. ');
    cloudDesc.createEl('strong', { text: 'Not active yet.' });
    cloudDesc.appendText(' These fields are persisted but unused until the sync feature ships in a later release.');
    new obsidian.Setting(syncPanel)
      .setName('Backend base URL')
      .setDesc('Coming soon')
      .addText((t) => {
        t.setPlaceholder('https://your-cadence-instance')
         .setValue(this.plugin.settings.cadenceApiUrl)
         .onChange(async (v) => { this.plugin.settings.cadenceApiUrl = v; await this.plugin.saveSettings(); });
        t.inputEl.disabled = true;
      });
    new obsidian.Setting(syncPanel)
      .setName('API token')
      .setDesc('Coming soon')
      .addText((t) => {
        t.setPlaceholder('paste JWT here when sync ships')
         .setValue(this.plugin.settings.cadenceApiToken)
         .onChange(async (v) => { this.plugin.settings.cadenceApiToken = v; await this.plugin.saveSettings(); });
        t.inputEl.disabled = true;
      });
  }
}

/* ─────────── Playbook Runner Bases view ─────────── */
const PLAYBOOK_RUNNER_VIEW_TYPE = 'agent-client-playbook-runner';
const PLAYBOOK_RUNNER_PINNED_KEY = 'bob-pinned-playbooks';

class CadencePlaybookRunnerView extends (obsidian.BasesView || class {}) {
  constructor(controller, parentEl, app) {
    if (obsidian.BasesView) super(controller);
    this._app = app;
    this._pinned = CadencePlaybookRunnerView._loadPinned();
    this._root = parentEl.createDiv({ cls: 'cad-pb-runner' });
  }

  static _loadPinned() {
    try { return new Set(JSON.parse(localStorage.getItem(PLAYBOOK_RUNNER_PINNED_KEY) || '[]')); }
    catch { return new Set(); }
  }
  static _savePinned(set) {
    localStorage.setItem(PLAYBOOK_RUNNER_PINNED_KEY, JSON.stringify([...set]));
  }

  onDataUpdated() {
    this._root.empty();
    let total = 0;
    for (const group of (this.data?.groupedData || [])) {
      for (const entry of group.entries) {
        total++;
        const path = entry.file.path;
        const name = entry.file.basename;
        const title = String(entry.getValue?.('note.title') ?? entry.getValue?.('file.name') ?? name);
        const trigger = String(entry.getValue?.('note.trigger') ?? '');

        const card = this._root.createDiv({ cls: 'cad-pb-card' });

        const pinBtn = card.createEl('button', { cls: 'cad-pb-pin' + (this._pinned.has(path) ? ' cad-pb-pin--active' : '') });
        pinBtn.setText(this._pinned.has(path) ? '★' : '☆');
        pinBtn.title = this._pinned.has(path) ? 'Unpin' : 'Pin';
        pinBtn.addEventListener('click', () => {
          this._pinned.has(path) ? this._pinned.delete(path) : this._pinned.add(path);
          CadencePlaybookRunnerView._savePinned(this._pinned);
          this.onDataUpdated();
        });

        const info = card.createDiv({ cls: 'cad-pb-card-info' });
        const titleEl = info.createSpan({ cls: 'cad-pb-card-title', text: title });
        if (trigger) { info.createSpan({ cls: 'cad-pb-card-trigger', text: trigger }); titleEl.title = trigger; }

        const runBtn = card.createEl('button', { cls: 'cad-btn primary cad-pb-run', text: '▶' });
        runBtn.title = 'Run playbook in AI chat session';
        runBtn.addEventListener('click', () => this._runPlaybook(title));
      }
    }
    if (total === 0) this._root.createDiv({ cls: 'cad-empty-state-title', text: 'No playbooks found' });
  }

  async _runPlaybook(title) {
    const ACW_CHAT = 'agent-client-chat-view';
    const cmd = `/playbook-runner ${title}`;
    const { workspace } = this._app;

    const send = async (view) => {
      view.setInputState({ text: cmd, files: [] });
      if (typeof view.sendMessage === 'function') await view.sendMessage();
    };

    // Reveal existing leaf
    const existing = workspace.getLeavesOfType(ACW_CHAT);
    if (existing.length > 0) {
      workspace.revealLeaf(existing[0]);
      await send(existing[0].view);
      return;
    }

    // Open a new split and wait for the view to mount
    const leaf = workspace.getLeaf('split', 'vertical');
    try {
      await leaf.setViewState({ type: ACW_CHAT, active: true });
      workspace.revealLeaf(leaf);
      setTimeout(() => {
        if (typeof leaf.view?.setInputState === 'function') send(leaf.view);
      }, 400);
    } catch {
      leaf.detach();
      await navigator.clipboard.writeText(cmd);
      new obsidian.Notice(`Agent chat unavailable. Copied to clipboard:\n${cmd}`, 5000);
    }
  }
}

/* ─────────── The plugin ─────────── */
class CadencePlugin extends obsidian.Plugin {
  async onload() {
    await this.loadSettings();
    initPluginPaths(this);
    await reloadEntityConfiguration(this.app, this.settings);

    this.registerView(
      VIEW_TYPE_CADENCE_APP,
      (leaf) => new CadenceAppView(leaf, this)
    );

    // Register playbook runner as a Bases custom view type (used in Playbooks.base Runner tabs)
    if (typeof this.registerBasesView === 'function') {
      this.registerBasesView(PLAYBOOK_RUNNER_VIEW_TYPE, {
        name: 'Playbook Runner',
        icon: 'play-circle',
        factory: (controller, parentEl) => new CadencePlaybookRunnerView(controller, parentEl, this.app),
      });
    }

    // Single ribbon icon → opens the Cadence app
    this.addRibbonIcon('sparkles', 'Open BOB Workspace', () => this.openApp());

    this.addCommand({
      id: 'open-cadence',
      name: 'Open BOB Workspace',
      callback: () => this.openApp(),
    });
    this.addCommand({
      id: 'open-cadence-home',
      name: 'Open BOB Workspace — Home (command centre)',
      callback: () => this.openApp('home'),
    });
    this.addCommand({
      id: 'open-cadence-today',
      name: 'Open BOB Workspace — Today',
      callback: () => this.openApp('planner.today'),
    });
    this.addCommand({
      id: 'open-cadence-calendar',
      name: 'Open BOB Workspace — Calendar (week)',
      callback: () => this.openApp('planner.calendar'),
    });
    this.addCommand({
      id: 'open-cadence-pipeline',
      name: 'Open BOB Workspace — Pipeline',
      callback: () => this.openApp('crm.pipeline'),
    });
    this.addCommand({
      id: 'new-daily-entry',
      name: 'New today entry (creates if missing)',
      callback: async () => {
        const file = await ensureDailyNote(this.app, this.settings);
        this.app.workspace.openLinkText(file.path, '', false);
      },
    });

    this.addSettingTab(new CadenceSettingTab(this.app, this));

    // ─── Quick capture (with optional reminder) ───
    this.addRibbonIcon('plus-circle', 'BOB Workspace quick capture', () => this.openQuickCapture());
    this.addCommand({
      id: 'quick-capture',
      name: 'Quick capture (with optional reminder)',
      hotkeys: [{ modifiers: ['Mod', 'Shift'], key: 'i' }],
      callback: () => this.openQuickCapture(),
    });
    this.addCommand({
      id: 'open-cadence-inbox',
      name: 'Open BOB Workspace — Inbox',
      callback: () => this.openApp('planner.inbox'),
    });

    this.addCommand({
      id: 'cadence-import-csv',
      name: 'Import from CSV',
      callback: () => {
        // Default to whichever entity list the user is on, fallback to contact
        let entityKey = 'contact';
        const leaf = this.app.workspace.getLeavesOfType(VIEW_TYPE_CADENCE_APP)[0];
        if (leaf && leaf.view) {
          const m = String(leaf.view.mode || '');
          if (m === 'crm.contacts')  entityKey = 'contact';
          else if (m === 'crm.companies') entityKey = 'company';
          else if (m === 'crm.activities') entityKey = 'activity';
          else if (m === 'crm.pipeline') entityKey = 'deal';
          else if (m === 'prm.partners') entityKey = 'partner';
          else if (m === 'prm.registrations') entityKey = 'registration';
          else if (m === 'prm.commissions') entityKey = 'commission';
          else if (m === 'crm.leads') entityKey = 'lead';
          else if (m === 'crm.campaigns') entityKey = 'campaign';
          else if (m === 'prm.certifications') entityKey = 'certification';
          else if (m === 'crm.sequences') entityKey = 'sequence';
          else if (m === 'planner.projects') entityKey = 'project';
        }
        new CadenceImportModal(this.app, { entityKey }).open();
      },
    });

    this.addCommand({
      id: 'bob-workspace-export-xlsx',
      name: 'Export all entities to XLSX',
      callback: async () => {
        try {
          const path = await exportAllEntitiesXLSX(this.app, this.settings);
          new obsidian.Notice(`BOB Workspace: exported workbook to ${path}`, 6000);
        } catch (e) {
          new obsidian.Notice(`BOB Workspace: XLSX export failed — ${e.message}`, 8000);
        }
      },
    });

    this.addCommand({
      id: 'bob-workspace-import-xlsx',
      name: 'Import entities from XLSX workbook',
      callback: async () => {
        await promptImportWorkbook(this.app, async () => this.refreshOpenViews());
      },
    });

    this.addCommand({
      id: 'create-workspace-config',
      name: 'Create workspace.json template',
      callback: async () => {
        if (await this.app.vault.adapter.exists(WORKSPACE_CONFIG_PATH)) {
          new obsidian.Notice(`workspace.json already exists at ${WORKSPACE_CONFIG_PATH}`);
          return;
        }
        await this.app.vault.adapter.write(WORKSPACE_CONFIG_PATH, workspaceConfigTemplate(this.settings));
        await reloadEntityConfiguration(this.app, this.settings);
        this.refreshOpenViews();
        new obsidian.Notice(`Created ${WORKSPACE_CONFIG_PATH} - edit it via Settings -> BOB Workspace -> Workspace definition.`);
      },
    });

    this.addCommand({
      id: 'reload-workspace-config',
      name: 'Reload workspace.json',
      callback: async () => {
        await reloadEntityConfiguration(this.app, this.settings);
        this.refreshOpenViews();
        new obsidian.Notice('BOB Workspace: workspace configuration reloaded.');
      },
    });

    // ─── Reminders engine ───
    // Tick once on load (catches anything that fired while Obsidian was closed),
    // then every 30s.
    this.app.workspace.onLayoutReady(() => this.tickReminders());
    this.registerInterval(window.setInterval(() => this.tickReminders(), 30 * 1000));

    // Optional: open Cadence Home on Obsidian startup.
    if (this.settings.openOnStartup) {
      this.app.workspace.onLayoutReady(() => this.openApp('home'));
    }
  }

  /* ── Quick capture API ── */
  openQuickCapture(prefill) {
    new CadenceCaptureModal(this.app, {
      defaultText: prefill && prefill.text ? prefill.text : '',
      defaultWhen: prefill && prefill.when ? prefill.when : null,
      defaultRepeat: prefill && prefill.repeat ? prefill.repeat : 'none',
      onSubmit: async (result) => {
        if (!result) return;
        await this.addReminder({
          text: result.text,
          when: result.when,
          repeat: result.repeat || 'none',
        });

        // Also append to the relevant daily note's tasks section.
        // - Scheduled today / unscheduled → today's note
        // - Scheduled future date → that day's note
        const targetDate = result.when ? new Date(result.when) : new Date();
        let noteDate = new Date();
        if (!isNaN(targetDate.getTime())) noteDate = targetDate;
        let dailyNoteAppended = false;
        try {
          const file = await ensureDailyNote(this.app, this.settings, noteDate);
          const content = await this.app.vault.read(file);
          const parsed = parseSections(content, this.settings);
          const newTasks = [...parsed.tasks, `- [ ] ${result.text}`];
          const next = replaceSection(content, this.settings.tasksHeading, newTasks.join('\n'));
          await this.app.vault.modify(file, next);
          dailyNoteAppended = true;
        } catch (_) { /* non-fatal — reminder is still saved */ }

        const noteLabel = sameDay(noteDate, new Date()) ? "today's note" : `${ymd(noteDate)} note`;
        if (result.when) {
          new obsidian.Notice(`Reminder set · ${reminderTimeStr(result.when)}${dailyNoteAppended ? ` · added to ${noteLabel}` : ''}`);
        } else {
          new obsidian.Notice(`Captured to Inbox${dailyNoteAppended ? ` · added to ${noteLabel}` : ''}`);
        }
      },
    }).open();
  }

  /* ── Reminders CRUD ── */
  async addReminder(partial) {
    const r = {
      id: reminderId(),
      text: partial.text,
      when: partial.when || null,
      repeat: partial.repeat || 'none',
      notes: partial.notes || '',
      project: partial.project || null,  // file path of linked project, if any
      notified: false,
      done: false,
      createdAt: new Date().toISOString(),
    };
    if (!Array.isArray(this.settings.reminders)) this.settings.reminders = [];
    this.settings.reminders.push(r);
    await this.saveSettings();
    this.refreshOpenViews();
    return r;
  }

  async updateReminder(id, patch) {
    const i = (this.settings.reminders || []).findIndex((r) => r.id === id);
    if (i < 0) return null;
    this.settings.reminders[i] = Object.assign({}, this.settings.reminders[i], patch);
    await this.saveSettings();
    this.refreshOpenViews();
    return this.settings.reminders[i];
  }

  async deleteReminder(id) {
    this.settings.reminders = (this.settings.reminders || []).filter((r) => r.id !== id);
    await this.saveSettings();
    this.refreshOpenViews();
  }

  async snoozeReminder(id, ms) {
    const target = new Date(Date.now() + ms);
    return this.updateReminder(id, {
      when: target.toISOString(),
      notified: false,
    });
  }

  async completeReminder(id) {
    return this.updateReminder(id, { done: true, notified: true });
  }

  refreshOpenViews() {
    this.app.workspace.getLeavesOfType(VIEW_TYPE_CADENCE_APP).forEach((leaf) => {
      if (leaf.view && typeof leaf.view.render === 'function') leaf.view.render();
    });
  }

  /* ── Reminder ticker ── */
  tickReminders() {
    if (!Array.isArray(this.settings.reminders)) return;
    const now = Date.now();
    let dirty = false;
    const additions = [];
    for (const r of this.settings.reminders) {
      if (r.done || r.notified) continue;
      if (!r.when) continue;
      const w = new Date(r.when).getTime();
      if (isNaN(w) || w > now) continue;
      this._fireReminder(r);
      r.notified = true;
      dirty = true;
      const next = nextRepeat(new Date(r.when), r.repeat);
      if (next) {
        additions.push({
          id: reminderId(),
          text: r.text,
          when: next.toISOString(),
          repeat: r.repeat,
          notified: false,
          done: false,
          createdAt: new Date().toISOString(),
        });
      }
    }
    if (additions.length) this.settings.reminders.push(...additions);
    if (dirty) {
      this.saveSettings().then(() => this.refreshOpenViews());
    }
  }

  _fireReminder(r) {
    new obsidian.Notice(`⏰  ${r.text}`, 8000);
    if (this.settings.desktopNotifications && typeof Notification !== 'undefined') {
      try {
        if (Notification.permission === 'granted') {
          new Notification('BOB Workspace reminder', { body: r.text });
        }
      } catch (_) {}
    }
  }

  async openApp(mode = null) {
    let leaf = this.app.workspace.getLeavesOfType(VIEW_TYPE_CADENCE_APP)[0];
    if (!leaf) {
      leaf = this.app.workspace.getLeaf('tab');
      await leaf.setViewState({ type: VIEW_TYPE_CADENCE_APP, active: true });
    }
    this.app.workspace.revealLeaf(leaf);
    if (leaf.view && typeof leaf.view.setMode === 'function') {
      const target = mode || leaf.view.mode || 'home';
      // Reset week-view anchor to current week when (re)opening that surface
      if (target === 'planner.calendar') leaf.view.plannerAnchor = startOfDay(new Date());
      await leaf.view.setMode(target);
    }
  }

  onunload() {
    this.app.workspace.detachLeavesOfType(VIEW_TYPE_CADENCE_APP);
  }

  async loadSettings() {
    const data = await this.loadData();
    this.settings = Object.assign({}, DEFAULT_SETTINGS, data);
    this.settings.baseFiles = Object.assign({}, DEFAULT_SETTINGS.baseFiles || {}, data?.baseFiles || {});
    this.settings.baseViews = Object.assign({}, DEFAULT_SETTINGS.baseViews || {}, data?.baseViews || {});
    this.settings.modules = Object.assign({}, DEFAULT_SETTINGS.modules || {}, data?.modules || {});
    this.settings.collapsedGroups = Object.assign({}, DEFAULT_SETTINGS.collapsedGroups || {}, data?.collapsedGroups || {});
    await loadWorkspaceConfig(this.app);
    this.settings = applyWorkspaceOwnedSettings(this.settings);
    CURRENT_CURRENCY = this.settings.currency || 'USD';
    syncEntityFolders(this.settings);
  }
  async saveSettings() {
    const workspaceSettings = persistedWorkspaceOwnedSettings(this.settings);
    const dataToSave = Object.assign({}, this.settings);
    WORKSPACE_OWNED_SETTING_KEYS.forEach((key) => {
      delete dataToSave[key];
    });
    await this.saveData(dataToSave);
    const workspaceConfig = validateWorkspaceConfig(Object.assign({}, WORKSPACE_CONFIG, { settings: workspaceSettings }));
    WORKSPACE_CONFIG = workspaceConfig;
    if (await this.app.vault.adapter.exists(WORKSPACE_CONFIG_PATH) || Object.keys(workspaceSettings).length) {
      await saveWorkspaceConfig(this.app, JSON.stringify(workspaceConfig, null, 2));
    }
    CURRENT_CURRENCY = this.settings.currency || 'USD';
    syncEntityFolders(this.settings);
  }
}

module.exports = CadencePlugin;
