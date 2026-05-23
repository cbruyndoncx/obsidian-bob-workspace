# BOB Workspace Navigation Inventory

Generated: 2026-05-23

## Summary

- Total navigation items defined: 60
- Default visible navigation items: 30
- Entity-backed navigation items: 44
- Secondary/setup items hidden by default: 23
- Vault schemas: 69
- Schemas represented in navigation: 43
- Schemas missing from navigation: 26

## Default Left Navigation

- (top): Home
- Planner: Inbox
- Planner: Today
- Planner: Calendar
- Planner: TaskNotes (`task`)
- Planner: Projects (`project`)
- CRM: Dashboard
- CRM: Pipeline (`deal`)
- CRM: Contacts (`person`)
- CRM: Clients (`client`)
- CRM: Leads (`lead`)
- CRM: Campaigns (`campaign`)
- CRM: Activities (`activity`)
- Client Work: Workspace (`meeting`)
- PRM: Partners (`partner`)
- Finance: Customer Invoices (`invoice`)
- Finance: General Ledger
- Finance: Finance Setup
- Finance: Tax
- Suppliers & Procurement: Suppliers (`supplier`)
- Suppliers & Procurement: Supplier Invoices (`supplier-invoice`)
- Suppliers & Procurement: Purchase Requisitions (`purchase-requisition`)
- Suppliers & Procurement: Purchase Orders (`purchase-order`)
- Reports: Pipeline
- Reports: Sales
- Reports: Partners
- Reports: Activity
- Reports: Productivity
- (top): Team
- (top): Settings

## Full Navigation Definition

| Group | Item | ID | Level | Parent | Entity / Schema |
| --- | --- | --- | --- | --- | --- |
| (top) | Home | `home` | primary |  | non-entity |
| Planner | Inbox | `planner.inbox` | primary |  | non-entity |
| Planner | Today | `planner.today` | primary |  | non-entity |
| Planner | Calendar | `planner.calendar` | primary |  | non-entity |
| Planner | TaskNotes | `planner.tasknotes` | primary |  | `task` / `task` |
| Planner | Projects | `planner.projects` | primary |  | `project` / `project` |
| CRM | Dashboard | `crm.dashboard` | primary |  | non-entity |
| CRM | Pipeline | `crm.pipeline` | primary |  | `deal` / `deal` |
| CRM | Contacts | `crm.contacts` | primary |  | `contact` / `person` |
| CRM | Clients | `crm.clients` | primary |  | `client` / `client` |
| CRM | My Companies | `crm.companies` | setup | `settings` | `company` / `company` |
| CRM | Leads | `crm.leads` | primary |  | `lead` / `lead` |
| CRM | Campaigns | `crm.campaigns` | primary |  | `campaign` / `campaign` |
| CRM | Sequences | `crm.sequences` | secondary | `crm.campaigns` | `sequence` / `sequence` |
| CRM | Activities | `crm.activities` | primary |  | `activity` / `activity` |
| Client Work | Workspace | `client-work.overview` | primary |  | `meeting` / `meeting` |
| Client Work | Meetings | `client-work.meetings` | secondary | `client-work.overview` | `meeting` / `meeting` |
| Client Work | Comms | `client-work.comms` | secondary | `client-work.overview` | `comms-thread` / `comms-thread` |
| Client Work | Deliverables | `client-work.deliverables` | secondary | `client-work.overview` | `deliverable` / `deliverable` |
| Client Work | Feedback | `client-work.feedback` | secondary | `client-work.overview` | `feedback` / `feedback` |
| Client Work | Surveys | `client-work.surveys` | secondary | `client-work.overview` | `survey` / `survey` |
| Client Work | Testimonials | `client-work.testimonials` | secondary | `client-work.overview` | `testimonial` / `testimonial` |
| Client Work | Decisions | `client-work.decisions` | secondary | `client-work.overview` | `decision` / `decision` |
| PRM | Partners | `prm.partners` | primary |  | `partner` / `partner` |
| PRM | Registrations | `prm.registrations` | secondary | `prm.partners` | `registration` / `registration` |
| PRM | Commissions | `prm.commissions` | secondary | `prm.partners` | `commission` / `commission` |
| PRM | Certifications | `prm.certifications` | secondary | `prm.partners` | `certification` / `certification` |
| PRM | Analytics | `prm.analytics` | secondary | `prm.partners` | non-entity |
| Finance | Customer Invoices | `finance.invoices` | primary |  | `invoice` / `invoice` |
| Finance | General Ledger | `finance.gl` | primary |  | non-entity |
| Finance | Finance Setup | `finance.setup` | primary |  | non-entity |
| Finance | Accounting Periods | `finance.accounting-periods` | setup | `finance.setup` | `accounting-period` / `accounting-period` |
| Finance | Bank Accounts | `finance.bank-accounts` | setup | `finance.setup` | `bank-account` / `bank-account` |
| Finance | FX Rates Tables | `finance.fx-rates` | setup | `finance.setup` | `fx-rates-table` / `fx-rates-table` |
| Finance | Inventory | `finance.inventory` | secondary | `finance.setup` | `inventory` / `inventory` |
| Finance | Bank Reconciliations | `finance.bank-reconciliations` | secondary | `finance.gl` | `bank-reconciliation` / `bank-reconciliation` |
| Finance | Chart of Accounts | `finance.chart-of-accounts` | secondary | `finance.gl` | `chart-of-accounts` / `chart-of-accounts` |
| Finance | Journal Entries | `finance.journal-entries` | secondary | `finance.gl` | `journal-entry` / `journal-entry` |
| Finance | Trial Balances | `finance.trial-balances` | secondary | `finance.gl` | `trial-balance` / `trial-balance` |
| Finance | Financial Statements | `finance.financial-statements` | secondary | `finance.gl` | `financial-statement` / `financial-statement` |
| Finance | FS Notes | `finance.fs-notes` | secondary | `finance.gl` | `fs-notes` / `fs-notes` |
| Finance | Tax | `tax.overview` | primary |  | non-entity |
| Finance | VAT Returns | `tax.vat-returns` | secondary | `tax.overview` | `vat-return` / `vat-return` |
| Finance | Corporate Tax Returns | `tax.corporate-tax-returns` | secondary | `tax.overview` | `corporate-tax-return` / `corporate-tax-return` |
| Finance | Deferred Tax | `tax.deferred-tax` | secondary | `tax.overview` | `deferred-tax` / `deferred-tax` |
| Finance | Transfer Pricing | `tax.transfer-pricing` | secondary | `tax.overview` | `transfer-pricing` / `transfer-pricing` |
| Finance | Free Zone Status | `tax.free-zone-status` | secondary | `tax.overview` | `free-zone-status` / `free-zone-status` |
| Finance | Legal Rules | `tax.legal-rules` | setup | `tax.overview` | `legal-rule` / `legal-rule` |
| Finance | Document Retention | `tax.document-retention` | setup | `tax.overview` | `document-retention` / `document-retention` |
| Suppliers & Procurement | Suppliers | `procurement.suppliers` | primary |  | `supplier` / `supplier` |
| Suppliers & Procurement | Supplier Invoices | `procurement.supplier-invoices` | primary |  | `supplier-invoice` / `supplier-invoice` |
| Suppliers & Procurement | Purchase Requisitions | `procurement.purchase-requisitions` | primary |  | `purchase-requisition` / `purchase-requisition` |
| Suppliers & Procurement | Purchase Orders | `procurement.purchase-orders` | primary |  | `purchase-order` / `purchase-order` |
| Reports | Pipeline | `reports.pipeline` | primary |  | non-entity |
| Reports | Sales | `reports.sales` | primary |  | non-entity |
| Reports | Partners | `reports.partners` | primary |  | non-entity |
| Reports | Activity | `reports.activity` | primary |  | non-entity |
| Reports | Productivity | `reports.productivity` | primary |  | non-entity |
| (top) | Team | `team` | primary |  | non-entity |
| (top) | Settings | `settings` | primary |  | non-entity |

