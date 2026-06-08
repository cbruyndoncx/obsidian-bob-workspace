/* ============================================================
   Cadence — Obsidian app
   Single unified view with internal tab nav (Today / Planner / ...).
   Source-of-truth = your daily-note markdown files.
   Plain JS (no build step). Loaded directly by Obsidian.
   ============================================================ */
'use strict';

const obsidian = require('obsidian');
const fs = require('fs');
const path = require('path');

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
    id: 'misc', label: '',
    items: [
      { id: 'team',                  label: 'Team',             icon: 'user-cog',          desc: 'Team members, roles, seats — admin view of your BOB Workspace.' },
      { id: 'settings',              label: 'Settings',         icon: 'settings-2',        desc: 'BOB Workspace settings — folders, headings, week start, API connection.' },
      { id: 'misc.dashboard-editor', label: 'Surface Designer', icon: 'layout-panel-left', desc: 'Customize dashboard layouts, reports and widgets — live preview updates as you type.' },
      { id: 'misc.export',            label: 'Export',           icon: 'download',          desc: 'Export data to XLSX workbooks.' },
      { id: 'misc.import',            label: 'Import',           icon: 'upload',            desc: 'Import data from XLSX workbooks or CSV files.' },
    ],
  },
];

const BUILTIN_SECONDARY_TABS = {};
const BUILTIN_WORKBOOK_EXPORT_GROUPS = [];

function cloneConfig(value) {
  return JSON.parse(JSON.stringify(value));
}

function normalizePinnedSurfaces(value) {
  const list = Array.isArray(value) ? value : [];
  const seen = new Set();
  return list.filter((surfaceId) => {
    if (!surfaceId || !SURFACE_BY_ID[surfaceId] || seen.has(surfaceId)) return false;
    seen.add(surfaceId);
    return true;
  });
}

function migrateWorkspacePlannerConfig(config) {
  if (!config || typeof config !== 'object' || Array.isArray(config)) return config;
  const next = JSON.parse(JSON.stringify(config));
  const planner = next.planner && typeof next.planner === 'object' && !Array.isArray(next.planner)
    ? Object.assign({}, next.planner)
    : {};
  const dashboards = next.dashboards && typeof next.dashboards === 'object' && !Array.isArray(next.dashboards)
    ? Object.assign({}, next.dashboards)
    : null;
  if (dashboards) {
    let moved = false;
    Object.keys(dashboards).forEach((surfaceId) => {
      if (!String(surfaceId || '').startsWith('planner.')) return;
      if (planner[surfaceId] == null) planner[surfaceId] = dashboards[surfaceId];
      delete dashboards[surfaceId];
      moved = true;
    });
    if (moved) {
      if (Object.keys(planner).length) next.planner = planner;
      else delete next.planner;
      if (Object.keys(dashboards).length) next.dashboards = dashboards;
      else delete next.dashboards;
    }
  }
  return next;
}

