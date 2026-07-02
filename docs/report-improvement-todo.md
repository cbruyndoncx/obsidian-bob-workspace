# Report Improvement TODO

Audience: junior developer working on BOB Workspace report configuration.

Goal: make Reports analytical and useful with the dashboard/report widget engine. Use native widgets first, then edit `templates/workspace-bob.json` plus the active installed `workspace.json` during vault testing.

## Ground Rules

- Reports are configured under `dashboards["reports.*"]` with `kind: "report"`.
- Do not create a separate `reports` config block unless the runtime is changed to support it.
- Prefer current widgets: `metric`, `gauge`, `progress`, `heatmap`, `bar-chart`, `list`, `kanban`, `selector`, `date-range`, `markdown`, `base-embed`, and `base-view`.
- Avoid duplicating operational dashboards. A report should answer performance, risk, trend, or review questions.
- After each config change, validate JSON and run:

```bash
node --check main.js
node tests/run-tests.js
```

## Working Checklist

### Pipeline

- [x] Keep existing controls for `groupBy`, `stage`, and close date.
- [x] Keep KPI metrics for open deals, weighted forecast, won, lost, and win rate.
- [x] Add a `bar-chart` for open deal value by stage.
- [x] Add a `bar-chart` for open deal count by owner.
- [x] Add a list of stale or risky open deals.
- [x] Add a `markdown` block defining weighted forecast and open pipeline.
- [x] Remove generic sections that do not support pipeline review.

### Sales

- [x] Keep owner selector and close date range.
- [x] Add source and client selectors because those fields exist in deal records.
- [x] Keep KPI metrics for revenue, lost value, capture rate, and average deal.
- [x] Add a `bar-chart` for won revenue by owner.
- [x] Add a `bar-chart` for won/lost counts by close date as a proxy until a period field exists.
- [x] Add a list of largest won deals.
- [x] Add a list of largest lost deals.
- [x] Add a `markdown` block explaining capture rate and date filtering.

### Partners

- [x] Replace the copied PRM overview shape with a report-focused layout.
- [x] Add selector for partner status.
- [x] Add metrics for partner count, partner-attributed open deals, partner-attributed won value, open commissions, and expiring certifications.
- [x] Add a `bar-chart` for partner deals by proxy attribution.
- [x] Add a list of open commissions.
- [x] Add a list of expiring certifications.
- [x] Add a list of partner-attributed deals.
- [x] Add a `markdown` block explaining what counts as partner-attributed.
- [ ] Replace the partner attribution proxy with a real `partner_ref` relationship on deal records.

### Activity

- [x] Keep date range and channel selector.
- [x] Add selector for activity owner if the field exists.
- [x] Add metrics for total activities, meetings, calls/messages, and overdue follow-ups.
- [x] Add a `bar-chart` for activity count by channel.
- [x] Add a `bar-chart` for activity count by direction as the best current segmentation proxy.
- [x] Add a list of recent activities for evidence.
- [x] Add a list of activities needing follow-up.
- [x] Remove unrelated recent contacts.
- [x] Add a `markdown` block explaining which activity types are counted.
- [x] Add owner-based activity segmentation once the schema exposes an `owner` field.

### Productivity

- [x] Keep current built-in productivity stats and trend charts.
- [x] Add a completion-rate metric from the built-in productivity snapshot.
- [x] Add a native `gauge` for completion score.
- [x] Add a native `progress` widget for active days built.
- [x] Add a native `heatmap` for content cadence.
- [x] Add a task split by project or context if TaskNotes metadata supports it.
- [x] Add a list of overdue or high-priority open tasks.
- [x] Add a `markdown` block explaining the time window and completion logic.

### Cleanup

- [x] Remove dashboard-like recent-records cards where they did not support an analytical question.
- [x] Replace generic cards with exception/evidence lists where possible.
- [ ] Revisit any remaining report cards that are still more operational than analytical.

### Data Model

- [x] Deals have `stage`, `owner`, `deal_value`, `expected_close`, `deal_source`, `client_id`, and `end_client_id`.
- [x] Activities have `date`, `channel`, `direction`, `client_id`, `lead_id`, `contact_ref`, `outcome`, and `next_action_date`.
- [x] Partners have `status`, `partner_name`, `partner_id`, `relationship_type`, `my_role`, and `agreement_type`.
- [x] Commissions have `status`, `amount`, `currency`, and `partner_ref`.
- [x] Certifications have `expires_date`, `renewal_date`, and `status`.
- [x] Tasks have `status`, `priority`, `due`, `scheduled`, `projects`, and `contexts`.
- [ ] Add a schema task for deal-level partner attribution if we want exact partner reporting.

## Acceptance Criteria For A Good Report

Each report should include:

- A date range control when the report is period-based.
- At least one segmentation control, such as owner, stage, channel, partner tier, source, or status.
- Three to five KPI metrics that answer report-level questions.
- At least one `bar-chart` breakdown.
- At least one exception list, such as stale, overdue, expiring, lost, inactive, or blocked records.
- At least one evidence list showing the records behind the numbers.
- A short `markdown` context block explaining what the report measures.

## Phase 1: Improve Existing Reports

### 1. Pipeline Report