## Secondary Tab Parents

- Campaigns: Overview, Campaigns, Sequences
- Client Work: Overview, Meetings, Comms, Deliverables, Feedback, Surveys, Testimonials, Decisions
- Partners: Overview, Partners, Registrations, Commissions, Certifications, Analytics
- Suppliers & Procurement: Overview, Suppliers, Supplier Invoices, Purchase Requisitions, Purchase Orders
- General Ledger: Overview, Chart of Accounts, Journal Entries, Bank Reconciliations, Trial Balances, Financial Statements, FS Notes
- Finance Setup: Overview, Accounting Periods, Bank Accounts, FX Rates, Inventory
- Finance / Tax: Overview, VAT Returns, Corporate Tax, Deferred Tax, Transfer Pricing, Free Zone Status, Legal Rules, Document Retention

## Client Work Filtering

`Client Work > Workspace` includes client and project selectors. Choosing a client applies a shared client filter across `client_id` and `end_client_id`. Choosing a project applies a shared `project_id` filter. `All clients` and `All projects` clear the respective filters.

## Team View

`Team` is a configurable People view, not a separate entity. It filters `type: person` records by `person_category`. The default included categories are `employee`, `freelancer`, and `contractor`; these can be changed in Settings under `Team person categories`.

## TaskNotes And Productivity

TaskNotes have two folder roles:

- `TaskNotes` workspace/list views show the active TaskNotes folder.
- `Productivity` history includes both the active TaskNotes folder and the TaskNotes archive folder when task mode is `TaskNotes only` or `Hybrid`.

The default folders are `00-CORE/TaskNotes/Tasks` and `00-CORE/TaskNotes/Archive`. The archive folder is configurable in Settings.

Productivity follows the configured task mode:

- `Checkbox only`: daily note checkbox tasks.
- `TaskNotes only`: TaskNotes from active and archive folders.
- `Hybrid`: daily note checkbox tasks plus TaskNotes.

## Schemas Missing From Navigation

- `ai-session-log`
- `analysis`
- `audit-engagement`
- `ecl-assessment`
- `fixed-asset`
- `gratuity-provision`
- `idea`
- `kpi`
- `lease`
- `marketing-content`
- `performance-obligation`
- `period-end-close`
- `periodic-note`
- `playbook`
- `pm-artifact`
- `process`
- `product`
- `provision`
- `reference`
- `regional-context`
- `research`
- `research-domain`
- `research-kb`
- `skill-scorecard`
- `spec-review`
- `wps-record`

## Organization Rule

- Primary left nav is for frequent working lists and dashboards.
- Supplier records, supplier invoices and procurement documents belong together under Suppliers & Procurement.
- GL, finance setup and tax are separate Finance work areas because they are different workflows.
- Secondary screens remain available as tabs inside parent screens and can be shown in the left nav from Settings.