function loadBuiltinDashboardDefaults() {
  const defaults = {};
  ['workspace-bob.json', 'workspace-cadence.json', 'workspace-crm.json'].forEach((fileName) => {
    const filePath = path.join(__dirname, 'templates', fileName);
    if (!fs.existsSync(filePath)) return;
    try {
      const parsed = JSON.parse(fs.readFileSync(filePath, 'utf8'));
      Object.entries(parsed.dashboards || {}).forEach(([surfaceId, config]) => {
        defaults[surfaceId] = cloneConfig(config);
      });
    } catch (_) { /* a malformed template file is skipped; other defaults still load */ }
  });
  return defaults;
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
const BUILTIN_ENTITY_DEFAULTS = JSON.parse(JSON.stringify(ENTITIES));

const DEAL_STAGES = ['lead', 'qualified', 'proposal', 'negotiation', 'won', 'lost'];

/* Deal field accessors — read entity definition overrides with safe defaults */
function dealStageField(def)    { return def.stageField    || 'stage'; }
function dealValueField(def)    { return def.valueField    || 'deal_value'; }
function dealCloseByField(def)  { return def.closeByField  || 'expected_close'; }
function dealWonStages(def)     { return def.wonStages     || ['won']; }
function dealLostStages(def)    { return def.lostStages    || ['lost']; }
function dealTerminalStages(def){ return [...dealWonStages(def), ...dealLostStages(def)]; }
function normalizeStatusValue(value) {
  return String(value || '').toLowerCase().replace(/[\s_]+/g, '-').trim();
}
function entityStatusField(def) {
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
function entityTerminalStatuses(def) {
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

function isOpenEntityRecord(entity, entityKey, entities = ENTITIES) {
  const def = entities[entityKey];
  const statusField = entityStatusField(def);
  const status = normalizeStatusValue(entityValue(entity, statusField, def));
  if (!status) return true;
  return !entityTerminalStatuses(def).has(status);
}
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
  'team', 'settings', 'misc.dashboard-editor', 'misc.export', 'misc.import',
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
  activeWorkspaceTemplate: '',
  collapsedGroups: {}, // { [groupId]: true }
  pinnedSurfaces: [], // [surfaceId]
  dashboardState: {}, // { [surfaceId]: { [controlKey]: value } }
  currency: 'USD',
  cadenceAppDark: false,
  taskProjectLinks: {}, // { "dailyPath::taskText": "Cadence/Projects/X.md" }
  modules: { crm: false, 'client-work': false, prm: false, srm: false, finance: false, procurement: false, tax: false, planner: false, ai: false },
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

function normalizeProjectId(value) {
  return String(value ?? '')
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-zA-Z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .replace(/-+/g, '-')
    .toLowerCase();
}

function humanizeProjectName(value) {
  const text = String(value ?? '')
    .replace(/[_-]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  if (!text) return '';
  return text
    .split(' ')
    .map((part) => {
      if (!part) return '';
      if (/^[A-Z0-9]{2,}$/.test(part)) return part;
      return part.charAt(0).toUpperCase() + part.slice(1).toLowerCase();
    })
    .join(' ');
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

function applyDashboardContext(value, context = {}) {
  if (typeof value === 'string') return applyTemplatePlaceholders(value, context);
  if (Array.isArray(value)) return value.map((item) => applyDashboardContext(item, context));
  if (value && typeof value === 'object') {
    const out = {};
    Object.entries(value).forEach(([key, item]) => {
      out[key] = applyDashboardContext(item, context);
    });
    return out;
  }
  return value;
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
let SCHEMA_ENTITY_KEYS = new Set();

function initPluginPaths(plugin) {
  const dir = (plugin.manifest && plugin.manifest.dir) || `.obsidian/plugins/${plugin.manifest.id}`;
  PLUGIN_DIR = dir;
  WORKSPACE_CONFIG_PATH = `${dir}/workspace.json`;
  WORKSPACE_BACKUP_PATH = `${dir}/workspace.backup.json`;
}

function validateWorkspaceConfig(config) {
  config = migrateWorkspacePlannerConfig(config);
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
    if (!group || typeof group !== 'object' || !group.id) {
      throw new Error('Every navigation group needs an id');
    }
    if (!Array.isArray(group.items)) continue; // separator group — no items to validate
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
  if (navigation?.actions != null && (typeof navigation.actions !== 'object' || Array.isArray(navigation.actions))) {
    throw new Error('navigation.actions must be an object keyed by surface id');
  }
  for (const [surfaceId, actions] of Object.entries(navigation?.actions || {})) {
    if (!Array.isArray(actions)) throw new Error(`actions "${surfaceId}" must be an array`);
    for (const action of actions) {
      if (!action || typeof action !== 'object' || Array.isArray(action)) {
        throw new Error(`actions "${surfaceId}" has an invalid action`);
      }
      if (!action.entityKey && !action.action && !action.route) {
        throw new Error(`actions "${surfaceId}" needs entityKey, action or route`);
      }
    }
  }
  if (config.entities != null) {
    throw new Error('entities is no longer supported; define record types in schema YAML');
  }
  if (config.bases != null && (typeof config.bases !== 'object' || Array.isArray(config.bases))) {
    throw new Error('bases must be an object keyed by entity type');
  }
  for (const [entityKey, base] of Object.entries(config.bases || {})) {
    if (!base || typeof base !== 'object' || Array.isArray(base) || !String(base.file || base.base || '').trim()) {
      throw new Error(`bases "${entityKey}" needs a file path`);
    }
  }
  if (config.dashboards != null && (typeof config.dashboards !== 'object' || Array.isArray(config.dashboards))) {
    throw new Error('dashboards must be an object keyed by surface id');
  }
  for (const [surfaceId, dashboard] of Object.entries(config.dashboards || {})) {
    validateDashboardConfig(dashboard, `dashboards.${surfaceId}`);
  }
  if (config.planner != null && (typeof config.planner !== 'object' || Array.isArray(config.planner))) {
    throw new Error('planner must be an object keyed by surface id');
  }
  for (const [surfaceId, plannerSurface] of Object.entries(config.planner || {})) {
    validateDashboardConfig(plannerSurface, `planner.${surfaceId}`);
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

function dashboardWidgetSchema(kind) {
  const schemas = {
    metric: {
      label: 'Metric',
      allowSourceOnly: true,
      requiresEntityOrSource: true,
      supports: ['count', 'metric', 'field', 'source', 'sub', 'accent'],
    },
    list: {
      label: 'List',
      allowSourceOnly: true,
      requiresEntityOrSource: true,
      supports: ['entity', 'source', 'titleFields', 'metaFields', 'limit', 'empty'],
    },
    'bar-chart': {
      label: 'Bar chart',
      allowSourceOnly: true,
      requiresEntityOrSource: true,
      supports: ['entity', 'source', 'groupBy', 'groups', 'columns', 'metric', 'field', 'limit'],
    },
    kanban: {
      label: 'Kanban',
      allowSourceOnly: true,
      requiresEntityOrSource: true,
      supports: ['entity', 'source', 'groupBy', 'groups', 'columns', 'sort', 'titleFields', 'metaFields', 'valueField'],
    },
    'base-link': {
      label: 'Base link',
      allowSourceOnly: true,
      requiresBaseOrEntity: true,
      supports: ['base', 'view', 'label', 'description'],
    },
    'base-embed': {
      label: 'Base embed',
      allowSourceOnly: true,
      requiresBaseOrEntity: true,
      supports: ['base', 'view', 'entity', 'source', 'titleFields', 'metaFields', 'limit'],
    },
    'base-view': {
      label: 'Base view (live)',
      allowSourceOnly: true,
      requiresBaseOrEntity: true,
      supports: ['base', 'view', 'entity', 'height', 'fallback', 'title'],
    },
    markdown: {
      label: 'Markdown',
      allowSourceOnly: true,
      supports: ['body', 'markdown', 'text', 'source', 'heading', 'section', 'title', 'subtitle'],
    },
    actions: {
      label: 'Actions',
      allowSourceOnly: true,
      supports: ['actions', 'buttons', 'label', 'icon', 'description'],
    },
    selector: {
      label: 'Selector',
      allowSourceOnly: true,
      supports: ['key', 'label', 'entity', 'field', 'options', 'allLabel', 'default', 'mode', 'type'],
    },
    'date-range': {
      label: 'Date range',
      allowSourceOnly: true,
      supports: ['key', 'label', 'field', 'allLabel', 'default', 'presets', 'mode', 'type'],
    },
    merge: {
      label: 'Merge',
      allowSourceOnly: true,
      supports: ['merge', 'title', 'empty'],
    },
  };
  return schemas[kind] || null;
}

function validateDashboardConfig(config, path) {
  if (!config || typeof config !== 'object' || Array.isArray(config)) {
    throw new Error(`${path} must be an object`);
  }
  if (config.title != null && typeof config.title !== 'string') {
    throw new Error(`${path}.title must be a string`);
  }
  if (config.subtitle != null && typeof config.subtitle !== 'string') {
    throw new Error(`${path}.subtitle must be a string`);
  }
  if (config.contextFilter != null && typeof config.contextFilter !== 'string') {
    throw new Error(`${path}.contextFilter must be a string`);
  }
  if (config.kind != null) {
    if (typeof config.kind !== 'string') {
      throw new Error(`${path}.kind must be a string`);
    }
    const kind = config.kind.trim().toLowerCase();
    if (kind && !['dashboard', 'report', 'planner'].includes(kind)) {
      throw new Error(`${path}.kind must be "dashboard", "report" or "planner"`);
    }
  }
  if (config.legend != null && typeof config.legend !== 'string') {
    throw new Error(`${path}.legend must be a string`);
  }
  if (config.stats != null) {
    if (!Array.isArray(config.stats)) throw new Error(`${path}.stats must be an array`);
    config.stats.forEach((stat, idx) => validateDashboardStat(stat, `${path}.stats[${idx}]`));
  }
  if (config.layout != null) {
    if (!Array.isArray(config.layout)) throw new Error(`${path}.layout must be an array`);
    config.layout.forEach((row, rowIdx) => {
      if (!Array.isArray(row)) throw new Error(`${path}.layout[${rowIdx}] must be an array`);
      row.forEach((col, colIdx) => {
        const cards = Array.isArray(col) ? col : [col];
        cards.forEach((card, cardIdx) => validateDashboardCard(card, `${path}.layout[${rowIdx}][${colIdx}][${cardIdx}]`));
      });
    });
  }
  if (config.controls != null) {
    if (!Array.isArray(config.controls)) throw new Error(`${path}.controls must be an array`);
    config.controls.forEach((card, idx) => validateDashboardCard(card, `${path}.controls[${idx}]`));
  }
  if (config.conditionalRows != null) {
    if (!Array.isArray(config.conditionalRows)) throw new Error(`${path}.conditionalRows must be an array`);
    config.conditionalRows.forEach((row, rowIdx) => {
      if (!row || typeof row !== 'object' || Array.isArray(row)) {
        throw new Error(`${path}.conditionalRows[${rowIdx}] must be an object`);
      }
      if (row.condition != null) {
        if (!row.condition || typeof row.condition !== 'object' || Array.isArray(row.condition)) {
          throw new Error(`${path}.conditionalRows[${rowIdx}].condition must be an object`);
        }
        if (row.condition.entities != null && !Array.isArray(row.condition.entities)) {
          throw new Error(`${path}.conditionalRows[${rowIdx}].condition.entities must be an array`);
        }
      }
      if (!Array.isArray(row.cards)) {
        throw new Error(`${path}.conditionalRows[${rowIdx}].cards must be an array`);
      }
      row.cards.forEach((card, cardIdx) => validateDashboardCard(card, `${path}.conditionalRows[${rowIdx}].cards[${cardIdx}]`));
    });
  }
}

function validateDashboardStat(stat, path) {
  if (!stat || typeof stat !== 'object' || Array.isArray(stat)) {
    throw new Error(`${path} must be an object`);
  }
  if (!String(stat.label || '').trim()) {
    throw new Error(`${path}.label is required`);
  }
  const statSource = typeof stat.source === 'object' && stat.source && !Array.isArray(stat.source) ? stat.source : null;
  const statMode = String(statSource?.mode || '').trim().toLowerCase();
  const statBuiltIn = String(statSource?.builtIn || '').trim().toLowerCase();
  const isBuiltInStat = statMode === 'built-in' && !!statBuiltIn;
  const hasEntity = String(stat.entity || '').trim();
  const hasField = String(stat.field || stat.valueField || stat.count?.field || '').trim();
  if (!hasEntity && !isBuiltInStat) {
    throw new Error(`${path}.entity is required`);
  }
  if (stat.count != null) {
    const ok = stat.count === 'all' || stat.count === 'open' || (typeof stat.count === 'object' && !Array.isArray(stat.count) && String(stat.count.field || '').trim());
    if (!ok) throw new Error(`${path}.count must be "all", "open", or an object with field`);
  }
  if (isBuiltInStat && !hasField && !stat.metric) {
    throw new Error(`${path}.field is required for built-in stats`);
  }
  if (stat.metric != null && typeof stat.metric !== 'string') {
    throw new Error(`${path}.metric must be a string`);
  }
  if (stat.source != null && typeof stat.source !== 'string' && (typeof stat.source !== 'object' || Array.isArray(stat.source))) {
    throw new Error(`${path}.source must be a string or object`);
  }
  if (stat.sub != null && typeof stat.sub === 'object' && !Array.isArray(stat.sub)) {
    if (stat.sub.entity != null && !String(stat.sub.entity).trim()) {
      throw new Error(`${path}.sub.entity must be a non-empty string when provided`);
    }
    if (stat.sub.source != null && typeof stat.sub.source !== 'string' && (typeof stat.sub.source !== 'object' || Array.isArray(stat.sub.source))) {
      throw new Error(`${path}.sub.source must be a string or object when provided`);
    }
  }
}

function validateDashboardCard(card, path) {
  if (!card || typeof card !== 'object' || Array.isArray(card)) {
    throw new Error(`${path} must be an object`);
  }
  const kind = dashboardWidgetKind(card) || (Array.isArray(card.merge) ? 'merge' : '');
  const schema = dashboardWidgetSchema(kind);
  if (card.kind != null && typeof card.kind !== 'string') {
    throw new Error(`${path}.kind must be a string`);
  }
  if (schema && kind === 'selector' && !String(card.key || card.name || card.field || card.entity || '').trim()) {
    throw new Error(`${path}.key is required`);
  }
  if (!String(card.title || '').trim() && !String(card.kind || '').trim()) {
    throw new Error(`${path}.title is required`);
  }
  const hasEntity = String(card.entity || '').trim();
  const hasMerge = Array.isArray(card.merge);
  const hasSource = !!card.source || !!card.base;
  const sourceMode = String(card.source?.mode || '').trim().toLowerCase();
  const builtInMode = sourceMode === 'built-in' || !!card.source?.builtIn;
  if (schema?.requiresBaseOrEntity && !hasEntity && !hasSource && !hasMerge) {
    throw new Error(`${path} needs a Base, source or entity`);
  }
  if (schema?.requiresEntityOrSource && !hasEntity && !hasSource && !hasMerge && !builtInMode) {
    throw new Error(`${path} needs an entity, built-in source or merge array`);
  }
  if (!hasEntity && !hasMerge && !hasSource && !builtInMode && !schema?.allowSourceOnly) {
    throw new Error(`${path} needs an entity, built-in source or merge array`);
  }
  if (card.source != null && typeof card.source !== 'string' && (typeof card.source !== 'object' || Array.isArray(card.source))) {
    throw new Error(`${path}.source must be a string or object`);
  }
  if (card.base != null) {
    if (typeof card.base !== 'string' && (typeof card.base !== 'object' || Array.isArray(card.base))) {
      throw new Error(`${path}.base must be a string or object`);
    }
    if (typeof card.base === 'object') {
      if (card.base.file != null && !String(card.base.file).trim()) {
        throw new Error(`${path}.base.file must be a non-empty string when provided`);
      }
      if (card.base.view != null && !String(card.base.view).trim()) {
        throw new Error(`${path}.base.view must be a non-empty string when provided`);
      }
      if (card.base.entity != null && !String(card.base.entity).trim()) {
        throw new Error(`${path}.base.entity must be a non-empty string when provided`);
      }
    }
  }
  if (card.columns != null && !Array.isArray(card.columns)) {
    throw new Error(`${path}.columns must be an array`);
  }
  if (card.groups != null && !Array.isArray(card.groups)) {
    throw new Error(`${path}.groups must be an array`);
  }
  if (card.titleFields != null && !Array.isArray(card.titleFields)) {
    throw new Error(`${path}.titleFields must be an array`);
  }
  if (card.metaFields != null && !Array.isArray(card.metaFields)) {
    throw new Error(`${path}.metaFields must be an array`);
  }
  if (card.dateFields != null && !Array.isArray(card.dateFields)) {
    throw new Error(`${path}.dateFields must be an array`);
  }
  if (card.limit != null && !(typeof card.limit === 'number' || /^\d+$/.test(String(card.limit)))) {
    throw new Error(`${path}.limit must be a number`);
  }
  if (card.merge != null) {
    if (!Array.isArray(card.merge)) throw new Error(`${path}.merge must be an array`);
    card.merge.forEach((source, idx) => {
      if (!source || typeof source !== 'object' || Array.isArray(source)) {
        throw new Error(`${path}.merge[${idx}] must be an object`);
      }
      if (!String(source.entity || '').trim()) {
        throw new Error(`${path}.merge[${idx}].entity is required`);
      }
      if (source.source != null && typeof source.source !== 'string' && (typeof source.source !== 'object' || Array.isArray(source.source))) {
        throw new Error(`${path}.merge[${idx}].source must be a string or object`);
      }
    });
  }
}

const WORKSPACE_OWNED_SETTING_KEYS = [
  'currency',
  'modules',
  'disabledSurfaces',
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
  'dashboardState',
  'pinnedSurfaces',
  'reminders',
  'taskProjectLinks',
];

function workspaceOwnedSettings(settings = {}) {
  const owned = {};
  WORKSPACE_OWNED_SETTING_KEYS.forEach((key) => {
    if (!Object.prototype.hasOwnProperty.call(settings, key)) return;
    owned[key] = key === 'pinnedSurfaces'
      ? normalizePinnedSurfaces(settings[key])
      : cloneConfig(settings[key]);
  });
  return owned;
}

function applyWorkspaceOwnedSettings(settings = {}) {
  const merged = Object.assign({}, settings);
  const workspaceSettings = WORKSPACE_CONFIG.settings || {};
  WORKSPACE_OWNED_SETTING_KEYS.forEach((key) => {
    if (Object.prototype.hasOwnProperty.call(workspaceSettings, key) && workspaceSettings[key] != null) {
      merged[key] = key === 'pinnedSurfaces'
        ? normalizePinnedSurfaces(workspaceSettings[key])
        : cloneConfig(workspaceSettings[key]);
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
    if (shouldPersist) {
      persisted[key] = key === 'pinnedSurfaces'
        ? normalizePinnedSurfaces(current)
        : cloneConfig(current);
    }
  });
  return persisted;
}

async function saveWorkspaceConfig(app, jsonText) {
  const parsed = validateWorkspaceConfig(migrateWorkspacePlannerConfig(JSON.parse(jsonText)));
  const adapter = app.vault.adapter;
  if (await adapter.exists(WORKSPACE_CONFIG_PATH)) {
    await adapter.write(WORKSPACE_BACKUP_PATH, await adapter.read(WORKSPACE_CONFIG_PATH));
  }
  await adapter.write(WORKSPACE_CONFIG_PATH, JSON.stringify(parsed, null, 2));
  WORKSPACE_CONFIG = parsed;
  WORKSPACE_HAS_NAVIGATION = Array.isArray(parsed.navigation?.groups);
  return parsed;
}

async function loadWorkspaceConfig(app) {
  WORKSPACE_CONFIG = {};
  WORKSPACE_HAS_NAVIGATION = false;
  if (!(await app.vault.adapter.exists(WORKSPACE_CONFIG_PATH))) return WORKSPACE_CONFIG;
  try {
    WORKSPACE_CONFIG = validateWorkspaceConfig(migrateWorkspacePlannerConfig(JSON.parse(await app.vault.adapter.read(WORKSPACE_CONFIG_PATH))));
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
    if (surface.entityKey || SECONDARY_TABS[surface.id] || config.dashboards?.[surface.id] || config.planner?.[surface.id]) {
      BUILT_SURFACES.add(surface.id);
    }
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

function addConfiguredEntityKey(keys, key) {
  const normalized = String(key || '').trim();
  if (normalized && ENTITIES[normalized]) keys.add(normalized);
}

function collectEntityKeysFromConfigValue(value, keys) {
  if (Array.isArray(value)) {
    value.forEach((item) => collectEntityKeysFromConfigValue(item, keys));
    return;
  }
  if (!value || typeof value !== 'object') return;
  addConfiguredEntityKey(keys, value.entityKey);
  addConfiguredEntityKey(keys, value.entity);
  Object.values(value).forEach((item) => collectEntityKeysFromConfigValue(item, keys));
}

function workspaceConfiguredEntityKeys(config = WORKSPACE_CONFIG, opts = {}) {
  const keys = new Set();
  SCHEMA_ENTITY_KEYS.forEach((key) => addConfiguredEntityKey(keys, key));
  Object.keys(config?.bases || {}).forEach((key) => addConfiguredEntityKey(keys, key));
  (config?.workbookGroups || []).forEach((group) =>
    (group.entityKeys || []).forEach((key) => addConfiguredEntityKey(keys, key))
  );
  collectEntityKeysFromConfigValue(config?.navigation, keys);
  collectEntityKeysFromConfigValue(config?.dashboards, keys);

  const hasExplicitConfig = !!(
	    SCHEMA_ENTITY_KEYS.size ||
	    config?.schemas ||
	    config?.bases ||
	    Array.isArray(config?.navigation?.groups) ||
    config?.navigation?.secondaryTabs ||
    config?.navigation?.actions ||
    Array.isArray(config?.workbookGroups) ||
    config?.dashboards
  );
  if (!keys.size && !hasExplicitConfig && opts.includeFallback !== false) {
    Object.keys(ENTITIES).forEach((key) => addConfiguredEntityKey(keys, key));
  }
  return keys;
}

function workspaceConfiguredEntityEntries(config = WORKSPACE_CONFIG, opts = {}) {
  return [...workspaceConfiguredEntityKeys(config, opts)]
    .map((key) => [key, ENTITIES[key]])
    .filter(([, def]) => def?.label)
    .sort(([, a], [, b]) =>
      String(a.plural || a.label).localeCompare(String(b.plural || b.label))
    );
}

function workspaceHasEntity(entityKey, config = WORKSPACE_CONFIG) {
  return workspaceConfiguredEntityKeys(config).has(entityKey);
}

function configuredSurfaceActions(surfaceId, config = WORKSPACE_CONFIG) {
  const actions = config?.navigation?.actions?.[surfaceId];
  return Array.isArray(actions) ? actions : [];
}

function configuredBaseDefinition(entityKey) {
  return WORKSPACE_CONFIG.bases?.[entityKey] || null;
}

function configuredDashboardDefinition(surfaceId) {
  return WORKSPACE_CONFIG.dashboards?.[surfaceId] || null;
}

function resolveDashboardConfig(surfaceId, dashboards = WORKSPACE_CONFIG.dashboards) {
  const config = (dashboards || {})[surfaceId] || null;
  return normalizeDashboardConfigShape(config);
}

function resolvePlannerConfig(surfaceId, planner = WORKSPACE_CONFIG.planner) {
  const config = (planner || {})[surfaceId] || null;
  return normalizeDashboardConfigShape(config);
}

function resolveSurfaceConfig(surfaceId, config = WORKSPACE_CONFIG) {
  if (String(surfaceId || '').startsWith('planner.')) {
    return resolvePlannerConfig(surfaceId, config.planner);
  }
  return resolveDashboardConfig(surfaceId, config.dashboards);
}

function normalizeDashboardConfigShape(value) {
  if (Array.isArray(value)) {
    return value.map((item) => normalizeDashboardConfigShape(item));
  }
  if (!value || typeof value !== 'object') return value;
  const out = {};
  Object.entries(value).forEach(([key, child]) => {
    out[key] = normalizeDashboardConfigShape(child);
  });
  return out;
}

function normalizeWidgetSourceConfig(source, fallbackEntityKey = null) {
  if (!source) {
    return { entityKey: fallbackEntityKey, mode: 'entity', builtIn: null };
  }
  if (typeof source === 'string') {
    return { entityKey: fallbackEntityKey, mode: source, builtIn: null };
  }
  if (typeof source !== 'object' || Array.isArray(source)) {
    return { entityKey: fallbackEntityKey, mode: 'entity', builtIn: null };
  }
  const baseConfig = source.base && typeof source.base === 'object' && !Array.isArray(source.base)
    ? {
        file: source.base.file || source.base.base || source.base.path || source.base.basePath || '',
        view: source.base.view || source.base.baseView || source.base.base_view || '',
      }
    : null;
  const base = baseConfig || source.base || source.file || source.basePath || null;
  const view = source.view || source.baseView || source.base_view || baseConfig?.view || '';
  const entityKey = source.entityKey || source.entity || fallbackEntityKey;
  const builtIn = String(source.builtIn || '').trim() || null;
  const rawMode = String(source.mode || '').trim().toLowerCase();
  const mode = rawMode || (builtIn ? 'built-in' : 'entity');
  const isBuiltIn = mode === 'built-in';
  return {
    entityKey,
    base,
    view,
    mode,
    builtIn: isBuiltIn ? builtIn : null,
    section: isBuiltIn ? (source.section || null) : null,
    field: source.field || source.valueField || null,
    labels: Array.isArray(source.labels) ? source.labels : null,
    filters: source.filters || null,
    groupBy: source.groupBy || null,
    sort: source.sort || null,
    limit: source.limit || null,
  };
}

function normalizeWidgetSortSpec(sort) {
  if (!sort) return [];
  const items = Array.isArray(sort) ? sort : [sort];
  return items.map((item) => {
    if (typeof item === 'string') {
      const match = item.trim().match(/^(.+?)(?:\s+(asc|desc))?$/i);
      if (!match) return null;
      return {
        property: basePropKey(match[1]),
        direction: String(match[2] || 'ASC').toUpperCase(),
      };
    }
    if (!item || typeof item !== 'object' || Array.isArray(item)) return null;
    const property = basePropKey(item.property || item.field || item.key || item.sort || '');
    if (!property) return null;
    return {
      property,
      direction: String(item.direction || item.order || 'ASC').toUpperCase(),
    };
  }).filter((item) => item && item.property);
}

function filterEntitiesByBaseConfig(app, entityKey, entities, baseConfig, warnings = []) {
  if (!entityKey || !Array.isArray(entities) || !baseConfig) return Array.isArray(entities) ? entities : [];
  let filtered = [...entities];
  const def = ENTITIES[entityKey];
  if (Array.isArray(baseConfig.folders) && baseConfig.folders.length) {
    const folders = baseConfig.folders.map((folder) => String(folder || '').replace(/\/$/, ''));
    filtered = filtered.filter((entity) => {
      const path = entity.file?.path || '';
      return folders.some((folder) => path === folder || path.startsWith(`${folder}/`));
    });
  }
  if (baseConfig.typeFilter) {
    filtered = filtered.filter((entity) => String(entityValue(entity, 'type', def) || '') === String(baseConfig.typeFilter));
  }
  if (baseConfig.typeFilters && typeof baseConfig.typeFilters === 'object') {
    filtered = filtered.filter((entity) => {
      const fm = entity.frontmatter || {};
      return Object.entries(baseConfig.typeFilters).every(([key, value]) => String(fm[key] ?? '') === String(value));
    });
  }
  if (baseConfig.baseFilters) {
    filtered = filtered.filter((entity) => {
      const file = entity.file;
      if (!file) return false;
      const globalMatch = evaluateBaseFilterNode(app, file, baseConfig.baseFilters.global);
      if (globalMatch === false) return false;
      const viewMatch = evaluateBaseFilterNode(app, file, baseConfig.baseFilters.view);
      if (viewMatch === false) return false;
      return true;
    });
  }
  if (baseConfig.filters) {
    filtered = filtered.filter((entity) => {
      const file = entity.file;
      if (!file) return false;
      const match = evaluateBaseFilterNode(app, file, baseConfig.filters);
      return match !== false;
    });
  }
  if (baseConfig.limit) {
    filtered = filtered.slice(0, baseConfig.limit);
  }
  if (baseConfig.baseSort?.length) {
    filtered = [...filtered].sort((a, b) => compareEntitiesByBaseSort(a, b, Object.assign({}, def || {}, { baseSort: baseConfig.baseSort })));
  }
  if (baseConfig.unsupportedBaseFilters?.length) {
    warnings.push(...baseConfig.unsupportedBaseFilters.map((filter) => `Unsupported Base filter: ${filter}`));
  }
  if (baseConfig.unsupportedBaseFeatures?.length) {
    warnings.push(...baseConfig.unsupportedBaseFeatures.map((feature) => `Unsupported Base feature: ${feature}`));
  }
  return filtered;
}

async function resolveWidgetSource(app, source, fallbackEntityKey = null, settings = {}) {
  const normalized = normalizeWidgetSourceConfig(source, fallbackEntityKey);
  const warnings = [];
  const entityKey = normalized.entityKey;
  const normalizedSort = (() => {
    const sort = normalized.sort;
    if (!sort) return [];
    const items = Array.isArray(sort) ? sort : [sort];
    return items.map((item) => {
      if (typeof item === 'string') {
        const match = item.trim().match(/^(.+?)(?:\s+(asc|desc))?$/i);
        if (!match) return null;
        return {
          property: basePropKey(match[1]),
          direction: String(match[2] || 'ASC').toUpperCase(),
        };
      }
      if (!item || typeof item !== 'object' || Array.isArray(item)) return null;
      const property = basePropKey(item.property || item.field || item.key || item.sort || '');
      if (!property) return null;
      return {
        property,
        direction: String(item.direction || item.order || 'ASC').toUpperCase(),
      };
    }).filter((item) => item && item.property);
  })();
  const basePath = typeof normalized.base === 'string'
    ? normalized.base
    : normalized.base?.file || normalized.base?.base || normalized.base?.path || normalized.base?.basePath || '';
  const baseView = normalized.view || normalized.base?.view || normalized.base?.baseView || normalized.base?.base_view || '';
  const metadata = {
    base: basePath || null,
    view: baseView || '',
    mode: normalized.mode || '',
    builtIn: normalized.builtIn || null,
  };
  if (normalized.mode === 'built-in') {
    const builtInName = String(normalized.builtIn || '').trim().toLowerCase();
    const builtInData = builtInName === 'productivity'
      ? await buildProductivitySnapshot(app, settings || WORKSPACE_CONFIG.settings || {})
      : builtInName === 'planner'
        ? await buildPlannerSnapshot(app, settings || WORKSPACE_CONFIG.settings || {})
      : builtInName === 'home'
        ? await buildHomeSnapshot(app, settings || WORKSPACE_CONFIG.settings || {})
        : null;
    return {
      entityKey: normalized.entityKey || null,
      def: normalized.entityKey && ENTITIES[normalized.entityKey] ? ENTITIES[normalized.entityKey] : null,
      entities: [],
      warnings,
      source: normalized,
      metadata: Object.assign({}, metadata, builtInData ? { builtInData } : {}),
      displayFields: [],
    };
  }
  if (!entityKey || !ENTITIES[entityKey]) {
    return { entityKey: entityKey || null, def: null, entities: [], warnings, source: normalized, metadata, displayFields: [] };
  }
  let def = ENTITIES[entityKey];
  let entities = listEntities(app, entityKey);
  if (basePath) {
    const baseFile = app.vault.getAbstractFileByPath(basePath);
    if (!(baseFile instanceof obsidian.TFile)) {
      warnings.push(`Base not found: ${basePath}`);
    } else {
      const baseConfig = await parseBaseFile(app, basePath, baseView);
      if (baseConfig) {
        metadata.baseConfig = baseConfig;
        if (normalized.filters) baseConfig.filters = normalized.filters;
        if (normalized.groupBy) baseConfig.groupBy = normalized.groupBy;
        if (normalizedSort.length) baseConfig.baseSort = normalizedSort;
        if (normalized.limit) baseConfig.limit = normalized.limit;
        entities = filterEntitiesByBaseConfig(app, entityKey, entities, baseConfig, warnings);
        def = Object.assign({}, def, {
          baseFilters: baseConfig.baseFilters || def.baseFilters,
          baseSort: baseConfig.baseSort || def.baseSort,
          baseGroupBy: baseConfig.baseGroupBy || def.baseGroupBy,
          baseView: baseConfig.baseView || def.baseView,
          externalBaseView: baseConfig.externalBaseView || def.externalBaseView,
          unsupportedBaseFilters: baseConfig.unsupportedBaseFilters || def.unsupportedBaseFilters,
          unsupportedBaseFeatures: baseConfig.unsupportedBaseFeatures || def.unsupportedBaseFeatures,
        });
      }
    }
  }
  if (normalized.filters && !basePath) {
    entities = filterEntitiesByBaseConfig(app, entityKey, entities, { filters: normalized.filters }, warnings);
  }
  if (normalizedSort.length && !basePath) {
    entities = [...entities].sort((a, b) => compareEntitiesByBaseSort(a, b, Object.assign({}, def || {}, { baseSort: normalizedSort })));
  }
  if (normalized.limit) {
    entities = entities.slice(0, normalized.limit);
  }
  return {
    entityKey,
    def,
    entities,
    warnings,
    source: normalized,
    metadata,
    displayFields: Array.isArray(def?.fields) ? def.fields : [],
  };
}

async function buildProductivitySnapshot(app, settings = {}) {
  const taskMode = settings.taskMode || 'checkbox';
  const includeCheckboxTasks = taskMode === 'checkbox' || taskMode === 'hybrid';
  const includeTaskNotes = taskMode === 'tasknotes' || taskMode === 'hybrid';
  const today = startOfDay(new Date());
  const days = Array.from({ length: 30 }, (_, i) => addDays(today, -i));
  const oldestDay = days[days.length - 1];
  const weekStart = startOfWeek(today, settings.weekStartsOn);
  const oldestWeekStart = addDays(weekStart, -11 * 7);
  const taskNoteStart = oldestWeekStart.getTime() < oldestDay.getTime() ? oldestWeekStart : oldestDay;
  const taskNotes = includeTaskNotes ? listTaskNotesForProductivity(app, settings, taskNoteStart, today) : [];
  const taskNotesByDate = new Map();
  taskNotes.forEach((task) => {
    if (!taskNotesByDate.has(task.date)) taskNotesByDate.set(task.date, []);
    taskNotesByDate.get(task.date).push(task);
  });
  const projectBuckets = new Map();
  const contextBuckets = new Map();
  const overdueTasks = [];
  const highPriorityTasks = [];
  const todayIso = ymd(today);
  const upsertBucket = (bucketMap, title) => {
    const key = String(title || '').trim();
    if (!key) return null;
    const current = bucketMap.get(key) || { title: key, value: 0, values: { open: 0, done: 0, total: 0 }, meta: '' };
    bucketMap.set(key, current);
    return current;
  };
  let totalOpen = 0, totalDone = 0, totalJournalChars = 0;
  let activeDays = 0;
  let streak = 0, streakBroken = false;
  const perDay = [];
  for (const d of days) {
    const f = app.vault.getAbstractFileByPath(dailyNotePath(settings, d));
    let open = 0, done = 0, jChars = 0, hasNote = false;
    if (includeCheckboxTasks && f && f instanceof obsidian.TFile) {
      hasNote = true;
      const c = await app.vault.read(f);
      const p = parseSections(c, settings);
      open = p.tasks.filter((l) => / \[ \] /.test(l)).length;
      done = p.tasks.filter((l) => / \[(x|X)\] /.test(l)).length;
      jChars = (p.journal || '').length;
    } else if (f && f instanceof obsidian.TFile) {
      hasNote = true;
      const c = await app.vault.read(f);
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

  taskNotes.forEach((task) => {
    const dueTime = task.due ? new Date(`${task.due}T00:00:00`).getTime() : NaN;
    const scheduledTime = task.scheduled ? new Date(`${task.scheduled}T00:00:00`).getTime() : NaN;
    const isOverdue = !task.done && ((Number.isFinite(dueTime) && dueTime < new Date(`${todayIso}T00:00:00`).getTime()) || (Number.isFinite(scheduledTime) && scheduledTime < new Date(`${todayIso}T00:00:00`).getTime()));
    const isHighPriority = !task.done && ['high', 'urgent', 'critical'].includes(String(task.priority || '').toLowerCase());
    if (isOverdue) overdueTasks.push(task);
    if (isHighPriority) highPriorityTasks.push(task);
    (Array.isArray(task.projects) ? task.projects : []).forEach((project) => {
      const bucket = upsertBucket(projectBuckets, project);
      if (!bucket) return;
      bucket.value += 1;
      bucket.values.total += 1;
      if (task.done) bucket.values.done += 1; else bucket.values.open += 1;
      bucket.meta = `${bucket.values.open} open · ${bucket.values.done} done`;
    });
    (Array.isArray(task.contexts) ? task.contexts : []).forEach((context) => {
      const bucket = upsertBucket(contextBuckets, context);
      if (!bucket) return;
      bucket.value += 1;
      bucket.values.total += 1;
      if (task.done) bucket.values.done += 1; else bucket.values.open += 1;
      bucket.meta = `${bucket.values.open} open · ${bucket.values.done} done`;
    });
  });

  const completion = totalOpen + totalDone === 0 ? 0 : Math.round((totalDone / (totalOpen + totalDone)) * 100);
  const weeks = [];
  for (let w = 11; w >= 0; w--) {
    const ws = addDays(weekStart, -w * 7);
    const we = addDays(ws, 7);
    let wd = 0, wo = 0, anyNote = false;
    for (let i = 0; i < 7; i++) {
      const d = addDays(ws, i);
      if (d.getTime() > today.getTime()) break;
      const f = app.vault.getAbstractFileByPath(dailyNotePath(settings, d));
      if (includeCheckboxTasks && f && f instanceof obsidian.TFile) {
        anyNote = true;
        const c = await app.vault.read(f);
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
  const wsOn = settings.weekStartsOn;
  const dayBuckets = Array.from({ length: 7 }, () => ({ done: 0, open: 0 }));
  perDay.forEach((p) => {
    const idx = (p.date.getDay() - wsOn + 7) % 7;
    dayBuckets[idx].done += p.done;
    dayBuckets[idx].open += p.open;
  });

  return {
    settings,
    taskMode,
    includeCheckboxTasks,
    includeTaskNotes,
    today,
    days,
    perDay,
    weeks,
    dayBuckets,
    totalOpen,
    totalDone,
    totalJournalChars,
    activeDays,
    streak,
    completion,
    taskNotes,
    projectBuckets: [...projectBuckets.values()].sort((a, b) => b.value - a.value),
    contextBuckets: [...contextBuckets.values()].sort((a, b) => b.value - a.value),
    overdueTasks: overdueTasks.sort((a, b) => String(a.due || a.scheduled || '9999-12-31').localeCompare(String(b.due || b.scheduled || '9999-12-31'))),
    highPriorityTasks: highPriorityTasks.sort((a, b) => {
      const rank = { critical: 0, urgent: 1, high: 2 };
      return (rank[String(a.priority || '').toLowerCase()] ?? 9) - (rank[String(b.priority || '').toLowerCase()] ?? 9);
    }),
  };
}

async function buildPlannerSnapshot(app, settings = {}) {
  const today = startOfDay(new Date());
  const nowMs = Date.now();
  const reminders = (settings.reminders || []).filter((r) => !r.done);

  const inbox = reminders
    .slice()
    .sort((a, b) => {
      const wa = a.when ? new Date(a.when).getTime() : Infinity;
      const wb = b.when ? new Date(b.when).getTime() : Infinity;
      return wa - wb;
    })
    .slice(0, 10)
    .map((r) => ({
      title: r.text || 'Reminder',
      meta: [r.when ? reminderTimeStr(r.when) : 'unscheduled', r.project ? projectNameFromPath(app, r.project) || 'project' : '']
        .filter(Boolean)
        .join(' · '),
      value: r.when ? new Date(r.when).getTime() : nowMs,
      action: { surface: 'planner.inbox' },
    }));

  const dailyFile = await ensureDailyNote(app, settings).catch(() => null);
  const todayTasks = dailyFile instanceof obsidian.TFile ? parseSections(await app.vault.read(dailyFile), settings) : { tasks: [] };
  const todayRows = (todayTasks.tasks || [])
    .slice(0, 12)
    .map((line) => {
      const done = / \[(x|X)\] /.test(line);
      return {
        title: String(line).replace(/^\s*-\s\[(x|X| )\]\s/, ''),
        meta: done ? 'done' : 'open',
        value: done ? 1 : 0,
        values: { done: done ? 1 : 0, open: done ? 0 : 1, total: 1 },
        action: { surface: 'planner.today' },
      };
    });

  const weekDays = weekDates(today, settings.weekStartsOn || 1);
  const calendarRows = await Promise.all(weekDays.map(async (date) => {
    const path = dailyNotePath(settings, date);
    const file = app.vault.getAbstractFileByPath(path);
    let tasks = [];
    let journal = '';
    if (file instanceof obsidian.TFile) {
      const parsed = parseSections(await app.vault.read(file), settings);
      tasks = parsed.tasks || [];
      journal = parsed.journal || '';
    }
    const open = tasks.filter((l) => / \[ \] /.test(l)).length;
    const done = tasks.filter((l) => / \[(x|X)\] /.test(l)).length;
    return {
      title: date.toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric' }),
      meta: file instanceof obsidian.TFile ? `${open} open · ${done} done${journal ? ` · journal ${journal.length} chars` : ''}` : 'no note',
      value: done,
      values: { done, open, total: open + done, journal: journal.length },
      file: file instanceof obsidian.TFile ? file : null,
      action: { surface: 'planner.calendar' },
    };
  }));

  const projectFiles = listEntityFiles(app, 'project');
  const projectsRows = await Promise.all(projectFiles.slice(0, 8).map(async (file) => {
    const title = projectNameFromPath(app, file.path) || file.basename;
    try {
      const meta = await readProjectMeta(app, file);
      return {
        title,
        meta: meta.total ? `${meta.done}/${meta.total} milestones · ${meta.percent}%` : 'project',
        value: meta.percent,
        values: { done: meta.done, total: meta.total, pct: meta.percent },
        progress: {
          value: meta.percent,
          label: meta.total ? `${meta.done}/${meta.total} milestones` : 'No milestones',
          pct: `${meta.percent}%`,
        },
        file,
        action: { surface: 'planner.projects' },
      };
    } catch (_) {
      return { title, meta: 'project', file, action: { surface: 'planner.projects' } };
    }
  }));

  const openTaskCount = todayRows.filter((row) => Number(row.values?.open) > 0).length;
  const doneTaskCount = todayRows.filter((row) => Number(row.values?.done) > 0).length;
  const calendarOpenCount = calendarRows.reduce((sum, row) => sum + (Number(row.values?.open) || 0), 0);
  const calendarDoneCount = calendarRows.reduce((sum, row) => sum + (Number(row.values?.done) || 0), 0);
  const overdueCount = reminders.filter((r) => r.when && new Date(r.when).getTime() <= nowMs).length;
  const briefing = [];
  if (openTaskCount) briefing.push({ title: `${openTaskCount} open ${openTaskCount === 1 ? 'task' : 'tasks'} today`, meta: 'planner.today', tone: 'emerald', action: { surface: 'planner.today' } });
  if (overdueCount) briefing.push({ title: `${overdueCount} overdue reminder${overdueCount === 1 ? '' : 's'}`, meta: 'planner.inbox', tone: 'rose', action: { surface: 'planner.inbox' } });
  if (projectsRows.length) briefing.push({ title: `${projectsRows.length} active project${projectsRows.length === 1 ? '' : 's'}`, meta: 'planner.projects', tone: 'mint', action: { surface: 'planner.projects' } });

  return {
    inbox,
    todayRows,
    calendarRows,
    projectsRows,
    briefing,
    overviewRows: briefing,
    inboxCount: inbox.length,
    todayCount: todayRows.length,
    calendarCount: calendarRows.length,
    projectCount: projectsRows.length,
    overdueCount,
    todayOpenCount: openTaskCount,
    todayDoneCount: doneTaskCount,
    calendarOpenCount,
    calendarDoneCount,
    totalOpenTasks: openTaskCount + calendarOpenCount,
    totalDoneTasks: doneTaskCount + calendarDoneCount,
  };
}

async function buildHomeSnapshot(app, settings = {}) {
  const today = startOfDay(new Date());
  const nowMs = Date.now();
  const configuredEntities = workspaceConfiguredEntityKeys(WORKSPACE_CONFIG);
  const reminders = (settings.reminders || []).filter((r) => !r.done);
  const dealDef = ENTITIES.deal;
  const contactDef = ENTITIES.contact;
  const partnerDef = ENTITIES.partner;
  const projectDef = ENTITIES.project;
  const certificationDef = ENTITIES.certification;
  const activityDef = ENTITIES.activity;
  const inbox = reminders
    .slice()
    .sort((a, b) => {
      const wa = a.when ? new Date(a.when).getTime() : Infinity;
      const wb = b.when ? new Date(b.when).getTime() : Infinity;
      return wa - wb;
    })
    .slice(0, 5)
    .map((r) => ({
      title: r.text || 'Reminder',
      meta: [r.when ? reminderTimeStr(r.when) : 'unscheduled', r.project ? projectNameFromPath(app, r.project) || 'project' : '']
        .filter(Boolean)
        .join(' · '),
      action: { surface: 'planner.inbox' },
    }));

  const dailyFile = await ensureDailyNote(app, settings).catch(() => null);
  const todayTasks = dailyFile instanceof obsidian.TFile ? parseSections(await app.vault.read(dailyFile), settings) : { tasks: [] };
  const todayRows = (todayTasks.tasks || [])
    .slice(0, 8)
    .map((line) => ({
      title: String(line).replace(/^\s*-\s\[(x|X| )\]\s/, ''),
      meta: / \[(x|X)\] /.test(line) ? 'done' : 'open',
      action: { surface: 'planner.today' },
    }));
  const week = await buildProductivitySnapshot(app, settings).catch(() => null);
  const weekRows = week ? [{
    title: 'This week',
    meta: `${week.streak}d streak · ${week.activeDays} active days · ${week.completion}% complete`,
    action: { surface: 'planner.calendar' },
  }] : [];

  const upcoming = [];
  if (configuredEntities.has('project')) {
    for (const e of listEntities(app, 'project')) {
      const due = entityValue(e, 'due', projectDef) || entityValue(e, 'deadline', projectDef);
      if (due) {
        const d = new Date(due);
        if (!isNaN(d.getTime()) && d >= today && d <= addDays(today, 7)) {
          upcoming.push({ date: d, title: entityValue(e, 'project_name', projectDef) || entityValue(e, 'name', projectDef) || e.basename, type: 'Project due', file: e.file });
        }
      }
      try {
        const meta = await readProjectMeta(app, e.file);
        if (meta.next?.date && meta.next.date >= today && meta.next.date <= addDays(today, 7)) {
          upcoming.push({ date: meta.next.date, title: `${entityValue(e, 'project_name', projectDef) || entityValue(e, 'name', projectDef) || e.basename} — ${meta.next.title || 'milestone'}`, type: 'Milestone', file: e.file });
        }
      } catch (_) { /* skip a project whose milestone metadata won't parse; widget still renders the rest */ }
    }
  }
  if (configuredEntities.has('registration')) {
    listEntities(app, 'registration').forEach((e) => {
      const exp = entityValue(e, 'expires_date', ENTITIES.registration);
      if (!exp) return;
      const d = new Date(exp);
      if (!isNaN(d.getTime()) && d >= today && d <= addDays(today, 7)) {
        upcoming.push({ date: d, title: entityValue(e, 'title', ENTITIES.registration) || e.basename, type: 'Registration expires', file: e.file });
      }
    });
  }
  if (configuredEntities.has('certification')) {
    listEntities(app, 'certification').forEach((e) => {
      const exp = entityValue(e, 'expires_date', certificationDef);
      if (!exp) return;
      const d = new Date(exp);
      if (!isNaN(d.getTime()) && d >= today && d <= addDays(today, 7)) {
        upcoming.push({ date: d, title: entityValue(e, 'name', certificationDef) || e.basename, type: 'Cert expires', file: e.file });
      }
    });
  }
  upcoming.sort((a, b) => a.date - b.date);
  const upcomingRows = upcoming.slice(0, 6).map((it) => ({
    title: it.title,
    meta: `${fmtValue(it.date, 'date')} · ${it.type}`,
    file: it.file,
  }));

  const partners = configuredEntities.has('partner') ? listEntities(app, 'partner').slice(0, 5).map((e) => ({
    title: entityValue(e, 'name', partnerDef) || e.basename,
    meta: [entityValue(e, 'tier', partnerDef), entityValue(e, 'status', partnerDef)].filter(Boolean).join(' · '),
    file: e.file,
  })) : [];
  const projects = configuredEntities.has('project') ? await Promise.all(listEntityFiles(app, 'project').slice(0, 3).map(async (f) => {
    const title = projectNameFromPath(app, f.path) || f.basename;
    try {
      const meta = await readProjectMeta(app, f);
      return {
        title,
        meta: meta.total ? `${meta.done}/${meta.total} milestones · ${meta.percent}%` : 'project',
        file: f,
        progress: {
          value: meta.percent,
          label: meta.total ? `${meta.done}/${meta.total} milestones` : 'No milestones',
          pct: `${meta.percent}%`,
        },
      };
    } catch (_) {
      return { title, meta: 'project', file: f };
    }
  })) : [];
  const deals = configuredEntities.has('deal') ? listEntities(app, 'deal') : [];
  const openDeals = deals.filter((e) => !dealTerminalStages(dealDef).includes(String(entityValue(e, 'stage', dealDef))));
  const pipelineRows = openDeals.slice(0, 5).map((e) => ({
    title: entityValue(e, 'title', dealDef) || e.basename,
    meta: `${entityValue(e, dealStageField(dealDef), dealDef) || '—'} · ${fmtValue(entityValue(e, dealValueField(dealDef), dealDef), 'currency')}`,
    file: e.file,
  }));
  const activityRows = configuredEntities.has('activity') ? listEntities(app, 'activity').slice()
    .sort((a, b) => new Date(activityDate(b, activityDef) || 0).getTime() - new Date(activityDate(a, activityDef) || 0).getTime())
    .slice(0, 5)
    .map((e) => ({
      title: activityTitle(e, activityDef),
      meta: `${entityValue(e, 'channel', activityDef) || '—'} · ${entityValue(e, 'client_id', activityDef) || '—'} · ${fmtValue(activityDate(e, activityDef), 'date')}`,
      file: e.file,
    })) : [];

  const briefing = await (async () => {
    const items = [];
    try {
      if (dailyFile instanceof obsidian.TFile) {
        const content = await app.vault.read(dailyFile);
        const parsed = parseSections(content, settings);
        const openTasks = parsed.tasks.filter((l) => / \[ \] /.test(l)).length;
        if (openTasks > 0) {
          items.push({ title: `${openTasks} open ${openTasks === 1 ? 'task' : 'tasks'} on today\\'s note`, meta: 'planner.today', tone: 'emerald', action: { surface: 'planner.today' } });
        }
      }
    } catch (_) { /* today's note missing or unreadable — the open-tasks hint is skipped */ }
    const overdue = reminders.filter((r) => r.when && new Date(r.when).getTime() <= nowMs);
    if (overdue.length) items.push({ title: `${overdue.length} overdue reminder${overdue.length === 1 ? '' : 's'}`, meta: overdue[0].text, tone: 'rose', action: { surface: 'planner.inbox' } });
    if (openDeals.length) items.push({ title: `${openDeals.length} open deal${openDeals.length === 1 ? '' : 's'}`, meta: `${fmtValue(openDeals.reduce((s, e) => s + (Number(entityValue(e, dealValueField(dealDef), dealDef)) || 0), 0), 'currency')} pipeline`, tone: 'sky', action: { surface: 'crm.pipeline' } });
    if (partners.length) items.push({ title: `${partners.length} partner${partners.length === 1 ? '' : 's'}`, meta: 'prm.partners', tone: 'mint', action: { surface: 'prm.partners' } });
    return items.slice(0, 4);
  })();

  return { briefing, inbox, todayRows, weekRows, upcomingRows, partners, projects, pipelineRows, activityRows };
}

function entityBasePath(settings = {}, entityKey) {
  const base = configuredBaseDefinition(entityKey);
  return base?.file || base?.base || (settings.baseFiles || {})[entityKey] || '';
}

function entityBaseViewName(settings = {}, entityKey) {
  const base = configuredBaseDefinition(entityKey);
  // User selection in settings.baseViews overrides workspace.json default view.
  return (settings.baseViews || {})[entityKey] || base?.view || base?.baseView || '';
}

function resetEntityRegistry(settings = {}) {
  CONFIGURED_BASE_ENTITY_KEYS.clear();
  SCHEMA_ENTITY_KEYS.clear();
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
       'folders','dateField','titleField','fieldAliases','baseFilters','baseSort','baseGroupBy','baseView','externalBaseView','unsupportedBaseFilters','unsupportedBaseFeatures'].forEach((k) => {
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
       'folders','dateField','titleField','fieldAliases','baseFilters','baseSort','baseGroupBy','baseView','externalBaseView','unsupportedBaseFilters','unsupportedBaseFeatures'].forEach((k) => {
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
    SCHEMA_ENTITY_KEYS.add(entityKey);
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
    ...collectBaseFilterConditionsForDerivation(yaml.filters),
    ...collectBaseFilterConditionsForDerivation(externalBaseView ? null : targetView?.filters),
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
  const limit = Number(externalBaseView ? yaml.limit : (targetView?.limit ?? yaml.limit));
  if (Number.isFinite(limit) && limit > 0) result.limit = limit;
  const unsupportedFilters = [
    ...collectUnsupportedBaseFilterConditions(yaml.filters),
    ...collectUnsupportedBaseFilterConditions(externalBaseView ? null : targetView?.filters),
  ];
  if (unsupportedFilters.length) result.unsupportedBaseFilters = [...new Set(unsupportedFilters)];
  const unsupportedFeatures = collectUnsupportedBaseFeatureWarnings(yaml.properties || {});
  if (unsupportedFeatures.length) result.unsupportedBaseFeatures = [...new Set(unsupportedFeatures)];

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

function collectBaseFilterConditionsForDerivation(node) {
  if (!node) return [];
  if (typeof node === 'string') return [node];
  if (Array.isArray(node)) return node.flatMap(collectBaseFilterConditionsForDerivation);
  if (typeof node !== 'object') return [];
  if (Object.prototype.hasOwnProperty.call(node, 'or')) return [];
  if (Object.prototype.hasOwnProperty.call(node, 'not')) return [];
  if (Object.prototype.hasOwnProperty.call(node, 'and')) {
    return collectBaseFilterConditionsForDerivation(node.and);
  }
  return Object.values(node).flatMap(collectBaseFilterConditionsForDerivation);
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
  if (value instanceof Date) return !isNaN(value.getTime());
  return true;
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
    || /^(?:date\()?[\w.-]+(?:\[['"].+?['"]\])?\)?\s*(==|<|<=|>|>=)\s*(?:(?:today\(\)|now\(\))(?:\s*[+-]\s*["']?\d+\s*(?:d|day|days)["']?)?|["']\d{4}-\d{2}-\d{2}["'])$/.test(cond);
}

function collectUnsupportedBaseFilterConditions(node) {
  return collectBaseFilterConditions(node).filter((cond) => !isSupportedBaseFilterCondition(cond));
}

function collectUnsupportedBaseFeatureWarnings(properties = {}) {
  if (!properties || typeof properties !== 'object' || Array.isArray(properties)) return [];
  const warnings = [];
  for (const [key, prop] of Object.entries(properties)) {
    const lowerKey = String(key || '').toLowerCase();
    const type = String(prop?.type || '').toLowerCase();
    if (lowerKey.startsWith('formula.') || lowerKey.includes('formula') || prop?.formula != null) {
      warnings.push(`Formula column not evaluated: ${key}`);
      continue;
    }
    if (lowerKey.includes('summary') || type.includes('summary') || prop?.summary != null || prop?.aggregate != null || prop?.aggregation != null || prop?.rollup != null) {
      warnings.push(`Summary column not fully evaluated: ${key}`);
    }
  }
  return warnings;
}

function normBaseName(value) {
  return String(value || '').toLowerCase().replace(/[^a-z0-9]/g, '');
}

async function readBaseSummary(app, file) {
  try {
    const raw = await app.vault.read(file);
    const yaml = obsidian.parseYaml(raw);
    if (!yaml || typeof yaml !== 'object') return null;
    const conditions = collectBaseFilterConditionsForDerivation(yaml.filters);
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
      unsupportedBaseFeatures: [...new Set(collectUnsupportedBaseFeatureWarnings(yaml.properties || {}))],
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
  if (baseConfig.unsupportedBaseFeatures) entity.unsupportedBaseFeatures = baseConfig.unsupportedBaseFeatures;
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

async function applyConfiguredBaseOverrides(app, settings = {}) {
  for (const [entityKey, def] of Object.entries(WORKSPACE_CONFIG.bases || {})) {
    const basePath = def?.file || def?.base;
    if (!basePath || !ENTITIES[entityKey]) continue;
    CONFIGURED_BASE_ENTITY_KEYS.add(entityKey);
    // User selection (settings.baseViews) overrides workspace.json default view.
    const viewName = entityBaseViewName(settings, entityKey);
    const baseConfig = await parseBaseFile(app, basePath, viewName);
    mergeBaseConfigIntoEntity(entityKey, baseConfig);
  }
}

async function reloadEntityConfiguration(app, settings = {}) {
  resetWorkspaceRegistries();
  await loadWorkspaceConfig(app);
  resetEntityRegistry(settings);
  applyWorkspaceRegistries(WORKSPACE_CONFIG);
  const effectiveSettings = effectiveSchemaSettings(settings);
  if (effectiveSettings.useSchemas) {
    const bootstrap = await bootstrapCanonicalSchemaSourcesIfMissing(app, effectiveSettings);
    if (bootstrap.count) {
      await regenerateSchemaOutputs(app, effectiveSettings);
    }
    await applySchemas(app, effectiveSettings);
  }
  await applyConfiguredBaseOverrides(app, settings);
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
    _comment: 'This file controls no-code workspace composition. Canonical entity definitions are in schema YAML; dashboards, navigation, and exports are configured here rather than hardcoded in the plugin.',
    settings: workspaceOwnedSettings(settings),
    schemas: {
      enabled: !!settings.useSchemas,
      folder: settings.schemasFolder || SCHEMA_FOLDER_DEFAULT,
    },
    bases,
    planner: WORKSPACE_CONFIG.planner || {},
    dashboards: WORKSPACE_CONFIG.dashboards || {},
    templates: WORKSPACE_CONFIG.templates || {},
    navigation: {
      groups: NAV_GROUPS,
      secondaryTabs: SECONDARY_TABS,
      actions: {},
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
  const type = String(field?.type || 'string').toLowerCase();
  const result = {
    name: field.key,
    type: type === 'number' || type === 'currency' ? 'number'
      : type === 'integer' ? 'integer'
      : type === 'boolean' ? 'boolean'
      : type === 'array' || type === 'tags' ? 'array'
      : 'string',
    required: !!field.primary,
  };
  if (type === 'date') result.format = 'date';
  else if (type === 'datetime' || type === 'date-time') result.format = 'date-time';
  else if (type === 'email') result.format = 'email';
  if (type === 'enum' && Array.isArray(field.options)) result.enum = field.options;
  if (Object.prototype.hasOwnProperty.call(field || {}, 'defaultValue')) {
    const defaultValue = resolveEntityFieldDefault(field);
    if (defaultValue !== undefined) result.default = defaultValue;
  }
  if (field.description) result.description = field.description;
  return result;
}

function entityLocationPattern(def, entityKey) {
  const patterns = [];
  if (Array.isArray(def?.folders) && def.folders.length) patterns.push(...def.folders);
  else if (String(def?.folder || '').trim()) patterns.push(def.folder);
  if (!patterns.length && entityKey) {
    const folder = entityFolder(entityKey);
    if (folder) patterns.push(folder);
  }
  return [...new Set(patterns.map((pattern) => String(pattern || '').trim().replace(/\/$/, '')).filter(Boolean))].join(' or ');
}

function schemaFieldArrayFromEntityFields(fields = []) {
  return fields
    .filter((field) => field && field.key && field.key !== 'type')
    .map((field) => schemaFieldFromEntityField(field))
    .filter((field) => field && field.name);
}

function schemaBobBlockFromEntityDefinition(def = {}) {
  const bob = {};
  [
    'stageField',
    'valueField',
    'closeByField',
    'wonStages',
    'lostStages',
    'detailMetaFields',
    'detailSections',
    'terminalStatuses',
    'stageConfidence',
    'template',
    'folders',
    'dateField',
    'titleField',
    'baseFilters',
    'baseSort',
    'baseGroupBy',
    'baseView',
    'externalBaseView',
    'unsupportedBaseFilters',
    'unsupportedBaseFeatures',
    'desc',
    'description',
    'scope',
  ].forEach((key) => {
    if (def[key] != null) bob[key] = cloneConfig(def[key]);
  });
  if (def.fieldAliases) bob.field_aliases = cloneConfig(def.fieldAliases);
  return bob;
}

function schemaSourceFromEntityDefinition(entityKey, def = ENTITIES[entityKey] || {}) {
  const fields = schemaFieldArrayFromEntityFields(def.fields || []);
  const primaryField = fields.find((field) => field.required)?.name || def.titleField || fields[0]?.name || '';
  const schema = {
    entity: entityKey,
    label: def.label || schemaFieldLabel(entityKey),
    plural: def.plural || pluralizeEntityLabel(def.label || schemaFieldLabel(entityKey)),
    icon: def.icon || 'file-text',
    location_pattern: entityLocationPattern(def, entityKey),
    fields,
  };
  const typeValue = def.filenameFilter ? '' : String(def.typeFilter || entityKey || '').trim();
  if (typeValue) schema.type_value = typeValue;
  if (primaryField) schema.key_fields = [primaryField];
  if (def.desc || def.description) schema.description = def.desc || def.description;
  if (def.fieldAliases && Object.keys(def.fieldAliases).length) schema.field_aliases = cloneConfig(def.fieldAliases);
  const bob = schemaBobBlockFromEntityDefinition(def);
  if (Object.keys(bob).length) schema.bob = bob;
  return schema;
}

function bootstrapSchemaEntityKeys(app, config = WORKSPACE_CONFIG, opts = {}) {
  const keys = new Set(workspaceConfiguredEntityKeys(config, Object.assign({ includeFallback: false }, opts)));
  if (!keys.size) {
    Object.keys(ENTITIES).forEach((key) => addConfiguredEntityKey(keys, key));
  }
  if (app && opts.includeVaultEntities !== false) {
    Object.keys(ENTITIES).forEach((key) => {
      try {
        if (listEntityFiles(app, key).length) addConfiguredEntityKey(keys, key);
      } catch (_) { /* a misconfigured entity is skipped so the rest still enumerate */ }
    });
  }
  return [...keys]
    .filter((key) => !!ENTITIES[key])
    .sort((a, b) => String(ENTITIES[a]?.plural || ENTITIES[a]?.label || a).localeCompare(String(ENTITIES[b]?.plural || ENTITIES[b]?.label || b)));
}

async function bootstrapCanonicalSchemaSources(app, settings = {}, opts = {}) {
  const folder = (WORKSPACE_CONFIG.schemas?.folder || settings.schemasFolder || SCHEMA_FOLDER_DEFAULT).replace(/\/$/, '');
  await ensureFolderSync(app, folder);
  const keys = bootstrapSchemaEntityKeys(app, WORKSPACE_CONFIG, opts);
  const written = [];
  const skipped = [];
  for (const entityKey of keys) {
    const def = ENTITIES[entityKey];
    if (!def) continue;
    const schemaPath = `${folder}/${entityKey}.yaml`;
    const schema = validateSourceSchemaDefinition(schemaSourceFromEntityDefinition(entityKey, def));
    if (await app.vault.adapter.exists(schemaPath)) {
      skipped.push(schemaPath);
      continue;
    }
    await app.vault.adapter.write(schemaPath, `${obsidian.stringifyYaml(schema)}\n`);
    written.push(schemaPath);
  }
  return {
    folder,
    count: written.length,
    skipped: skipped.length,
    written,
    skippedPaths: skipped,
    entityKeys: keys,
  };
}

async function bootstrapCanonicalSchemaSourcesIfMissing(app, settings = {}, opts = {}) {
  const loaded = await loadCanonicalSchemaSources(app, settings);
  if (loaded.schemas.length) return {
    folder: loaded.folder,
    count: 0,
    skipped: 0,
    written: [],
    skippedPaths: [],
    entityKeys: loaded.schemas.map((item) => item.schema.entity).sort(),
    alreadyPresent: true,
  };
  const result = await bootstrapCanonicalSchemaSources(app, settings, opts);
  return Object.assign({ alreadyPresent: false }, result);
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
  const filesPaths = String(schema.location_pattern || '')
    .split(/\s+or\s+/i)
    .map((item) => String(item || '').trim().replace(/^['"]|['"]$/g, ''))
    .filter(Boolean);
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
    filesPaths: filesPaths.length ? filesPaths : [schema.location_pattern],
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
  const sortedSchemas = [...loaded.schemas].sort((a, b) =>
    (a.schema.label || a.schema.entity).localeCompare(b.schema.label || b.schema.entity));
  let datamodelUpdated = 0;
  if (await injectGeneratedSection(app, 'DATAMODEL.md',
    '<!-- BEGIN GENERATED: ENTITY TYPES -->', '<!-- END GENERATED: ENTITY TYPES -->',
    generateEntityTypesTable(sortedSchemas))) datamodelUpdated++;
  if (await injectGeneratedSection(app, 'DATAMODEL-FULL.md',
    '<!-- BEGIN GENERATED: ENTITY DEFINITIONS -->', '<!-- END GENERATED: ENTITY DEFINITIONS -->',
    generateEntityDefinitionsSection(sortedSchemas))) datamodelUpdated++;
  return {
    count: loaded.schemas.length,
    removed,
    fileClassFolder,
    jsonFolder,
    datamodelUpdated,
  };
}

async function injectGeneratedSection(app, filePath, beginMarker, endMarker, content) {
  if (!await app.vault.adapter.exists(filePath)) return false;
  const text = await app.vault.adapter.read(filePath);
  const beginIdx = text.indexOf(beginMarker);
  const endIdx = text.indexOf(endMarker);
  if (beginIdx === -1 || endIdx === -1 || endIdx <= beginIdx) return false;
  const updated = text.slice(0, beginIdx + beginMarker.length) + '\n' + content + '\n' + text.slice(endIdx);
  await app.vault.adapter.write(filePath, updated);
  return true;
}

function schemaFieldDocType(field) {
  if (Array.isArray(field.enum)) return 'enum';
  if (field.format === 'date' || field.bob_type === 'date') return 'date';
  if (field.bob_type === 'currency') return 'currency';
  if (field.bob_type === 'tags' || field.type === 'array') return 'array';
  return field.type || 'string';
}

function generateEntityTypesTable(schemas) {
  const header = '| Entity | `type:` value | Location | Key Fields |\n|--------|--------------|----------|------------|';
  const rows = schemas.map(({ schema }) => {
    const label = schema.label || schema.entity;
    const typeValue = schema.type_value ? `\`${schema.type_value}\`` : '_(filename-backed)_';
    const location = schema.location_pattern || '—';
    const keyFields = (schema.key_fields || []).map((k) => `\`${k}\``).join(', ') || '—';
    return `| ${label} | ${typeValue} | ${location} | ${keyFields} |`;
  });
  return `${header}\n${rows.join('\n')}`;
}

function generateEntityDefinitionsSection(schemas) {
  return schemas.map(({ schema }) => {
    const label = schema.label || schema.entity;
    const typeValue = schema.type_value || '_(filename-backed)_';
    const location = schema.location_pattern || '—';
    const definition = schema.description || '—';
    const scope = schema.scope || '';

    let attrTable = '| Attribute | Value |\n|-----------|-------|\n';
    attrTable += `| **Definition** | ${definition} |\n`;
    attrTable += `| **\`type:\`** | \`${typeValue}\` |\n`;
    attrTable += `| **Location** | \`${location}\` |`;
    if (scope) attrTable += `\n| **Scope** | ${scope} |`;

    const dataFields = (schema.fields || []).filter((f) => f.name !== 'type');
    let fieldTable = '';
    if (dataFields.length) {
      fieldTable = '\n\n| Field | Required | Type | Allowed Values / Notes |\n|-------|----------|------|------------------------|\n';
      fieldTable += dataFields.map((field) => {
        const req = field.required ? 'yes' : 'no';
        const type = schemaFieldDocType(field);
        let notes = field.description || '';
        if (Array.isArray(field.enum)) {
          const enumList = field.enum.map((v) => `\`${v}\``).join(', ');
          notes = notes ? `${notes} — ${enumList}` : enumList;
        }
        return `| \`${field.name}\` | ${req} | ${type} | ${notes || '—'} |`;
      }).join('\n');
    }

    let extra = '';
    if (Array.isArray(schema.co_required) && schema.co_required.length) {
      extra += '\n\n' + schema.co_required.map((pair) =>
        `**Co-required**: \`${pair.map((n) => `\`${n}\``).join(' and ')}\` must be set together.`
      ).join(' ');
    }
    if (Array.isArray(schema.status_lifecycle) && schema.status_lifecycle.length) {
      extra += `\n\n**Lifecycle**: ${schema.status_lifecycle.map((s) => `\`${s}\``).join(' → ')}`;
    }

    return `### ${label}\n\n${attrTable}${fieldTable}${extra}\n\n---`;
  }).join('\n\n');
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
  if (node.not != null) {
    const result = evaluateBaseFilterNode(app, file, node.not);
    return result == null ? true : !result;
  }
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

  const dateCompare = cond.match(/^(?:date\()?(.+?)\)?\s*(==|<|<=|>|>=)\s*((?:today|now)\(\)(?:\s*[+-]\s*["']?\d+\s*(?:d|day|days)["']?)?|["']\d{4}-\d{2}-\d{2}["'])$/);
  if (dateCompare) {
    const actual = parseBaseDate(basePropValue(app, file, fm, dateCompare[1]));
    if (!actual) return false;
    const target = parseTodayExpression(dateCompare[3]) || parseBaseDate(String(dateCompare[3] || '').replace(/^["']|["']$/g, '')) || today;
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
  if (def?.typeFilter === 'project') {
    if (key === 'project_name' || key === 'name' || key === 'title') {
      return fm.project_name || fm.name || fm.project || humanizeProjectName(fm.project_id || entity.basename);
    }
  }
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
  const projectId = normalizeProjectId(name) || 'untitled-project';
  const projectName = humanizeProjectName(name) || projectId;
  if (template) {
    return renderTemplateDocument(template, {
      name: projectName,
      title: projectName,
      project_id: projectId,
      project_name: projectName,
      today: ymd(),
      label: def.label || 'Project',
      plural: def.plural || 'Projects',
    }, {
      frontmatter: {
        type: 'project',
        project_id: projectId,
        project_name: projectName,
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
        `# ${projectName}`,
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
    `project_id: ${projectId}`,
    `project_name: ${projectName}`,
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
    `# ${projectName}`,
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
      return {
        file,
        fm,
        status,
        done,
        date,
        priority: String(fm.priority || '').trim().toLowerCase(),
        due: fm.due ? String(fm.due).slice(0, 10) : '',
        scheduled: fm.scheduled ? String(fm.scheduled).slice(0, 10) : '',
        projects: Array.isArray(fm.projects)
          ? fm.projects
          : String(fm.projects || '').split(/[,\n]/).map((item) => item.trim()).filter(Boolean),
        contexts: Array.isArray(fm.contexts)
          ? fm.contexts
          : String(fm.contexts || '').split(/[,\n]/).map((item) => item.trim()).filter(Boolean),
      };
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
  const createContext = Object.assign({}, context);
  let effectiveRawName = rawName;
  if (entityKey === 'project') {
    const values = Object.assign({}, context.values || {});
    const providedId = String(values.project_id || values.projectId || values.id || '').trim();
    const providedName = String(values.project_name || values.name || values.project || rawName || '').trim();
    const projectId = normalizeProjectId(providedId || providedName || rawName);
    const projectName = humanizeProjectName(providedName || rawName || projectId) || projectId;
    values.project_id = projectId;
    values.project_name = projectName;
    delete values.name;
    delete values.project;
    delete values.projectId;
    delete values.id;
    createContext.values = values;
    effectiveRawName = projectId || rawName;
  }
  const folder = resolveEntityCreateFolder(entityKey, effectiveRawName, createContext);
  await ensureFolderSync(app, folder);
  const safeName = (effectiveRawName || `Untitled ${def.label}`).replace(/[\\/:*?"<>|]/g, '-').trim() || 'Untitled';
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
  if (!file) return humanizeProjectName(path.split('/').pop().replace(/\.md$/, ''));
  const cache = app.metadataCache.getFileCache(file);
  const fm = (cache && cache.frontmatter) || {};
  return fm.project_name || fm.name || fm.project || humanizeProjectName(fm.project_id || file.basename);
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
            if (leaf && leaf.view && typeof leaf.view.openEntityDetailFromFile === 'function') {
              leaf.view.openEntityDetailFromFile(file);
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
        if (!(await confirmModal(this.app, 'Delete this reminder?', { title: 'Delete reminder', cta: 'Delete' }))) return;
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
  } catch (_) { /* getFullPath unavailable on this adapter — fall back to other candidates */ }
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
  for (const [key, def] of workspaceConfiguredEntityEntries(WORKSPACE_CONFIG)) {
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
  const included = entityKeys?.length
    ? new Set(entityKeys)
    : workspaceConfiguredEntityKeys(WORKSPACE_CONFIG);
  const sortedEntities = [...included]
    .map((key) => [key, ENTITIES[key]])
    .filter(([, def]) => def)
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

async function importWorkbookEntitiesFromBuffer(app, buffer, filename) {
  const XLSX = getXLSX(app);
  const wb = XLSX.read(buffer, { type: 'array', cellDates: true });
  const result = { created: 0, updated: 0, failed: 0, sheets: 0, skippedSheets: [] };
  for (const sheetName of wb.SheetNames) {
    const entityKey = workbookEntityKeyFromSheet(sheetName);
    if (!entityKey) { result.skippedSheets.push(sheetName); continue; }
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
    this.csvText = (opts && opts.prefillCsv) || '';
    this.headers = [];
    this.rows = [];
    this.mapping = {}; // csv-header → entity-field-key | null
  }

  onOpen() {
    const { contentEl, modalEl } = this;
    contentEl.empty();
    contentEl.addClass('cad-import-modal');
    if (modalEl) modalEl.addClass('cad-import-modal-shell');
    contentEl.createEl('h3', { cls: 'cad-create-title', text: 'Import' });

    /* Top row: entity picker + file source buttons */
    const srcRow = contentEl.createDiv({ cls: 'cad-data-btn-row cad-import-src-row' });
    const entitySelect = srcRow.createEl('select', { cls: 'cad-de-select' });
    const fileBtn  = srcRow.createEl('button', { cls: 'cad-btn', text: 'Pick .csv file…' });
    fileBtn.type = 'button';
    const xlsxBtn = srcRow.createEl('button', { cls: 'cad-btn', text: 'Pick .xlsx file…' });
    xlsxBtn.type = 'button';

    /* Entity selector (same select, wired below) */
    const entityRow = contentEl.createDiv({ cls: 'cad-create-row' });
    entityRow.style.display = 'none'; // hidden — entity select is in srcRow
    entitySelect.createEl('option', { value: '', text: 'Please select entity…', attr: { disabled: '', selected: '' } });
    const importEntityEntries = workspaceConfiguredEntityEntries(WORKSPACE_CONFIG);
    if (this.entityKey && ENTITIES[this.entityKey] && !importEntityEntries.some(([key]) => key === this.entityKey)) {
      importEntityEntries.unshift([this.entityKey, ENTITIES[this.entityKey]]);
    }
    importEntityEntries
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

    if (this.csvText) { ta.value = this.csvText; this._parse(); }
    fileBtn.addEventListener('click', () => {
      const inp = document.createElement('input');
      inp.type = 'file'; inp.accept = '.csv,.txt';
      inp.addEventListener('change', async () => {
        const f = inp.files[0]; if (!f) return;
        try { const text = await f.text(); ta.value = text; this.csvText = text; this._parse(); this._renderPreview(); }
        catch (e) { new obsidian.Notice(`Failed to read file: ${e.message}`); }
      });
      inp.click();
    });
    xlsxBtn.addEventListener('click', () => {
      const inp = document.createElement('input');
      inp.type = 'file'; inp.accept = '.xlsx,.xlsm,.xlsb,.xls';
      inp.addEventListener('change', async () => {
        const f = inp.files[0]; if (!f) return;
        try { await this._loadXLSXFile(f, ta); }
        catch (e) { new obsidian.Notice(`Failed to read file: ${e.message}`); }
      });
      inp.click();
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
    const folder = `${DEFAULT_SETTINGS.workbookExportFolder}/Templates`;
    const safeKey = this.entityKey.replace(/[^a-z0-9_-]/gi, '-').toLowerCase();
    const path = `${folder}/${safeKey}-import-template.csv`;
    try {
      await ensureFolderSync(this.app, DEFAULT_SETTINGS.workbookExportFolder);
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
      const folder = `${DEFAULT_SETTINGS.workbookExportFolder}/Templates`;
      const safeKey = this.entityKey.replace(/[^a-z0-9_-]/gi, '-').toLowerCase();
      const path = `${folder}/${safeKey}-import-template.xlsx`;
      await writeWorkbookToVault(this.app, wb, path);
      new obsidian.Notice(`Exported XLSX template to ${path}`);
    } catch (e) {
      new obsidian.Notice(`BOB Workspace: failed to export XLSX template — ${e.message}`);
    }
  }

  async _loadXLSXFile(file, textarea) {
    const XLSX = getXLSX(this.app);
    const buffer = await file.arrayBuffer();
    const wb = XLSX.read(buffer, { type: 'array', cellDates: true });
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

/* ─────────── Yes/No confirmation modal ─────────── */
class CadenceConfirmModal extends obsidian.Modal {
  constructor(app, opts) {
    super(app);
    this.message = opts.message || 'Are you sure?';
    this.heading = opts.title || 'Confirm';
    this.cta = opts.cta || 'Confirm';
    this.danger = opts.danger !== false; // destructive styling by default
    this.onResolve = opts.onResolve;
    this._answered = false;
  }
  onOpen() {
    const { contentEl } = this;
    contentEl.empty();
    contentEl.addClass('cad-confirm-modal');
    contentEl.createEl('h3', { text: this.heading });
    String(this.message).split('\n').forEach((line) => contentEl.createEl('p', { text: line }));

    const row = contentEl.createDiv({ cls: 'cad-confirm-actions' });
    const cancel = row.createEl('button', { text: 'Cancel' });
    cancel.addEventListener('click', () => this.close());
    const ok = row.createEl('button', { text: this.cta, cls: this.danger ? 'mod-warning' : 'mod-cta' });
    ok.addEventListener('click', () => { this._answered = true; this.close(); this.onResolve(true); });

    setTimeout(() => ok.focus(), 0);
  }
  onClose() {
    if (!this._answered && this.onResolve) this.onResolve(false);
    this.contentEl.empty();
  }
}

// Promise-based replacement for window.confirm(); resolves true on confirm, false otherwise.
function confirmModal(app, message, opts = {}) {
  return new Promise((resolve) => {
    new CadenceConfirmModal(app, { message, ...opts, onResolve: resolve }).open();
  });
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

/* ─────────── Template-backed dashboard examples ─────────── */
const BUILTIN_DASHBOARD_DEFAULTS = loadBuiltinDashboardDefaults();

const INTERNAL_DASHBOARD_PROVIDERS = [
  'briefing',
  'home-inbox',
  'home-today',
  'home-week',
  'home-upcoming',
  'home-partners',
  'home-projects',
  'home-pipeline',
  'home-activities',
  'productivity-summary',
  'productivity-trend',
  'productivity-weekday',
  'productivity-notes',
];

const PURE_DASHBOARD_WIDGET_TYPES = [
  'list',
  'metric',
  'bar-chart',
  'date-range',
  'kanban',
  'selector',
  'markdown',
  'actions',
  'base-link',
  'base-embed',
  'base-view',
  'merge',
];

const DASHBOARD_WIDGET_CATALOG = [
  {
    id: 'metric',
    label: 'Metric stat',
    status: 'implemented',
    description: 'Top-row KPI cards driven by count and aggregate stats. Supports count, open, sum, avg, weighted forecast, win rate, capture rate and unique counts.',
    config: ['label', 'entity', 'count', 'metric', 'field', 'source', 'sub', 'accent'],
    examples: ['client-work.dashboard', 'crm.pipeline', 'reports.sales'],
  },
  {
    id: 'card-list',
    label: 'Card list',
    status: 'implemented',
    description: 'Recent, open, and due entity cards rendered from entity notes or filtered Base-backed entity sets.',
    config: ['title', 'entity', 'source', 'titleFields', 'metaFields', 'dateFields', 'empty'],
    examples: ['client-work.dashboard', 'reports.activity'],
  },
  {
    id: 'list',
    label: 'List widget',
    status: 'implemented',
    description: 'Compact row list for entity results, similar to a lightweight report section.',
    config: ['title', 'entity', 'source', 'titleFields', 'metaFields', 'limit', 'empty'],
    examples: ['workspace.entity-list', 'report sections'],
  },
  {
    id: 'bar-chart',
    label: 'Bar chart',
    status: 'implemented',
    description: 'Grouped count or value bars driven by a field, groups, or explicit columns.',
    config: ['title', 'entity', 'source', 'groupBy', 'groups', 'columns', 'metric', 'field', 'limit'],
    examples: ['reports.sales', 'pipeline summaries'],
  },
  {
    id: 'kanban',
    label: 'Kanban board',
    status: 'implemented',
    description: 'Grouped entity board for stage-style workflows. Supports group ordering, custom labels, WIP limits, drag/drop stage changes and per-column totals.',
    config: ['entity', 'source', 'groupBy', 'groups', 'columns', 'sort', 'titleFields', 'metaFields', 'cardTitleFields', 'cardMetaFields', 'valueField', 'wipLimit'],
    examples: ['crm.pipeline'],
  },
  {
    id: 'merge',
    label: 'Merged card',
    status: 'implemented',
    description: 'Combines several source definitions into one card section.',
    config: ['merge', 'title', 'empty'],
    examples: ['finance.setup.overview', 'tax.dashboard'],
  },
  {
    id: 'table',
    label: 'Table view',
    status: 'planned',
    description: 'Planned Base-backed table widget for directly embedding tabular report sections.',
    config: ['entity', 'base', 'view', 'columns', 'filters', 'sort'],
    examples: ['future report/table widgets'],
  },
  {
    id: 'base-link',
    label: 'Base link',
    status: 'implemented',
    description: 'Direct link widget for a selected .base file or named view without duplicating the Base UI.',
    config: ['base', 'view', 'label', 'description'],
    examples: ['reports', 'pipeline review'],
  },
  {
    id: 'base-embed',
    label: 'Base embed',
    status: 'partial',
    description: 'Compact embedded preview of a Base-backed result set with open-base fallback for non-table views.',
    config: ['base', 'view', 'entity', 'source', 'titleFields', 'metaFields', 'limit'],
    examples: ['workspace.base-preview', 'report sections'],
  },
  {
    id: 'base-view',
    label: 'Base view (live)',
    status: 'implemented',
    description: 'Live inline Obsidian Base view mounted inside a dashboard cell with preview, link, or error fallback.',
    config: ['title', 'entity', 'base', 'view', 'height', 'fallback'],
    examples: ['workspace.base-view', 'task board'],
  },
  {
    id: 'markdown',
    label: 'Markdown note',
    status: 'implemented',
    description: 'Static commentary widget for notes, guidance, or report narrative. Supports raw markdown bodies and note-backed sources.',
    config: ['title', 'body', 'source', 'heading', 'section'],
    examples: ['workspace.report-note', 'report commentary'],
  },
  {
    id: 'actions',
    label: 'Actions',
    status: 'implemented',
    description: 'Configured button bar for surface switches, commands, note links and record-creation shortcuts.',
    config: ['actions', 'buttons', 'label', 'icon', 'entityKey', 'surface', 'command', 'path', 'url'],
    examples: ['workspace.quick-actions', 'report controls'],
  },
  {
    id: 'selector',
    label: 'Selector',
    status: 'implemented',
    description: 'A dashboard control that stores a selected value and exposes it for placeholder-driven filters.',
    config: ['key', 'label', 'entity', 'field', 'options', 'allLabel', 'default'],
    examples: ['workspace.report-filters', 'report controls'],
  },
  {
    id: 'date-range',
    label: 'Date range',
    status: 'implemented',
    description: 'A dashboard control for preset or custom date ranges. Exposes start/end/filter placeholders for report widgets.',
    config: ['key', 'label', 'field', 'default', 'presets', 'allLabel'],
    examples: ['reports.activity', 'reports.pipeline'],
  },
];

function dashboardWidgetKind(card) {
  if (!card || typeof card !== 'object') return '';
  return String(card.kind || '').trim();
}

function collectDashboardWidgetKinds(card, kinds = new Set()) {
  if (!card || typeof card !== 'object' || Array.isArray(card)) return kinds;
  const kind = dashboardWidgetKind(card);
  if (kind) kinds.add(kind);
  if (Array.isArray(card.merge)) {
    kinds.add('merge');
    card.merge.forEach((source) => collectDashboardWidgetKinds(source, kinds));
  }
  return kinds;
}

function countDashboardCards(config = {}) {
  let count = 0;
  for (const row of config.layout || []) {
    for (const col of row || []) {
      count += Array.isArray(col) ? col.length : 1;
    }
  }
  count += (config.conditionalRows || []).reduce((sum, row) => sum + (Array.isArray(row?.cards) ? row.cards.length : 0), 0);
  return count;
}

function summarizeDashboardBlueprint(id, config = {}) {
  const widgetKinds = new Set();
  const sourceKinds = new Set();
  const kind = String(
    config.kind || (String(id || '').startsWith('reports.') ? 'report' : String(id || '').startsWith('planner.') ? 'planner' : 'dashboard')
  ).trim().toLowerCase() || 'dashboard';
  (config.stats || []).forEach((stat) => {
    widgetKinds.add('metric');
    if (stat.metric) sourceKinds.add(`metric:${stat.metric}`);
    if (stat.count === 'open') sourceKinds.add('count:open');
    if (stat.count === 'all' || stat.count == null) sourceKinds.add('count:all');
  });
  (config.controls || []).forEach((card) => {
    collectDashboardWidgetKinds(card, widgetKinds);
    if (typeof card.source === 'string') sourceKinds.add(card.source);
    else if (card.source && typeof card.source === 'object') {
      sourceKinds.add(String(card.source.source || card.source.kind || 'object'));
    }
  });
  for (const row of config.layout || []) {
    for (const col of row || []) {
      for (const card of (Array.isArray(col) ? col : [col])) {
        collectDashboardWidgetKinds(card, widgetKinds);
        if (typeof card.source === 'string') sourceKinds.add(card.source);
        else if (card.source && typeof card.source === 'object') {
          sourceKinds.add(String(card.source.source || card.source.kind || 'object'));
        }
      }
    }
  }
  (config.conditionalRows || []).forEach((row) => {
    (row.cards || []).forEach((card) => {
      collectDashboardWidgetKinds(card, widgetKinds);
      if (typeof card.source === 'string') sourceKinds.add(card.source);
      else if (card.source && typeof card.source === 'object') {
        sourceKinds.add(String(card.source.source || card.source.kind || 'object'));
      }
    });
  });
  return {
    id,
    title: config.title || id,
    subtitle: config.subtitle || '',
    contextFilter: config.contextFilter || '',
    legend: config.legend || '',
    kind,
    statsCount: (config.stats || []).length,
    cardCount: countDashboardCards(config),
    widgetKinds: [...widgetKinds].sort(),
    sourceKinds: [...sourceKinds].sort(),
  };
}

function dashboardProviderRowValue(row, field = '') {
  if (!row || typeof row !== 'object') return 0;
  const key = String(field || '').trim();
  if (key && row.values && Object.prototype.hasOwnProperty.call(row.values, key)) {
    return Number(row.values[key]) || 0;
  }
  if (key && Object.prototype.hasOwnProperty.call(row, key)) {
    return Number(row[key]) || 0;
  }
  if (row.value != null) return Number(row.value) || 0;
  if (row.values) {
    for (const candidate of ['value', 'done', 'count', 'total', 'pct', 'open']) {
      if (Object.prototype.hasOwnProperty.call(row.values, candidate)) {
        return Number(row.values[candidate]) || 0;
      }
    }
  }
  return 0;
}

/* ─────────── The unified Cadence app view ─────────── */
class CadenceAppView extends obsidian.ItemView {
  constructor(leaf, plugin) {
    super(leaf);
    this.plugin = plugin;
    // Migrate older mode IDs from previous versions
    const raw = plugin.settings.defaultTab || 'planner.today';
    this.mode = this._migrateModeId(raw);
    // Today state
    this.todayFile = null;
    this.todayParsed = null;
    // Planner state
    this.plannerAnchor = startOfDay(new Date());
    // Detail-view state — when set, renders the entity form instead of the surface
    this.detailFile = null;
    this.detailEntityKey = null;
    // Mobile nav drawer state (ephemeral, not persisted)
    this.mobileNavOpen = false;
    // Preserve left-nav scroll position across full re-renders.
    this._navScrollTop = 0;
    this._renderSeq = 0;
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

  async openEntityDetailFromFile(file, entityKey = null) {
    const key = entityKey || entityKeyFromFile(this.app, file);
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
        if (!Array.isArray(g.items)) return g; // separator group — pass through as-is
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

  _pinnedNavSurfaceIds() {
    const pinned = this.plugin.settings.pinnedSurfaces || [];
    return pinned.filter((surfaceId, idx, arr) => surfaceId && SURFACE_BY_ID[surfaceId] && arr.indexOf(surfaceId) === idx);
  }

  async _togglePinnedNavSurface(surfaceId) {
    if (!surfaceId || !SURFACE_BY_ID[surfaceId]) return;
    const pinned = new Set(this.plugin.settings.pinnedSurfaces || []);
    if (pinned.has(surfaceId)) pinned.delete(surfaceId);
    else pinned.add(surfaceId);
    this.plugin.settings.pinnedSurfaces = Array.from(pinned);
    await this.plugin.saveSettings();
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
  getDisplayText() { return 'BOB Workspace'; }
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
      if (this._basesCache) this._basesCache.clear();
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
    const previousNav = root.querySelector ? root.querySelector('.cad-app-nav') : null;
    const previousNavScrollTop = previousNav ? previousNav.scrollTop : (this._navScrollTop || 0);
    const renderSeq = ++this._renderSeq;
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
    brand.createSpan({ cls: 'cad-app-brand-text', text: 'BOB Workspace' });

    const topRight = topbar.createDiv({ cls: 'cad-app-topbar-right' });

    /* BOB Workspace dark mode toggle (scoped — does NOT touch Obsidian's mode) */
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
    this._navScrollTop = previousNavScrollTop;
    const collapsed = this.plugin.settings.collapsedGroups || {};
    const pinnedIds = this._pinnedNavSurfaceIds();
    const pinnedSet = new Set(pinnedIds);

    if (pinnedIds.length) {
      const pinnedWrap = nav.createDiv({ cls: 'cad-nav-pinned' });
      const pinnedRow = pinnedWrap.createDiv({ cls: 'cad-nav-pinned-row' });
      pinnedIds.forEach((surfaceId) => {
        const surface = SURFACE_BY_ID[surfaceId];
        const pinWrap = pinnedRow.createDiv({ cls: 'cad-nav-pinned-item-wrap' });
        const pin = pinWrap.createEl('button', {
          cls: 'cad-nav-pinned-item' + (this.mode === surfaceId ? ' active' : ''),
          attr: { type: 'button' },
        });
        pin.title = surface.label;
        const ic = pin.createSpan({ cls: 'cad-nav-pinned-icon' });
        try { obsidian.setIcon(ic, surface.icon); } catch (_) {}
        pin.addEventListener('click', () => {
          this.setMode(surfaceId);
          if (this.mobileNavOpen) this._toggleMobileNav(false);
        });
        const remove = pinWrap.createEl('button', {
          cls: 'cad-nav-pinned-remove',
          attr: { type: 'button', 'aria-label': `Unpin ${surface.label}` },
        });
        remove.title = `Unpin ${surface.label}`;
        try { obsidian.setIcon(remove, 'pin-off'); } catch (_) {}
        remove.addEventListener('click', async (ev) => {
          ev.preventDefault();
          ev.stopPropagation();
          await this._togglePinnedNavSurface(surfaceId);
          await this.render();
        });
      });
    }

    const visibleGroups = this._visibleNavGroups();
    visibleGroups.forEach((group) => {
      if (!Array.isArray(group.items)) { nav.createEl('hr', { cls: 'cad-nav-separator' }); return; }
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
          const isPinned = pinnedSet.has(s.id);
          const pinBtn = item.createEl('button', {
            cls: 'cad-nav-pin-toggle' + (isPinned ? ' is-pinned' : ''),
            attr: { type: 'button' },
          });
          pinBtn.title = isPinned ? `Unpin ${s.label}` : `Pin ${s.label}`;
          try { obsidian.setIcon(pinBtn, isPinned ? 'pin' : 'pin-off'); } catch (_) {}
          pinBtn.addEventListener('click', async (ev) => {
            ev.preventDefault();
            ev.stopPropagation();
            await this._togglePinnedNavSurface(s.id);
            await this.render();
          });
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

    this._navEl = nav;
    const restoreNavScroll = () => {
      if (this._renderSeq !== renderSeq) return;
      if (this._navEl !== nav) return;
      nav.scrollTop = this._navScrollTop || 0;
    };
    restoreNavScroll();
    requestAnimationFrame(restoreNavScroll);

    const content = body.createDiv({ cls: 'cad-app-content' });

    // Detail view trumps the normal surface routing
    if (this.detailFile && this.detailEntityKey) {
      await this.renderEntityDetail(content, this.detailEntityKey, this.detailFile);
      return;
    }

    const configuredDashboard = this.mode === 'planner.today' ? null : resolveSurfaceConfig(this.mode);
    if (configuredDashboard) {
      await this.renderConfigDashboard(this.mode, content, { config: configuredDashboard });
      return;
    }

    const route = {
      'home': () => this.renderHome(content),
      'planner.inbox': () => this.renderInbox(content),
      'planner.today': () => this.renderTodayPane(content),
      'planner.calendar': () => this.renderPlannerPane(content),
      'planner.projects': () => this.renderProjectsView(content),
      'crm.dashboard': () => this.renderConfigDashboard('crm.dashboard', content),
      'crm.pipeline': () => this.renderConfigDashboard('crm.pipeline', content),
      'crm.contacts': () => this.renderEntityList(content, 'contact'),
      'crm.clients': () => this.renderEntityList(content, 'client'),
      'crm.companies': () => this.renderEntityList(content, 'company'),
      'crm.activities': () => this.renderEntityList(content, 'activity'),
      'prm.partners': () => this.renderEntityTabs(content, 'prm.partners', 'prm.partners.overview'),
      'prm.registrations': () => this.renderEntityList(content, 'registration'),
      'prm.commissions': () => this.renderEntityList(content, 'commission'),
      'crm.leads': () => this.renderEntityList(content, 'lead'),
      'crm.campaigns': () => this.renderEntityTabs(content, 'crm.campaigns', 'crm.campaigns.overview'),
      'crm.sequences': () => this.renderEntityList(content, 'sequence'),
      'prm.certifications': () => this.renderEntityList(content, 'certification'),
      'prm.analytics': () => this.renderPRMAnalytics(content),
      'reports.pipeline': () => this.renderConfigDashboard('reports.pipeline', content),
      'reports.sales': () => this.renderConfigDashboard('reports.sales', content),
      'reports.partners': () => this.renderConfigDashboard('reports.partners', content),
      'reports.activity': () => this.renderConfigDashboard('reports.activity', content),
      'reports.productivity': () => this.renderProductivity(content),
      'team': () => this.renderTeam(content),
      'settings': () => this.openSettingsTab(content),
      'misc.dashboard-editor': () => this.renderDashboardEditor(content),
      'misc.export': () => this.renderExport(content),
      'misc.import': () => this.renderImport(content),
      'ai.playbooks': () => this.renderEntityList(content, 'playbook'),
      'ai.skills': () => this.renderEntityList(content, 'skill'),
      'finance.invoices': () => this.renderEntityTabs(content, 'finance.invoices', 'invoice'),
      'finance.gl': () => this.renderEntityTabs(content, 'finance.gl', 'finance.gl.overview'),
      'finance.setup': () => this.renderEntityTabs(content, 'finance.setup', 'finance.setup.overview'),
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
      'tax.overview': () => this.renderEntityTabs(content, 'tax.overview', 'tax.dashboard'),
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
  _renderPageHeader(root, title, subtitle, actions, options = {}) {
    const head = root.createDiv({ cls: 'cad-page-header' });
    const left = head.createDiv({ cls: 'cad-page-header-left' });
    left.createDiv({ cls: 'cad-eyebrow', text: 'BOB WORKSPACE' });
    left.createDiv({ cls: 'cad-page-title', text: title });
    if (subtitle) left.createDiv({ cls: 'cad-page-subtitle', text: subtitle });
    const right = head.createDiv({ cls: 'cad-page-header-right' });
    const surfaceId = options.surfaceId || this.mode;
    const renderConfigured = options.configuredActions !== false;
    const configuredActionCount = renderConfigured ? this._configuredHeaderActionCount(surfaceId) : 0;
    const ctx = { surfaceId, configuredActionCount, hasConfiguredActions: configuredActionCount > 0 };
    if (typeof actions === 'function') actions(right, ctx);
    if (renderConfigured) this._renderConfiguredHeaderActions(right, surfaceId);
    return head;
  }

  _configuredHeaderActionCount(surfaceId) {
    return configuredSurfaceActions(surfaceId).filter((action) => this._isConfiguredHeaderActionRenderable(action)).length;
  }

  _isConfiguredHeaderActionRenderable(action) {
    if (!action || typeof action !== 'object') return false;
    if (action.entityKey) return workspaceHasEntity(action.entityKey) && !!ENTITIES[action.entityKey]?.label;
    const actionId = String(action.action || '').trim();
    const route = String(action.route || '').trim();
    return actionId === 'quick-capture' || actionId === 'today-task' || !!(route && SURFACE_BY_ID[route]);
  }

  _renderConfiguredHeaderActions(container, surfaceId) {
    let rendered = 0;
    configuredSurfaceActions(surfaceId).forEach((action) => {
      if (!this._isConfiguredHeaderActionRenderable(action)) return;
      if (action.entityKey) {
        const def = ENTITIES[action.entityKey];
        const btn = container.createEl('button', {
          cls: `cad-btn${action.primary ? ' primary' : ''}`,
          text: action.label || `+ ${def.label}`,
        });
        btn.addEventListener('click', () => this._createEntityFromPrompt(action.entityKey));
        rendered++;
        return;
      }

      const actionId = String(action.action || '').trim();
      const route = String(action.route || '').trim();
      const label = action.label || (
        actionId === 'quick-capture' ? '+ Inbox' :
        actionId === 'today-task' ? '+ Task' :
        route && SURFACE_BY_ID[route] ? SURFACE_BY_ID[route].label :
        ''
      );
      if (!label) return;
      const btn = container.createEl('button', {
        cls: `cad-btn${action.primary ? ' primary' : ''}`,
        text: label,
      });
      btn.addEventListener('click', () => {
        if (actionId === 'quick-capture') this.plugin.openQuickCapture();
        else if (actionId === 'today-task') this._quickAddTodayTask();
        else if (route && SURFACE_BY_ID[route]) this.setMode(route);
      });
      rendered++;
    });
    return rendered;
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
      if (!(await confirmModal(this.app, `Move to trash:\n• ${names}\n\n${filesToDelete.length} ${filesToDelete.length === 1 ? def.label.toLowerCase() : def.plural.toLowerCase()} will be deleted.`, { title: 'Delete files', cta: 'Move to trash' }))) return;
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
    if (configuredDashboardDefinition(route)) return this.renderConfigDashboard(route, root, opts);
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
        const name = String(entityValue(project, 'project_name', ENTITIES.project) || entityValue(project, 'name', ENTITIES.project) || entityValue(project, 'project', ENTITIES.project) || project.basename || id).trim();
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
    const previousProject = entity.frontmatter?.project;
    const values = [
      ...(Array.isArray(ids) ? ids : [ids]),
      ...(Array.isArray(previousProject) ? previousProject : [previousProject]),
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
    return isOpenEntityRecord(entity, entityKey, ENTITIES);
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

  _normalizeWidgetSource(source, fallbackEntityKey = null) {
    return normalizeWidgetSourceConfig(source, fallbackEntityKey);
  }

  _widgetSourceSpec(card, fallbackEntityKey = null) {
    if (!card || typeof card !== 'object') return card;
    const source = card.source && typeof card.source === 'object'
      ? Object.assign({}, card.source)
      : (typeof card.source === 'string' ? { source: card.source } : {});
    const base = card.base && typeof card.base === 'object'
      ? card.base
      : (typeof card.base === 'string' ? { file: card.base } : {});
    const spec = Object.assign({}, source);
    if (base.file || base.base || base.path || base.basePath) {
      spec.base = base.file || base.base || base.path || base.basePath;
    }
    if (base.view || base.baseView || base.base_view) {
      spec.view = base.view || base.baseView || base.base_view;
    }
    if (base.entity || card.entity || fallbackEntityKey) {
      spec.entity = base.entity || card.entity || fallbackEntityKey;
    }
    return spec;
  }

  _filterEntitiesByBaseConfig(entityKey, entities, baseConfig, warnings = []) {
    return filterEntitiesByBaseConfig(this.app, entityKey, entities, baseConfig, warnings);
  }

  async _resolveWidgetEntities(source, fallbackEntityKey = null) {
    return resolveWidgetSource(this.app, source, fallbackEntityKey, this.plugin.settings);
  }

  _dashboardDateRangePresets(card, state = {}) {
    const today = startOfDay(new Date());
    const y = today.getFullYear();
    const m = today.getMonth();
    const weekStart = startOfWeek(today, this.plugin.settings.weekStartsOn || 1);
    const q = Math.floor(m / 3);
    return [
      { value: 'all', label: String(card.allLabel || 'All').trim(), from: '', to: '', filter: 'true' },
      { value: 'today', label: 'Today', from: today, to: today },
      { value: 'this-week', label: 'This week', from: weekStart, to: addDays(weekStart, 6) },
      { value: 'this-month', label: 'This month', from: startOfDay(new Date(y, m, 1)), to: startOfDay(new Date(y, m + 1, 0)) },
      { value: 'last-30-days', label: 'Last 30 days', from: addDays(today, -29), to: today },
      { value: 'this-quarter', label: 'This quarter', from: startOfDay(new Date(y, q * 3, 1)), to: startOfDay(new Date(y, q * 3 + 3, 0)) },
      { value: 'custom', label: 'Custom', from: state[`${card.key || card.name || card.field || 'dateRange'}Start`] || '', to: state[`${card.key || card.name || card.field || 'dateRange'}End`] || '' },
    ];
  }

  _applyDateRangeControlState(state, card, presetValue = null) {
    const key = String(card.key || card.name || card.field || 'dateRange').trim();
    if (!key) return;
    const field = String(card.field || 'date').trim();
    const filterKey = `${key}Filter`;
    const startKey = `${key}Start`;
    const endKey = `${key}End`;
    const presetKey = `${key}Preset`;
    const toYmd = (value) => {
      const d = value instanceof Date ? value : new Date(value);
      return isNaN(d.getTime()) ? '' : ymd(d);
    };
    const requested = String(presetValue || state[presetKey] || state[key] || card.default || 'this-month').trim() || 'this-month';
    const presets = this._dashboardDateRangePresets(card, state);
    const preset = presets.find((item) => item.value === requested) || presets.find((item) => item.value === 'this-month') || presets[0];
    state[presetKey] = preset.value;
    state[key] = preset.value;
    if (preset.value === 'all') {
      delete state[startKey];
      delete state[endKey];
      state[filterKey] = 'true';
      return;
    }
    if (preset.value === 'custom') {
      const start = state[startKey] ? toYmd(state[startKey]) : '';
      const end = state[endKey] ? toYmd(state[endKey]) : '';
      state[filterKey] = start && end ? `${field} >= ${JSON.stringify(start)} && ${field} <= ${JSON.stringify(end)}` : 'true';
      return;
    }
    const from = toYmd(preset.from);
    const to = toYmd(preset.to);
    state[startKey] = from;
    state[endKey] = to;
    state[filterKey] = from && to ? `${field} >= ${JSON.stringify(from)} && ${field} <= ${JSON.stringify(to)}` : 'true';
  }

  _initializeDashboardControlState(surfaceId, controls = []) {
    const state = this._dashboardStateFor(surfaceId);
    controls.forEach((card) => {
      if (!card || typeof card !== 'object') return;
      const kind = String(card.kind || '').trim().toLowerCase();
      const isDateRange = kind === 'date-range' || String(card.mode || card.type || '').trim().toLowerCase() === 'date-range';
      const key = String(card.key || card.name || card.field || card.entity || '').trim();
      if (!key) return;
      const filterKey = `${key}Filter`;
      if (isDateRange) {
        if (!state[filterKey]) this._applyDateRangeControlState(state, card);
        return;
      }
      if (kind !== 'selector') return;
      if (state[filterKey]) return;
      const defaultValue = String(card.default || '').trim();
      state[key] = defaultValue;
      state[filterKey] = 'true';
      if (!defaultValue || !Array.isArray(card.options)) return;
      const selected = card.options.find((opt) => {
        if (opt == null) return false;
        if (typeof opt === 'string' || typeof opt === 'number') return String(opt) === defaultValue;
        return String(opt.value ?? opt.id ?? opt.key ?? opt.label ?? '').trim() === defaultValue;
      });
      if (selected && typeof selected === 'object' && selected.filter) {
        state[filterKey] = String(selected.filter);
      } else if (selected != null && card.field) {
        state[filterKey] = `${String(card.field).trim()} == ${JSON.stringify(defaultValue)}`;
      }
    });
  }

  async renderConfigDashboard(surfaceId, root, opts = {}) {
    const config = opts.config || resolveSurfaceConfig(surfaceId);
    if (!config) {
      const surface = SURFACE_BY_ID[surfaceId] || {};
      if (!opts.skipHeader) {
        this._renderPageHeader(root, surface.label || surfaceId || 'Dashboard', 'No dashboard configuration found');
      }
      const card = root.createDiv({ cls: 'cad-dash-card' });
      const body = card.createDiv({ cls: 'cad-dash-card-body' });
      body.createDiv({
        cls: 'cad-empty',
        text: `Add dashboards.${surfaceId} to workspace.json to render this surface.`,
      });
      return;
    }
    root.toggleClass('cadence-report', config.kind === 'report' || String(surfaceId || '').startsWith('reports.'));
    root.toggleClass('cadence-planner', config.kind === 'planner' || String(surfaceId || '').startsWith('planner.'));

    const dashboardWarnings = [];
    const widgetCache = new Map();
    const dashboardState = this._dashboardStateFor(surfaceId);
    this._initializeDashboardControlState(surfaceId, config.controls || []);
    const dashboardContext = Object.assign({
      clientId: this._clientWorkClientId || '',
      projectId: this._clientWorkProjectId || '',
    }, dashboardState);
    const getWidgetEntities = async (source, fallbackEntityKey = null) => {
      const normalized = this._normalizeWidgetSource(applyDashboardContext(source, dashboardContext), fallbackEntityKey);
      const cacheKey = JSON.stringify({
        entityKey: normalized.entityKey,
        mode: normalized.mode,
        base: normalized.base,
        view: normalized.view,
        section: normalized.section || null,
        filters: normalized.filters || null,
        groupBy: normalized.groupBy || null,
        sort: normalized.sort || null,
        limit: normalized.limit,
        contextFilter: config.contextFilter || '',
      });
      if (!widgetCache.has(cacheKey)) {
        widgetCache.set(cacheKey, this._resolveWidgetEntities(normalized, normalized.entityKey).then((resolved) => {
          if (Array.isArray(resolved.warnings) && resolved.warnings.length) {
            dashboardWarnings.push(...resolved.warnings);
          }
          let entities = resolved.entities || [];
          if (config.contextFilter === 'client-work') {
            const cid = this._clientWorkClientId || '';
            const pid = this._clientWorkProjectId || '';
            entities = entities.filter((e) => this._entityMatchesClient(e, cid) && this._entityMatchesProject(e, pid));
          }
          return Object.assign({}, resolved, { entities });
        }));
      }
      return widgetCache.get(cacheKey);
    };

    const titleSuffix = config.contextFilter === 'client-work'
      ? [this._clientWorkClientId, this._clientWorkProjectId].filter(Boolean).join(' · ')
      : '';
    if (!opts.skipHeader) {
      this._renderPageHeader(
        root,
        config.title + (titleSuffix ? ` · ${titleSuffix}` : ''),
        config.subtitle,
        (r, ctx) => {
          if (config.contextFilter === 'client-work') this._renderClientWorkSelector(r);
          const exportBtn = r.createEl('button', { cls: 'cad-btn', text: 'Save' });
          exportBtn.addEventListener('click', async () => {
            exportBtn.disabled = true;
            exportBtn.textContent = 'Saving…';
            try {
              const path = await this._exportConfigDashboard(surfaceId, config, getWidgetEntities, dashboardContext);
              new obsidian.Notice(`BOB Workspace: saved note to ${path}`, 6000);
            } catch (e) {
              new obsidian.Notice(`BOB Workspace: save failed — ${e.message}`, 8000);
            } finally {
              exportBtn.disabled = false;
              exportBtn.textContent = 'Save';
            }
          });
        }
      );
    }

    if (Array.isArray(config.controls) && config.controls.length) {
      const controlsSection = root.createDiv({ cls: 'cad-dash-filter-group' });
      const controlsHead = controlsSection.createDiv({ cls: 'cad-dash-filter-group-head' });
      controlsHead.createDiv({ cls: 'cad-dash-card-title', text: 'FILTERS' });
      controlsHead.createDiv({ cls: 'cad-dash-filter-group-note', text: 'All filters are combined with AND.' });
      const controlsWrap = controlsSection.createDiv({ cls: 'cad-dash-controls' });
      for (const control of config.controls) {
        await this._renderConfigCard(controlsWrap.createDiv({ cls: 'cad-dash-col' }), control, getWidgetEntities);
      }
    }

    if (config.stats?.length) {
      const statItems = await Promise.all(config.stats.map(async (s) => {
        const resolved = await getWidgetEntities(s.source || s, s.entity);
        const entities = resolved.entities;
        const builtInData = resolved.metadata?.builtInData || resolved.metadata?.providerData || null;
        const def = resolved.def || ENTITIES[s.entity];
        const metric = String(s.metric || s.count?.metric || '').trim();
        const field = s.field || s.valueField || s.count?.field || '';
        const hasEntityModel = !!def && !!s.entity;
        const stageField = hasEntityModel ? dealStageField(def) : '';
        const dealValue = (e) => Number(entityValue(e, field || (hasEntityModel ? dealValueField(def) : field), def)) || 0;
        const countOpen = hasEntityModel ? entities.filter((e) => this._isOpenEntity(e, s.entity)).length : 0;
        const countWon = hasEntityModel ? entities.filter((e) => dealWonStages(def).includes(String(entityValue(e, stageField, def)))).length : 0;
        const countLost = hasEntityModel ? entities.filter((e) => dealLostStages(def).includes(String(entityValue(e, stageField, def)))).length : 0;
        let value;
        if (builtInData && field && Object.prototype.hasOwnProperty.call(builtInData, field)) {
          value = builtInData[field];
        } else if (metric === 'sum') {
          value = entities.reduce((sum, e) => sum + dealValue(e), 0);
        } else if (metric === 'avg') {
          value = entities.length ? entities.reduce((sum, e) => sum + dealValue(e), 0) / entities.length : 0;
        } else if (metric === 'weightedForecast') {
          const stageConfidenceRaw = def?.stageConfidence || { lead: 0.1, qualified: 0.25, proposal: 0.5, negotiation: 0.75 };
          const stageConfidence = Object.fromEntries(Object.entries(stageConfidenceRaw).map(([k, v]) => [String(k).toLowerCase(), Number(v) || 0]));
          value = entities.reduce((sum, e) => {
            const stage = String(entityValue(e, stageField, def) || '').toLowerCase();
            return sum + dealValue(e) * (stageConfidence[stage] || 0);
          }, 0);
        } else if (metric === 'winRate') {
          value = countWon + countLost === 0 ? 0 : Math.round((countWon / (countWon + countLost)) * 100);
        } else if (metric === 'captureRate') {
          const wonValue = entities.filter((e) => dealWonStages(def).includes(String(entityValue(e, stageField, def)))).reduce((sum, e) => sum + dealValue(e), 0);
          const lostValue = entities.filter((e) => dealLostStages(def).includes(String(entityValue(e, stageField, def)))).reduce((sum, e) => sum + dealValue(e), 0);
          const total = wonValue + lostValue;
          value = total === 0 ? 0 : Math.round((wonValue / total) * 100);
        } else if (metric === 'uniqueCount') {
          value = new Set(entities.map((e) => String(entityValue(e, field, def) || '').trim()).filter(Boolean)).size;
        } else if (s.count === 'open') {
          value = countOpen;
        } else if (s.count && typeof s.count === 'object' && s.count.field) {
          value = entities.filter((e) => entityValue(e, s.count.field, def)).length;
        } else {
          value = entities.length;
        }
        let sub = s.sub;
        if (sub && typeof sub === 'object') {
          const subKey = sub.entity || s.entity;
          const subResolved = await getWidgetEntities(sub.source || sub, subKey);
          const subEnts = subResolved.entities;
          const subCount = sub.count === 'open'
            ? subEnts.filter(e => this._isOpenEntity(e, subKey)).length
            : subEnts.length;
          sub = `${subCount} ${sub.suffix}`;
        }
        return { label: s.label, value, sub, accent: s.accent, mode: s.mode };
      }));
      this._dashboardStats(root, statItems);
    }

    for (const row of config.layout || []) {
      const cols = root.createDiv({ cls: 'cad-dash-cols' });
      for (const colDef of row) {
        const col = cols.createDiv({ cls: 'cad-dash-col' });
        for (const card of (Array.isArray(colDef) ? colDef : [colDef])) {
          await this._renderConfigCard(col, card, getWidgetEntities, dashboardContext);
        }
      }
    }

    for (const cr of config.conditionalRows || []) {
      const resolvedConditions = await Promise.all((cr.condition?.entities || []).map((key) => getWidgetEntities(null, key)));
      const hasData = resolvedConditions.some((resolved) => resolved.entities.length > 0);
      if (!hasData) continue;
      const extra = root.createDiv({ cls: 'cad-dash-cols' });
      for (const card of cr.cards) {
        await this._renderConfigCard(extra.createDiv({ cls: 'cad-dash-col' }), card, getWidgetEntities, dashboardContext);
      }
    }

    if (dashboardWarnings.length) {
      const details = root.createEl('details', { cls: 'cad-base-filter-warnings' });
      details.createEl('summary', { text: `${dashboardWarnings.length} dashboard warning${dashboardWarnings.length === 1 ? '' : 's'}` });
      const list = details.createEl('ul');
      dashboardWarnings.forEach((warning) => {
        list.createEl('li').createEl('code', { text: warning });
      });
    }

    if (config.legend === 'finance-statements') this._renderFinanceStatementLegend(root);
  }

  async _renderConfigCard(col, card, getWidgetEntities, dashboardContext = {}) {
    try {
      const resolvedCard = applyDashboardContext(card, dashboardContext);
      if (await this._renderWidgetByKind(col, resolvedCard, getWidgetEntities)) return;
      const rows = await this._resolveCardRows(resolvedCard, getWidgetEntities);
      this._dashCardSection(col, resolvedCard.title, rows, resolvedCard.empty || '');
    } catch (error) {
      this._renderWidgetErrorCard(col, card, error);
    }
  }

  _renderWidgetErrorCard(col, card, error) {
    const title = String(card?.title || card?.kind || 'Widget').trim();
    const cardEl = col.createDiv({ cls: 'cad-dash-card cad-widget-error-card' });
    const head = cardEl.createDiv({ cls: 'cad-dash-card-head' });
    head.createDiv({ cls: 'cad-dash-card-title', text: title });
    head.createSpan({ cls: 'cad-widget-catalog-badge cad-widget-error-badge', text: 'Error' });
    const body = cardEl.createDiv({ cls: 'cad-dash-card-body' });
    body.createDiv({ cls: 'cad-empty', text: 'This widget failed to render.' });
    const details = body.createEl('details', { cls: 'cad-widget-error-details' });
    details.createEl('summary', { text: 'Show details' });
    details.createEl('code', { text: String(error?.message || error || 'Unknown widget error') });
  }

  _renderRowProgress(parent, progress) {
    if (!progress || typeof progress !== 'object') return;
    const value = Math.max(0, Math.min(100, Number(progress.value ?? progress.percent ?? progress.pct ?? 0) || 0));
    const wrap = parent.createDiv({ cls: 'cad-proj-progress-wrap cad-row-progress' });
    wrap.dataset.pctBand = pctBand(value);
    const label = wrap.createDiv({ cls: 'cad-proj-progress-label' });
    label.createSpan({ text: String(progress.label || 'Progress') });
    label.createSpan({ cls: 'cad-proj-progress-pct', text: String(progress.pct || `${value}%`) });
    const bar = wrap.createDiv({ cls: 'cad-proj-progress-bar' });
    const fill = bar.createDiv({ cls: 'cad-proj-progress-fill' });
    fill.style.width = `${value}%`;
  }

  _applyCardTone(cardEl, card = {}) {
    if (!cardEl) return;
    const explicit = String(card.tone || card.accent || '').trim().toLowerCase();
    const text = String(card.title || card.label || card.kind || '').toLowerCase();
    const source = card.source && typeof card.source === 'object' ? String(card.source.section || card.source.builtIn || '') : '';
    const seed = explicit || source.toLowerCase() || text;
    let tone = 'sky';
    if (/today|done|won|complete|activity/.test(seed)) tone = 'emerald';
    else if (/week|project|partner|base/.test(seed)) tone = 'mint';
    else if (/upcoming|pipeline|date|warning|risk/.test(seed)) tone = 'warn';
    else if (/inbox|overdue|lost|error/.test(seed)) tone = 'rose';
    else if (/brief|top|jump|action/.test(seed)) tone = 'sky';
    cardEl.dataset.tone = tone;
  }

  async _exportConfigDashboard(surfaceId, config, getWidgetEntities, dashboardContext) {
    const exportFolder = workbookExportFolder(this.plugin.settings);
    const now = new Date();
    const pad = (n) => String(n).padStart(2, '0');
    const stamp = `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}_${pad(now.getHours())}-${pad(now.getMinutes())}`;
    const title = String(config.title || surfaceId || 'Report').trim();
    const slug = title.replace(/[^a-z0-9]+/gi, '-').replace(/^-|-$/g, '').toLowerCase() || 'report';
    const path = `${exportFolder}/${slug}_${stamp}.md`;
    await ensureFolderSync(this.app, exportFolder);

    const lines = [];
    lines.push(`# ${config.title || surfaceId}`);
    if (config.subtitle) lines.push(`\n${config.subtitle}`);
    lines.push(`\n- Surface: \`${surfaceId}\``);
    if (config.contextFilter) lines.push(`- Context: \`${config.contextFilter}\``);
    const selectorBits = Object.entries(dashboardContext || {})
      .filter(([key, value]) => key.endsWith('Filter') && String(value || '').trim())
      .map(([key, value]) => `  - ${key}: \`${value}\``);
    if (selectorBits.length) {
      lines.push('\n## Filters');
      lines.push(...selectorBits);
    }

    if (Array.isArray(config.controls) && config.controls.length) {
      lines.push('\n## Controls');
      for (const control of config.controls) {
        const title = String(control.title || control.label || control.kind || 'Control').trim();
        lines.push(`- ${title}`);
        if (control.kind === 'selector') {
          const key = String(control.key || control.name || control.field || control.entity || '').trim();
          const value = String(dashboardContext?.[key] || '').trim();
          lines.push(`  - key: \`${key}\``);
          lines.push(`  - value: \`${value || 'All'}\``);
        }
      }
    }

    if (Array.isArray(config.stats) && config.stats.length) {
      lines.push('\n## Metrics');
      for (const stat of config.stats) {
        const resolved = await getWidgetEntities(stat.source || stat, stat.entity);
        const entities = resolved.entities || [];
        const def = resolved.def || ENTITIES[stat.entity];
        const builtInData = resolved.metadata?.builtInData || resolved.metadata?.providerData || null;
        const metric = String(stat.metric || stat.count?.metric || '').trim();
        const field = stat.field || stat.valueField || stat.count?.field || '';
        const hasEntityModel = !!def && !!stat.entity;
        const stageField = hasEntityModel ? dealStageField(def) : '';
        const valueField = field || (hasEntityModel ? dealValueField(def) : '');
        const dealValue = (e) => Number(entityValue(e, valueField, def)) || 0;
        const numericValues = entities.map((e) => dealValue(e)).filter((value) => Number.isFinite(value));
        const countOpen = hasEntityModel ? entities.filter((e) => this._isOpenEntity(e, stat.entity)).length : 0;
        const countWon = hasEntityModel ? entities.filter((e) => dealWonStages(def).includes(String(entityValue(e, stageField, def)))).length : 0;
        const countLost = hasEntityModel ? entities.filter((e) => dealLostStages(def).includes(String(entityValue(e, stageField, def)))).length : 0;
        let value;
        const filledCount = entities.filter((e) => {
          const raw = entityValue(e, valueField, def);
          return hasBaseValue(raw);
        }).length;
        const emptyCount = Math.max(0, entities.length - filledCount);
        if (metric === 'sum') value = entities.reduce((sum, e) => sum + dealValue(e), 0);
        else if (metric === 'avg') value = entities.length ? entities.reduce((sum, e) => sum + dealValue(e), 0) / entities.length : 0;
        else if (metric === 'min') value = numericValues.length ? Math.min(...numericValues) : 0;
        else if (metric === 'max') value = numericValues.length ? Math.max(...numericValues) : 0;
        else if (metric === 'filled') value = filledCount;
        else if (metric === 'empty') value = emptyCount;
        else if (metric === 'weightedForecast') {
          const stageConfidenceRaw = def?.stageConfidence || { lead: 0.1, qualified: 0.25, proposal: 0.5, negotiation: 0.75 };
          const stageConfidence = Object.fromEntries(Object.entries(stageConfidenceRaw).map(([k, v]) => [String(k).toLowerCase(), Number(v) || 0]));
          value = entities.reduce((sum, e) => sum + dealValue(e) * (stageConfidence[String(entityValue(e, stageField, def) || '').toLowerCase()] || 0), 0);
        } else if (metric === 'winRate') {
          value = countWon + countLost === 0 ? 0 : Math.round((countWon / (countWon + countLost)) * 100);
        } else if (metric === 'captureRate') {
          const wonValue = entities.filter((e) => dealWonStages(def).includes(String(entityValue(e, stageField, def)))).reduce((sum, e) => sum + dealValue(e), 0);
          const lostValue = entities.filter((e) => dealLostStages(def).includes(String(entityValue(e, stageField, def)))).reduce((sum, e) => sum + dealValue(e), 0);
          const total = wonValue + lostValue;
          value = total === 0 ? 0 : Math.round((wonValue / total) * 100);
        } else if (metric === 'uniqueCount') {
          value = new Set(entities.map((e) => String(entityValue(e, field, def) || '').trim()).filter(Boolean)).size;
        } else if (metric === 'ratio') {
          const numeratorSpec = stat.numerator ?? stat.ratio?.numerator ?? stat.ratio?.top ?? stat.ratio?.value;
          const denominatorSpec = stat.denominator ?? stat.ratio?.denominator ?? stat.ratio?.bottom ?? stat.ratio?.total;
          const resolveRatioValue = (spec) => {
            if (typeof spec === 'number') return spec;
            if (typeof spec === 'string' && spec.trim()) {
              return entities.reduce((sum, entity) => sum + (Number(entityValue(entity, spec.trim(), def)) || 0), 0);
            }
            return 0;
          };
          const numerator = resolveRatioValue(numeratorSpec);
          const denominator = resolveRatioValue(denominatorSpec);
          value = denominator === 0 ? 0 : Math.round((numerator / denominator) * 100);
        } else if (stat.count === 'open') {
          value = countOpen;
        } else if (builtInData && field && Object.prototype.hasOwnProperty.call(builtInData, field)) {
          value = builtInData[field];
        } else {
          value = entities.length;
        }
        lines.push(`- ${stat.label}: ${value}${stat.sub ? ` (${typeof stat.sub === 'string' ? stat.sub : stat.sub.suffix || ''})` : ''}`);
      }
    }

    let sectionIndex = 0;
    for (const row of config.layout || []) {
      for (const colDef of row) {
        for (const card of (Array.isArray(colDef) ? colDef : [colDef])) {
          sectionIndex++;
          const title = String(card.title || card.label || card.kind || `Widget ${sectionIndex}`).trim();
          lines.push(`\n## ${title}`);
          if (card.kind === 'selector') {
            const key = String(card.key || card.name || card.field || card.entity || '').trim();
            const value = dashboardContext?.[key] || '';
            lines.push(`- Selector: \`${key}\``);
            lines.push(`- Value: \`${value || 'All'}\``);
            continue;
          }
          if (card.kind === 'actions') {
            (Array.isArray(card.actions) ? card.actions : []).map((action) => this._normalizeActionSpec(action)).filter(Boolean).forEach((action) => {
              lines.push(`- ${action.label}${action.surface ? ` -> surface \`${action.surface}\`` : ''}${action.command ? ` -> command \`${action.command}\`` : ''}${action.entityKey ? ` -> create \`${action.entityKey}\`` : ''}`);
            });
            continue;
          }
          if (card.kind === 'markdown') {
            const md = await this._resolveMarkdownWidgetContent(card);
            const snippet = String(md.text || '').trim().split('\n').slice(0, 12).join('\n');
            lines.push(snippet ? `\n${snippet}` : '- No markdown content');
            continue;
          }
          if (card.kind === 'base-link') {
            const base = await this._resolveBaseWidgetTarget(card);
            lines.push(`- Base: \`${base.basePath || '—'}\``);
            if (base.viewName) lines.push(`- View: \`${base.viewName}\``);
            continue;
          }
          if (card.kind === 'base-embed') {
            const base = await this._resolveBaseWidgetTarget(card);
            const resolved = base.entityKey ? await getWidgetEntities(this._widgetSourceSpec(card, base.entityKey), base.entityKey).catch(() => null) : null;
            const preview = (resolved?.entities || []).slice(0, Math.max(1, Number(card.limit || 5) || 5));
            lines.push(`- Base: \`${base.basePath || '—'}\``);
            if (base.viewName) lines.push(`- View: \`${base.viewName}\``);
            preview.forEach((entity) => {
              const titleFields = Array.isArray(card.titleFields) && card.titleFields.length ? card.titleFields : ['title', 'name', 'subject'];
              const metaFields = Array.isArray(card.metaFields) && card.metaFields.length ? card.metaFields : ['status', 'date', 'value'];
              const entityTitle = titleFields.map((field) => String(entityValue(entity, field, base.entityDef) || '').trim()).find(Boolean) || entity.basename;
              const metaBits = metaFields.map((field) => fmtValue(entityValue(entity, field, base.entityDef), base.entityDef?.fields?.find((f) => f.key === field)?.type)).filter(Boolean);
              lines.push(`- ${entityTitle}${metaBits.length ? ` · ${metaBits.join(' · ')}` : ''}`);
            });
            continue;
          }
          const rows = await this._resolveCardRows(card, getWidgetEntities);
          if (!rows.length) {
            lines.push('- No rows');
            continue;
          }
          rows.slice(0, 10).forEach((row) => {
            lines.push(`- ${row.title}${row.meta ? ` · ${row.meta}` : ''}`);
          });
          if (rows.length > 10) lines.push(`- …and ${rows.length - 10} more`);
        }
      }
    }

    const file = await this.app.vault.create(path, `${lines.join('\n')}\n`);
    await this.app.workspace.openLinkText(file.path, '', false);
    return file.path;
  }

  async _resolveCardRows(card, getWidgetEntities) {
    if (card.merge) {
      const merged = [];
      for (const m of card.merge) {
        merged.push(...await this._resolveSourceRows(m, getWidgetEntities));
      }
      return merged
        .sort((a, b) => (b.file?.stat?.mtime || 0) - (a.file?.stat?.mtime || 0))
        .slice(0, 6);
    }
    return this._resolveSourceRows(card, getWidgetEntities);
  }

  async _resolveSourceRows(def, getWidgetEntities) {
    const sourceSpec = this._widgetSourceSpec(def, def.entity);
    const resolved = await getWidgetEntities(sourceSpec, def.entity);
    const all = resolved.entities || [];
    const entityDef = resolved.def || ENTITIES[def.entity];
    const source = typeof def.source === 'string' ? def.source : String(sourceSpec.source || sourceSpec.kind || 'recent');
    if (sourceSpec.mode === 'built-in') {
      return this._resolveBuiltInRows(def, resolved);
    }
    const sortSpec = sourceSpec.sort || def.sort || null;
    const limit = sourceSpec.limit || def.limit || 6;
    if (source === 'recent') return this._recentRows(def.entity, all, def.titleFields, def.metaFields, sortSpec, limit);
    if (source === 'recent-open') return this._recentRows(def.entity, all.filter(e => this._isOpenEntity(e, def.entity)), def.titleFields, def.metaFields, sortSpec, limit);
    if (source === 'due') return this._dueRows(def.entity, all, def.dateFields, def.titleFields, limit);
    if (source === 'due-open') return this._dueRows(def.entity, all.filter(e => this._isOpenEntity(e, def.entity)), def.dateFields, def.titleFields, limit);
    if (source === 'base' || source === 'table' || source === 'list' || source === 'entity') {
      return this._recentRows(def.entity, all, def.titleFields, def.metaFields, sortSpec, limit, entityDef);
    }
    return [];
  }

  _resolveBuiltInRows(def, resolved) {
    const builtIn = String(resolved.source?.builtIn || resolved.metadata?.builtIn || '').trim().toLowerCase();
    const builtInData = resolved.metadata?.builtInData || null;
    if (!builtInData) return [];
    if (builtIn === 'home') {
      const section = String(resolved.source?.section || def.section || def.mode || '').trim().toLowerCase();
      if (section === 'briefing') return builtInData.briefing || [];
      if (section === 'inbox') return builtInData.inbox || [];
      if (section === 'today') return builtInData.todayRows || [];
      if (section === 'week' || section === 'this-week') return builtInData.weekRows || [];
      if (section === 'upcoming') return builtInData.upcomingRows || [];
      if (section === 'partners') return builtInData.partners || [];
      if (section === 'projects') return builtInData.projects || [];
      if (section === 'pipeline') return builtInData.pipelineRows || [];
      if (section === 'activities') return builtInData.activityRows || [];
      return [
        { title: 'Inbox', meta: String(builtInData.inbox?.length || 0), action: { surface: 'planner.inbox' } },
        { title: 'Today', meta: String(builtInData.todayRows?.length || 0), action: { surface: 'planner.today' } },
        { title: 'Week', meta: String(builtInData.weekRows?.length || 0), action: { surface: 'planner.calendar' } },
      ];
    }
    if (builtIn === 'planner') {
      const section = String(resolved.source?.section || def.section || def.mode || '').trim().toLowerCase();
      if (section === 'overview') return builtInData.overviewRows || builtInData.briefing || [];
      if (section === 'inbox') return builtInData.inbox || [];
      if (section === 'today') return builtInData.todayRows || [];
      if (section === 'calendar' || section === 'week') return builtInData.calendarRows || [];
      if (section === 'projects') return builtInData.projectsRows || [];
      return [
        { title: 'Inbox', meta: String(builtInData.inboxCount || 0), action: { surface: 'planner.inbox' } },
        { title: 'Today', meta: String(builtInData.todayCount || 0), action: { surface: 'planner.today' } },
        { title: 'Calendar', meta: String(builtInData.calendarCount || 0), action: { surface: 'planner.calendar' } },
        { title: 'Projects', meta: String(builtInData.projectCount || 0), action: { surface: 'planner.projects' } },
      ];
    }
    if (builtIn !== 'productivity') return [];
    const section = String(resolved.source?.section || def.section || def.mode || '').trim().toLowerCase();
    if (section === 'per-day' || section === 'perday' || section === 'trend') {
      return (builtInData.perDay || [])
        .slice()
        .reverse()
        .map((item) => ({
          title: fmtValue(item.date, 'date'),
          meta: `done ${item.done} · open ${item.open}${item.jChars ? ` · journal ${item.jChars}` : ''}`,
          value: Number(item.done) || 0,
          values: {
            done: Number(item.done) || 0,
            open: Number(item.open) || 0,
            journal: Number(item.jChars) || 0,
            total: (Number(item.done) || 0) + (Number(item.open) || 0),
          },
        }));
    }
    if (section === 'weeks' || section === 'weekly') {
      return (builtInData.weeks || []).map((item) => ({
        title: item.label || fmtValue(item.start, 'date'),
        meta: `${item.done} done · ${item.open} open`,
        value: Number(item.done) || 0,
        values: {
          done: Number(item.done) || 0,
          open: Number(item.open) || 0,
          total: (Number(item.done) || 0) + (Number(item.open) || 0),
        },
      }));
    }
    if (section === 'weekday' || section === 'day-buckets' || section === 'daybuckets') {
      const labels = resolved.source?.labels || ['MON', 'TUE', 'WED', 'THU', 'FRI', 'SAT', 'SUN'];
      return (builtInData.dayBuckets || []).map((item, idx) => {
        const total = item.done + item.open;
        const pct = total === 0 ? 0 : Math.round((item.done / total) * 100);
        return {
          title: labels[idx] || `DAY ${idx + 1}`,
          meta: total === 0 ? 'no data' : `${pct}% · ${item.done}/${total}`,
          value: pct,
          values: {
            pct,
            done: Number(item.done) || 0,
            open: Number(item.open) || 0,
            total,
          },
        };
      });
    }
    if (section === 'task-notes' || section === 'tasknotes' || section === 'notes') {
      return (builtInData.taskNotes || []).map((task) => ({
        title: task.text || task.title || 'Task note',
        meta: `${task.date || '—'} · ${task.done ? 'done' : 'open'}`,
        file: task.file || null,
      }));
    }
    if (section === 'projects' || section === 'project') {
      return (builtInData.projectBuckets || []).map((item) => ({
        title: item.title || 'Project',
        meta: item.meta || '',
        value: Number(item.value) || 0,
        values: Object.assign({}, item.values || {}),
      }));
    }
    if (section === 'contexts' || section === 'context') {
      return (builtInData.contextBuckets || []).map((item) => ({
        title: item.title || 'Context',
        meta: item.meta || '',
        value: Number(item.value) || 0,
        values: Object.assign({}, item.values || {}),
      }));
    }
    if (section === 'overdue' || section === 'overdue-open') {
      return (builtInData.overdueTasks || []).map((task) => ({
        title: task.title || task.file?.basename || 'Task note',
        meta: [task.due ? `due ${task.due}` : '', task.scheduled ? `scheduled ${task.scheduled}` : '', task.priority ? task.priority : '']
          .filter(Boolean)
          .join(' · '),
        file: task.file || null,
      }));
    }
    if (section === 'high-priority' || section === 'priority-open') {
      return (builtInData.highPriorityTasks || []).map((task) => ({
        title: task.title || task.file?.basename || 'Task note',
        meta: [task.priority || '', task.due ? `due ${task.due}` : '', task.scheduled ? `scheduled ${task.scheduled}` : '']
          .filter(Boolean)
          .join(' · '),
        file: task.file || null,
      }));
    }
    return [
      { title: 'Tasks done', meta: String(builtInData.totalDone ?? 0) },
      { title: 'Tasks open', meta: String(builtInData.totalOpen ?? 0) },
      { title: 'Streak', meta: `${builtInData.streak ?? 0}d` },
    ];
  }

  async _renderWidgetByKind(col, card, getWidgetEntities) {
    const kind = String(card.kind || '').trim();
    if (!kind) return false;
    if (kind === 'kanban') {
      await this._renderKanbanWidget(col, card, getWidgetEntities);
      return true;
    }
    if (kind === 'list') {
      await this._renderListWidget(col, card, getWidgetEntities);
      return true;
    }
    if (kind === 'bar-chart' || kind === 'chart-bar') {
      await this._renderBarChartWidget(col, card, getWidgetEntities);
      return true;
    }
    if (kind === 'base-link') {
      await this._renderBaseLinkWidget(col, card, getWidgetEntities);
      return true;
    }
    if (kind === 'base-embed') {
      await this._renderBaseEmbedWidget(col, card, getWidgetEntities);
      return true;
    }
    if (kind === 'base-view') {
      await this._renderBaseViewWidget(col, card, getWidgetEntities);
      return true;
    }
    if (kind === 'markdown') {
      await this._renderMarkdownWidget(col, card);
      return true;
    }
    if (kind === 'actions') {
      await this._renderActionsWidget(col, card);
      return true;
    }
    if (kind === 'selector') {
      await this._renderSelectorWidget(col, card, getWidgetEntities);
      return true;
    }
    if (kind === 'date-range') {
      await this._renderDateRangeWidget(col, card);
      return true;
    }
    return false;
  }

  _dashboardStateFor(surfaceId) {
    const state = this._dashboardState || (this._dashboardState = {});
    const persisted = this.plugin.settings.dashboardState || (this.plugin.settings.dashboardState = {});
    if (!state[surfaceId]) {
      state[surfaceId] = cloneConfig(persisted[surfaceId] || {});
      persisted[surfaceId] = state[surfaceId];
    } else if (persisted[surfaceId] !== state[surfaceId]) {
      persisted[surfaceId] = state[surfaceId];
    }
    return state[surfaceId];
  }

  async _persistDashboardState() {
    try {
      await this.plugin.saveSettings();
    } catch (_) {}
  }

  async _resolveBaseWidgetTarget(card) {
    const baseDef = card.base && typeof card.base === 'object' ? card.base : {};
    const entityKey = String(card.entity || baseDef.entity || '').trim();
    const mappedBase = entityKey ? entityBasePath(this.plugin.settings, entityKey) : '';
    const basePath = String(baseDef.file || baseDef.base || card.base || mappedBase || '').trim();
    const viewName = String(baseDef.view || baseDef.baseView || card.view || '').trim();
    const label = String(card.title || baseDef.label || baseDef.title || 'Base').trim();
    const description = String(card.description || baseDef.description || card.subtitle || '').trim();
    const resolvedEntity = entityKey ? await this._resolveWidgetEntities(null, entityKey).catch(() => null) : null;
    const entityDef = resolvedEntity?.def || ENTITIES[entityKey] || null;
    const summary = basePath ? await readBaseSummary(this.app, this.app.vault.getAbstractFileByPath(basePath)).catch(() => null) : null;
    return { baseDef, entityKey, basePath, viewName, label, description, entityDef, summary };
  }

  async _renderBaseLinkWidget(root, card, getWidgetEntities) {
    const { entityKey, basePath, viewName, label, description, entityDef, summary } = await this._resolveBaseWidgetTarget(card);

    const cardEl = root.createDiv({ cls: 'cad-dash-card cad-base-link-card' });
    this._applyCardTone(cardEl, Object.assign({ kind: 'base-link' }, card));
    const head = cardEl.createDiv({ cls: 'cad-dash-card-head' });
    head.createDiv({ cls: 'cad-dash-card-title', text: label });
    if (viewName) head.createSpan({ cls: 'cad-widget-catalog-badge', text: viewName });
    const body = cardEl.createDiv({ cls: 'cad-dash-card-body' });
    if (description) body.createDiv({ cls: 'cad-dash-card-sub', text: description });
    if (basePath) {
      body.createDiv({ cls: 'cad-dash-card-path', text: basePath });
    } else {
      body.createDiv({ cls: 'cad-empty', text: 'No Base file selected.' });
    }
    if (summary) {
      const meta = body.createDiv({ cls: 'cad-dashboard-inventory-meta' });
      meta.createSpan({ cls: 'cad-dashboard-inventory-chip', text: summary.label || 'base' });
      if (Array.isArray(summary.views) && summary.views.length) {
        meta.createSpan({ cls: 'cad-dashboard-inventory-chip', text: `${summary.views.length} views` });
      }
      if (Array.isArray(summary.typeFilters) && summary.typeFilters.length) {
        meta.createSpan({ cls: 'cad-dashboard-inventory-chip', text: summary.typeFilters.join(', ') });
      }
    }
    if (entityDef?.externalBaseView?.basePath) {
      body.createDiv({ cls: 'setting-item-description', text: `Entity-backed Base target for ${entityDef.label} is available through the configured entity mapping.` });
    }
    const actions = body.createDiv({ cls: 'cad-de-actions' });
    const openBtn = actions.createEl('button', { cls: 'cad-btn primary', text: 'Open Base' });
    openBtn.addEventListener('click', async () => {
      if (entityKey && entityDef?.externalBaseView) {
        this._openEntityBase(entityKey);
        return;
      }
      if (!basePath) return;
      const file = this.app.vault.getAbstractFileByPath(basePath);
      if (file instanceof obsidian.TFile) {
        await this.app.workspace.openLinkText(file.path, '', false);
      } else {
        new obsidian.Notice(`Base file not found: ${basePath}`);
      }
    });
    if (viewName && basePath) {
      const copyBtn = actions.createEl('button', { cls: 'cad-btn', text: 'Copy config' });
      copyBtn.addEventListener('click', async () => {
        const snippet = JSON.stringify({ base: { file: basePath, view: viewName } }, null, 2);
        try {
          await navigator.clipboard.writeText(snippet);
          new obsidian.Notice('Copied Base widget config.');
        } catch (_) {}
      });
    }
  }

  async _renderBaseEmbedWidget(root, card, getWidgetEntities) {
    const { entityKey, basePath, viewName, label, description, entityDef, summary } = await this._resolveBaseWidgetTarget(card);
    const entitySource = entityKey ? await getWidgetEntities(this._widgetSourceSpec(card, entityKey), entityKey).catch(() => null) : null;
    const entities = entitySource?.entities || [];
    const titleFields = Array.isArray(card.titleFields) && card.titleFields.length
      ? card.titleFields
      : ['title', 'name', 'subject'];
    const metaFields = Array.isArray(card.metaFields) && card.metaFields.length
      ? card.metaFields
      : [String(card.groupBy || card.field || '').trim(), 'status', 'date', 'value'].filter(Boolean);
    const limit = Math.max(1, Number(card.limit || 5) || 5);
    const preview = entities.slice(0, limit);

    const cardEl = root.createDiv({ cls: 'cad-dash-card cad-base-embed-card' });
    this._applyCardTone(cardEl, Object.assign({ kind: 'base-embed' }, card));
    const head = cardEl.createDiv({ cls: 'cad-dash-card-head' });
    head.createDiv({ cls: 'cad-dash-card-title', text: label });
    if (viewName) head.createSpan({ cls: 'cad-widget-catalog-badge', text: viewName });
    const body = cardEl.createDiv({ cls: 'cad-dash-card-body' });
    if (description) body.createDiv({ cls: 'cad-dash-card-sub', text: description });
    if (basePath) body.createDiv({ cls: 'cad-dash-card-path', text: basePath });

    const meta = body.createDiv({ cls: 'cad-dashboard-inventory-meta' });
    if (summary) {
      meta.createSpan({ cls: 'cad-dashboard-inventory-chip', text: summary.label || 'base' });
      if (Array.isArray(summary.views) && summary.views.length) {
        meta.createSpan({ cls: 'cad-dashboard-inventory-chip', text: `${summary.views.length} views` });
      }
      if (Array.isArray(summary.typeFilters) && summary.typeFilters.length) {
        meta.createSpan({ cls: 'cad-dashboard-inventory-chip', text: summary.typeFilters.join(', ') });
      }
    }
    meta.createSpan({ cls: 'cad-dashboard-inventory-chip', text: `${preview.length}${entities.length > preview.length ? ` / ${entities.length}` : ''} rows` });
    if (entityDef?.externalBaseView?.basePath) {
      meta.createSpan({ cls: 'cad-dashboard-inventory-chip', text: 'external view' });
    }

    const actions = body.createDiv({ cls: 'cad-de-actions' });
    const openBtn = actions.createEl('button', { cls: 'cad-btn primary', text: 'Open Base' });
    openBtn.addEventListener('click', async () => {
      if (entityKey && entityDef?.externalBaseView) {
        this._openEntityBase(entityKey);
        return;
      }
      if (!basePath) return;
      const file = this.app.vault.getAbstractFileByPath(basePath);
      if (file instanceof obsidian.TFile) {
        await this.app.workspace.openLinkText(file.path, '', false);
      } else {
        new obsidian.Notice(`Base file not found: ${basePath}`);
      }
    });

    if (!preview.length) {
      body.createDiv({ cls: 'cad-empty', text: entitySource ? 'No rows matched this Base/view.' : 'No rows available for preview.' });
      return;
    }

    const list = body.createDiv({ cls: 'cad-home-list cad-base-embed-list' });
    preview.forEach((entity) => {
      const row = list.createDiv({ cls: 'cad-home-row cad-base-embed-row' });
      const title = titleFields.map((field) => String(entityValue(entity, field, entityDef) || '').trim()).find(Boolean) || entity.basename;
      const metaBits = metaFields
        .map((field) => fmtValue(entityValue(entity, field, entityDef), entityDef?.fields?.find((f) => f.key === field)?.type))
        .filter(Boolean);
      row.createDiv({ cls: 'cad-home-row-date', text: entity.file?.basename || '' });
      const main = row.createDiv({ cls: 'cad-home-row-main' });
      main.createDiv({ cls: 'cad-home-row-title', text: title });
      if (metaBits.length) {
        main.createDiv({ cls: 'cad-home-row-meta', text: metaBits.join(' · ') });
      }
      if (entity.file) {
        row.classList.add('clickable');
        row.addEventListener('click', () => this.openEntityDetailFromFile(entity.file));
      }
    });
  }

  _normalizeBaseViewHeight(value) {
    if (value === undefined || value === null || value === '' || value === 0 || value === '0') return null;
    if (String(value).trim().toLowerCase() === 'auto') return null;
    const n = Number(value);
    return Number.isFinite(n) && n > 0 ? n : 360;
  }

  async _renderBaseViewWidget(root, card, getWidgetEntities) {
    const target = await this._resolveBaseWidgetTarget(card);
    const { basePath, viewName, label } = target;

    if (!basePath) {
      await this._renderBaseViewFallback(root, card, getWidgetEntities, 'No Base file configured');
      return;
    }

    const file = this.app.vault.getAbstractFileByPath(basePath);
    if (!(file instanceof obsidian.TFile)) {
      await this._renderBaseViewFallback(root, card, getWidgetEntities, `Base file not found: ${basePath}`);
      return;
    }

    const cardEl = root.createDiv({ cls: 'cad-dash-card cad-base-view-card' });
    this._applyCardTone(cardEl, Object.assign({ kind: 'base-view' }, card));
    const head = cardEl.createDiv({ cls: 'cad-dash-card-head' });
    head.createDiv({ cls: 'cad-dash-card-title', text: label || card.title || 'Base view' });
    if (viewName) head.createSpan({ cls: 'cad-widget-catalog-badge', text: viewName });

    const body = cardEl.createDiv({ cls: 'cad-dash-card-body cad-base-view-body' });
    const normalizedHeight = this._normalizeBaseViewHeight(card.height);
    if (normalizedHeight) body.style.height = `${normalizedHeight}px`;

    try {
      await this._mountLiveBaseView(body, file, basePath, viewName);
    } catch (err) {
      body.empty();
      await this._renderBaseViewFallbackContent(body, card, getWidgetEntities, err?.message || String(err || 'Base view unavailable'));
    }
  }

  async _mountLiveBaseView(body, file, basePath, viewName) {
    const linktext = viewName ? `${basePath}#${viewName}` : basePath;
    const md = `![[${linktext}]]`;
    if (obsidian.MarkdownRenderer?.renderMarkdown) {
      try {
        await obsidian.MarkdownRenderer.renderMarkdown(md, body, basePath, this);
        await this._waitForBaseEmbedRender();
        if (this._hasLiveBaseEmbedContent(body, md, linktext)) return;
      } finally {
        if (!this._hasLiveBaseEmbedContent(body, md, linktext)) body.empty();
      }
    }
    await this._mountLiveBaseViewViaEmbedRegistry(body, file, basePath, viewName);
  }

  async _waitForBaseEmbedRender() {
    await new Promise((resolve) => setTimeout(resolve, 0));
    await new Promise((resolve) => {
      const raf = typeof requestAnimationFrame === 'function'
        ? requestAnimationFrame
        : (typeof window !== 'undefined' && typeof window.requestAnimationFrame === 'function' ? window.requestAnimationFrame.bind(window) : null);
      if (raf) raf(resolve);
      else setTimeout(resolve, 0);
    });
  }

  _hasLiveBaseEmbedContent(body, md, linktext) {
    const renderedText = String(body.textContent || '').trim();
    const basePathOnly = String(linktext || '').split('#')[0] || '';
    if (!body.childElementCount) return false;
    if (renderedText === md || renderedText === linktext) return false;
    if (basePathOnly && renderedText === basePathOnly) return false;
    if (basePathOnly && renderedText.replace(/\s+/g, ' ').trim() === basePathOnly) return false;
    const baseEmbed = body.querySelector?.([
      '.bases-embed',
      '.base-embed',
      '.bases-view',
      '.bases-embed-container',
      '.bases-view-container',
      '[data-type="base"]',
      '[data-embed-type="base"]',
      '[src$=".base"]',
    ].join(','));
    if (baseEmbed) return true;
    const genericEmbed = body.querySelector?.('.internal-embed, .markdown-embed, .file-embed');
    if (!genericEmbed) return false;
    const genericText = String(genericEmbed.textContent || '').replace(/\s+/g, ' ').trim();
    if (!genericText) return false;
    if (genericText === md || genericText === linktext || genericText === basePathOnly) return false;
    if (basePathOnly && genericText.includes(basePathOnly) && genericText.length <= basePathOnly.length + 24) return false;
    return genericText.length > 0;
  }

  async _mountLiveBaseViewViaEmbedRegistry(body, file, basePath, viewName) {
    const reg = this.app.embedRegistry;
    const creator = reg?.embedByExtension?.base || reg?.getEmbedCreator?.(file);
    if (!creator) throw new Error('Base embed creator unavailable');
    const linktext = viewName ? `${basePath}#${viewName}` : basePath;
    const embed = creator(
      { app: this.app, containerEl: body, sourcePath: basePath, linktext, showInline: true, depth: 0 },
      file,
      viewName || ''
    );
    if (!embed) throw new Error('Base embed creator returned no embed');
    if (typeof this.addChild === 'function') this.addChild(embed);
    await (embed.loadFile?.() ?? embed.load?.());
    await this._waitForBaseEmbedRender();
    const linktextAfterLoad = viewName ? `${basePath}#${viewName}` : basePath;
    const mdAfterLoad = `![[${linktextAfterLoad}]]`;
    if (!this._hasLiveBaseEmbedContent(body, mdAfterLoad, linktextAfterLoad)) {
      throw new Error('Base embed creator did not render an inline view');
    }
  }

  async _renderBaseViewFallback(root, card, getWidgetEntities, reason) {
    const mode = String(card.fallback || 'preview').trim().toLowerCase();
    if (mode === 'preview') {
      await this._renderBaseEmbedWidget(root, card, getWidgetEntities);
      return;
    }
    if (mode === 'link') {
      await this._renderBaseLinkWidget(root, card, getWidgetEntities);
      return;
    }
    const fallbackCard = root.createDiv({ cls: 'cad-dash-card cad-base-view-card cad-base-view-fallback' });
    this._applyCardTone(fallbackCard, Object.assign({ kind: 'base-view' }, card));
    const head = fallbackCard.createDiv({ cls: 'cad-dash-card-head' });
    head.createDiv({ cls: 'cad-dash-card-title', text: card.title || 'Base view' });
    fallbackCard.createDiv({ cls: 'cad-dash-card-body' })
      .createDiv({ cls: 'cad-soon-desc', text: `Base view unavailable (${reason})` });
  }

  async _renderBaseViewFallbackContent(body, card, getWidgetEntities, reason) {
    const mode = String(card.fallback || 'preview').trim().toLowerCase();
    if (mode === 'link') {
      const target = await this._resolveBaseWidgetTarget(card);
      body.createDiv({ cls: 'cad-soon-desc', text: reason });
      if (target.basePath) {
        const btn = body.createEl('button', { cls: 'cad-btn cad-btn-sm', text: 'Open Base' });
        btn.addEventListener('click', () => this.app.workspace.openLinkText(target.basePath, '', false));
      }
      return;
    }
    if (mode === 'preview' && typeof getWidgetEntities === 'function') {
      const target = await this._resolveBaseWidgetTarget(card);
      const resolved = target.entityKey
        ? await getWidgetEntities(this._widgetSourceSpec(card, target.entityKey), target.entityKey).catch(() => null)
        : null;
      const entities = Array.isArray(resolved?.entities) ? resolved.entities : [];
      const rows = entities.slice(0, Math.max(1, Number(card.limit || 5) || 5));
      body.createDiv({ cls: 'cad-soon-desc', text: reason });
      if (rows.length) {
        const list = body.createDiv({ cls: 'cad-base-embed-list cad-base-view-preview-list' });
        rows.forEach((entity) => {
          const row = list.createDiv({ cls: 'cad-base-embed-row' });
          row.createDiv({ cls: 'cad-home-row-title', text: entity?.title || entity?.name || entity?.file?.basename || entity?.basename || 'Untitled' });
          if (entity?.file) {
            row.classList.add('clickable');
            row.addEventListener('click', () => this.openEntityDetailFromFile(entity.file));
          }
        });
      } else {
        body.createDiv({ cls: 'cad-empty', text: 'No rows available for preview.' });
      }
      if (target.basePath) {
        const btn = body.createEl('button', { cls: 'cad-btn cad-btn-sm', text: 'Open Base' });
        btn.addEventListener('click', () => this.app.workspace.openLinkText(target.basePath, '', false));
      }
      return;
    }
    body.createDiv({ cls: 'cad-soon-desc', text: `Base view unavailable (${reason})` });
  }

  async _resolveMarkdownWidgetContent(card) {
    const source = card.source;
    const body = String(card.body || card.markdown || card.text || '').trim();
    const heading = String(card.heading || card.section || '').trim();
    if (body) return { text: body, sourcePath: '' };

    const sourcePath = typeof source === 'string'
      ? source
      : String(source?.file || source?.path || source?.note || source?.source || '').trim();
    if (!sourcePath) return { text: '', sourcePath: '' };

    const file = this.app.vault.getAbstractFileByPath(sourcePath);
    if (!(file instanceof obsidian.TFile)) return { text: '', sourcePath };
    let content;
    try { content = await this.app.vault.read(file); }
    catch (_) { return { text: '', sourcePath: file.path }; } // file removed mid-render
    if (!heading) return { text: content, sourcePath: file.path };

    const sections = parseH2Sections(content);
    if (sections[heading] != null) return { text: sections[heading], sourcePath: file.path };
    const normalizedHeading = heading.toLowerCase();
    const match = Object.entries(sections).find(([key]) => key.trim().toLowerCase() === normalizedHeading);
    return { text: match ? match[1] : content, sourcePath: file.path };
  }

  async _renderMarkdownWidget(root, card) {
    const title = String(card.title || 'Note').trim();
    const subtitle = String(card.subtitle || card.description || '').trim();
    const { text, sourcePath } = await this._resolveMarkdownWidgetContent(card);
    const cardEl = root.createDiv({ cls: 'cad-dash-card cad-markdown-card' });
    this._applyCardTone(cardEl, Object.assign({ kind: 'markdown' }, card));
    const head = cardEl.createDiv({ cls: 'cad-dash-card-head' });
    head.createDiv({ cls: 'cad-dash-card-title', text: title });
    if (sourcePath) head.createSpan({ cls: 'cad-widget-catalog-badge', text: sourcePath.split('/').pop().replace(/\.md$/i, '') });
    const body = cardEl.createDiv({ cls: 'cad-dash-card-body cad-markdown-body' });
    if (subtitle) body.createDiv({ cls: 'cad-dash-card-sub', text: subtitle });
    if (!text) {
      body.createDiv({ cls: 'cad-empty', text: 'No markdown content supplied.' });
      return;
    }
    const target = body.createDiv({ cls: 'cad-markdown-render' });
    try {
      if (obsidian.MarkdownRenderer?.renderMarkdown) {
        await obsidian.MarkdownRenderer.renderMarkdown(text, target, sourcePath || '', this);
      } else {
        target.createEl('pre', { text });
      }
    } catch (_) {
      target.createEl('pre', { text });
    }
  }

  _normalizeActionSpec(action) {
    if (!action) return null;
    if (typeof action === 'string') return { label: action, command: action };
    if (typeof action !== 'object' || Array.isArray(action)) return null;
    const spec = Object.assign({}, action);
    spec.label = String(spec.label || spec.title || spec.text || spec.name || 'Action').trim();
    spec.type = String(spec.type || spec.kind || spec.action || '').trim().toLowerCase();
    spec.command = String(spec.command || spec.commandId || spec.cmd || '').trim();
    spec.surface = String(spec.surface || spec.mode || spec.route || spec.view || '').trim();
    spec.entityKey = String(spec.entityKey || spec.entity || '').trim();
    spec.path = String(spec.path || spec.file || spec.note || '').trim();
    spec.url = String(spec.url || spec.href || '').trim();
    return spec;
  }

  async _runActionSpec(action) {
    const spec = this._normalizeActionSpec(action);
    if (!spec) return;
    if (spec.type === 'surface' || spec.surface) {
      this.setMode(spec.surface);
      return;
    }
    if (spec.type === 'quick-capture' || spec.label.toLowerCase() === 'quick capture') {
      this.plugin.openQuickCapture();
      return;
    }
    if (spec.type === 'today-task') {
      this._quickAddTodayTask();
      return;
    }
    if (spec.type === 'command' || spec.command) {
      if (spec.command) {
        try {
          await this.app.commands.executeCommandById(spec.command);
        } catch (e) {
          new obsidian.Notice(`Failed to run command: ${e.message}`);
        }
      }
      return;
    }
    if (spec.type === 'url' || spec.url) {
      if (spec.url) window.open(spec.url, '_blank', 'noopener,noreferrer');
      return;
    }
    if (spec.type === 'note' || spec.path) {
      if (!spec.path) return;
      const file = this.app.vault.getAbstractFileByPath(spec.path);
      if (file instanceof obsidian.TFile) {
        await this.app.workspace.openLinkText(file.path, '', false);
      } else {
        new obsidian.Notice(`Note not found: ${spec.path}`);
      }
      return;
    }
    if (spec.type === 'create' || spec.type === 'create-entity' || spec.entityKey) {
      if (!spec.entityKey) return;
      await this._createEntityFromPrompt(spec.entityKey);
      return;
    }
  }

  async _renderActionsWidget(root, card) {
    const actions = Array.isArray(card.actions)
      ? card.actions
      : Array.isArray(card.buttons)
        ? card.buttons
        : [];
    const cardEl = root.createDiv({ cls: 'cad-dash-card cad-actions-card' });
    this._applyCardTone(cardEl, Object.assign({ kind: 'actions' }, card));
    const title = String(card.title || '').trim();
    if (title) {
      const head = cardEl.createDiv({ cls: 'cad-dash-card-head' });
      head.createDiv({ cls: 'cad-dash-card-title', text: title });
    }
    const body = cardEl.createDiv({ cls: 'cad-dash-card-body' });
    if (card.description || card.subtitle) {
      body.createDiv({ cls: 'cad-dash-card-sub', text: String(card.description || card.subtitle || '').trim() });
    }
    const bar = body.createDiv({ cls: 'cad-actions-bar' });
    if (!actions.length) {
      bar.createDiv({ cls: 'cad-empty', text: 'No actions configured.' });
      return;
    }
    actions.map((action) => this._normalizeActionSpec(action)).filter(Boolean).forEach((action) => {
      const isCreate = !!action.entityKey;
      const isPrimaryAction = action.type === 'quick-capture' || action.type === 'today-task' || isCreate || !!action.primary;
      const btn = bar.createEl('button', {
        cls: `cad-btn${(isPrimaryAction ? ' primary' : '')}${action.danger ? ' cad-btn-danger' : ''}`,
        text: action.entityKey
          ? `+ New ${ENTITIES[action.entityKey]?.label || action.entityKey}`
          : (action.type === 'quick-capture' ? '+ Capture' : action.label),
      });
      if (action.description) btn.title = action.description;
      btn.addEventListener('click', async () => { await this._runActionSpec(action); });
    });
  }

  async _renderProductivitySummaryWidget(root) {
    const snap = await this._productivitySnapshot();
    const card = root.createDiv({ cls: 'cad-dash-card' });
    card.createDiv({ cls: 'cad-dash-card-head' }).createDiv({ cls: 'cad-dash-card-title', text: 'PRODUCTIVITY SUMMARY' });
    const body = card.createDiv({ cls: 'cad-dash-card-body' });
    const grid = body.createDiv({ cls: 'cad-stat-grid' });
    const stat = (label, value, sub, accent) => {
      const c = grid.createDiv({ cls: 'cad-stat-card' });
      if (accent) c.dataset.accent = accent;
      c.createDiv({ cls: 'cad-stat-label', text: label });
      c.createDiv({ cls: 'cad-stat-value', text: String(value) });
      if (sub) c.createDiv({ cls: 'cad-stat-sub', text: sub });
    };
    const taskSource = snap.taskMode === 'tasknotes' ? 'TaskNotes' : snap.taskMode === 'hybrid' ? 'daily notes + TaskNotes' : 'daily notes';
    stat('COMPLETION', `${snap.completion}%`, `${snap.totalDone}/${snap.totalOpen + snap.totalDone} tasks`, 'emerald');
    stat('STREAK', `${snap.streak}d`, 'consecutive active days', 'mint');
    stat('ACTIVE', `${snap.activeDays}/30`, 'days with a note', 'sky');
    stat('JOURNAL', snap.totalJournalChars.toLocaleString(), `${taskSource} activity`, 'warn');
  }

  async _renderProductivityTrendWidget(root) {
    const snap = await this._productivitySnapshot();
    const card = root.createDiv({ cls: 'cad-dash-card' });
    card.createDiv({ cls: 'cad-dash-card-head' }).createDiv({ cls: 'cad-dash-card-title', text: 'PRODUCTIVITY TREND' });
    const body = card.createDiv({ cls: 'cad-dash-card-body' });
    body.createDiv({ cls: 'cad-section-label-lg', text: 'TASKS DONE — LAST 14 DAYS' });
    const last14 = snap.perDay.slice(0, 14).reverse();
    const max = Math.max(1, ...last14.map((p) => p.done));
    const chart = body.createDiv({ cls: 'cad-bar-chart' });
    last14.forEach((p) => {
      const col = chart.createDiv({ cls: 'cad-bar-col' });
      const bar = col.createDiv({ cls: 'cad-bar' });
      bar.style.height = `${(p.done / max) * 100}%`;
      const ratio = p.done / max;
      bar.dataset.band = p.done === 0 ? 'empty' : ratio < 0.34 ? 'low' : ratio < 0.67 ? 'mid' : 'high';
      bar.title = `${p.date.toLocaleDateString()} — ${p.done} done, ${p.open} open`;
      col.createDiv({ cls: 'cad-bar-label', text: String(p.date.getDate()) });
    });

    body.createDiv({ cls: 'cad-section-label-lg', text: 'COMPLETION TREND — LAST 12 WEEKS' });
    const wkChart = body.createDiv({ cls: 'cad-bar-chart cad-bar-chart-tall' });
    const maxWeek = Math.max(1, ...snap.weeks.map((w) => w.done));
    snap.weeks.forEach((w) => {
      const col = wkChart.createDiv({ cls: 'cad-bar-col' });
      const bar = col.createDiv({ cls: 'cad-bar' });
      bar.style.height = `${(w.done / maxWeek) * 100}%`;
      const ratio = w.done / maxWeek;
      bar.dataset.band = w.done === 0 ? 'empty' : ratio < 0.34 ? 'low' : ratio < 0.67 ? 'mid' : 'high';
      bar.title = `Week of ${w.label} — ${w.done} done, ${w.open} open`;
      col.createDiv({ cls: 'cad-bar-label', text: w.label });
    });
  }

  async _renderProductivityWeekdayWidget(root) {
    const snap = await this._productivitySnapshot();
    const card = root.createDiv({ cls: 'cad-dash-card' });
    card.createDiv({ cls: 'cad-dash-card-head' }).createDiv({ cls: 'cad-dash-card-title', text: 'COMPLETION BY WEEKDAY' });
    const body = card.createDiv({ cls: 'cad-dash-card-body cad-mini-stat-row' });
    const wsOn = snap.settings.weekStartsOn;
    const dayLabels = wsOn === 1
      ? ['MON', 'TUE', 'WED', 'THU', 'FRI', 'SAT', 'SUN']
      : ['SUN', 'MON', 'TUE', 'WED', 'THU', 'FRI', 'SAT'];
    const dayAccents = ['emerald', 'mint', 'sky', 'warn', 'rose', 'mint', 'sky'];
    snap.dayBuckets.forEach((b, i) => {
      const total = b.done + b.open;
      const pct = total === 0 ? 0 : Math.round((b.done / total) * 100);
      const mini = body.createDiv({ cls: 'cad-mini-stat' });
      mini.dataset.accent = dayAccents[i];
      mini.createDiv({ cls: 'cad-mini-stat-value', text: total === 0 ? '—' : `${pct}%` });
      mini.createDiv({ cls: 'cad-mini-stat-label', text: dayLabels[i] });
      const sub = mini.createDiv({ cls: 'cad-stat-sub' });
      sub.style.marginTop = '4px';
      sub.setText(total === 0 ? 'no data' : `${b.done}/${total}`);
    });
  }

  async _renderProductivityNotesWidget(root) {
    const snap = await this._productivitySnapshot();
    const card = root.createDiv({ cls: 'cad-dash-card' });
    card.createDiv({ cls: 'cad-dash-card-head' }).createDiv({ cls: 'cad-dash-card-title', text: 'TASK NOTES' });
    const body = card.createDiv({ cls: 'cad-dash-card-body' });
    if (!snap.taskNotes.length) {
      body.createDiv({ cls: 'cad-empty', text: 'No TaskNotes in the selected range.' });
      return;
    }
    const list = body.createDiv({ cls: 'cad-home-list' });
    snap.taskNotes.slice(0, 10).forEach((task) => {
      const row = list.createDiv({ cls: 'cad-home-row' });
      row.createDiv({ cls: 'cad-home-row-title', text: task.text || task.title || 'Task note' });
      row.createDiv({ cls: 'cad-home-row-meta', text: `${task.date || '—'} · ${task.done ? 'done' : 'open'}` });
      if (task.file) row.addEventListener('click', () => this.openEntityDetailFromFile(task.file));
    });
  }

  async _renderSelectorWidget(root, card, getWidgetEntities) {
    const surfaceId = this.mode;
    const state = this._dashboardStateFor(surfaceId);
    const key = String(card.key || card.name || card.field || card.entity || '').trim();
    const label = String(card.label || card.title || key || 'Filter').trim();
    const filterKey = `${key}Filter`;
    const dateRangeMode = String(card.mode || card.type || '').trim().toLowerCase() === 'date-range';
    if (!key) {
      const cardEl = root.createDiv({ cls: 'cad-dash-card cad-selector-card' });
      this._applyCardTone(cardEl, Object.assign({ kind: 'selector' }, card));
      const body = cardEl.createDiv({ cls: 'cad-dash-card-body' });
      body.createDiv({ cls: 'cad-empty', text: 'Selector needs a key.' });
      return;
    }

    const cardEl = root.createDiv({ cls: 'cad-dash-card cad-selector-card' });
    this._applyCardTone(cardEl, Object.assign({ kind: 'selector' }, card));
    const head = cardEl.createDiv({ cls: 'cad-dash-card-head' });
    head.createDiv({ cls: 'cad-dash-card-title', text: label });
    const body = cardEl.createDiv({ cls: 'cad-dash-card-body' });
    if (card.description || card.subtitle) {
      body.createDiv({ cls: 'cad-dash-card-sub', text: String(card.description || card.subtitle || '').trim() });
    }

    const row = body.createDiv({ cls: 'cad-selector-row' });
    const select = row.createEl('select', { cls: 'dropdown cad-selector-select' });

    const options = [];
    const allLabel = String(card.allLabel || 'All').trim();
    options.push({ value: '', label: allLabel, filter: 'true' });

    if (dateRangeMode) {
      const today = startOfDay(new Date());
      const y = today.getFullYear();
      const m = today.getMonth();
      const startOfMonth = startOfDay(new Date(y, m, 1));
      const endOfMonth = startOfDay(new Date(y, m + 1, 0));
      const weekStart = startOfWeek(today, this.plugin.settings.weekStartsOn || 1);
      const weekEnd = addDays(weekStart, 6);
      const q = Math.floor(m / 3);
      const quarterStart = startOfDay(new Date(y, q * 3, 1));
      const quarterEnd = startOfDay(new Date(y, q * 3 + 3, 0));
      const addRange = (value, labelText, from, to) => {
        const field = String(card.field || 'date').trim();
        options.push({
          value,
          label: labelText,
          filter: `${field} >= ${JSON.stringify(ymd(from))} && ${field} <= ${JSON.stringify(ymd(to))}`,
        });
      };
      addRange('today', 'Today', today, today);
      addRange('this-week', 'This week', weekStart, weekEnd);
      addRange('this-month', 'This month', startOfMonth, endOfMonth);
      addRange('last-30-days', 'Last 30 days', addDays(today, -29), today);
      addRange('this-quarter', 'This quarter', quarterStart, quarterEnd);
    } else if (Array.isArray(card.options) && card.options.length) {
      card.options.forEach((opt) => {
        if (opt == null) return;
        if (typeof opt === 'string' || typeof opt === 'number') {
          const value = String(opt);
          options.push({ value, label: value, filter: `${String(card.field || '').trim()} == ${JSON.stringify(value)}` });
          return;
        }
        if (typeof opt === 'object') {
          const value = String(opt.value ?? opt.id ?? opt.key ?? opt.label ?? '').trim();
          if (!value) return;
          options.push({
            value,
            label: String(opt.label || opt.title || value).trim(),
            filter: String(opt.filter || `${String(card.field || '').trim()} == ${JSON.stringify(value)}`),
          });
        }
      });
    } else if (card.entity && card.field) {
      const resolved = await getWidgetEntities(this._widgetSourceSpec(card, card.entity), card.entity).catch(() => null);
      const entities = resolved?.entities || [];
      const def = resolved?.def || ENTITIES[card.entity];
      const fieldKey = String(card.field || '').trim();
      const values = new Set();
      entities.forEach((entity) => {
        const raw = entityValue(entity, fieldKey, def);
        const valuesList = Array.isArray(raw) ? raw : [raw];
        valuesList.forEach((value) => {
          const normalized = String(value ?? '').trim();
          if (normalized) values.add(normalized);
        });
      });
      [...values].sort((a, b) => a.localeCompare(b, undefined, { numeric: true, sensitivity: 'base' })).forEach((value) => {
        options.push({ value, label: value, filter: `${fieldKey} == ${JSON.stringify(value)}` });
      });
    }

    options.forEach((opt) => {
      const option = select.createEl('option', { value: opt.value, text: opt.label });
      if ((state[key] ?? String(card.default || '').trim()) === opt.value) option.selected = true;
    });

    const syncState = () => {
      const selected = options.find((opt) => opt.value === select.value) || options[0] || { value: '', filter: 'true' };
      state[key] = selected.value;
      state[filterKey] = selected.filter || 'true';
    };
    syncState();
    select.addEventListener('change', async () => {
      syncState();
      await this._persistDashboardState();
      await this.render();
    });

    const hint = body.createDiv({ cls: 'cad-selector-hint' });
    hint.createSpan({ text: `${key}: ` });
    hint.createSpan({ cls: 'cad-selector-current', text: select.value || allLabel });
  }

  async _renderDateRangeWidget(root, card) {
    const surfaceId = this.mode;
    const state = this._dashboardStateFor(surfaceId);
    const key = String(card.key || card.name || card.field || 'dateRange').trim();
    const label = String(card.label || card.title || key || 'Date range').trim();
    const field = String(card.field || 'date').trim();
    const filterKey = `${key}Filter`;
    const startKey = `${key}Start`;
    const endKey = `${key}End`;
    const presetKey = `${key}Preset`;
    const current = String(state[presetKey] || card.default || 'this-month').trim() || 'this-month';
    const cardEl = root.createDiv({ cls: 'cad-dash-card cad-selector-card' });
    this._applyCardTone(cardEl, Object.assign({ kind: 'date-range' }, card));
    const head = cardEl.createDiv({ cls: 'cad-dash-card-head' });
    head.createDiv({ cls: 'cad-dash-card-title', text: label });
    const body = cardEl.createDiv({ cls: 'cad-dash-card-body' });
    if (card.description || card.subtitle) {
      body.createDiv({ cls: 'cad-dash-card-sub', text: String(card.description || card.subtitle || '').trim() });
    }

    const presets = [
      { value: 'all', label: String(card.allLabel || 'All').trim(), from: '', to: '', filter: 'true' },
      { value: 'today', label: 'Today', from: startOfDay(new Date()), to: startOfDay(new Date()) },
      { value: 'this-week', label: 'This week', from: startOfWeek(new Date(), this.plugin.settings.weekStartsOn || 1), to: addDays(startOfWeek(new Date(), this.plugin.settings.weekStartsOn || 1), 6) },
      { value: 'this-month', label: 'This month', from: startOfDay(new Date(new Date().getFullYear(), new Date().getMonth(), 1)), to: startOfDay(new Date(new Date().getFullYear(), new Date().getMonth() + 1, 0)) },
      { value: 'last-30-days', label: 'Last 30 days', from: addDays(startOfDay(new Date()), -29), to: startOfDay(new Date()) },
      { value: 'this-quarter', label: 'This quarter', from: startOfDay(new Date(new Date().getFullYear(), Math.floor(new Date().getMonth() / 3) * 3, 1)), to: startOfDay(new Date(new Date().getFullYear(), Math.floor(new Date().getMonth() / 3) * 3 + 3, 0)) },
      { value: 'custom', label: 'Custom', from: state[startKey] ? new Date(state[startKey]) : '', to: state[endKey] ? new Date(state[endKey]) : '' },
    ];

    const toYmd = (value) => {
      const d = value instanceof Date ? value : new Date(value);
      return isNaN(d.getTime()) ? '' : ymd(d);
    };
    const updateFromPreset = (presetValue) => {
      const preset = presets.find((item) => item.value === presetValue) || presets[3];
      state[presetKey] = preset.value;
      state[key] = preset.value;
      if (preset.value === 'all') {
        delete state[startKey];
        delete state[endKey];
        state[filterKey] = 'true';
        return;
      }
      if (preset.value === 'custom') {
        const start = state[startKey] ? toYmd(state[startKey]) : '';
        const end = state[endKey] ? toYmd(state[endKey]) : '';
        state[filterKey] = start && end ? `${field} >= ${JSON.stringify(start)} && ${field} <= ${JSON.stringify(end)}` : 'true';
        return;
      }
      const from = toYmd(preset.from);
      const to = toYmd(preset.to);
      state[startKey] = from;
      state[endKey] = to;
      state[filterKey] = from && to ? `${field} >= ${JSON.stringify(from)} && ${field} <= ${JSON.stringify(to)}` : 'true';
    };
    if (!state[presetKey]) updateFromPreset(current);

    const presetRow = body.createDiv({ cls: 'cad-selector-row' });
    const presetSelect = presetRow.createEl('select', { cls: 'dropdown cad-selector-select' });
    presets.forEach((preset) => {
      const option = presetSelect.createEl('option', { value: preset.value, text: preset.label });
      if ((state[presetKey] || current) === preset.value) option.selected = true;
    });

    const rangeWrap = body.createDiv({ cls: 'cad-date-range' });
    const startInput = rangeWrap.createEl('input', { type: 'date', cls: 'cad-selector-date' });
    const endInput = rangeWrap.createEl('input', { type: 'date', cls: 'cad-selector-date' });
    startInput.value = state[startKey] || '';
    endInput.value = state[endKey] || '';
    startInput.disabled = (state[presetKey] || current) !== 'custom';
    endInput.disabled = (state[presetKey] || current) !== 'custom';

    const renderState = async () => {
      await this._persistDashboardState();
      await this.render();
    };
    presetSelect.addEventListener('change', async () => {
      updateFromPreset(presetSelect.value);
      startInput.disabled = presetSelect.value !== 'custom';
      endInput.disabled = presetSelect.value !== 'custom';
      await renderState();
    });
    const commitCustom = async () => {
      state[presetKey] = 'custom';
      state[key] = 'custom';
      state[startKey] = startInput.value || '';
      state[endKey] = endInput.value || '';
      state[filterKey] = startInput.value && endInput.value
        ? `${field} >= ${JSON.stringify(startInput.value)} && ${field} <= ${JSON.stringify(endInput.value)}`
        : 'true';
      await renderState();
    };
    startInput.addEventListener('change', commitCustom);
    endInput.addEventListener('change', commitCustom);

    const hint = body.createDiv({ cls: 'cad-selector-hint' });
    hint.createSpan({ text: `${key}: ` });
    hint.createSpan({ cls: 'cad-selector-current', text: state[presetKey] || current });
  }

  async _renderKanbanWidget(root, card, getWidgetEntities) {
    const resolved = await getWidgetEntities(this._widgetSourceSpec(card, card.entity), card.entity);
    const def = resolved.def || ENTITIES[resolved.entityKey || card.entity];
    const entities = resolved.entities || [];
    const entityKey = resolved.entityKey || card.entity;
    if (!def || !entityKey) return;

    const groupBy = String(card.groupBy || card.group || card.field || dealStageField(def) || 'stage').trim();
    const valueField = String(card.valueField || dealValueField(def) || '').trim();
    const titleFields = Array.isArray(card.cardTitleFields) && card.cardTitleFields.length
      ? card.cardTitleFields
      : (Array.isArray(card.titleFields) && card.titleFields.length ? card.titleFields : ['title', 'name']);
    const metaFields = Array.isArray(card.cardMetaFields) && card.cardMetaFields.length
      ? card.cardMetaFields
      : (Array.isArray(card.metaFields) && card.metaFields.length ? card.metaFields : [groupBy, valueField, 'company'].filter(Boolean));
    const sortMode = String(card.sort || 'mtime-desc').trim().toLowerCase();

    const normalizeGroup = (entry) => {
      if (entry == null) return null;
      if (typeof entry === 'object' && !Array.isArray(entry)) {
        const value = String(entry.value ?? entry.id ?? entry.key ?? entry.label ?? '').trim();
        if (!value) return null;
        return {
          value,
          label: String(entry.label || entry.title || value).trim(),
          empty: String(entry.empty || entry.description || '').trim(),
          description: String(entry.description || '').trim(),
          limit: entry.limit != null ? Number(entry.limit) : null,
          wipLimit: entry.wipLimit != null ? Number(entry.wipLimit) : null,
        };
      }
      const value = String(entry).trim();
      if (!value) return null;
      return { value, label: value, empty: '' };
    };

    let groups = [];
    if (Array.isArray(card.columns) && card.columns.length) {
      groups = card.columns.map(normalizeGroup).filter(Boolean);
    } else if (Array.isArray(card.groups) && card.groups.length) {
      groups = card.groups.map(normalizeGroup).filter(Boolean);
    } else {
      const optionField = def.fields?.find((field) => field.key === groupBy);
      if (Array.isArray(optionField?.options) && optionField.options.length) {
        groups = optionField.options.map(normalizeGroup).filter(Boolean);
      } else {
        groups = [...new Set(entities.map((entity) => String(entityValue(entity, groupBy, def) || '').trim()).filter(Boolean))]
          .sort((a, b) => a.localeCompare(b))
          .map((value) => ({ value, label: value, empty: '' }));
      }
    }
    if (!groups.length) groups = [{ value: '(blank)', label: '(blank)', empty: '' }];

    const orderForSort = new Map(groups.map((group, idx) => [group.value, idx]));
    const sortEntities = (items) => {
      const sorted = [...items];
      if (sortMode === 'title') {
        sorted.sort((a, b) => String(entityPrimaryValue(a, def)).localeCompare(String(entityPrimaryValue(b, def))));
      } else if (sortMode === 'value-asc' && valueField) {
        sorted.sort((a, b) => (Number(entityValue(a, valueField, def)) || 0) - (Number(entityValue(b, valueField, def)) || 0));
      } else if (sortMode === 'value-desc' && valueField) {
        sorted.sort((a, b) => (Number(entityValue(b, valueField, def)) || 0) - (Number(entityValue(a, valueField, def)) || 0));
      } else if (sortMode === 'group') {
        sorted.sort((a, b) => {
          const av = String(entityValue(a, groupBy, def) || '');
          const bv = String(entityValue(b, groupBy, def) || '');
          return (orderForSort.get(av) ?? 999) - (orderForSort.get(bv) ?? 999);
        });
      } else {
        sorted.sort((a, b) => (b.file?.stat?.mtime || 0) - (a.file?.stat?.mtime || 0));
      }
      return sorted;
    };

    const board = root.createDiv({ cls: 'cad-kanban-board' });
    const isMobile = !!(obsidian.Platform && obsidian.Platform.isMobile);
    let activeDragPath = null;
    groups.forEach((group) => {
      const items = entities.filter((e) => String(entityValue(e, groupBy, def) || '').trim() === group.value);
      const columnValue = items.reduce((sum, e) => sum + (Number(entityValue(e, valueField, def)) || 0), 0);
      const groupLimit = Number(group.limit || group.wipLimit || card.wipLimit || 0);
      const overLimit = groupLimit > 0 && items.length > groupLimit;

      const col = board.createDiv({ cls: 'cad-kanban-col' });
      if (overLimit) col.addClass('cad-kanban-col-over-limit');
      col.dataset.stage = group.value;
      const head = col.createDiv({ cls: 'cad-kanban-col-head' });
      head.createDiv({ cls: 'cad-kanban-col-title', text: group.label });
      const headMeta = head.createDiv({ cls: 'cad-kanban-col-meta' });
      headMeta.setText(`${items.length}${valueField ? ` · ${fmtValue(columnValue, 'currency')}` : ''}`);
      if (groupLimit > 0) {
        const limitChip = head.createSpan({ cls: 'cad-kanban-col-limit', text: `${items.length}/${groupLimit}` });
        if (overLimit) limitChip.addClass('is-over-limit');
      }
      if (group.description) {
        col.createDiv({ cls: 'cad-kanban-col-description', text: group.description });
      }

      const list = col.createDiv({ cls: 'cad-kanban-col-list' });
      const onDropEntity = async (filePath) => {
        if (!filePath || !groupBy) return;
        try {
          const file = this.app.vault.getAbstractFileByPath(filePath);
          if (!(file instanceof obsidian.TFile)) return;
          await this.app.fileManager.processFrontMatter(file, (fm) => {
            fm[groupBy] = group.value;
          });
          new obsidian.Notice(`Moved to ${group.label}`);
        } catch (e) {
          new obsidian.Notice(`Failed to move: ${e.message}`);
        }
      };
      const allowDrop = (event) => {
        const hasPath = !!event.dataTransfer?.getData('text/cadence-entity') || !!activeDragPath;
        if (!hasPath) return false;
        event.preventDefault();
        event.stopPropagation();
        event.dataTransfer.dropEffect = 'move';
        col.addClass('drag-over');
        return true;
      };
      col.addEventListener('dragover', allowDrop);
      col.addEventListener('dragleave', () => col.removeClass('drag-over'));
      col.addEventListener('drop', async (event) => {
        if (!allowDrop(event)) return;
        col.removeClass('drag-over');
        const filePath = activeDragPath || event.dataTransfer?.getData('text/cadence-entity');
        activeDragPath = null;
        await onDropEntity(filePath);
      });
      if (!items.length) {
        list.createDiv({ cls: 'cad-empty', text: group.empty || '—' });
        return;
      }
      sortEntities(items)
        .forEach((entity) => {
          const cardEl = list.createDiv({ cls: 'cad-kanban-card' });
          cardEl.dataset.path = entity.file.path;
          const title = titleFields
            .map((field) => String(entityValue(entity, field, def) || '').trim())
            .find(Boolean) || entityPrimaryValue(entity, def) || entity.basename;
          cardEl.createDiv({ cls: 'cad-kanban-card-title', text: title });
          const meta = cardEl.createDiv({ cls: 'cad-kanban-card-meta' });
          const value = valueField ? entityValue(entity, valueField, def) : null;
          if (value != null && value !== '') meta.createSpan({ cls: 'cad-kanban-card-value', text: fmtValue(value, 'currency') });
          const metaText = metaFields
            .map((field) => {
              if (!field) return '';
              if (field === valueField) return '';
              const current = entityValue(entity, field, def);
              if (current == null || current === '') return '';
              const fieldDef = def.fields?.find((f) => f.key === field);
              return fmtValue(current, fieldDef?.type || 'text');
            })
            .filter(Boolean)
            .join(' · ');
          if (metaText) meta.createSpan({ cls: 'cad-kanban-card-company', text: metaText });
          if (overLimit) cardEl.addClass('cad-kanban-card-over-limit');
          if (!isMobile) {
            cardEl.draggable = true;
            cardEl.addEventListener('dragstart', (ev) => {
              activeDragPath = entity.file.path;
              cardEl.addClass('dragging');
              try {
                ev.dataTransfer.effectAllowed = 'move';
                ev.dataTransfer.setData('text/cadence-entity', entity.file.path);
                ev.dataTransfer.setData('text/cadence-stage', group.value);
                ev.dataTransfer.setData('text/plain', `[[${entity.file.basename}]]`);
              } catch (_) {}
            });
            cardEl.addEventListener('dragend', () => {
              activeDragPath = null;
              cardEl.removeClass('dragging');
            });
          } else {
            cardEl.addClass('cad-kanban-card-touch');
          }
          cardEl.addEventListener('click', () => this.openEntityDetail(entityKey, entity.file));
      });
    });
  }

  async _renderListWidget(root, card, getWidgetEntities) {
    const rows = await this._resolveCardRows(card, getWidgetEntities);
    const cardEl = root.createDiv({ cls: 'cad-dash-card cad-list-card' });
    this._applyCardTone(cardEl, Object.assign({ kind: 'list' }, card));
    const head = cardEl.createDiv({ cls: 'cad-dash-card-head' });
    head.createDiv({ cls: 'cad-dash-card-title', text: String(card.title || card.label || 'List').trim() });
    const body = cardEl.createDiv({ cls: 'cad-dash-card-body' });
    if (card.description || card.subtitle) {
      body.createDiv({ cls: 'cad-dash-card-sub', text: String(card.description || card.subtitle || '').trim() });
    }
    if (!rows.length) {
      body.createDiv({ cls: 'cad-empty', text: String(card.empty || 'No rows').trim() });
      return;
    }
    const list = body.createDiv({ cls: 'cad-home-list cad-list-widget' });
    rows.slice(0, Math.max(1, Number(card.limit || 6) || 6)).forEach((row) => {
      const item = list.createDiv({ cls: 'cad-home-row cad-list-row' });
      const main = item.createDiv({ cls: 'cad-home-row-main' });
      main.createDiv({ cls: 'cad-home-row-title', text: row.title || 'Untitled' });
      if (row.meta) main.createDiv({ cls: 'cad-home-row-meta', text: row.meta });
      this._renderRowProgress(main, row.progress);
      if (row.file || row.surface || row.command || row.url || row.action) {
        item.classList.add('clickable');
        item.addEventListener('click', async () => {
          if (row.file) {
            if (row.entityKey) {
              this.openEntityDetail(row.entityKey, row.file);
              return;
            }
            this.openEntityDetailFromFile(row.file);
            return;
          }
          if (row.action) {
            await this._runActionSpec(row.action);
            return;
          }
          if (row.surface) {
            this.setMode(row.surface);
            return;
          }
          if (row.command) {
            await this._runActionSpec({ command: row.command });
            return;
          }
          if (row.url) {
            window.open(row.url, '_blank', 'noopener,noreferrer');
          }
        });
      }
    });
  }

  async _renderBarChartWidget(root, card, getWidgetEntities) {
    const resolved = await getWidgetEntities(this._widgetSourceSpec(card, card.entity), card.entity);
    const builtInData = resolved.metadata?.builtInData || resolved.metadata?.providerData || null;
    const builtInName = String(resolved.source?.builtIn || '').trim().toLowerCase();
    const isBuiltIn = !!builtInData && !!builtInName;
    const isProductivityBuiltIn = builtInName === 'productivity';
    const entityKey = resolved.entityKey || card.entity || (isBuiltIn ? builtInName : '');
    const def = resolved.def || ENTITIES[resolved.entityKey || card.entity] || null;
    const entities = resolved.entities || [];
    if (!def && !isBuiltIn) return;
    if (!isBuiltIn && !entityKey) return;

    const groupBy = String(card.groupBy || card.group || (isProductivityBuiltIn ? '' : card.field || (def ? dealStageField(def) : 'date'))).trim();
    const metric = String(card.metric || card.aggregate || 'count').trim().toLowerCase();
    const valueField = String(card.valueField || card.field || (isProductivityBuiltIn ? '' : (def ? dealValueField(def) : ''))).trim();
    const limit = Math.max(1, Number(card.limit || 8) || 8);
    const labels = new Map();
    const normalizeGroup = (entry) => {
      if (entry == null) return null;
      if (typeof entry === 'object' && !Array.isArray(entry)) {
        const value = String(entry.value ?? entry.id ?? entry.key ?? entry.label ?? '').trim();
        if (!value) return null;
        return { value, label: String(entry.label || entry.title || value).trim() };
      }
      const value = String(entry).trim();
      if (!value) return null;
      return { value, label: value };
    };
    let groups = [];
    if (Array.isArray(card.groups) && card.groups.length) {
      groups = card.groups.map(normalizeGroup).filter(Boolean);
    } else if (Array.isArray(card.columns) && card.columns.length) {
      groups = card.columns.map(normalizeGroup).filter(Boolean);
    } else {
      const fieldDef = def?.fields?.find((field) => field.key === groupBy);
      if (Array.isArray(fieldDef?.options) && fieldDef.options.length) {
        groups = fieldDef.options.map(normalizeGroup).filter(Boolean);
      } else {
        groups = [...new Set(entities.map((entity) => String(entityValue(entity, groupBy, def) || '').trim()).filter(Boolean))]
          .sort((a, b) => a.localeCompare(b, undefined, { numeric: true, sensitivity: 'base' }))
          .map((value) => ({ value, label: value }));
      }
    }
    if (!groups.length) groups = [{ value: '(blank)', label: '(blank)' }];
    const valuesForGroup = (groupValue) => entities.filter((entity) => String(entityValue(entity, groupBy, def) || '').trim() === groupValue);
    const numericValue = (entity) => Number(entityValue(entity, valueField, def)) || 0;
    const computeValue = (items) => {
      if (metric === 'sum') return items.reduce((sum, entity) => sum + numericValue(entity), 0);
      if (metric === 'avg') return items.length ? items.reduce((sum, entity) => sum + numericValue(entity), 0) / items.length : 0;
      if (metric === 'unique' || metric === 'uniquecount') {
        return new Set(items.map((entity) => String(entityValue(entity, valueField || groupBy, def) || '').trim()).filter(Boolean)).size;
      }
      if (metric === 'open') return items.filter((entity) => this._isOpenEntity(entity, entityKey)).length;
      return items.length;
    };
    const builtInRows = isBuiltIn
      ? this._resolveBuiltInRows(Object.assign({}, card, { source: Object.assign({}, resolved.source, { section: resolved.source?.section || card.section || '' }) }), resolved)
      : null;
    const chartValues = Array.isArray(builtInRows) && builtInRows.length
      ? builtInRows.slice(0, limit).map((row) => {
        const label = String(row.title || '').trim() || '—';
        const value = dashboardProviderRowValue(row, valueField);
        return {
          group: { value: label, label },
          items: [],
          value,
          meta: row.meta || '',
        };
      })
      : groups.map((group) => {
        const items = valuesForGroup(group.value);
        return {
          group,
          items,
          value: computeValue(items),
        };
      }).sort((a, b) => b.value - a.value).slice(0, limit);
    const max = Math.max(1, ...chartValues.map((entry) => Number(entry.value) || 0));

    const cardEl = root.createDiv({ cls: 'cad-dash-card cad-bar-chart-card' });
    this._applyCardTone(cardEl, Object.assign({ kind: 'bar-chart' }, card));
    const head = cardEl.createDiv({ cls: 'cad-dash-card-head' });
    head.createDiv({ cls: 'cad-dash-card-title', text: String(card.title || card.label || 'Bar chart').trim() });
    const badge = isProductivityBuiltIn ? (valueField || String(resolved.source?.section || card.section || '').trim()) : groupBy;
    if (badge) head.createSpan({ cls: 'cad-widget-catalog-badge', text: badge });
    const body = cardEl.createDiv({ cls: 'cad-dash-card-body' });
    if (card.description || card.subtitle) {
      body.createDiv({ cls: 'cad-dash-card-sub', text: String(card.description || card.subtitle || '').trim() });
    }
    const chart = body.createDiv({ cls: 'cad-bar-chart cad-bar-chart-tall' });
    chartValues.forEach((entry) => {
      labels.set(entry.group.value, entry.group.label);
      const col = chart.createDiv({ cls: 'cad-bar-col' });
      const bar = col.createDiv({ cls: 'cad-bar' });
      bar.style.height = `${(Number(entry.value) / max) * 100}%`;
      const ratio = Number(entry.value) / max;
      bar.dataset.band = Number(entry.value) === 0 ? 'empty' : ratio < 0.34 ? 'low' : ratio < 0.67 ? 'mid' : 'high';
      bar.title = `${entry.group.label} — ${fmtValue(entry.value, metric === 'sum' || metric === 'avg' ? 'currency' : 'number')}${entry.meta ? ` · ${entry.meta}` : ''}`;
      col.createDiv({ cls: 'cad-bar-label', text: entry.group.label });
      col.createDiv({ cls: 'cad-bar-value', text: String(entry.value) });
      if (entry.items.length && entry.items[0]?.file) {
        col.addEventListener('click', () => {
          const first = entry.items[0];
          if (first.entityKey) {
            this.openEntityDetail(first.entityKey, first.file);
            return;
          }
          this.openEntityDetailFromFile(first.file);
        });
      }
    });
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

  _renderWidgetCatalog(root) {
    const section = root.createDiv({ cls: 'cad-widget-catalog' });
    section.createDiv({ cls: 'cad-section-label-lg', text: 'Widget catalog' });
    section.createEl('p', {
      cls: 'setting-item-description',
      text: 'This catalog shows the dashboard widget shapes that can be expressed in workspace.json today, plus the gaps we still want to close.',
    });

    const grid = section.createDiv({ cls: 'cad-widget-catalog-grid' });
    DASHBOARD_WIDGET_CATALOG.forEach((entry) => {
      const card = grid.createDiv({ cls: `cad-widget-catalog-card cad-widget-catalog-${entry.status}` });
      const head = card.createDiv({ cls: 'cad-widget-catalog-head' });
      head.createDiv({ cls: 'cad-widget-catalog-title', text: entry.label });
      head.createSpan({ cls: 'cad-widget-catalog-badge', text: entry.status });
      card.createDiv({ cls: 'cad-widget-catalog-id', text: entry.id });
      card.createDiv({ cls: 'cad-widget-catalog-desc', text: entry.description });
      const chips = card.createDiv({ cls: 'cad-widget-catalog-chips' });
      entry.config.forEach((key) => chips.createSpan({ cls: 'cad-widget-catalog-chip', text: key }));
      if (entry.examples?.length) {
        const ex = card.createDiv({ cls: 'cad-widget-catalog-examples' });
        ex.createSpan({ cls: 'cad-widget-catalog-examples-label', text: 'Examples' });
        ex.createSpan({ cls: 'cad-widget-catalog-examples-value', text: entry.examples.join(' · ') });
      }
    });

    const gap = section.createDiv({ cls: 'cad-widget-gap' });
    gap.createDiv({ cls: 'cad-widget-gap-title', text: 'Configuration gap snapshot' });
    gap.createDiv({
      cls: 'setting-item-description',
      text: 'Metric stats, list, bar chart, card lists, merged sources, kanban, Base links, Base previews, markdown, actions and selectors are already config-driven. The remaining work is mostly about richer report composition, stronger Base integration, and any remaining runtime-snapshot-backed sections.',
    });
  }

  _renderDashboardInventory(root) {
    const section = root.createDiv({ cls: 'cad-dashboard-inventory' });
    section.createDiv({ cls: 'cad-section-label-lg', text: 'Built-in dashboard inventory' });
    section.createEl('p', {
      cls: 'setting-item-description',
      text: 'Use this inventory to compare the shipped dashboards against the widget catalog and see where we still rely on runtime-snapshot-backed sections.',
    });

    const grid = section.createDiv({ cls: 'cad-dashboard-inventory-grid' });
    Object.entries(BUILTIN_DASHBOARD_DEFAULTS).forEach(([id, config]) => {
      const summary = summarizeDashboardBlueprint(id, config);
      const card = grid.createDiv({ cls: 'cad-dashboard-inventory-card' });
      const head = card.createDiv({ cls: 'cad-dashboard-inventory-head' });
      head.createDiv({ cls: 'cad-dashboard-inventory-title', text: summary.title });
      head.createSpan({ cls: 'cad-dashboard-inventory-id', text: id });
      const meta = card.createDiv({ cls: 'cad-dashboard-inventory-meta' });
      meta.createSpan({ text: `kind: ${summary.kind}` });
      meta.createSpan({ text: `${summary.statsCount} stats` });
      meta.createSpan({ text: `${summary.cardCount} cards` });
      if (summary.contextFilter) meta.createSpan({ text: `context: ${summary.contextFilter}` });
      if (summary.legend) meta.createSpan({ text: `legend: ${summary.legend}` });
      const kindRow = card.createDiv({ cls: 'cad-dashboard-inventory-row' });
      kindRow.createSpan({ cls: 'cad-dashboard-inventory-label', text: 'Widgets' });
      (summary.widgetKinds.length ? summary.widgetKinds : ['none']).forEach((kind) => {
        kindRow.createSpan({ cls: 'cad-dashboard-inventory-chip', text: kind });
      });
      const sourceRow = card.createDiv({ cls: 'cad-dashboard-inventory-row' });
      sourceRow.createSpan({ cls: 'cad-dashboard-inventory-label', text: 'Sources' });
      (summary.sourceKinds.length ? summary.sourceKinds : ['n/a']).forEach((kind) => {
        sourceRow.createSpan({ cls: 'cad-dashboard-inventory-chip', text: kind });
      });
    });
  }

  _recentRows(entityKey, entities, titleFields = ['title', 'name'], metaFields = ['status'], sortSpec = null, limit = 6) {
    const def = ENTITIES[entityKey];
    const sort = normalizeWidgetSortSpec(sortSpec);
    const sorted = [...entities];
    if (sort.length) {
      sorted.sort((a, b) => compareEntitiesByBaseSort(a, b, Object.assign({}, def || {}, { baseSort: sort })));
    } else {
      sorted.sort((a, b) => (b.file?.stat?.mtime || 0) - (a.file?.stat?.mtime || 0));
    }
    return sorted
      .slice(0, Math.max(1, Number(limit) || 6))
      .map((entity) => {
        const titleField = titleFields.find((field) => entityValue(entity, field, def));
        const title = (titleField ? entityValue(entity, titleField, def) : '') || entity.basename;
        const meta = metaFields.map((field) => fmtValue(entityValue(entity, field, def), def.fields.find((f) => f.key === field)?.type)).filter(Boolean).join(' · ');
        return { title, meta: meta || 'No status', file: entity.file };
      });
  }

  _dueRows(entityKey, entities, dateFields, titleFields = ['title', 'name'], limit = 6) {
    const today = startOfDay(new Date());
    const horizon = addDays(today, 30);
    const def = ENTITIES[entityKey];
    return entities
      .map((entity) => ({ entity, date: this._dateValue(entity, entityKey, dateFields) }))
      .filter((item) => item.date && item.date.getTime() <= horizon.getTime())
      .sort((a, b) => a.date - b.date)
      .slice(0, Math.max(1, Number(limit) || 6))
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
    return this.renderConfigDashboard('client-work.dashboard', root, opts);
  }

  async renderFinanceGLDashboard(root) {
    return this.renderConfigDashboard('finance.gl.overview', root);
  }

  async renderFinanceSetupDashboard(root) {
    return this.renderConfigDashboard('finance.setup.overview', root);
  }

  async renderProcurementDashboard(root) {
    return this.renderConfigDashboard('procurement.overview', root);
  }

  async renderTaxDashboard(root) {
    return this.renderConfigDashboard('tax.dashboard', root);
  }

  async renderPartnerWorkspaceDashboard(root) {
    return this.renderConfigDashboard('prm.partners.overview', root);
  }

  async renderCampaignWorkspaceDashboard(root) {
    return this.renderConfigDashboard('crm.campaigns.overview', root);
  }

  async renderExport(root) {
    this._renderPageHeader(root, 'Export', 'Export your data to an Excel workbook');

    const section = (parent, title, desc) => {
      const s = parent.createDiv({ cls: 'cad-data-section' });
      s.createDiv({ cls: 'cad-data-section-title', text: title });
      if (desc) s.createDiv({ cls: 'cad-data-section-desc', text: desc });
      return s;
    };

    const exportGroups = workbookExportGroups();
    const exportSec = section(root, 'Export to XLSX',
      'Select one or more groups and export to an Excel workbook. Each group becomes a separate sheet.');

    const checked = new Set(exportGroups.map(g => g.id));
    if (exportGroups.length) {
      const groupsWrap = exportSec.createDiv({ cls: 'cad-data-group-list' });
      exportGroups.forEach(g => {
        const lbl = groupsWrap.createEl('label', { cls: 'cad-data-group-item' });
        const cb = lbl.createEl('input', { type: 'checkbox' });
        cb.checked = true;
        cb.addEventListener('change', () => { if (cb.checked) checked.add(g.id); else checked.delete(g.id); });
        lbl.createSpan({ text: g.label });
        lbl.createSpan({ cls: 'cad-data-group-count', text: `${g.entityKeys.length} types` });
      });
    }

    const destDesc = exportSec.createDiv({ cls: 'cad-data-section-desc' });
    destDesc.setText('Output folder: ');
    destDesc.createEl('strong', { text: workbookExportFolder(this.settings) });

    const exportRow = exportSec.createDiv({ cls: 'cad-data-action-row' });
    const exportBtnRow = exportRow.createDiv({ cls: 'cad-data-btn-row' });
    const exportBtn = exportBtnRow.createEl('button', { cls: 'cad-btn', text: 'Export workbook' });
    const exportStatus = exportRow.createDiv({ cls: 'cad-data-status' });
    exportBtn.addEventListener('click', async () => {
      const keys = exportGroups.length
        ? selectedWorkbookEntityKeys([...checked])
        : [...workspaceConfiguredEntityKeys(WORKSPACE_CONFIG)];
      if (!keys.length) { exportStatus.className = 'cad-data-status cad-data-status-error'; exportStatus.setText('Nothing to export.'); return; }
      exportBtn.disabled = true;
      exportBtn.setText('Exporting…');
      exportStatus.className = 'cad-data-status';
      exportStatus.setText('');
      try {
        const suffix = exportGroups.length && checked.size < exportGroups.length ? 'selected' : '';
        const path = await exportEntitiesXLSX(this.app, keys, suffix, this.settings);
        exportStatus.className = 'cad-data-status cad-data-status-ok';
        exportStatus.setText('Saved to ');
        exportStatus.createEl('strong', { text: path });
        exportStatus.createSpan({ text: ' — ' });
        const openLink = exportStatus.createEl('a', { cls: 'cad-data-open-link', text: 'Open file', href: '#' });
        openLink.addEventListener('click', (evt) => {
          evt.preventDefault();
          this.app.openWithDefaultApp(path);
        });
      } catch (e) {
        exportStatus.className = 'cad-data-status cad-data-status-error';
        exportStatus.setText(`Export failed — ${e.message}`);
      } finally {
        exportBtn.disabled = false;
        exportBtn.setText('Export workbook');
      }
    });

    // ── Export import template ───────────────────────────────────────
    const tmplSec = section(root, 'Export import template',
      'Download a pre-filled template file to use as a starting point for importing a specific entity type.');
    const tmplRow = tmplSec.createDiv({ cls: 'cad-data-btn-row' });
    const tmplSelect = tmplRow.createEl('select', { cls: 'cad-de-select' });
    workspaceConfiguredEntityEntries(WORKSPACE_CONFIG)
      .forEach(([key, def]) => tmplSelect.createEl('option', { value: key, text: def.plural || def.label || key }));
    const tmplCsvBtn  = tmplRow.createEl('button', { cls: 'cad-btn', text: 'CSV template' });
    const tmplXlsxBtn = tmplRow.createEl('button', { cls: 'cad-btn', text: 'XLSX template' });
    tmplCsvBtn.addEventListener('click', async () => {
      const modal = new CadenceImportModal(this.app, { entityKey: tmplSelect.value });
      await modal._exportTemplateCSV();
    });
    tmplXlsxBtn.addEventListener('click', async () => {
      const modal = new CadenceImportModal(this.app, { entityKey: tmplSelect.value });
      await modal._exportTemplateXLSX();
    });
  }

  renderImport(root) {
    new CadenceImportModal(this.app, {}).open();
  }

  async renderDashboardEditor(root) {
    this._renderPageHeader(root, 'Surface Designer', 'Customize dashboards, reports and widgets');

    const builtinIds = Object.keys(BUILTIN_DASHBOARD_DEFAULTS);
    const builtinPlannerIds = Object.keys(WORKSPACE_CONFIG.planner || {});
    const workspaceDashIds = Object.keys(WORKSPACE_CONFIG.dashboards || {});
    const customOnlyIds = workspaceDashIds.filter(id => !builtinIds.includes(id) && !builtinPlannerIds.includes(id));
    const allIds = [...builtinIds, ...builtinPlannerIds, ...customOnlyIds];

    const toolbar = root.createDiv({ cls: 'cad-de-toolbar' });
    toolbar.createDiv({ cls: 'cad-de-toolbar-label', text: 'Dashboard' });
    const sel = toolbar.createEl('select', { cls: 'cad-de-select' });
    allIds.forEach(id => {
      const opt = sel.createEl('option', { text: id, value: id });
      if (id === (this._dashEditorSurfaceId || builtinIds[0])) opt.selected = true;
    });
    const newSurfaceWrap = toolbar.createDiv({ cls: 'cad-de-toolbar-new-surface' });
    const newSurfaceInput = newSurfaceWrap.createEl('input', { type: 'text', cls: 'cad-de-field cad-de-field-sm', placeholder: 'New route id' });
    const newSurfaceKind = newSurfaceWrap.createEl('select', { cls: 'cad-de-select' });
    ['dashboard', 'report', 'planner'].forEach((kind) => newSurfaceKind.createEl('option', { value: kind, text: kind }));
    const addSurfaceBtn = newSurfaceWrap.createEl('button', { cls: 'cad-btn', text: '+ Add surface' });
    addSurfaceBtn.addEventListener('click', async () => {
      const id = String(newSurfaceInput.value || '').trim();
      if (!id) {
        new obsidian.Notice('Enter a surface id first.');
        return;
      }
      const targetStore = id.startsWith('planner.') ? 'planner' : 'dashboards';
      if (!WORKSPACE_CONFIG[targetStore]) WORKSPACE_CONFIG[targetStore] = {};
      if (WORKSPACE_CONFIG[targetStore][id]) {
        this._dashEditorSurfaceId = id;
        this._dashEditorDraft = getConfig(id);
        renderEditorPane(id);
        renderPreview(id);
        return;
      }
      WORKSPACE_CONFIG[targetStore][id] = {
        kind: newSurfaceKind.value,
        title: id,
        subtitle: '',
        layout: [],
        stats: [],
      };
      try {
        await saveWorkspaceConfig(this.app, JSON.stringify(WORKSPACE_CONFIG, null, 2));
        this._dashEditorSurfaceId = id;
        this._dashEditorDraft = getConfig(id);
        new obsidian.Notice(`Created dashboard surface "${id}".`);
        renderEditorPane(id);
        renderPreview(id);
      } catch (e) {
        new obsidian.Notice(`Create failed: ${e.message}`);
      }
    });

    const modeToggle = toolbar.createDiv({ cls: 'cad-de-mode-toggle' });
    if (!this._dashEditorMode) this._dashEditorMode = 'visual';
    const visualBtn = modeToggle.createEl('button', { cls: `cad-de-mode-btn${this._dashEditorMode === 'visual' ? ' active' : ''}`, text: 'Visual' });
    const jsonBtn   = modeToggle.createEl('button', { cls: `cad-de-mode-btn${this._dashEditorMode === 'json'   ? ' active' : ''}`, text: 'JSON' });

    const split       = root.createDiv({ cls: 'cad-de-split' });
    const editorPane  = split.createDiv({ cls: 'cad-de-editor-pane' });
    const previewPane = split.createDiv({ cls: 'cad-de-preview-pane' });

    const getConfig = (id) => {
      const plannerConfig = (WORKSPACE_CONFIG.planner || {})[id];
      if (plannerConfig) return normalizeDashboardConfigShape(JSON.parse(JSON.stringify(plannerConfig)));
      const ws = (WORKSPACE_CONFIG.dashboards || {})[id];
      if (ws) return normalizeDashboardConfigShape(JSON.parse(JSON.stringify(ws)));
      const bi = BUILTIN_DASHBOARD_DEFAULTS[id];
      if (bi) return normalizeDashboardConfigShape(JSON.parse(JSON.stringify(bi)));
      return { title: id, layout: [] };
    };

    const renderPreview = async (id) => {
      previewPane.empty();
      const prevDash = WORKSPACE_CONFIG.dashboards;
      const prevPlanner = WORKSPACE_CONFIG.planner;
      try {
        if (String(id || '').startsWith('planner.')) {
          WORKSPACE_CONFIG.planner = Object.assign({}, prevPlanner, { [id]: this._dashEditorDraft });
        } else {
          WORKSPACE_CONFIG.dashboards = Object.assign({}, prevDash, { [id]: this._dashEditorDraft });
        }
        await this.renderConfigDashboard(id, previewPane);
      } finally {
        WORKSPACE_CONFIG.dashboards = prevDash;
        WORKSPACE_CONFIG.planner = prevPlanner;
      }
    };

    let debounceTimer;
    const triggerPreview = (id) => {
      clearTimeout(debounceTimer);
      debounceTimer = setTimeout(() => renderPreview(id), 400);
    };

    const isEditable = (id) => !!(WORKSPACE_CONFIG.dashboards || {})[id] || !!(WORKSPACE_CONFIG.planner || {})[id] || customOnlyIds.includes(id);

    const renderEditorPane = (id) => {
      editorPane.empty();
      const editable = isEditable(id);
      const config = this._dashEditorDraft;

      editorPane.createDiv({
        cls: `cad-de-badge ${editable ? 'cad-de-badge-custom' : 'cad-de-badge-builtin'}`,
        text: editable ? 'Custom override' : 'Built-in (read-only)',
      });

      const reRender = () => { renderEditorPane(id); triggerPreview(id); };
      const validationStatus = editorPane.createDiv({ cls: 'cad-de-validation-status' });
      let validationTimer = null;
      const setValidationStatus = (message, ok) => {
        validationStatus.setText(message);
        validationStatus.toggleClass('is-valid', !!ok);
        validationStatus.toggleClass('is-invalid', !ok);
      };
      const validateDraft = () => {
        try {
          validateDashboardConfig(config, `dashboards.${id}`);
          setValidationStatus('Valid dashboard config', true);
          return true;
        } catch (e) {
          setValidationStatus(`Invalid dashboard: ${e.message}`, false);
          return false;
        }
      };
      const scheduleValidation = () => {
        clearTimeout(validationTimer);
        validationTimer = setTimeout(() => { validateDraft(); }, 150);
      };

      if (this._dashEditorMode === 'visual') {
        this._renderDashboardDesigner(editorPane, config, editable, reRender, () => {
          scheduleValidation();
          triggerPreview(id);
        });
      } else {
        const ta = editorPane.createEl('textarea', { cls: 'cad-de-textarea' });
        ta.value = JSON.stringify(config, null, 2);
        ta.readOnly = !editable;
        ta.spellcheck = false;
        if (editable) {
          ta.addEventListener('input', () => {
            clearTimeout(debounceTimer);
            debounceTimer = setTimeout(() => {
              try {
                this._dashEditorDraft = normalizeDashboardConfigShape(JSON.parse(ta.value));
                validateDraft();
                renderPreview(id);
              } catch (e) {
                setValidationStatus(`Invalid JSON: ${e.message}`, false);
              }
            }, 600);
          });
        }
      }

      const actions = editorPane.createDiv({ cls: 'cad-de-actions' });
      if (!editable) {
        const customizeBtn = actions.createEl('button', { cls: 'cad-btn primary', text: 'Customize' });
        customizeBtn.addEventListener('click', () => {
          const targetStore = id.startsWith('planner.') ? 'planner' : 'dashboards';
          if (!WORKSPACE_CONFIG[targetStore]) WORKSPACE_CONFIG[targetStore] = {};
          WORKSPACE_CONFIG[targetStore][id] = JSON.parse(JSON.stringify(BUILTIN_DASHBOARD_DEFAULTS[id] || getConfig(id)));
          this._dashEditorDraft = getConfig(id);
          renderEditorPane(id);
          renderPreview(id);
        });
      } else {
        const saveBtn = actions.createEl('button', { cls: 'cad-btn primary', text: 'Save' });
        saveBtn.addEventListener('click', async () => {
          try {
            if (!validateDraft()) return;
            this._dashEditorDraft = normalizeDashboardConfigShape(this._dashEditorDraft);
            const targetStore = id.startsWith('planner.') ? 'planner' : 'dashboards';
            if (!WORKSPACE_CONFIG[targetStore]) WORKSPACE_CONFIG[targetStore] = {};
            WORKSPACE_CONFIG[targetStore][id] = this._dashEditorDraft;
            await saveWorkspaceConfig(this.app, JSON.stringify(WORKSPACE_CONFIG, null, 2));
            new obsidian.Notice('Dashboard saved.');
          } catch (e) { new obsidian.Notice(`Save failed: ${e.message}`); }
        });
        if (BUILTIN_DASHBOARD_DEFAULTS[id] || id.startsWith('planner.')) {
          const resetBtn = actions.createEl('button', { cls: 'cad-btn cad-btn-danger', text: 'Reset to built-in' });
          resetBtn.addEventListener('click', async () => {
            const stores = id.startsWith('planner.') ? ['planner', 'dashboards'] : ['dashboards'];
            stores.forEach((targetStore) => {
              if (!WORKSPACE_CONFIG[targetStore]) return;
              delete WORKSPACE_CONFIG[targetStore][id];
              if (Object.keys(WORKSPACE_CONFIG[targetStore]).length === 0) delete WORKSPACE_CONFIG[targetStore];
            });
            await saveWorkspaceConfig(this.app, JSON.stringify(WORKSPACE_CONFIG, null, 2));
            new obsidian.Notice('Reset to built-in.');
            this._dashEditorDraft = getConfig(id);
            renderEditorPane(id);
            renderPreview(id);
          });
        }
      }
      validateDraft();
    };

    const renderAll = (id) => {
      this._dashEditorSurfaceId = id;
      this._dashEditorDraft = getConfig(id);
      renderEditorPane(id);
      renderPreview(id);
    };

    sel.addEventListener('change', () => renderAll(sel.value));
    visualBtn.addEventListener('click', () => {
      this._dashEditorMode = 'visual'; visualBtn.addClass('active'); jsonBtn.removeClass('active');
      renderEditorPane(this._dashEditorSurfaceId);
    });
    jsonBtn.addEventListener('click', () => {
      this._dashEditorMode = 'json'; jsonBtn.addClass('active'); visualBtn.removeClass('active');
      renderEditorPane(this._dashEditorSurfaceId);
    });

    const initialId = this._dashEditorSurfaceId && allIds.includes(this._dashEditorSurfaceId)
      ? this._dashEditorSurfaceId : allIds[0];
    sel.value = initialId;
    renderAll(initialId);
  }

  _renderDashboardDesigner(pane, config, editable, reRender, triggerPreview) {
    const entityKeys = workspaceConfiguredEntityEntries(WORKSPACE_CONFIG).map(([key]) => key);
    const defaultEntityKey = entityKeys[0] || Object.keys(ENTITIES)[0] || 'contact';
    const summarizeCardSource = (source) => {
      if (!source) return '';
      if (typeof source === 'string') return source.trim();
      if (Array.isArray(source)) return `${source.length} items`;
      if (typeof source === 'object') {
        const bits = [
          source.builtIn || source.kind || source.mode || source.source,
          source.section,
          source.entity,
          source.field,
          source.base?.file || source.base?.base || source.base?.path || source.base?.basePath,
        ].filter(Boolean).map((value) => String(value).trim());
        return bits.join(' · ') || 'object';
      }
      return String(source).trim();
    };

    // Header fields
    const metaSection = pane.createDiv({ cls: 'cad-de-section' });
    metaSection.createDiv({ cls: 'cad-de-section-label', text: 'Header' });
    const titleInput = metaSection.createEl('input', { type: 'text', cls: 'cad-de-field', value: config.title || '', placeholder: 'Title' });
    titleInput.disabled = !editable;
    titleInput.addEventListener('input', () => { config.title = titleInput.value; triggerPreview(); });
    const subInput = metaSection.createEl('input', { type: 'text', cls: 'cad-de-field', value: config.subtitle || '', placeholder: 'Subtitle' });
    subInput.disabled = !editable;
    subInput.addEventListener('input', () => { config.subtitle = subInput.value; triggerPreview(); });
    const kindRow = metaSection.createDiv({ cls: 'cad-de-form-row' });
    kindRow.createDiv({ cls: 'cad-de-form-label', text: 'Kind' });
    const kindSelect = kindRow.createEl('select', { cls: 'cad-de-field cad-de-field-sm' });
    const defaultKind = String(config.kind || (String(this._dashEditorSurfaceId || '').startsWith('planner.') ? 'planner' : 'dashboard')).trim().toLowerCase() || 'dashboard';
    ['dashboard', 'report', 'planner'].forEach((kind) => {
      const opt = kindSelect.createEl('option', { value: kind, text: kind });
      if (defaultKind === kind) opt.selected = true;
    });
    kindSelect.disabled = !editable;
    kindSelect.addEventListener('change', () => { config.kind = kindSelect.value; triggerPreview(); });
    const contextRow = metaSection.createDiv({ cls: 'cad-de-form-row' });
    contextRow.createDiv({ cls: 'cad-de-form-label', text: 'Context' });
    const contextSelect = contextRow.createEl('select', { cls: 'cad-de-field cad-de-field-sm' });
    [
      { value: '', label: 'none' },
      { value: 'client-work', label: 'selected client/project' },
    ].forEach(({ value, label }) => {
      const opt = contextSelect.createEl('option', { value, text: label });
      if (String(config.contextFilter || '') === value) opt.selected = true;
    });
    contextSelect.disabled = !editable;
    contextSelect.addEventListener('change', () => {
      if (contextSelect.value) config.contextFilter = contextSelect.value;
      else delete config.contextFilter;
      triggerPreview();
    });

    // Stats
    const statsSection = pane.createDiv({ cls: 'cad-de-section' });
    const statsHead = statsSection.createDiv({ cls: 'cad-de-section-head' });
    statsHead.createDiv({ cls: 'cad-de-section-label', text: `Stats (${(config.stats || []).length})` });
    if (editable) {
      const addBtn = statsHead.createEl('button', { cls: 'cad-btn cad-btn-sm', text: '+ Add stat' });
      addBtn.addEventListener('click', () => {
        (config.stats || (config.stats = [])).push({ label: 'NEW STAT', entity: defaultEntityKey, count: 'all' });
        reRender();
      });
    }
    (config.stats || []).forEach((stat, idx) => {
      const chip = statsSection.createDiv({ cls: 'cad-de-stat-chip' });
      const lbl = chip.createEl('input', { type: 'text', cls: 'cad-de-stat-label' });
      lbl.value = stat.label || ''; lbl.placeholder = 'LABEL'; lbl.disabled = !editable;
      lbl.addEventListener('input', () => { stat.label = lbl.value; triggerPreview(); });
      const ent = chip.createEl('select', { cls: 'cad-de-stat-select' });
      ent.disabled = !editable;
      if (stat.entity && !entityKeys.includes(stat.entity) && ENTITIES[stat.entity]) {
        const o = ent.createEl('option', { value: stat.entity, text: stat.entity });
        o.selected = true;
      }
      entityKeys.forEach(k => { const o = ent.createEl('option', { value: k, text: k }); if (k === stat.entity) o.selected = true; });
      ent.addEventListener('change', () => { stat.entity = ent.value; triggerPreview(); });
      const cnt = chip.createEl('select', { cls: 'cad-de-stat-select' });
      cnt.disabled = !editable;
      ['all', 'open'].forEach(v => { const o = cnt.createEl('option', { value: v, text: v }); if (v === stat.count) o.selected = true; });
      cnt.addEventListener('change', () => { stat.count = cnt.value; triggerPreview(); });
      if (editable) {
        const del = chip.createEl('button', { cls: 'cad-btn cad-btn-sm cad-btn-danger', text: '×' });
        del.addEventListener('click', () => { config.stats.splice(idx, 1); reRender(); });
      }
    });

    const controlsSection = pane.createDiv({ cls: 'cad-de-section' });
    const controlsHead = controlsSection.createDiv({ cls: 'cad-de-section-head' });
    controlsHead.createDiv({ cls: 'cad-de-section-label', text: `Controls (${(config.controls || []).length})` });
    if (editable) {
      const addBtn = controlsHead.createEl('button', { cls: 'cad-btn cad-btn-sm', text: '+ Add control' });
      addBtn.addEventListener('click', () => {
        (config.controls || (config.controls = [])).push({ kind: 'selector', key: 'filter', label: 'New control', allLabel: 'All' });
        reRender();
      });
    }
    (config.controls || []).forEach((control, idx) => {
      const chip = controlsSection.createDiv({ cls: 'cad-de-stat-chip cad-de-control-chip' });
      const lbl = chip.createEl('input', { type: 'text', cls: 'cad-de-stat-label' });
      lbl.value = control.title || control.label || ''; lbl.placeholder = 'LABEL'; lbl.disabled = !editable;
      lbl.addEventListener('input', () => { control.label = lbl.value; triggerPreview(); });
      const typ = chip.createEl('select', { cls: 'cad-de-stat-select' });
      typ.disabled = !editable;
      ['selector', 'date-range', 'markdown', 'actions', 'base-link', 'base-embed', 'base-view'].forEach((type) => {
        const o = typ.createEl('option', { value: type, text: type });
        if (type === (control.kind || 'selector')) o.selected = true;
      });
      typ.addEventListener('change', () => { control.kind = typ.value; triggerPreview(); });
      if (editable) {
        const del = chip.createEl('button', { cls: 'cad-btn cad-btn-sm cad-btn-danger', text: '×' });
        del.addEventListener('click', () => { config.controls.splice(idx, 1); reRender(); });
      }
    });

    // Normalize layout columns to arrays
    if (!config.layout) config.layout = [];
    config.layout = config.layout.map(row => row.map(col => Array.isArray(col) ? col : [col]));

    // Layout board
    const layoutSection = pane.createDiv({ cls: 'cad-de-section' });
    layoutSection.createDiv({ cls: 'cad-de-section-label', text: 'Layout' });

    let activeDrag = null;

    config.layout.forEach((row, rowIdx) => {
      const rowEl = layoutSection.createDiv({ cls: 'cad-de-layout-row' });
      const rowHead = rowEl.createDiv({ cls: 'cad-de-row-head' });
      rowHead.createDiv({ cls: 'cad-de-row-label', text: `Row ${rowIdx + 1}` });
      if (editable) {
        const addCol = rowHead.createEl('button', { cls: 'cad-btn cad-btn-sm', text: '+ Col' });
        addCol.addEventListener('click', () => {
          row.push([{ kind: 'list', title: 'New Card', entity: defaultEntityKey, source: 'recent', titleFields: ['title', 'name'], metaFields: ['status'], empty: 'No items.' }]);
          reRender();
        });
        const delRow = rowHead.createEl('button', { cls: 'cad-btn cad-btn-sm cad-btn-danger', text: '× Row' });
        delRow.addEventListener('click', () => { config.layout.splice(rowIdx, 1); reRender(); });
      }

      const cols = rowEl.createDiv({ cls: 'cad-de-row-cols' });
      row.forEach((col, colIdx) => {
        const colEl = cols.createDiv({ cls: 'cad-de-layout-col' });

        if (editable && row.length > 1) {
          const delCol = colEl.createEl('button', { cls: 'cad-btn cad-btn-sm cad-btn-danger cad-de-del-col', text: '× Col' });
          delCol.addEventListener('click', () => { row.splice(colIdx, 1); reRender(); });
        }

        col.forEach((card, cardIdx) => {
          const cardEl = colEl.createDiv({ cls: 'cad-de-card' });
          cardEl.draggable = editable;
          if (editable) {
            cardEl.addEventListener('dragstart', (ev) => {
              activeDrag = { rowIdx, colIdx, cardIdx };
              ev.dataTransfer.effectAllowed = 'move';
              ev.dataTransfer.setData('text/cad-dash', JSON.stringify(activeDrag));
              setTimeout(() => cardEl.addClass('cad-de-dragging'), 0);
            });
            cardEl.addEventListener('dragend', () => { activeDrag = null; cardEl.removeClass('cad-de-dragging'); });
            cardEl.addEventListener('dragover', (ev) => {
              if (!activeDrag) return; ev.preventDefault(); ev.stopPropagation(); cardEl.addClass('drag-over');
            });
            cardEl.addEventListener('dragleave', () => cardEl.removeClass('drag-over'));
            cardEl.addEventListener('drop', (ev) => {
              ev.preventDefault(); ev.stopPropagation(); cardEl.removeClass('drag-over');
              if (!activeDrag) return;
              const src = activeDrag;
              const [moved] = config.layout[src.rowIdx][src.colIdx].splice(src.cardIdx, 1);
              let tgt = cardIdx;
              if (src.rowIdx === rowIdx && src.colIdx === colIdx && src.cardIdx < cardIdx) tgt--;
              config.layout[rowIdx][colIdx].splice(Math.max(0, tgt), 0, moved);
              reRender();
            });
          }

          const cardHead = cardEl.createDiv({ cls: 'cad-de-card-head' });
          if (editable) cardHead.createSpan({ cls: 'cad-de-drag-handle', text: '⠿' });
          const titleSpan = cardHead.createSpan({ cls: 'cad-de-card-title-text', text: card.title || '(untitled)' });
          const badges = cardHead.createDiv({ cls: 'cad-de-card-badges' });
          badges.createSpan({ cls: 'cad-de-card-badge', text: card.kind || card.entity || '?' });
          const sourceLabel = summarizeCardSource(card.source);
          if (sourceLabel && sourceLabel !== 'recent') badges.createSpan({ cls: 'cad-de-card-badge cad-de-badge-source', text: sourceLabel });

          if (editable) {
            const acts = cardHead.createDiv({ cls: 'cad-de-card-actions' });
            const editBtn = acts.createEl('button', { cls: 'cad-btn cad-btn-sm', text: 'Edit' });
            editBtn.addEventListener('mousedown', ev => ev.stopPropagation());
            editBtn.addEventListener('dragstart', ev => ev.stopPropagation());
            editBtn.addEventListener('click', (ev) => {
              ev.stopPropagation();
              const existing = cardEl.querySelector('.cad-de-card-form');
              if (existing) { existing.remove(); return; }
              this._renderCardForm(cardEl, card, () => {
                titleSpan.textContent = card.title || '(untitled)';
                badges.empty();
                badges.createSpan({ cls: 'cad-de-card-badge', text: card.kind || card.entity || '?' });
                const updatedSourceLabel = summarizeCardSource(card.source);
                if (updatedSourceLabel && updatedSourceLabel !== 'recent') {
                  badges.createSpan({ cls: 'cad-de-card-badge cad-de-badge-source', text: updatedSourceLabel });
                }
                triggerPreview();
              });
            });
            const delBtn = acts.createEl('button', { cls: 'cad-btn cad-btn-sm cad-btn-danger', text: '×' });
            delBtn.addEventListener('mousedown', ev => ev.stopPropagation());
            delBtn.addEventListener('click', () => { col.splice(cardIdx, 1); reRender(); });
          }
        });

        if (editable) {
          const dropZone = colEl.createDiv({ cls: 'cad-de-col-drop-zone', text: '+ Add card' });
          dropZone.addEventListener('dragover', (ev) => {
            if (!activeDrag) return; ev.preventDefault(); ev.stopPropagation(); dropZone.addClass('drag-over');
          });
          dropZone.addEventListener('dragleave', () => dropZone.removeClass('drag-over'));
          dropZone.addEventListener('drop', (ev) => {
            ev.preventDefault(); ev.stopPropagation(); dropZone.removeClass('drag-over');
            if (!activeDrag) return;
            const src = activeDrag;
            const [moved] = config.layout[src.rowIdx][src.colIdx].splice(src.cardIdx, 1);
            config.layout[rowIdx][colIdx].push(moved);
            reRender();
          });
          dropZone.addEventListener('click', () => {
            col.push({ title: 'New Card', entity: defaultEntityKey, source: 'recent', titleFields: ['title', 'name'], metaFields: ['status'], empty: 'No items.' });
            reRender();
          });
        }
      });
    });

    if (editable) {
      const addRowBtn = layoutSection.createEl('button', { cls: 'cad-btn cad-btn-sm cad-de-add-row-btn', text: '+ Add row' });
      addRowBtn.addEventListener('click', () => {
        config.layout.push([[{ title: 'New Card', entity: defaultEntityKey, source: 'recent', titleFields: ['title', 'name'], metaFields: ['status'], empty: 'No items.' }]]);
        reRender();
      });
    }

    // Conditional rows — same visual pattern as layout rows; each card in cr.cards = one column
    if ((config.conditionalRows || []).length > 0 || editable) {
      const crSection = pane.createDiv({ cls: 'cad-de-section' });
      crSection.createDiv({ cls: 'cad-de-section-label', text: 'Conditional rows' });
      const newCard = () => ({ title: 'New Card', entity: defaultEntityKey, source: 'recent', titleFields: ['title', 'name'], metaFields: ['status'], empty: 'No items.' });
      (config.conditionalRows || []).forEach((cr, crIdx) => {
        const crEl = crSection.createDiv({ cls: 'cad-de-layout-row' });
        const crRowHead = crEl.createDiv({ cls: 'cad-de-row-head' });
        crRowHead.createDiv({ cls: 'cad-de-row-label', text: 'Show when' });
        const condInp = crRowHead.createEl('input', { type: 'text', cls: 'cad-de-field cad-de-field-sm' });
        condInp.value = (cr.condition?.entities || []).join(', ');
        condInp.placeholder = 'entities with data (comma-separated)';
        condInp.disabled = !editable;
        condInp.addEventListener('input', () => {
          if (!cr.condition) cr.condition = {};
          cr.condition.entities = condInp.value.split(',').map(s => s.trim()).filter(Boolean);
          triggerPreview();
        });
        if (editable) {
          const addCol = crRowHead.createEl('button', { cls: 'cad-btn cad-btn-sm', text: '+ Col' });
          addCol.addEventListener('click', () => { (cr.cards || (cr.cards = [])).push(newCard()); reRender(); });
          const delCr = crRowHead.createEl('button', { cls: 'cad-btn cad-btn-sm cad-btn-danger', text: '× Row' });
          delCr.addEventListener('click', () => { config.conditionalRows.splice(crIdx, 1); reRender(); });
        }
        const crCols = crEl.createDiv({ cls: 'cad-de-row-cols' });
        (cr.cards || []).forEach((card, cardIdx) => {
          const col = crCols.createDiv({ cls: 'cad-de-layout-col' });
          if (editable && (cr.cards || []).length > 1) {
            const delCol = col.createEl('button', { cls: 'cad-btn cad-btn-sm cad-btn-danger cad-de-del-col', text: '× Col' });
            delCol.addEventListener('click', () => { cr.cards.splice(cardIdx, 1); reRender(); });
          }
          const cardEl = col.createDiv({ cls: 'cad-de-card' });
          const cardHead = cardEl.createDiv({ cls: 'cad-de-card-head' });
          const titleSpan = cardHead.createSpan({ cls: 'cad-de-card-title-text', text: card.title || '(untitled)' });
          const badges = cardHead.createDiv({ cls: 'cad-de-card-badges' });
          badges.createSpan({ cls: 'cad-de-card-badge', text: card.entity || '?' });
          const sourceLabel = summarizeCardSource(card.source);
          if (sourceLabel && sourceLabel !== 'recent') badges.createSpan({ cls: 'cad-de-card-badge cad-de-badge-source', text: sourceLabel });
          if (editable) {
            const acts = cardHead.createDiv({ cls: 'cad-de-card-actions' });
            const editBtn = acts.createEl('button', { cls: 'cad-btn cad-btn-sm', text: 'Edit' });
            editBtn.addEventListener('mousedown', ev => ev.stopPropagation());
            editBtn.addEventListener('click', (ev) => {
              ev.stopPropagation();
              const existing = cardEl.querySelector('.cad-de-card-form');
              if (existing) { existing.remove(); return; }
              this._renderCardForm(cardEl, card, () => {
                titleSpan.textContent = card.title || '(untitled)';
                badges.empty();
                badges.createSpan({ cls: 'cad-de-card-badge', text: card.entity || '?' });
                const updatedSourceLabel = summarizeCardSource(card.source);
                if (updatedSourceLabel && updatedSourceLabel !== 'recent') {
                  badges.createSpan({ cls: 'cad-de-card-badge cad-de-badge-source', text: updatedSourceLabel });
                }
                triggerPreview();
              });
            });
            const delBtn = acts.createEl('button', { cls: 'cad-btn cad-btn-sm cad-btn-danger', text: '×' });
            delBtn.addEventListener('click', () => { cr.cards.splice(cardIdx, 1); reRender(); });
          }
        });
      });
      if (editable) {
        const addRowBtn = crSection.createEl('button', { cls: 'cad-btn cad-btn-sm cad-de-add-row-btn', text: '+ Add conditional row' });
        addRowBtn.addEventListener('click', () => {
          (config.conditionalRows || (config.conditionalRows = [])).push({ condition: { entities: [] }, cards: [newCard()] });
          reRender();
        });
      }
    }
  }

  _renderCardForm(parent, card, onChange) {
    const form = parent.createDiv({ cls: 'cad-de-card-form' });
    let _dlId = 0;
    const entityFieldKeys = [...new Set((ENTITIES[card.entity]?.fields || []).map((field) => field.key).filter(Boolean))];
    const fieldSuggestions = entityFieldKeys.length ? entityFieldKeys : ['title', 'name', 'status', 'value', 'date'];
    const addSuggestion = (dl, value) => {
      const text = String(value || '').trim();
      if (!dl || !text) return;
      if ([...dl.querySelectorAll('option')].some((opt) => opt.value === text)) return;
      dl.createEl('option', { value: text });
    };
    const isScalarValue = (value) => value == null || ['string', 'number', 'boolean'].includes(typeof value);
    const formatFieldValue = (value) => {
      if (Array.isArray(value)) {
        if (value.every(isScalarValue)) return value.join(', ');
        return JSON.stringify(value, null, 2);
      }
      if (value && typeof value === 'object') return JSON.stringify(value, null, 2);
      return value == null ? '' : String(value);
    };
    const parseFieldValue = (value, current) => {
      if (Array.isArray(current)) {
        if (current.every(isScalarValue)) {
          return String(value || '').split(',').map((item) => item.trim()).filter(Boolean);
        }
        try { return JSON.parse(String(value || '')); } catch (_) { return String(value || ''); }
      }
      if (current && typeof current === 'object') {
        try { return JSON.parse(String(value || '')); } catch (_) { return String(value || ''); }
      }
      return value;
    };
    const addRow = (label, key, opts, combobox = false) => {
      const r = form.createDiv({ cls: 'cad-de-form-row' });
      r.createDiv({ cls: 'cad-de-form-label', text: label });
      if (opts && !combobox) {
        const sel = r.createEl('select', { cls: 'cad-de-field cad-de-field-sm' });
        opts.forEach(v => { const o = sel.createEl('option', { value: v, text: v }); if (v === card[key]) o.selected = true; });
        sel.addEventListener('change', () => { card[key] = sel.value; onChange(); });
      } else if (opts && combobox) {
        const dlId = `cad-de-dl-${++_dlId}`;
        const inp = r.createEl('input', { type: 'text', cls: 'cad-de-field cad-de-field-sm', attr: { list: dlId } });
        inp.value = formatFieldValue(card[key]);
        const dl = r.createEl('datalist', { attr: { id: dlId } });
        opts.forEach(v => dl.createEl('option', { value: v }));
        inp.addEventListener('input', () => {
          card[key] = parseFieldValue(inp.value, card[key]);
          onChange();
        });
        return dl;
      } else {
        const current = card[key];
        if (Array.isArray(current) && !current.every(isScalarValue)) {
          const ta = r.createEl('textarea', { cls: 'cad-de-textarea cad-de-json-field' });
          ta.rows = 4;
          ta.value = formatFieldValue(current);
          ta.spellcheck = false;
          ta.addEventListener('input', () => {
            card[key] = parseFieldValue(ta.value, current);
            onChange();
          });
        } else if (current && typeof current === 'object') {
          const ta = r.createEl('textarea', { cls: 'cad-de-textarea cad-de-json-field' });
          ta.rows = 4;
          ta.value = formatFieldValue(current);
          ta.spellcheck = false;
          ta.addEventListener('input', () => {
            card[key] = parseFieldValue(ta.value, current);
            onChange();
          });
        } else {
          const val = formatFieldValue(current);
          const inp = r.createEl('input', { type: 'text', cls: 'cad-de-field cad-de-field-sm' });
          inp.value = val; inp.placeholder = key;
          inp.addEventListener('input', () => {
            card[key] = inp.value;
            onChange();
          });
        }
      }
      return null;
    };
    const getObjectField = (key, fallback = {}) => {
      const current = card[key];
      if (current && typeof current === 'object' && !Array.isArray(current)) return current;
      return Object.assign({}, fallback);
    };
    const setObjectField = (key, patch) => {
      const next = getObjectField(key);
      Object.entries(patch).forEach(([prop, value]) => {
        if (value == null || value === '') delete next[prop];
        else next[prop] = value;
      });
      card[key] = next;
      onChange();
    };
    const sortedEntityKeys = workspaceConfiguredEntityEntries(WORKSPACE_CONFIG).map(([key]) => key);
    if (card.entity && ENTITIES[card.entity] && !sortedEntityKeys.includes(card.entity)) {
      sortedEntityKeys.unshift(card.entity);
    }
    addRow('Title', 'title');
    addRow('Entity', 'entity', sortedEntityKeys, true);
    const titleFieldList = addRow('Title fields', 'titleFields', fieldSuggestions, true);
    const metaFieldList = addRow('Meta fields', 'metaFields', fieldSuggestions, true);
    addRow('Empty text', 'empty');
    addRow('Section', 'section');
    addRow('Tone', 'tone', ['emerald', 'mint', 'sky', 'warn', 'rose']);
    addRow('Accent', 'accent', ['emerald', 'mint', 'sky', 'warn', 'rose']);
    addRow('Value field', 'valueField');
    addRow('Group by', 'groupBy');
    addRow('Limit', 'limit');
    addRow('View', 'view');
    addRow('Height', 'height');
    addRow('Fallback', 'fallback', ['preview', 'link', 'error']);

    const typeRow = form.createDiv({ cls: 'cad-de-form-row' });
    typeRow.createDiv({ cls: 'cad-de-form-label', text: 'Widget type' });
    const typeSelect = typeRow.createEl('select', { cls: 'cad-de-field cad-de-field-sm' });
    const widgetTypes = [...PURE_DASHBOARD_WIDGET_TYPES];
    const currentType = String(card.kind || (Array.isArray(card.merge) ? 'merge' : 'list')).trim() || 'list';
    if (!widgetTypes.includes(currentType)) widgetTypes.push(currentType);
    widgetTypes.forEach((type) => {
      const option = typeSelect.createEl('option', { value: type, text: type });
      if (type === currentType) option.selected = true;
    });
    typeSelect.addEventListener('change', () => {
      if (typeSelect.value === 'merge') {
        card.kind = '';
        if (!Array.isArray(card.merge)) card.merge = [{ entity: card.entity || defaultEntityKey, source: 'recent' }];
      } else {
        card.kind = typeSelect.value;
      }
      onChange();
    });
    const source = getObjectField('source', typeof card.source === 'string' ? { source: card.source } : {});
    const sourceModeValue = (() => {
      const raw = String(source.mode || '').trim().toLowerCase();
      return raw || (String(source.builtIn || '').trim() ? 'built-in' : 'recent');
    })();
    const setSourceField = (patch, opts = {}) => {
      const normalizedPatch = Object.assign({}, patch);
      const next = Object.assign({}, getObjectField('source', { mode: sourceModeValue || 'recent' }), normalizedPatch);
      if (String(next.mode || '').trim() !== 'built-in') delete next.builtIn;
      if (opts.clearSource && !String(next.mode || '').trim()) delete next.source;
      card.source = next;
      onChange();
    };
    const sourceSection = form.createDiv({ cls: 'cad-de-section cad-de-section-compact' });
    sourceSection.createDiv({ cls: 'cad-de-section-label', text: 'Source details' });
    const sourceModeRow = sourceSection.createDiv({ cls: 'cad-de-form-row' });
    sourceModeRow.createDiv({ cls: 'cad-de-form-label', text: 'Mode' });
    const sourceMode = sourceModeRow.createEl('select', { cls: 'cad-de-field cad-de-field-sm' });
    ['recent', 'recent-open', 'due', 'due-open', 'entity', 'base', 'list', 'table', 'built-in'].forEach((mode) => {
      const opt = sourceMode.createEl('option', { value: mode, text: mode });
      if (sourceModeValue === mode || (!sourceModeValue && mode === 'recent')) opt.selected = true;
    });
    sourceMode.addEventListener('change', () => {
      if (sourceMode.value === 'built-in') {
        setSourceField({
          mode: 'built-in',
          builtIn: sourceProvider.value || 'home',
          section: sectionSelect.value || null,
        }, { clearSource: false });
      } else {
        setSourceField({ mode: sourceMode.value }, { clearSource: true });
      }
      syncBuiltInControls();
    });

    const sourceProviderRow = sourceSection.createDiv({ cls: 'cad-de-form-row' });
    sourceProviderRow.createDiv({ cls: 'cad-de-form-label', text: 'Built-in source' });
    const sourceProvider = sourceProviderRow.createEl('select', { cls: 'cad-de-field cad-de-field-sm' });
    const builtInSourceOptions = [
      { value: 'home', label: 'home' },
      { value: 'planner', label: 'planner' },
      { value: 'productivity', label: 'productivity' },
    ];
    const currentBuiltInSource = String(source.builtIn || (sourceModeValue === 'built-in' ? 'home' : '')).trim().toLowerCase();
    builtInSourceOptions.forEach((choice) => {
      const opt = sourceProvider.createEl('option', { value: choice.value, text: choice.label });
      if ((currentBuiltInSource || 'home') === choice.value) opt.selected = true;
    });
    sourceProvider.disabled = !editable || sourceModeValue !== 'built-in';
    sourceProvider.addEventListener('change', () => {
      const builtInName = sourceProvider.value || 'home';
      const selectedSection = builtInSectionOptions(builtInName)[0]?.value || '';
      setSourceField({
        mode: 'built-in',
        builtIn: builtInName,
        section: selectedSection,
      }, { clearSource: false });
      syncBuiltInControls();
    });

    const sourceEntityRow = sourceSection.createDiv({ cls: 'cad-de-form-row' });
    sourceEntityRow.createDiv({ cls: 'cad-de-form-label', text: 'Source entity' });
    const sourceEntity = sourceEntityRow.createEl('input', { type: 'text', cls: 'cad-de-field cad-de-field-sm' });
    sourceEntity.value = source.entity || card.entity || '';
    sourceEntity.placeholder = 'entity key';
    sourceEntity.addEventListener('input', () => {
      card.entity = sourceEntity.value || '';
      setSourceField({ entity: sourceEntity.value || null }, { clearSource: false });
    });

    const sourceFiltersRow = sourceSection.createDiv({ cls: 'cad-de-form-row' });
    sourceFiltersRow.createDiv({ cls: 'cad-de-form-label', text: 'Filters' });
    const sourceFilters = sourceFiltersRow.createEl('input', { type: 'text', cls: 'cad-de-field cad-de-field-sm' });
    sourceFilters.value = source.filters || card.filters || '';
    sourceFilters.placeholder = 'YAML/SQL-like filter expression';
    sourceFilters.addEventListener('input', () => {
      setSourceField({ filters: sourceFilters.value });
    });

    const sourceGroupRow = sourceSection.createDiv({ cls: 'cad-de-form-row' });
    sourceGroupRow.createDiv({ cls: 'cad-de-form-label', text: 'Group by' });
    const sourceGroup = sourceGroupRow.createEl('input', { type: 'text', cls: 'cad-de-field cad-de-field-sm', attr: { list: `cad-de-group-${++_dlId}` } });
    sourceGroup.value = source.groupBy || card.groupBy || '';
    sourceGroup.placeholder = 'field key';
    const sourceGroupList = sourceGroupRow.createEl('datalist', { attr: { id: `cad-de-group-${_dlId}` } });
    fieldSuggestions.forEach((field) => sourceGroupList.createEl('option', { value: field }));
    sourceGroup.addEventListener('input', () => {
      card.groupBy = sourceGroup.value || '';
      setSourceField({ groupBy: sourceGroup.value });
    });

    const sourceSortRow = sourceSection.createDiv({ cls: 'cad-de-form-row' });
    sourceSortRow.createDiv({ cls: 'cad-de-form-label', text: 'Sort' });
    const sourceSort = sourceSortRow.createEl('input', { type: 'text', cls: 'cad-de-field cad-de-field-sm', attr: { list: `cad-de-sort-${++_dlId}` } });
    sourceSort.value = source.sort || card.sort || '';
    sourceSort.placeholder = 'field ASC';
    const sourceSortList = sourceSortRow.createEl('datalist', { attr: { id: `cad-de-sort-${_dlId}` } });
    fieldSuggestions.forEach((field) => {
      sourceSortList.createEl('option', { value: `${field} ASC` });
      sourceSortList.createEl('option', { value: `${field} DESC` });
    });
    sourceSort.addEventListener('input', () => {
      card.sort = sourceSort.value || '';
      setSourceField({ sort: sourceSort.value });
    });

    const builtInSectionOptions = (builtInName) => {
      const builtIns = {
        home: [
          { value: 'briefing', label: 'Briefing' },
          { value: 'inbox', label: 'Inbox' },
          { value: 'today', label: 'Today' },
          { value: 'week', label: 'This week' },
          { value: 'upcoming', label: 'Upcoming' },
          { value: 'pipeline', label: 'Pipeline' },
          { value: 'partners', label: 'Partners' },
          { value: 'projects', label: 'Projects' },
          { value: 'activities', label: 'Recent activity' },
        ],
        planner: [
          { value: 'overview', label: 'Overview' },
          { value: 'inbox', label: 'Inbox' },
          { value: 'today', label: 'Today' },
          { value: 'calendar', label: 'Calendar' },
          { value: 'projects', label: 'Projects' },
        ],
        productivity: [
          { value: 'per-day', label: 'Per day' },
          { value: 'weeks', label: 'Weeks' },
          { value: 'weekday', label: 'Weekday mix' },
          { value: 'task-notes', label: 'Task notes' },
        ],
      };
      return builtIns[builtInName] || [];
    };
    const inferBuiltInSection = (builtInName) => {
      const builtIn = String(builtInName || '').trim().toLowerCase();
      const title = String(config.title || card.title || '').trim().toLowerCase();
      const choices = builtInSectionOptions(builtIn);
      const byLabel = choices.find((choice) => String(choice.label || '').trim().toLowerCase() === title);
      if (byLabel) return byLabel.value;
      const aliases = {
        home: {
          'top of the day': 'briefing',
          briefing: 'briefing',
          inbox: 'inbox',
          today: 'today',
          'this week': 'week',
          week: 'week',
          upcoming: 'upcoming',
          pipeline: 'pipeline',
          partners: 'partners',
          projects: 'projects',
          'recent activity': 'activities',
          activity: 'activities',
          activities: 'activities',
        },
        planner: {
          overview: 'overview',
          inbox: 'inbox',
          today: 'today',
          calendar: 'calendar',
          projects: 'projects',
        },
        productivity: {
          'per day': 'per-day',
          'week day mix': 'weekday',
          'weekday mix': 'weekday',
          'task notes': 'task-notes',
          'tasknotes': 'task-notes',
          weeks: 'weeks',
        },
      };
      return aliases[builtIn]?.[title] || '';
    };
    const sourceSectionRow = sourceSection.createDiv({ cls: 'cad-de-form-row' });
    sourceSectionRow.createDiv({ cls: 'cad-de-form-label', text: 'Built-in section' });
    const sectionWrap = sourceSectionRow.createDiv({ cls: 'cad-de-source-section-wrap' });
    const sectionSelect = sectionWrap.createEl('select', { cls: 'cad-de-field cad-de-field-sm' });
    const syncBuiltInControls = () => {
      const isBuiltIn = sourceMode.value === 'built-in';
      const builtInName = String(sourceProvider.value || 'home').trim().toLowerCase() || 'home';
      const choices = builtInSectionOptions(builtInName);
      const selectedValue = String(card.section || source.section || inferBuiltInSection(builtInName) || choices[0]?.value || '').trim();
      sourceProvider.disabled = !editable || !isBuiltIn;
      sourceSectionRow.style.display = isBuiltIn ? '' : 'none';
      sectionSelect.empty();
      if (choices.length) {
        choices.forEach((choice) => {
          const opt = sectionSelect.createEl('option', { value: choice.value, text: choice.label });
          if (choice.value === selectedValue) opt.selected = true;
        });
        sectionSelect.disabled = !editable || !isBuiltIn;
        sectionSelect.style.display = '';
      } else {
        const opt = sectionSelect.createEl('option', { value: '', text: 'No sections available' });
        opt.selected = true;
        sectionSelect.disabled = true;
        sectionSelect.style.display = '';
      }
    };
    sectionSelect.addEventListener('change', () => {
      const section = sectionSelect.value || '';
      card.section = section;
      setSourceField({ section: section || null });
    });
    syncBuiltInControls();

    const sourceLabelsRow = sourceSection.createDiv({ cls: 'cad-de-form-row' });
    sourceLabelsRow.createDiv({ cls: 'cad-de-form-label', text: 'Labels' });
    const sourceLabels = sourceLabelsRow.createEl('input', { type: 'text', cls: 'cad-de-field cad-de-field-sm' });
    sourceLabels.value = Array.isArray(source.labels) ? source.labels.join(', ') : '';
    sourceLabels.placeholder = 'Comma-separated labels';
    sourceLabels.addEventListener('input', () => {
      const labels = String(sourceLabels.value || '')
        .split(',')
        .map((item) => item.trim())
        .filter(Boolean);
      setSourceField({ labels: labels.length ? labels : null });
    });

    const baseObj = getObjectField('base');
    const baseMetadataSource = baseObj && typeof baseObj === 'object' ? baseObj : {};
    void (async () => {
      const basePath = String(
        baseMetadataSource.file ||
        baseMetadataSource.base ||
        baseMetadataSource.path ||
        baseMetadataSource.basePath ||
        source.base?.file ||
        source.base?.base ||
        source.base?.path ||
        source.base?.basePath ||
        ''
      ).trim();
      if (!basePath) return;
      const baseFile = this.app.vault.getAbstractFileByPath(basePath);
      if (!(baseFile instanceof obsidian.TFile)) return;
      const baseViewName = String(
        baseMetadataSource.view ||
        baseMetadataSource.baseView ||
        baseMetadataSource.base_view ||
        source.base?.view ||
        source.base?.baseView ||
        source.base?.base_view ||
        ''
      ).trim();
      const baseConfig = await parseBaseFile(this.app, basePath, baseViewName).catch(() => null);
      if (!baseConfig) return;
      const baseFields = Array.isArray(baseConfig.fields) ? baseConfig.fields : [];
      const extraFields = new Set();
      const addField = (field) => {
        const key = String(field?.key || '').trim();
        if (!key) return;
        extraFields.add(key);
        const label = String(field?.label || '').trim();
        if (label && label !== key) extraFields.add(label);
      };
      baseFields.forEach(addField);
      (entityDef?.fields || []).forEach(addField);
      extraFields.forEach((field) => {
        addSuggestion(titleFieldList, field);
        addSuggestion(metaFieldList, field);
        addSuggestion(sourceGroupList, field);
        addSuggestion(sourceSortList, `${field} ASC`);
        addSuggestion(sourceSortList, `${field} DESC`);
      });
    })();

    const sourceLimitRow = sourceSection.createDiv({ cls: 'cad-de-form-row' });
    sourceLimitRow.createDiv({ cls: 'cad-de-form-label', text: 'Limit' });
    const sourceLimit = sourceLimitRow.createEl('input', { type: 'number', cls: 'cad-de-field cad-de-field-sm' });
    sourceLimit.value = source.limit != null ? String(source.limit) : (card.limit != null ? String(card.limit) : '');
    sourceLimit.placeholder = 'rows';
    sourceLimit.addEventListener('input', () => {
      const limitValue = sourceLimit.value === '' ? null : Number(sourceLimit.value);
      card.limit = limitValue;
      setObjectField('source', { limit: limitValue });
    });

    const baseSection = form.createDiv({ cls: 'cad-de-section cad-de-section-compact' });
    baseSection.createDiv({ cls: 'cad-de-section-label', text: 'Base target' });
    const baseFileRow = baseSection.createDiv({ cls: 'cad-de-form-row' });
    baseFileRow.createDiv({ cls: 'cad-de-form-label', text: 'Base file' });
    const baseFile = baseFileRow.createEl('input', { type: 'text', cls: 'cad-de-field cad-de-field-sm' });
    baseFile.value = baseObj.file || '';
    baseFile.placeholder = '00-CORE/Bases/... .base';
    baseFile.addEventListener('input', () => {
      setObjectField('base', { file: baseFile.value });
    });
    const baseViewRow = baseSection.createDiv({ cls: 'cad-de-form-row' });
    baseViewRow.createDiv({ cls: 'cad-de-form-label', text: 'Base view' });
    const baseView = baseViewRow.createEl('input', { type: 'text', cls: 'cad-de-field cad-de-field-sm' });
    baseView.value = baseObj.view || '';
    baseView.placeholder = 'View name';
    baseView.addEventListener('input', () => {
      setObjectField('base', { view: baseView.value });
    });
    const baseEntityRow = baseSection.createDiv({ cls: 'cad-de-form-row' });
    baseEntityRow.createDiv({ cls: 'cad-de-form-label', text: 'Base entity' });
    const baseEntity = baseEntityRow.createEl('input', { type: 'text', cls: 'cad-de-field cad-de-field-sm' });
    baseEntity.value = baseObj.entity || '';
    baseEntity.placeholder = 'entity key';
    baseEntity.addEventListener('input', () => {
      setObjectField('base', { entity: baseEntity.value });
    });

    if (String(card.kind || '').trim() === 'selector') {
      const selectorSection = form.createDiv({ cls: 'cad-de-section cad-de-section-compact' });
      selectorSection.createDiv({ cls: 'cad-de-section-label', text: 'Selector details' });
      addRow('Key', 'key');
      addRow('Label', 'label');
      addRow('Field', 'field');
      addRow('All label', 'allLabel');
      addRow('Mode', 'mode', ['value', 'date-range']);
      addRow('Options', 'options');
    }

    if (String(card.kind || '').trim() === 'kanban') {
      const kanbanSection = form.createDiv({ cls: 'cad-de-section cad-de-section-compact' });
      kanbanSection.createDiv({ cls: 'cad-de-section-label', text: 'Kanban details' });
      addRow('Group by', 'groupBy');
      addRow('Columns', 'columns');
      addRow('Groups', 'groups');
      addRow('Value field', 'valueField');
      addRow('Title fields', 'titleFields');
      addRow('Meta fields', 'metaFields');
      addRow('Sort', 'sort');
    }
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
    this._renderPageHeader(root, title, `${filtered.length} ${filtered.length === 1 ? def.label.toLowerCase() : def.plural.toLowerCase()} in ${entityFolder(entityKey)}${unsupportedText}`, (right, ctx) => {
      if (opts.renderHeaderControls) opts.renderHeaderControls(right, entityKey);
      this._renderEntityViewSelect(right, entityKey);
      if (def.externalBaseView) {
        const openBaseBtn = right.createEl('button', { cls: 'cad-btn', text: 'Open Base' });
        openBaseBtn.addEventListener('click', () => this._openEntityBase(entityKey));
      }
      if (!ctx.hasConfiguredActions) {
        const btn = right.createEl('button', { cls: 'cad-btn primary', text: `+ New ${def.label}` });
        btn.addEventListener('click', () => this._createEntityFromPrompt(entityKey));
      }
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
      if (!(await confirmModal(this.app, `Delete this ${def.label.toLowerCase()}? This moves the file to trash.`, { title: 'Delete', cta: 'Delete' }))) return;
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
        if (def.typeFilter === 'project') {
          if (f.key === 'project_id') inp.placeholder = 'Project ID';
          if (f.key === 'project_name') inp.placeholder = 'Project Name';
        } else if (f.key === primaryKey) {
          inp.placeholder = `${def.label} name`;
        }
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
    const titleVal = projectNameFromPath(this.app, file.path) || fm.project_name || fm.name || fm.project || fm[primaryKey] || file.basename;

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
      if (!(await confirmModal(this.app, `Delete this project? This moves the file to trash.`, { title: 'Delete project', cta: 'Delete' }))) return;
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
    this._renderPageHeader(root, 'Projects', `${files.length} ${files.length === 1 ? 'project' : 'projects'} in ${projectFolderLabel}${unsupportedText}`, (right, ctx) => {
      this._renderEntityViewSelect(right, 'project');
      if (def.externalBaseView) {
        const openBaseBtn = right.createEl('button', { cls: 'cad-btn', text: 'Open Base' });
        openBaseBtn.addEventListener('click', () => this._openEntityBase('project'));
      }
      if (!ctx.hasConfiguredActions) {
        const btn = right.createEl('button', { cls: 'cad-btn primary', text: '+ New Project' });
        btn.addEventListener('click', () => this._createEntityFromPrompt('project'));
      }
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
      title.addEventListener('click', (ev) => { ev.preventDefault(); ev.stopPropagation(); this.openEntityDetailFromFile(p.entity.file); });
      card.classList.add('clickable');
      card.addEventListener('click', () => this.openEntityDetailFromFile(p.entity.file));
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
        title.addEventListener('click', (ev) => { ev.preventDefault(); ev.stopPropagation(); this.openEntityDetailFromFile(p.entity.file); });
        card.classList.add('clickable');
        card.addEventListener('click', () => this.openEntityDetailFromFile(p.entity.file));
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
    const today = new Date();
    const dateStr = today.toLocaleDateString(undefined, { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric' });
    this._renderPageHeader(root, `${greeting()}.`, dateStr);
    await this.renderConfigDashboard('home', root, { skipHeader: true });
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

    this._renderPageHeader(root, 'Inbox', `${all.length} ${all.length === 1 ? 'item' : 'items'} · capture once, surface at the right time`, (right, ctx) => {
      if (!ctx.hasConfiguredActions) {
        const captureBtn = right.createEl('button', { cls: 'cad-btn primary', text: '+ Quick capture' });
        captureBtn.addEventListener('click', () => this.plugin.openQuickCapture());
      }
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
      link.addEventListener('click', (e) => { e.preventDefault(); this.openEntityDetailFromFile(g.file); });
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
        row.addEventListener('click', () => this.openEntityDetailFromFile(g.file));
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
        if (file && file instanceof obsidian.TFile) this.openEntityDetailFromFile(file);
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
    const delBtn = mk('×', 'Delete', async () => {
      if (await confirmModal(this.app, 'Delete this reminder?', { title: 'Delete reminder', cta: 'Delete' })) this.plugin.deleteReminder(r.id);
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
    try {
      const file = await ensureDailyNote(this.app, this.plugin.settings);
      const content = await this.app.vault.read(file);
      const parsed = parseSections(content, this.plugin.settings);
      const newTasks = [...parsed.tasks, `- [ ] ${text}`];
      const next = replaceSection(content, this.plugin.settings.tasksHeading, newTasks.join('\n'));
      await this.app.vault.modify(file, next);
      new obsidian.Notice('Added to today');
    } catch (e) {
      new obsidian.Notice(`Couldn't add task: ${e.message}`);
    }
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
    this._renderPageHeader(root, def.plural, `${entities.length} ${entities.length === 1 ? def.label.toLowerCase() : def.plural.toLowerCase()} · ${fmtValue(totalValue, 'currency')} total${unsupportedText}`, (right, ctx) => {
      this._renderEntityViewSelect(right, entityKey);
      if (def.externalBaseView) {
        const openBaseBtn = right.createEl('button', { cls: 'cad-btn', text: 'Open Base' });
        openBaseBtn.addEventListener('click', () => this._openEntityBase(entityKey));
      }
      if (!ctx.hasConfiguredActions) {
        const btn = right.createEl('button', { cls: 'cad-btn primary', text: `+ New ${def.label}` });
        btn.addEventListener('click', () => this._createEntityFromPrompt(entityKey));
      }
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
    this._renderPageHeader(root, 'CRM Dashboard', 'Pipeline · momentum · recent activity', (right, ctx) => {
      if (!ctx.hasConfiguredActions) {
        const newDeal = right.createEl('button', { cls: 'cad-btn primary', text: '+ New Deal' });
        newDeal.addEventListener('click', () => this._createEntityFromPrompt('deal'));
      }
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
      if (r.file) row.addEventListener('click', () => {
        if (r.entityKey) {
          this.openEntityDetail(r.entityKey, r.file);
          return;
        }
        this.openEntityDetailFromFile(r.file);
      });
    });
  }

  async _productivitySnapshot() {
    return buildProductivitySnapshot(this.app, this.plugin.settings);
  }

  /* ── Reports: Productivity (over daily notes) ── */
  async renderProductivity(root) {
    return this.renderConfigDashboard('reports.productivity', root);
  }

  async renderReportPipeline(root) {
    return this.renderConfigDashboard('reports.pipeline', root);
  }

  async renderReportSales(root) {
    return this.renderConfigDashboard('reports.sales', root);
  }

  async renderReportPartners(root) {
    return this.renderConfigDashboard('reports.partners', root);
  }

  async renderReportActivity(root) {
    return this.renderConfigDashboard('reports.activity', root);
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

  /* ── Settings (opens Obsidian settings → BOB Workspace) ─ */
  async openSettingsTab(root) {
    root.addClass('cadence-soon');
    const wrap = root.createDiv({ cls: 'cad-soon-wrap' });
    const ic = wrap.createDiv({ cls: 'cad-soon-icon' });
    try { obsidian.setIcon(ic, 'settings-2'); } catch (_) {}
    wrap.createDiv({ cls: 'cad-eyebrow', text: 'BOB WORKSPACE' });
    wrap.createDiv({ cls: 'cad-soon-title', text: 'Settings' });
    wrap.createDiv({ cls: 'cad-soon-desc', text: 'Configure folders, headings, week start, default tab, and the future BOB Workspace backend connection.' });
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
              if (f instanceof obsidian.TFile) this.openEntityDetailFromFile(f);
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
    });
    ta.addEventListener('blur', () => {
      this.saveTodayJournal(ta.value);
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
  constructor(app, plugin) { super(app, plugin); this.plugin = plugin; this._reviewActiveTab = 'overview'; this._reviewRenderSeq = 0; }

  _dashboardSettingsRenderer() {
    if (!this._dashboardRenderer) {
      const renderer = Object.create(CadenceAppView.prototype);
      renderer.mode = 'settings.dashboard-editor';
      renderer.detailFile = null;
      renderer.detailEntityKey = null;
      renderer._dashboardState = {};
      renderer._clientWorkClientId = '';
      renderer._clientWorkProjectId = '';
      renderer.render = async () => {};
      renderer.setMode = async (mode) => this.plugin.openApp(mode);
      renderer.openEntityDetailFromFile = (file) => {
        if (!file?.path) return;
        this.plugin.app.workspace.openLinkText(file.path, '', false);
      };
      this._dashboardRenderer = renderer;
    }
    this._dashboardRenderer.app = this.plugin.app;
    this._dashboardRenderer.plugin = this.plugin;
    this._dashboardRenderer.settings = this.plugin.settings;
    return this._dashboardRenderer;
  }

  display() {
    const { containerEl } = this;
    containerEl.empty();
    containerEl.createEl('h2', { text: 'BOB Workspace' });

    const fork = containerEl.createEl('p', { cls: 'setting-item-description' });
    fork.appendText('BOB Workspace is a fork of the ');
    fork.createEl('a', {
      text: 'Upstream Cadence Planner',
      href: 'https://github.com/iotool/obsidian-cadence-planner',
    }).setAttribute('target', '_blank');
    fork.appendText(' Obsidian plugin, extended with canonical schema editing, .base files, vault-aware entity mapping, and configurable folders. ');
    fork.createEl('strong', { text: 'Folder structure alignment with upstream Cadence is available, but should be verified in any mixed-vault setup' });
    fork.appendText(' — if you switch between forks, back up your vault first.');

    /* ─── Settings tab bar ─── */
    const TAB_IDS = ['workspace', 'review', 'navigation', 'dashboards', 'widgets', 'modules', 'data-model', 'planner', 'app', 'exports', 'data'];
    const TAB_LABELS = ['Workspace', 'Review', 'Navigation', 'Dashboards', 'Widgets', 'Modules', 'Data model', 'Planner', 'App', 'Exports', 'Data'];
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
    const pReview = tabPanels['review'];
    const pNav = tabPanels['navigation'];
    const pDash = tabPanels['dashboards'];
    const pWidgets = tabPanels['widgets'];
    const pMod = tabPanels['modules'];
    const pDm = tabPanels['data-model'];
    const pPlanner = tabPanels['planner'];
    const pApp = tabPanels['app'];
    const pExp = tabPanels['exports'];
    const pData = tabPanels['data'];

    /* ─── Workspace configuration (workspace.json) ─── */
    pWs.createEl('h3', { text: 'Workspace definition' });
    const workspaceDesc = pWs.createEl('p', { cls: 'setting-item-description' });
    workspaceDesc.appendText('Define schema loading, Base/view associations and templates in ');
    workspaceDesc.createEl('code', { text: 'workspace.json' });
    workspaceDesc.appendText(' next to plugin data. Use the other tabs for navigation, dashboards, widget catalog and export-group editing.');

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
        renderWorkspaceDesigners();
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
        void renderWorkspaceReview();
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
        renderWorkspaceDesigners();
      } catch (e) {
        setWorkspaceStatus(`Cannot format: ${e.message}`, false);
      }
    });
    const workspaceSaveBtn = workspaceBtns.createEl('button', { text: 'Save and apply', cls: 'mod-cta' });
    workspaceSaveBtn.addEventListener('click', async () => {
      try {
        const parsed = validateWorkspaceConfig(migrateWorkspacePlannerConfig(JSON.parse(workspaceTa.value)));
        await saveWorkspaceConfig(this.plugin.app, workspaceTa.value);
        if (parsed.schemas?.enabled) {
          const bootstrap = await bootstrapCanonicalSchemaSourcesIfMissing(this.plugin.app, this.plugin.settings);
          if (bootstrap.count) {
            await regenerateSchemaOutputs(this.plugin.app, this.plugin.settings);
          }
        }
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
        renderWorkspaceDesigners();
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
        workspaceTa.value = JSON.stringify(config, null, 2);
        setWorkspaceStatus('Base associations imported into workspace draft - click Save and apply', true);
        renderWorkspaceDesigners();
      } catch (e) {
        setWorkspaceStatus(`Import failed: ${e.message}`, false);
      }
    });

    pWs.createEl('h3', { text: 'Workspace templates' });
    const templateDesc = pWs.createEl('p', { cls: 'setting-item-description' });
    templateDesc.appendText('Select a workspace template from ');
    templateDesc.createEl('code', { text: `${PLUGIN_DIR}/templates` });
    templateDesc.appendText('. Applying a template writes the active ');
    templateDesc.createEl('code', { text: 'workspace.json' });
    templateDesc.appendText(' and stores the selected template in plugin data.');
    const templateWrap = pWs.createDiv({ cls: 'setting-group cad-settings-section' });
    const templatePanel = templateWrap.createDiv({ cls: 'setting-items' });
    const templateStatus = templatePanel.createDiv({ cls: 'setting-item-description' });
    const templateRow = templatePanel.createDiv({ cls: 'cad-workspace-template-row' });
    const templateSelect = templateRow.createEl('select', { cls: 'dropdown' });
    const templateReloadBtn = templateRow.createEl('button', { text: 'Reload' });
    const templateApplyBtn = templateRow.createEl('button', { text: 'Apply selected', cls: 'mod-cta' });
    const templateMeta = templatePanel.createDiv({ cls: 'setting-item-description' });
    let workspaceTemplates = [];
    const renderTemplateMeta = () => {
      const selected = workspaceTemplates.find((tpl) => workspaceTemplateKey(tpl) === templateSelect.value);
      const meta = selected?._template;
      if (!meta) {
        templateMeta.setText('');
        templateApplyBtn.disabled = true;
        return;
      }
      templateApplyBtn.disabled = false;
      const pathText = selected._templatePath ? ` · ${selected._templatePath}` : '';
      templateMeta.setText(`${meta.label || workspaceTemplateKey(selected)}${meta.description ? ` - ${meta.description}` : ''}${pathText}`);
    };
    const refreshWorkspaceTemplateSelector = async () => {
      workspaceTemplates = await loadWorkspaceTemplates(this.plugin.app);
      templateSelect.empty();
      if (!workspaceTemplates.length) {
        templateSelect.createEl('option', { value: '', text: 'No templates found' });
        templateStatus.setText(`No template JSON files found in ${PLUGIN_DIR}/templates.`);
        templateApplyBtn.disabled = true;
        renderTemplateMeta();
        return;
      }
      workspaceTemplates.forEach((tpl) => {
        const key = workspaceTemplateKey(tpl);
        const meta = tpl._template || {};
        const option = templateSelect.createEl('option', { value: key, text: meta.label || key });
        if (key === this.plugin.settings.activeWorkspaceTemplate) option.selected = true;
      });
      if (!templateSelect.value && workspaceTemplates[0]) templateSelect.value = workspaceTemplateKey(workspaceTemplates[0]);
      const active = this.plugin.settings.activeWorkspaceTemplate || 'none';
      templateStatus.setText(`Loaded ${workspaceTemplates.length} template${workspaceTemplates.length === 1 ? '' : 's'} · active: ${active}`);
      renderTemplateMeta();
    };
    templateSelect.addEventListener('change', renderTemplateMeta);
    templateReloadBtn.addEventListener('click', () => refreshWorkspaceTemplateSelector());
    templateApplyBtn.addEventListener('click', async () => {
      const selected = workspaceTemplates.find((tpl) => workspaceTemplateKey(tpl) === templateSelect.value);
      if (!selected) return;
      try {
        const meta = await applyWorkspaceTemplate(this.plugin.app, this.plugin, selected);
        if (await adapter.exists(WORKSPACE_CONFIG_PATH)) {
          workspaceTa.value = await adapter.read(WORKSPACE_CONFIG_PATH);
        }
        setWorkspaceStatus(`Applied template: ${meta.label}`, true);
        templateStatus.setText(`Loaded ${workspaceTemplates.length} template${workspaceTemplates.length === 1 ? '' : 's'} · active: ${workspaceTemplateKey(selected)}`);
        renderWorkspaceDesigners();
        void renderWorkspaceReview();
        new obsidian.Notice(`BOB Workspace: "${meta.label}" template applied.`);
      } catch (e) {
        templateStatus.setText(`Template apply failed: ${e.message}`);
        new obsidian.Notice(`BOB Workspace: template apply failed - ${e.message}`);
      }
    });
    setTimeout(() => refreshWorkspaceTemplateSelector(), 0);

    const navDesigner = pNav.createDiv({ cls: 'cad-nav-designer' });
    const navDesignerHead = navDesigner.createDiv({ cls: 'cad-nav-designer-head' });
    navDesignerHead.createEl('h4', { text: 'Navigation designer' });
    navDesignerHead.createEl('p', {
      cls: 'setting-item-description',
      text: 'Drag unassigned tabs or record types into groups and move existing menu items between groups. Choose icons from Obsidian\'s registered icon library. Remove an item to return it to its available pool. Changes update the workspace JSON draft; use Save and apply above to persist them.',
    });
    const navDesignerBody = navDesigner.createDiv({ cls: 'cad-nav-designer-body' });
    pExp.createEl('h3', { text: 'Exports' });
    const workbookDesigner = pExp.createDiv({ cls: 'cad-workbook-designer' });
    const workbookDesignerHead = workbookDesigner.createDiv({ cls: 'cad-nav-designer-head' });
    workbookDesignerHead.createEl('h4', { text: 'Workbook export groups' });
    workbookDesignerHead.createEl('p', {
      cls: 'setting-item-description',
      text: 'Define reusable XLSX export bundles in workspace.json. Assign a record type to more than one bundle when separate exports need overlapping data.',
    });
    const workbookDesignerBody = workbookDesigner.createDiv({ cls: 'cad-workbook-designer-body' });

    const readWorkspaceDraft = () => validateWorkspaceConfig(migrateWorkspacePlannerConfig(JSON.parse(workspaceTa.value)));
    const reviewText = (value, fallback = '—') => {
      if (value == null || value === '') return fallback;
      if (Array.isArray(value)) return value.length ? value.join(', ') : fallback;
      if (value && typeof value === 'object') {
        const text = JSON.stringify(value);
        return text.length > 120 ? `${text.slice(0, 117)}…` : text;
      }
      return String(value);
    };
    const renderReviewTable = (parent, title, headers, rows, emptyText = 'Nothing to review yet') => {
      const section = parent.createDiv({ cls: 'cad-review-section' });
      section.createDiv({ cls: 'cad-section-label-lg', text: title });
      if (!rows.length) {
        section.createDiv({ cls: 'cad-empty', text: emptyText });
        return section;
      }
      const wrap = section.createDiv({ cls: 'cad-review-table-wrap' });
      const table = wrap.createEl('table', { cls: 'cad-review-table' });
      const thead = table.createEl('thead');
      const headRow = thead.createEl('tr');
      headers.forEach((header) => headRow.createEl('th', { text: header }));
      const tbody = table.createEl('tbody');
      rows.forEach((row) => {
        const tr = tbody.createEl('tr');
        row.forEach((cell) => tr.createEl('td', { text: reviewText(cell) }));
      });
      return section;
    };
    const widgetSourceSummary = (source) => {
      if (!source || typeof source !== 'object' || Array.isArray(source)) return reviewText(source, '');
      const bits = [];
      if (source.mode) bits.push(`mode:${source.mode}`);
      if (source.builtIn) bits.push(`built-in:${source.builtIn}`);
      if (source.section) bits.push(`section:${source.section}`);
      if (source.entity || source.entityKey) bits.push(`entity:${source.entity || source.entityKey}`);
      if (source.base) {
        const base = source.base;
        const file = base.file || base.base || base.path || base.basePath || base;
        bits.push(`base:${reviewText(file, '')}`);
      }
      if (source.view) bits.push(`view:${source.view}`);
      if (source.groupBy) bits.push(`groupBy:${source.groupBy}`);
      if (source.field) bits.push(`field:${source.field}`);
      if (source.limit != null) bits.push(`limit:${source.limit}`);
      return bits.join(' · ');
    };
    const collectWidgetRows = (surfaceId, surfaceConfig = {}) => {
      const rows = [];
      const pushCard = (section, card, idx, extra = '') => {
        if (!card || typeof card !== 'object') return;
        rows.push([
          card.title || card.label || '(untitled)',
          surfaceId,
          section,
          idx,
          card.kind || 'list',
          widgetSourceSummary(card.source),
          card.entity || card.source?.entity || card.source?.entityKey || '',
          card.metric || card.count?.metric || '',
          card.field || card.valueField || card.groupBy || '',
          card.limit != null ? String(card.limit) : '',
          extra,
        ]);
      };
      (surfaceConfig.stats || []).forEach((stat, idx) => pushCard('stats', stat, idx + 1));
      (surfaceConfig.controls || []).forEach((control, idx) => pushCard('controls', control, idx + 1));
      (surfaceConfig.layout || []).forEach((row, rowIdx) => {
        (row || []).forEach((colDef, colIdx) => {
          (Array.isArray(colDef) ? colDef : [colDef]).forEach((card, cardIdx) => {
            pushCard(`layout ${rowIdx + 1}.${colIdx + 1}`, card, cardIdx + 1);
          });
        });
      });
      (surfaceConfig.conditionalRows || []).forEach((row, rowIdx) => {
        (row.cards || []).forEach((card, cardIdx) => {
          pushCard(`conditional ${rowIdx + 1}`, card, cardIdx + 1, widgetSourceSummary(row.condition));
        });
      });
      return rows;
    };
    const loadReviewSchemaSources = async (folder) => {
      const adapter = this.plugin.app.vault.adapter;
      const result = { folder, schemas: [], errors: [] };
      if (!folder || !await adapter.exists(folder)) return result;
      const listed = await adapter.list(folder);
      for (const filePath of (listed.files || []).filter((file) => /\.ya?ml$/i.test(file))) {
        try {
          const schema = validateSourceSchemaDefinition(obsidian.parseYaml(await adapter.read(filePath)));
          result.schemas.push({ path: filePath, schema });
        } catch (e) {
          result.errors.push(`${filePath}: ${e.message}`);
        }
      }
      return result;
    };
    const renderWorkspaceReview = async () => {
      if (!pReview) return;
      const reviewSeq = ++this._reviewRenderSeq;
      pReview.empty();
      let config;
      try {
        config = readWorkspaceDraft();
      } catch (_) {
        config = WORKSPACE_CONFIG;
      }
      const activeTab = this._reviewActiveTab || 'overview';
      const reviewTabs = [
        ['overview', 'Overview'],
        ['navigation', 'Navigation'],
        ['secondary', 'Secondary tabs'],
        ['bases', 'Bases'],
        ['surfaces', 'Dashboards + planner'],
        ['widgets', 'Widgets'],
        ['reverse', 'Reverse map'],
        ['unassigned', 'Unassigned'],
      ];
      if (!reviewTabs.some(([id]) => id === activeTab)) this._reviewActiveTab = 'overview';
      const tabBar = pReview.createDiv({ cls: 'cad-settings-tabs cad-review-tabs' });
      const panel = pReview.createDiv({ cls: 'cad-settings-tab-panel cad-review-panel' });
      const setActiveTab = (id) => {
        this._reviewActiveTab = id;
        void renderWorkspaceReview();
      };
      reviewTabs.forEach(([id, label]) => {
        const btn = tabBar.createEl('button', { cls: 'cad-settings-tab cad-review-tab', text: label });
        btn.toggleClass('is-active', id === activeTab);
        btn.addEventListener('click', () => setActiveTab(id));
      });

      const navigation = config.navigation || {};
      const navGroups = Array.isArray(navigation.groups) ? navigation.groups : [];
      const secondaryTabs = navigation.secondaryTabs || {};
      const dashboardEntries = Object.entries(config.dashboards || {}).sort(([a], [b]) => a.localeCompare(b));
      const plannerEntries = Object.entries(config.planner || {}).sort(([a], [b]) => a.localeCompare(b));
      const baseKeys = Array.from(new Set([
        ...Object.keys(config.bases || {}),
        ...Object.keys(this.plugin.settings.baseFiles || {}),
        ...Object.keys(this.plugin.settings.baseViews || {}),
      ])).sort();
      const schemaFolder = (config.schemas?.folder || this.plugin.settings.schemasFolder || SCHEMA_FOLDER_DEFAULT).replace(/\/$/, '');
      const schemaSources = await loadReviewSchemaSources(schemaFolder);
      if (this._reviewRenderSeq !== reviewSeq) return;
      const counts = [
        ['Nav groups', navGroups.length],
        ['Primary nav items', navGroups.reduce((sum, group) => sum + (group.items?.length || 0), 0)],
        ['Secondary tab sets', Object.keys(secondaryTabs).length],
        ['Base mappings', baseKeys.length],
        ['Dashboards', dashboardEntries.length],
        ['Planner surfaces', plannerEntries.length],
        ['Workbook groups', Array.isArray(config.workbookGroups) ? config.workbookGroups.length : 0],
        ['Schema sources', schemaSources.schemas.length],
      ];

      const configuredNavIds = new Set(navGroups.flatMap((group) => (group.items || []).map((item) => item.id)));
      const navRows = [];
      NAV_GROUPS.forEach((group, groupIndex) => {
        (group.items || []).forEach((surface, itemIndex) => {
          const visibleReasons = [];
          if ((this.plugin.settings.disabledSurfaces || []).includes(surface.id)) visibleReasons.push('disabled');
          if (surface.module && this.plugin.settings.modules?.[surface.module] === false) visibleReasons.push(`module:${surface.module} off`);
          if (surface.navLevel === 'secondary' && !this.plugin.settings.showSecondaryNav) visibleReasons.push('secondary hidden');
          if (surface.navLevel === 'setup' && !this.plugin.settings.showSetupNav) visibleReasons.push('setup hidden');
          navRows.push([
            surface.label || surface.id || '',
            surface.id || '',
            group.label || group.id || '',
            `${groupIndex + 1}.${itemIndex + 1}`,
            surface.parent || '',
            surface.navLevel || 'primary',
            surface.module || '',
            surface.entityKey || '',
            configuredNavIds.has(surface.id) ? 'configured' : 'fallback',
            visibleReasons.length ? visibleReasons.join(' · ') : 'visible',
          ]);
        });
      });

      const secondaryRows = [];
      Object.entries(secondaryTabs).forEach(([parentId, tabs]) => {
        (tabs || []).forEach((tab, idx) => {
          secondaryRows.push([
            tab.label || tab.route || tab.entityKey || `Tab ${idx + 1}`,
            parentId,
            idx + 1,
            tab.route || '',
            tab.entityKey || '',
            tab.icon || '',
            Array.isArray(tab.children) ? `${tab.children.length} children` : '',
          ]);
        });
      });

      const baseRows = baseKeys.map((entityKey) => {
        const configured = config.bases?.[entityKey] || {};
        const effectivePath = entityBasePath(this.plugin.settings, entityKey);
        const effectiveView = entityBaseViewName(this.plugin.settings, entityKey);
        const source = config.bases?.[entityKey] ? 'workspace.json.bases' : ((this.plugin.settings.baseFiles || {})[entityKey] || (this.plugin.settings.baseViews || {})[entityKey] ? 'plugin settings' : '');
        return [
          ENTITIES[entityKey]?.label || entityKey,
          entityKey,
          effectivePath || configured.file || configured.base || '',
          effectiveView || configured.view || configured.baseView || '',
          source,
        ];
      });

      const surfaceConfigs = [
        ...dashboardEntries.map(([id, surfaceConfig]) => ({ store: 'dashboards', id, surfaceConfig })),
        ...plannerEntries.map(([id, surfaceConfig]) => ({ store: 'planner', id, surfaceConfig })),
      ];
      const surfaceRows = surfaceConfigs.map(({ store, id, surfaceConfig }) => {
        const summary = summarizeDashboardBlueprint(id, surfaceConfig || {});
        return [
          summary.title,
          store,
          id,
          summary.kind,
          summary.statsCount,
          summary.cardCount,
          summary.widgetKinds.join(', ') || 'none',
          summary.sourceKinds.join(', ') || 'n/a',
          summary.contextFilter || '',
        ];
      });
      const widgetRows = surfaceConfigs.flatMap(({ id, surfaceConfig }) => collectWidgetRows(id, surfaceConfig || {}));

      const allEntityKeys = new Set([
        ...schemaSources.schemas.map(({ schema }) => SCHEMA_TO_ENTITY_KEY[schema.entity] || schema.entity),
        ...baseKeys,
        ...navGroups.flatMap((group) => (group.items || []).map((surface) => surface.entityKey).filter(Boolean)),
        ...Object.values(secondaryTabs).flatMap((tabs) => (tabs || []).map((tab) => tab.entityKey).filter(Boolean)),
      ]);
      const allEntityRows = [...allEntityKeys]
        .sort((a, b) => String(ENTITIES[a]?.label || a).localeCompare(String(ENTITIES[b]?.label || b)))
        .map((entityKey) => {
          const schemaSource = schemaSources.schemas.find(({ schema }) => (SCHEMA_TO_ENTITY_KEY[schema.entity] || schema.entity) === entityKey) || null;
          const navMatches = [];
          navGroups.forEach((group) => {
            (group.items || []).forEach((surface) => {
              if (surface.entityKey !== entityKey) return;
              navMatches.push(`${group.label || group.id || ''} / ${surface.label || surface.id || surface.entityKey}`);
            });
          });
          const tabMatches = [];
          Object.entries(secondaryTabs).forEach(([parentId, tabs]) => {
            const parentSurface = navGroups.flatMap((group) => group.items || []).find((surface) => surface.id === parentId);
            (tabs || []).forEach((tab) => {
              if (tab.entityKey !== entityKey) return;
              tabMatches.push(`${parentSurface?.label || parentId} / ${tab.label || tab.route || tab.entityKey}`);
            });
          });
          const basePath = entityBasePath(this.plugin.settings, entityKey) || config.bases?.[entityKey]?.file || config.bases?.[entityKey]?.base || '';
          const baseView = entityBaseViewName(this.plugin.settings, entityKey) || config.bases?.[entityKey]?.view || config.bases?.[entityKey]?.baseView || '';
          const inMenu = navMatches.length > 0 || tabMatches.length > 0;
          const sourceBits = [];
          if (schemaSource?.path) sourceBits.push('schema');
          if (basePath) sourceBits.push('base');
          if (!sourceBits.length) sourceBits.push('unmapped');
          return {
            label: ENTITIES[entityKey]?.label || schemaSource?.schema?.label || entityKey,
            entityKey,
            schemaPath: schemaSource?.path || '',
            basePath,
            baseView,
            navMatches,
            tabMatches,
            menuStatus: inMenu ? 'in menu' : 'not in menu',
            sourceStatus: sourceBits.join(' + '),
          };
        });
      const reverseRows = allEntityRows.map((row) => ([
        row.label,
        row.entityKey,
        row.schemaPath || '—',
        row.basePath || '—',
        row.baseView || '—',
        row.navMatches.length ? row.navMatches.join(' · ') : '—',
        row.tabMatches.length ? row.tabMatches.join(' · ') : '—',
        row.menuStatus,
        row.sourceStatus,
      ]));
      const unassignedRows = allEntityRows
        .filter((row) => row.menuStatus !== 'in menu' && (row.schemaPath || row.basePath))
        .map((row) => ([
          row.label,
          row.entityKey,
          row.schemaPath || '—',
          row.basePath || '—',
          row.baseView || '—',
          row.sourceStatus,
        ]));

      if (schemaSources.errors.length) {
        const details = panel.createEl('details', { cls: 'cad-base-filter-warnings' });
        details.createEl('summary', { text: `${schemaSources.errors.length} schema source warning${schemaSources.errors.length === 1 ? '' : 's'}` });
        const list = details.createEl('ul');
        schemaSources.errors.forEach((error) => {
          list.createEl('li').createEl('code', { text: error });
        });
      }

      if (activeTab === 'overview') {
        const summary = panel.createDiv({ cls: 'cad-review-summary' });
        counts.forEach(([label, value]) => {
          const card = summary.createDiv({ cls: 'cad-review-summary-card' });
          card.createDiv({ cls: 'cad-review-summary-value', text: String(value) });
          card.createDiv({ cls: 'cad-review-summary-label', text: String(label) });
        });
        const note = panel.createDiv({ cls: 'cad-widget-gap' });
        note.createDiv({ cls: 'cad-widget-gap-title', text: 'Review focus' });
        note.createDiv({
          cls: 'setting-item-description',
          text: 'Use the dedicated tabs to inspect navigation, bases, dashboards, widgets, and the reverse entity mapping. The reverse map shows which schema and base-backed entities are not yet represented in the menu tree.',
        });
        const missingCount = allEntityRows.filter((row) => row.menuStatus !== 'in menu' && (row.schemaPath || row.basePath)).length;
        const missingCard = note.createDiv({ cls: 'cad-review-summary-card' });
        missingCard.createDiv({ cls: 'cad-review-summary-value', text: String(missingCount) });
        missingCard.createDiv({ cls: 'cad-review-summary-label', text: 'Entities not in menu' });
      } else if (activeTab === 'navigation') {
        renderReviewTable(panel, 'Navigation inventory', ['Label', 'Surface', 'Group', 'Order', 'Parent', 'Level', 'Module', 'Entity', 'Source', 'Visibility'], navRows, 'No navigation items are available.');
      } else if (activeTab === 'secondary') {
        renderReviewTable(panel, 'Secondary tabs', ['Tab', 'Parent', '#', 'Route', 'Entity', 'Icon', 'Children'], secondaryRows, 'No secondary tabs are configured.');
      } else if (activeTab === 'bases') {
        renderReviewTable(panel, 'Effective base mappings', ['Label', 'Entity', 'Base file', 'View', 'Source'], baseRows, 'No base mappings are configured.');
      } else if (activeTab === 'surfaces') {
        renderReviewTable(panel, 'Configured dashboards and planner surfaces', ['Title', 'Store', 'Surface', 'Kind', 'Stats', 'Cards', 'Widgets', 'Sources', 'Context'], surfaceRows, 'No dashboard or planner surfaces are configured.');
      } else if (activeTab === 'widgets') {
        renderReviewTable(panel, 'Widget inventory', ['Title', 'Surface', 'Section', '#', 'Kind', 'Source', 'Entity', 'Metric', 'Field / Group', 'Limit', 'Condition / Notes'], widgetRows, 'No widgets are configured.');
      } else if (activeTab === 'reverse') {
        renderReviewTable(panel, 'Reverse entity map', ['Label', 'Entity', 'Schema file', 'Base file', 'View', 'Nav group/item', 'Tab parent/tab', 'Menu status', 'Source status'], reverseRows, 'No schema or base mappings are available.');
      } else if (activeTab === 'unassigned') {
        renderReviewTable(panel, 'Entities missing from the menu tree', ['Label', 'Entity', 'Schema file', 'Base file', 'View', 'Source status'], unassignedRows, 'No schema-backed or base-backed entities are currently missing from the menu tree.');
      }
    };
    let dashboardRenderer = null;
    const renderWorkspaceDesigners = () => {
      renderNavDesigner();
      renderWorkbookDesigner();
      void renderWorkspaceReview();
      if (dashboardRenderer) {
        pDash.empty();
        void dashboardRenderer.renderDashboardEditor(pDash).catch((e) => {
          pDash.createDiv({ cls: 'setting-item-description', text: `Dashboard editor failed: ${e.message}` });
        });
        pWidgets.empty();
        dashboardRenderer._renderWidgetCatalog(pWidgets);
      }
    };
    const updateWorkspaceDraft = (config, message) => {
      workspaceTa.value = JSON.stringify(config, null, 2);
      setWorkspaceStatus(message || 'Workspace changed - click Save and apply', true);
      WORKSPACE_CONFIG = validateWorkspaceConfig(migrateWorkspacePlannerConfig(config));
      renderWorkspaceDesigners();
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
      workspaceConfiguredEntityEntries(config).forEach(([entityKey, def]) => {
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
      const entities = workspaceConfiguredEntityEntries(config);
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
    workspaceTa.addEventListener('input', () => {
      try {
        const parsed = readWorkspaceDraft();
        WORKSPACE_CONFIG = parsed;
        setWorkspaceStatus(`Valid - ${parsed.navigation?.groups?.length || 0} navigation group${(parsed.navigation?.groups?.length || 0) === 1 ? '' : 's'}`, true);
        renderWorkspaceDesigners();
      } catch (e) {
        setWorkspaceStatus(`Invalid JSON/config: ${e.message}`, false);
      }
    });
    setTimeout(renderWorkspaceDesigners, 0);

    /* ─── Dashboards ─── */
    pDash.createEl('h3', { text: 'Dashboards' });
    pDash.createEl('p', {
      cls: 'setting-item-description',
      text: 'Use the dashboard editor to tune the shipped surfaces. The dashboard tab stays focused on composition; the widget catalog and gap analysis live next door.',
    });
    dashboardRenderer = this._dashboardSettingsRenderer();
    void dashboardRenderer.renderDashboardEditor(pDash).catch((e) => {
      pDash.createDiv({ cls: 'setting-item-description', text: `Dashboard editor failed: ${e.message}` });
    });
    dashboardRenderer._renderDashboardInventory(pDash);

    /* ─── Widgets ─── */
    pWidgets.createEl('h3', { text: 'Widget catalog' });
    dashboardRenderer._renderWidgetCatalog(pWidgets);

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
    if (schemasManaged) {
      const banner = schemasPanel.createDiv({ cls: 'cad-managed-banner' });
      const icon = banner.createSpan({ cls: 'cad-managed-banner-icon' });
      try { obsidian.setIcon(icon, 'lock'); } catch (_) {}
      banner.createSpan({ text: 'Schema settings are controlled by ' });
      banner.createEl('code', { text: 'workspace.json' });
      banner.createSpan({ text: '. Edit the ' });
      const wsLink = banner.createEl('a', { text: 'Workspace tab', cls: 'cad-managed-banner-link' });
      wsLink.addEventListener('click', () => {
        const wsTab = containerEl.querySelector('.cad-settings-tab[data-tab="workspace"]');
        if (wsTab) wsTab.click();
      });
      banner.createSpan({ text: ' to change them.' });
    }
    new obsidian.Setting(schemasPanel)
      .setName('Use schema YAML files')
      .setDesc('Read entity definitions (folders, type filters, field types, enum options) from Metadata Menu schema YAML files.')
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
      .setDesc('Vault path where schema YAML files live (one per entity).')
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
            new obsidian.Notice(`BOB Workspace: generated ${result.count} FileClass and JSON Schema output(s); removed ${result.removed} stale output(s)${result.datamodelUpdated ? `; updated ${result.datamodelUpdated} DATAMODEL section(s)` : ''}.`);
            await reloadEntityConfiguration(this.plugin.app, this.plugin.settings);
            this.plugin.refreshOpenViews();
          } catch (e) {
            new obsidian.Notice(`BOB Workspace: output generation failed - ${e.message}`);
          }
        }));

    const schemaBootstrapBanner = schemasPanel.createDiv({ cls: 'cad-managed-banner cad-schema-bootstrap-banner' });
    schemaBootstrapBanner.style.display = 'none';
    const bootstrapIcon = schemaBootstrapBanner.createSpan({ cls: 'cad-managed-banner-icon' });
    try { obsidian.setIcon(bootstrapIcon, 'database'); } catch (_) {}
    const bootstrapText = schemaBootstrapBanner.createSpan({ text: 'No schema sources found in the configured folder.' });
    schemaBootstrapBanner.createSpan({ text: ' ' });
    const bootstrapAction = schemaBootstrapBanner.createEl('button', { cls: 'cad-btn cad-btn-sm', text: 'Bootstrap schemas' });
    bootstrapAction.addEventListener('click', async () => {
      if (!(await confirmModal(this.plugin.app, 'Create canonical schema YAML from the current workspace entity definitions? Existing source files will be left untouched.', { title: 'Bootstrap schemas', cta: 'Bootstrap', danger: false }))) return;
      try {
        const result = await bootstrapCanonicalSchemaSources(this.plugin.app, this.plugin.settings);
        const regen = await regenerateSchemaOutputs(this.plugin.app, this.plugin.settings);
        await reloadEntityConfiguration(this.plugin.app, this.plugin.settings);
        this.plugin.refreshOpenViews();
        new obsidian.Notice(`BOB Workspace: bootstrapped ${result.count} schema source file${result.count === 1 ? '' : 's'}${result.skipped ? `; skipped ${result.skipped} existing source file${result.skipped === 1 ? '' : 's'}` : ''}. Generated ${regen.count} FileClass and JSON Schema output(s).`);
        this.display();
      } catch (e) {
        new obsidian.Notice(`BOB Workspace: schema bootstrap failed - ${e.message}`);
      }
    });

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
    (async () => {
      try {
        const loaded = await loadCanonicalSchemaSources(this.plugin.app, this.plugin.settings);
        const empty = !loaded.schemas.length;
        schemaBootstrapBanner.style.display = empty ? '' : 'none';
        bootstrapText.setText(empty
          ? `No schema sources found in ${schemaFolder}.`
          : `Found ${loaded.schemas.length} schema source${loaded.schemas.length === 1 ? '' : 's'} in ${schemaFolder}.`);
      } catch (_) {
        schemaBootstrapBanner.style.display = 'none';
      }
    })();

    const setSchemaStatus = (text, ok = true) => {
      schemaStatus.setText(text || '');
      schemaStatus.toggleClass('cad-status-ok', !!ok);
      schemaStatus.toggleClass('cad-status-err', !ok);
    };
    const highlightSaveButtons = (on) => {
      schemaSave.toggleClass('cad-schema-save-needed', on);
      schemaSaveGenerate.toggleClass('cad-schema-save-needed', on);
    };
    const autoSaveSchema = async () => {
      if (!sourceSchema || !sourceSchemaPath) return;
      try { validateSourceSchemaDefinition(sourceSchema); } catch (e) {
        setSchemaStatus(`Fix before saving: ${e.message}`, false);
        highlightSaveButtons(true);
        return;
      }
      const renamedPath = `${schemaFolder}/${sourceSchema.entity}.yaml`;
      if (sourceSchemaPath !== renamedPath && await adapter.exists(sourceSchemaPath)) {
        setSchemaStatus('Entity key changed — use Save to rename the file', false);
        highlightSaveButtons(true);
        return;
      }
      try {
        const targetPath = (await adapter.exists(sourceSchemaPath)) ? sourceSchemaPath : renamedPath;
        await ensureFolderSync(this.plugin.app, schemaFolder);
        if (await adapter.exists(targetPath)) {
          await adapter.write(`${targetPath}.backup`, await adapter.read(targetPath));
        }
        await adapter.write(targetPath, obsidian.stringifyYaml(sourceSchema));
        sourceSchemaPath = targetPath;
        schemaDirty = false;
        highlightSaveButtons(false);
        this._schemaDesignerSelectedPath = sourceSchemaPath;
        if (!schemaFiles.includes(sourceSchemaPath)) schemaFiles.push(sourceSchemaPath);
        setSchemaStatus('Saved', true);
        await reloadEntityConfiguration(this.plugin.app, this.plugin.settings);
        this.plugin.refreshOpenViews();
        await refreshSchemaSelect(sourceSchemaPath);
      } catch (e) {
        setSchemaStatus(`Auto-save failed: ${e.message}`, false);
        highlightSaveButtons(true);
      }
    };
    const markSchemaDirty = () => {
      schemaDirty = true;
      setSchemaStatus('Unsaved changes', true);
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
      input.addEventListener('blur', () => {
        if (schemaDirty) autoSaveSchema();
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
        autoSaveSchema();
        renderSchemaIcon();
      }).open());
      renderSchemaIcon();
      textControl(identity, 'Type value', sourceSchema.type_value, (value) => { sourceSchema.type_value = value.trim(); });
      textControl(identity, 'Location pattern', sourceSchema.location_pattern, (value) => { sourceSchema.location_pattern = value.trim(); });
      textControl(identity, 'Definition', sourceSchema.description, (value) => { sourceSchema.description = value; }, true);
      textControl(identity, 'Scope', sourceSchema.scope, (value) => {
        if (value && value.trim()) sourceSchema.scope = value.trim();
        else delete sourceSchema.scope;
      });
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
        autoSaveSchema();
        renderSourceSchema();
      });
      (sourceSchema.fields || []).forEach((field, index) => {
        const card = fieldsSection.createDiv({ cls: 'cad-schema-field' });
        const row = card.createDiv({ cls: 'cad-schema-field-main' });
        const nameInput = row.createEl('input', { type: 'text', cls: 'cad-schema-designer-input', placeholder: 'field_name' });
        nameInput.value = field.name || '';
        nameInput.addEventListener('input', () => { field.name = nameInput.value.trim(); markSchemaDirty(); });
        nameInput.addEventListener('blur', () => { if (schemaDirty) autoSaveSchema(); });
        const typeSelect = row.createEl('select', { cls: 'dropdown cad-schema-field-type' });
        [['string', 'Text'], ['number', 'Number'], ['integer', 'Integer'], ['boolean', 'Boolean'], ['array', 'Array'], ['date', 'Date'], ['datetime', 'Date/time'], ['enum', 'Enum']].forEach(([value, label]) => {
          typeSelect.createEl('option', { value, text: label });
        });
        typeSelect.value = editableSchemaFieldType(field);
        typeSelect.addEventListener('change', () => {
          applyEditableSchemaFieldType(field, typeSelect.value);
          markSchemaDirty();
          autoSaveSchema();
          renderSourceSchema();
        });
        const requiredWrap = row.createEl('label', { cls: 'cad-schema-required' });
        const required = requiredWrap.createEl('input', { type: 'checkbox' });
        required.checked = !!field.required;
        requiredWrap.appendText(' Required');
        required.addEventListener('change', () => { field.required = required.checked; markSchemaDirty(); autoSaveSchema(); });
        const up = row.createEl('button', { cls: 'cad-nav-designer-action', text: '\u2191', attr: { title: 'Move up' } });
        up.disabled = index === 0;
        up.addEventListener('click', () => {
          if (index === 0) return;
          [sourceSchema.fields[index - 1], sourceSchema.fields[index]] = [sourceSchema.fields[index], sourceSchema.fields[index - 1]];
          markSchemaDirty();
          autoSaveSchema();
          renderSourceSchema();
        });
        const down = row.createEl('button', { cls: 'cad-nav-designer-action', text: '\u2193', attr: { title: 'Move down' } });
        down.disabled = index === sourceSchema.fields.length - 1;
        down.addEventListener('click', () => {
          if (index >= sourceSchema.fields.length - 1) return;
          [sourceSchema.fields[index], sourceSchema.fields[index + 1]] = [sourceSchema.fields[index + 1], sourceSchema.fields[index]];
          markSchemaDirty();
          autoSaveSchema();
          renderSourceSchema();
        });
        const remove = row.createEl('button', { cls: 'cad-nav-designer-action danger', text: 'Remove' });
        remove.addEventListener('click', () => {
          sourceSchema.fields.splice(index, 1);
          markSchemaDirty();
          autoSaveSchema();
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
          autoSaveSchema();
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
      if (schemaDirty && !(await confirmModal(this.plugin.app, 'Discard unsaved schema changes?', { title: 'Discard changes', cta: 'Discard' }))) {
        schemaSelect.value = sourceSchemaPath;
        return;
      }
      await loadSourceSchema(schemaSelect.value);
    });
    schemaReload.addEventListener('click', async () => {
      if (schemaDirty && !(await confirmModal(this.plugin.app, 'Discard unsaved schema changes?', { title: 'Discard changes', cta: 'Discard' }))) return;
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
          if (!(await confirmModal(this.plugin.app, `Rename schema source file to ${sourceSchema.entity}.yaml to match its entity key?`, { title: 'Rename schema source', cta: 'Rename', danger: false }))) {
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
          outputText = ` Generated ${result.count} FileClass and JSON Schema output(s); removed ${result.removed} stale output(s)${result.datamodelUpdated ? `; updated ${result.datamodelUpdated} DATAMODEL section(s)` : ''}.`;
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
      if (!(await confirmModal(this.plugin.app, `Archive ${sourceSchemaPath}? It will stop loading as a record type and remain available as a timestamped backup.`, { title: 'Archive schema source', cta: 'Archive' }))) return;
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

    pData.createEl('h3', { text: 'Sync' });
    pData.createEl('p', {
      cls: 'setting-item-description',
      text: 'Cloud sync remains a future bridge. The settings stay here so the eventual backend configuration has a stable home.',
    });
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

/* ─────────── Workspace template picker ─────────── */
async function seedWorkspaceTemplates(app) {
  const adapter = app.vault.adapter;
  const dir = `${PLUGIN_DIR}/templates`;
  try { await adapter.mkdir(dir); } catch (_) {}
}

async function loadWorkspaceTemplates(app) {
  const adapter = app.vault.adapter;
  const dir = `${PLUGIN_DIR}/templates`;
  try {
    const listed = await adapter.list(dir);
    const files = (listed.files || []).filter((f) => f.endsWith('.json')).sort();
    const templates = [];
    for (const path of files) {
      try {
        const tpl = JSON.parse(await adapter.read(path));
        if (tpl._template) {
          Object.defineProperty(tpl, '_templatePath', { value: path, enumerable: false });
          templates.push(tpl);
        }
      } catch (_) {}
    }
    return templates.sort((a, b) => (a._template.order || 99) - (b._template.order || 99));
  } catch (_) {}
  return [];
}

function workspaceTemplateKey(template) {
  return String(template?._template?.id || template?._templatePath || template?._template?.label || '').trim();
}

async function applyWorkspaceTemplate(app, plugin, template) {
  if (!template?._template) throw new Error('Invalid workspace template');
  const { _template, ...config } = template;
  const parsed = validateWorkspaceConfig(config);
  await saveWorkspaceConfig(app, JSON.stringify(parsed, null, 2));
  WORKSPACE_CONFIG = parsed;
  plugin.settings.activeWorkspaceTemplate = workspaceTemplateKey(template);
  plugin.settings.setupDismissed = true;
  plugin.settings = applyWorkspaceOwnedSettings(plugin.settings);
  await plugin.saveSettings();
  if (parsed.schemas?.enabled) {
    const bootstrap = await bootstrapCanonicalSchemaSourcesIfMissing(app, plugin.settings);
    if (bootstrap.count) {
      await regenerateSchemaOutputs(app, plugin.settings);
    }
  }
  await reloadEntityConfiguration(app, plugin.settings);
  plugin.refreshOpenViews();
  return _template;
}

class CadenceWorkspaceSetupModal extends obsidian.Modal {
  constructor(app, plugin, templates) {
    super(app);
    this.plugin = plugin;
    this.templates = templates;
    this.selected = null;
  }

  onOpen() {
    const { contentEl } = this;
    contentEl.empty();
    contentEl.addClass('cad-setup-modal');
    contentEl.createEl('h2', { text: 'Welcome to BOB Workspace' });
    contentEl.createEl('p', { cls: 'cad-setup-subtitle', text: 'Choose a starter workspace to get going. You can customise it at any time from Settings → BOB Workspace → Workspace.' });

    const grid = contentEl.createDiv({ cls: 'cad-template-grid' });
    for (const tpl of this.templates) {
      const meta = tpl._template;
      const card = grid.createDiv({ cls: 'cad-template-card' });
      card.createEl('strong', { text: meta.label });
      card.createEl('p', { text: meta.description });
      card.addEventListener('click', () => {
        grid.querySelectorAll('.cad-template-card').forEach((c) => c.classList.remove('is-selected'));
        card.classList.add('is-selected');
        this.selected = tpl;
        applyBtn.disabled = false;
      });
    }

    const footer = contentEl.createDiv({ cls: 'cad-setup-footer' });
    const applyBtn = footer.createEl('button', { text: 'Apply template', cls: 'mod-cta' });
    applyBtn.disabled = true;
    applyBtn.addEventListener('click', async () => {
      if (!this.selected) return;
      const meta = await applyWorkspaceTemplate(this.app, this.plugin, this.selected);
      this.close();
      new obsidian.Notice(`BOB Workspace: "${meta.label}" template applied.`);
    });

    const skipBtn = footer.createEl('button', { text: 'Skip for now', cls: 'cad-setup-skip' });
    skipBtn.addEventListener('click', async () => {
      this.plugin.settings.setupDismissed = true;
      await this.plugin.saveSettings();
      this.close();
    });
  }

  onClose() {
    this.contentEl.empty();
  }
}

/* ─────────── The plugin ─────────── */
class CadencePlugin extends obsidian.Plugin {
  async onload() {
    initPluginPaths(this);
    await seedWorkspaceTemplates(this.app);
    await this.loadSettings();
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
      id: 'apply-workspace-template',
      name: 'Apply workspace template…',
      callback: async () => {
        const templates = await loadWorkspaceTemplates(this.app);
        if (templates.length === 0) {
          new obsidian.Notice('BOB Workspace: no templates found in plugin templates/ folder.');
          return;
        }
        new CadenceWorkspaceSetupModal(this.app, this, templates).open();
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

    this.addCommand({
      id: 'bootstrap-canonical-schemas',
      name: 'Bootstrap canonical schemas from workspace',
      callback: async () => {
        try {
          const result = await bootstrapCanonicalSchemaSources(this.app, this.settings);
          const regen = await regenerateSchemaOutputs(this.app, this.settings);
          await reloadEntityConfiguration(this.app, this.settings);
          this.refreshOpenViews();
          new obsidian.Notice(`BOB Workspace: bootstrapped ${result.count} schema source file${result.count === 1 ? '' : 's'}${result.skipped ? `; skipped ${result.skipped} existing source file${result.skipped === 1 ? '' : 's'}` : ''}. Generated ${regen.count} FileClass and JSON Schema output(s).`);
        } catch (e) {
          new obsidian.Notice(`BOB Workspace: schema bootstrap failed - ${e.message}`);
        }
      },
    });

    // ─── Reminders engine ───
    // Tick once on load (catches anything that fired while Obsidian was closed),
    // then every 30s.
    this.app.workspace.onLayoutReady(() => this.tickReminders());
    this.registerInterval(window.setInterval(() => this.tickReminders(), 30 * 1000));

    // ─── First-run workspace template picker ───
    this.app.workspace.onLayoutReady(async () => {
      const hasWorkspace = await this.app.vault.adapter.exists(WORKSPACE_CONFIG_PATH);
      if (!hasWorkspace && !this.settings.setupDismissed) {
        const templates = await loadWorkspaceTemplates(this.app);
        if (templates.length > 0) {
          new CadenceWorkspaceSetupModal(this.app, this, templates).open();
        }
      }
    });

    // Optional: open BOB Workspace Home on Obsidian startup.
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
    // Obsidian manages view leaf lifecycle on unload; detaching here is a
    // documented anti-pattern that disrupts the user's saved layout.
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
