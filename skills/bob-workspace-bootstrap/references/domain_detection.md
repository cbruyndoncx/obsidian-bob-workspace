# Domain Detection — Folder-to-Domain Mapping

Folder structure is the authoritative source for domain grouping. No value-chain mapping, no upfront user question. Folder = domain.

## Default mapping table

| Folder pattern | Domain | Typical entities |
|----------------|--------|-----------------|
| `20-COMPANY/00-PROFILE/` | Company | company, profile |
| `20-COMPANY/01-QMS/` | Quality | skill-scorecard, spec-review |
| `20-COMPANY/02-DECISIONS/` | Decisions | decision-log |
| `20-COMPANY/03-PROCESSES/` | Processes | process, playbook |
| `20-COMPANY/04-LEGAL/` | Legal | legal-rule, retention-register, freezone-status |
| `20-COMPANY/05-HR/` | HR | person (employee), wps-record |
| `20-COMPANY/06-FINANCE/` | Finance | journal-entry, trial-balance, vat-return, ct-return, invoice (AP), bank-account, etc. |
| `20-COMPANY/07-KNOWLEDGE-BASE/` | Knowledge Base | reference, research |
| `20-COMPANY/30-SUPPLIERS/` | Suppliers | supplier, feedback |
| `20-COMPANY/35-PARTNERS/` | Partners | partner, certification, commission |
| `20-COMPANY/40-PRODUCTS/` | Products | product |
| `20-COMPANY/50-MARKETING/` | Marketing & Content | marketing-content, campaign |
| `20-COMPANY/55-LEADS/` | Sales — Leads | lead, comms-thread |
| `20-COMPANY/60-SALES/` | Sales | sequence, objection-playbook, sales-report |
| `20-COMPANY/70-OPERATIONS/` | Operations | survey, support-ticket |
| `20-COMPANY/80-MANAGEMENT/` | Management | kpi, strategy-doc |
| `30-CLIENTS/` | Clients & Delivery | client, deal, invoice, project, deliverable, meeting, activity, feedback, testimonial |
| `40-RESOURCES/` | Resources | research, research-kb, research-domain |
| `10-ME/` | Personal | person, idea, meeting (personal) |
| `00-CORE/TaskNotes/` | Tasks | task |
| `00-CORE/PeriodicNotes/` | Periodic Notes | periodic-note |

## Resolution rule

For each detected `type:`, take the mode (most common) of parent-folder paths. Match against the longest-prefix folder pattern above. That's the domain.

## Special cases

- **Person entities split across domains**: `10-ME/10-PEOPLE/` → Personal, `30-CLIENTS/{id}/10-PEOPLE/` → Clients & Delivery. Same `type: person`, two domains — present in both groups in `workspace.json`.
- **Invoice entities split**: `30-CLIENTS/{id}/02-INVOICES/` → Clients & Delivery (AR), `20-COMPANY/06-FINANCE/AP/INVOICES/` → Finance (AP). Disambiguate by folder, surface both in proposal.
- **Unmapped folders**: if a `type:`'s dominant folder doesn't match any prefix above, surface in proposal as "ungrouped — user should assign domain or rename folder."

## User override

User can edit `99-TMP/OUTPUT/bob-workspace-bootstrap-proposal.md` to reassign domain before confirmation. Re-run reads the edits.
