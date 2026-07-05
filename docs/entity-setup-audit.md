# Entity Setup Audit

> ⚠️ **DEPRECATED / STALE (2026-07-02).** A private-vault snapshot that predates the config-driven model. It describes the `entities.json` override mechanism, which is now rejected on load (`entities is no longer supported`); schema/Base counts are vault-specific. Verify against current schema YAML and `src/` before relying on it. Regenerate or delete.

Generated: 2026-05-22

## Summary

- Navigation entities: 43
- Built-in plugin entities: 43
- Vault schemas: 69
- Vault Bases: 44
- `entities.json` overrides: 7

## Key Findings

All navigation entities have a built-in plugin entity and a matching schema. The main inconsistencies are:

- Several entities have an existing Base file but no configured Base in plugin settings.
- Several built-in fallback definitions still use older fallback field names.
- Schema loading usually corrects field definitions, but fallback/import/export can drift if schemas are disabled or unavailable.
- The vault contains many schemas that are not yet exposed in the BOB Workspace navigation.

## Navigation Entities

| Group | Entity | Schema | Base Status | Main Issue |
| --- | --- | --- | --- | --- |
| Planner | `task` | `task.yaml` | configured custom TaskNotes Base | fallback includes schema fields used for import/export; `title` retained as UI/file-name primary |
| Planner | `project` | `project.yaml` | configured | fallback aligned to schema key fields: `client_id`, `status`, `priority`, `deadline`, `created` |
| CRM | `deal` | `deal.yaml` | configured | fallback aligned to BOB fields; partner-sourced reporting still needs `partner_ref` decision |
| CRM | `contact` | `person.yaml` | configured | mostly aligned; fallback now includes `person_category` |
| CRM | `client` | `client.yaml` | configured to `Clients.base` | fallback and Base aligned to client identity, regions, jurisdiction and registry fields |
| CRM | `company` | `company.yaml` | configured to `Companies.base` | separated from client Base; filters `type: company` under company profile folder |
| CRM | `lead` | `lead.yaml` | configured | fallback aligned to primary BOB fields; long-tail schema fields remain schema-only |
| CRM | `campaign` | `campaign.yaml` | configured to `Campaigns.base` | fallback and Base aligned to schema campaign metrics |
| CRM | `sequence` | `sequence.yaml` | configured to `Sequences.base` | fallback and Base aligned to schema sequence metrics |
| CRM | `activity` | `activity.yaml` | configured to `Activities.base` | recovered useful legacy concepts as canonical BOB fields: `contact_ref`, `related`, follow-up fields |
| Client Work | `meeting` | `meeting.yaml` | configured to `Meetings.base` | added to Client Work tabs and workbook export; workspace can filter by `client_id`/`end_client_id` and `project_id` |
| Client Work | `comms-thread` | `comms-thread.yaml` | configured to `Comms.base` | added to Client Work tabs and workbook export; workspace can filter by `client_id`/`end_client_id` and `project_id` |
| Client Work | `deliverable` | `deliverable.yaml` | configured to `Deliverables.base` | added to Client Work tabs and workbook export; workspace can filter by `client_id`/`end_client_id` and `project_id` |
| Client Work | `feedback` | `feedback.yaml` | configured to `Feedback.base` | added to Client Work tabs and workbook export; workspace can filter by `client_id`/`end_client_id` and `project_id` |
| Client Work | `survey` | `survey.yaml` | configured to `Surveys.base` | added to Client Work tabs and workbook export; optional `client_id`, `end_client_id`, `project_id`, and `project` added |
| Client Work | `testimonial` | `testimonial.yaml` | configured to `Testimonials.base` | added to Client Work tabs and workbook export; workspace can filter by `client_id`/`end_client_id` and `project_id` |
| Client Work | `decision` | `decision.yaml` | configured to `Decisions.base` | added to Client Work tabs and workbook export; optional `client_id`, `end_client_id`, `project_id`, and `project` added |
| SRM | `supplier` | `supplier.yaml` | configured to `Suppliers.base` | fallback, Base and schema aligned to `supplier_id`, `supplier_name`, spend category and procurement fields |
| PRM | `partner` | `partner.yaml` | configured to `Partners.base` | fallback aligned to BOB fields |
| PRM | `registration` | `registration.yaml` | configured to `Partner-Registrations.base` | fallback and Base aligned to primary BOB fields |
| PRM | `commission` | `commission.yaml` | configured to `Partner-Commissions.base` | fallback and Base aligned to primary BOB fields |
| PRM | `certification` | `certification.yaml` | configured to `Partner-Certifications.base` | fallback and Base aligned to primary BOB fields |
| Finance | `invoice` | `invoice.yaml` | configured to existing `AR.base` | customer invoice Base is intentionally separate from supplier invoices |
| Finance | `supplier-invoice` | `supplier-invoice.yaml` | configured to `Supplier-Invoices.base` | fallback aligned to Base fields |
| Procurement | `purchase-requisition` | `purchase-requisition.yaml` | configured to `Purchase-Requisitions.base` | fallback aligned to Base fields |
| Procurement | `purchase-order` | `purchase-order.yaml` | configured to `Purchase-Orders.base` | fallback aligned to Base fields; `delivery_status` added to schema/model because the Base already uses it |

Finance and Tax entities now have plugin fallback definitions aligned to their main schema key fields and Base files for richer workspace views. Customer invoices reuse the existing `AR.base`.

## Schemas Not Yet In Navigation

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

## Review Order

1. CRM core: `deal`, `lead`, `activity` - fallback cleanup done
2. PRM: `partner`, `registration`, `commission`, `certification` - fallback cleanup and Base setup done
3. Procurement and supplier documents: `purchase-requisition`, `purchase-order`, `supplier-invoice` - fallback cleanup done
4. Supplier profile: `supplier` - fallback cleanup done
5. Finance and Tax summary entities - fallback cleanup and Base setup done
6. Client Work: `meeting`, `comms-thread`, `deliverable`, `feedback`, `survey`, `testimonial`, `decision` - navigation, tabs, Bases, workbook export, selected-client filtering and selected-project filtering done
7. Optional future navigation groups for schemas not exposed today