Target config key: `dashboards["reports.pipeline"]`

- [x] Keep existing controls for `groupBy`, `stage`, and close date.
- [x] Keep KPI metrics for open deals, weighted forecast, won, lost, and win rate.
- [x] Add a `bar-chart` for open deal value by stage.
- [x] Add a `bar-chart` for open deal count by owner.
- [x] Add a list of stale or risky open deals. Use available fields such as `expected_close`, `last_activity`, `last_contact`, or status/stage if present.
- [x] Add a `markdown` block defining weighted forecast and open pipeline.
- [x] Remove generic sections that do not support pipeline review.

Notes:
- If stale/risk fields are not available, create the best possible list using `due`, `expected_close`, or recently modified open deals.
- Do not add custom JavaScript for this phase.

### 2. Sales Report

Target config key: `dashboards["reports.sales"]`

- [x] Keep owner selector and close date range.
- [x] Keep KPI metrics for revenue, lost value, capture rate, and average deal.
- [x] Add a `bar-chart` for won revenue by owner.
- [x] Add a `bar-chart` for won/lost count by close period as a proxy until a real period field exists.
- [x] Add a list of largest won deals.
- [x] Add a list of largest lost deals.
- [x] Add a selector for source, company, or client if the field exists in deal records.
- [x] Add a `markdown` block explaining capture rate and date filtering.

Notes:
- True prior-period comparison is not supported yet. Do not fake it unless static date ranges are acceptable.

### 3. Partners Report

Target config key: `dashboards["reports.partners"]`

- [x] Replace the copied PRM overview shape with a report-focused layout.
- [x] Add selector for partner tier or partner status if fields exist.
- [x] Add metrics for partner count, partner-attributed open deals, partner-attributed won value, open commissions, and expiring certifications.
- [x] Add a `bar-chart` for partner deals by partner or tier using the current proxy field set.
- [x] Add a list of open commissions.
- [x] Add a list of expiring certifications.
- [x] Add a list of partner-attributed deals.
- [x] Add a `markdown` block explaining what counts as partner-attributed.

Notes:
- This report depends on deal records having a `partner`, `partner_ref`, or equivalent relationship field.
- If partner-attributed won value cannot be computed with current fields, leave a clear TODO note in the markdown block.

### 4. Activity Report

Target config key: `dashboards["reports.activity"]`

- [x] Keep date range and channel selector.
- [x] Add selector for activity owner if the field exists.
- [x] Add metrics for total activities, meetings, calls/messages, and overdue follow-ups if fields exist.
- [x] Add a `bar-chart` for activity count by channel or activity type.
- [x] Add a `bar-chart` for activity count by owner direction proxy.
- [x] Add a list of recent activities for evidence.
- [x] Add a list of activities needing follow-up.
- [x] Remove unrelated recent contacts unless they directly support activity review.
- [x] Add a `markdown` block explaining which activity types are counted.

Notes:
- Use `activity_type`, `channel`, `owner`, `date`, `status`, and `follow_up_date` if available.

### 5. Productivity Report

Target config key: `dashboards["reports.productivity"]`

- [x] Keep current built-in productivity stats and trend charts.
- [x] Add a completion-rate metric if the built-in source exposes it.
- [x] Add a task split by project or context if TaskNotes metadata supports it.
- [x] Add a list of overdue or high-priority open tasks.
- [x] Add a `markdown` block explaining the time window and completion logic.

Notes:
- This report uses built-in runtime productivity data. Some desired analytics may require materializing TaskNotes rollups later.

## Phase 2: Remove Dashboard-Like Content

- [x] Review report layouts and remove generic "recent records" cards unless they support an analytical question.
- [x] Replace generic cards with exception/evidence lists where possible:
  - Largest open risks.
  - Upcoming expiries.
  - Won deals this period.
  - Lost deals this period.
  - No recent activity.
  - Overdue follow-ups.
  - Open commissions.

## Phase 3: Data Model Check

Confirm these fields exist before relying on them in report configs:

- [x] Deals: `stage`, `owner`, `value` or `deal_value`, `expected_close`, `source`, `partner`, `company` or `client`.
- [x] Activities: `date`, `activity_type`, `channel`, `owner`, `status`, `follow_up_date`.
- [x] Partners: `tier`, `status`, `partner_name`.
- [x] Commissions: `status`, `amount`, `currency`, `partner_ref`.
- [x] Certifications: `expires_date`, `renewal_date`, `status`.
- [x] Tasks: `status`, `priority`, `due`, `scheduled`, `projects`, `contexts`.
- [ ] Deal-level `partner_ref` is still missing for exact partner attribution.

If a needed field is missing, document it in the report markdown block and create a separate schema/data-model task. Do not silently use a wrong field.

## Later Widget Gaps

Do not implement these until current widgets are exhausted:

- [ ] Ranked table widget.
- [ ] Prior-period comparison metric.
- [ ] Stacked or grouped bar chart.
- [ ] Funnel widget.
- [ ] Automated insight/narrative widget.

## Suggested Order

1. Improve `reports.pipeline`.
2. Improve `reports.sales`.
3. Improve `reports.activity`.
4. Rework `reports.partners`.
5. Refine `reports.productivity`.
