# Report Improvement TODO

Audience: junior developer working on BOB Workspace report configuration.

Goal: make Reports analytical and useful without adding new widget types first. Use the existing dashboard/report widget engine and edit `templates/workspace-bob.json` plus the active installed `workspace.json` during vault testing.

## Ground Rules

- Reports are configured under `dashboards["reports.*"]` with `kind: "report"`.
- Do not create a separate `reports` config block unless the runtime is changed to support it.
- Prefer current widgets: `metric`, `bar-chart`, `list`, `kanban`, `selector`, `date-range`, `markdown`, `base-embed`, and `base-view`.
- Avoid duplicating operational dashboards. A report should answer performance, risk, trend, or review questions.
- After each config change, validate JSON and run:

```bash
node --check main.js
node tests/run-tests.js
```

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

- [ ] Keep existing controls for `groupBy`, `stage`, and close date.
- [ ] Keep KPI metrics for open deals, weighted forecast, won, lost, and win rate.
- [ ] Add a `bar-chart` for open deal value by stage.
- [ ] Add a `bar-chart` for open deal count by owner.
- [ ] Add a list of stale or risky open deals. Use available fields such as `expected_close`, `last_activity`, `last_contact`, or status/stage if present.
- [ ] Add a `markdown` block defining weighted forecast and open pipeline.
- [ ] Remove generic sections that do not support pipeline review.

Notes:
- If stale/risk fields are not available, create the best possible list using `due`, `expected_close`, or recently modified open deals.
- Do not add custom JavaScript for this phase.

### 2. Sales Report

Target config key: `dashboards["reports.sales"]`

- [ ] Keep owner selector and close date range.
- [ ] Keep KPI metrics for revenue, lost value, capture rate, and average deal.
- [ ] Add a `bar-chart` for won revenue by owner.
- [ ] Add a `bar-chart` for won/lost count by close period if a period field exists.
- [ ] Add a list of largest won deals.
- [ ] Add a list of largest lost deals.
- [ ] Add a selector for source, company, or client if the field exists in deal records.
- [ ] Add a `markdown` block explaining capture rate and date filtering.

Notes:
- True prior-period comparison is not supported yet. Do not fake it unless static date ranges are acceptable.

### 3. Partners Report

Target config key: `dashboards["reports.partners"]`

- [ ] Replace the copied PRM overview shape with a report-focused layout.
- [ ] Add selector for partner tier or partner status if fields exist.
- [ ] Add metrics for partner count, partner-attributed open deals, partner-attributed won value, open commissions, and expiring certifications.
- [ ] Add a `bar-chart` for partner deals by partner or tier.
- [ ] Add a list of open commissions.
- [ ] Add a list of expiring certifications.
- [ ] Add a list of partner-attributed deals.
- [ ] Add a `markdown` block explaining what counts as partner-attributed.

Notes:
- This report depends on deal records having a `partner`, `partner_ref`, or equivalent relationship field.
- If partner-attributed won value cannot be computed with current fields, leave a clear TODO note in the markdown block.

### 4. Activity Report

Target config key: `dashboards["reports.activity"]`

- [ ] Keep date range and channel selector.
- [ ] Add selector for activity owner if the field exists.
- [ ] Add metrics for total activities, meetings, calls/messages, and overdue follow-ups if fields exist.
- [ ] Add a `bar-chart` for activity count by channel or activity type.
- [ ] Add a `bar-chart` for activity count by owner.
- [ ] Add a list of recent activities for evidence.
- [ ] Add a list of activities needing follow-up.
- [ ] Remove unrelated recent contacts unless they directly support activity review.
- [ ] Add a `markdown` block explaining which activity types are counted.

Notes:
- Use `activity_type`, `channel`, `owner`, `date`, `status`, and `follow_up_date` if available.

### 5. Productivity Report

Target config key: `dashboards["reports.productivity"]`

- [ ] Keep current built-in productivity stats and trend charts.
- [ ] Add a completion-rate metric if the built-in source exposes it.
- [ ] Add a task split by project or context if TaskNotes metadata supports it.
- [ ] Add a list of overdue or high-priority open tasks.
- [ ] Add a `markdown` block explaining the time window and completion logic.

Notes:
- This report uses built-in runtime productivity data. Some desired analytics may require materializing TaskNotes rollups later.

## Phase 2: Remove Dashboard-Like Content

- [ ] Review all report layouts and remove generic "recent records" cards unless they support an analytical question.
- [ ] Replace generic cards with exception/evidence lists:
  - Largest open risks.
  - Upcoming expiries.
  - Won deals this period.
  - Lost deals this period.
  - No recent activity.
  - Overdue follow-ups.
  - Open commissions.

## Phase 3: Data Model Check

Confirm these fields exist before relying on them in report configs:

- [ ] Deals: `stage`, `owner`, `value` or `deal_value`, `expected_close`, `source`, `partner`, `company` or `client`.
- [ ] Activities: `date`, `activity_type`, `channel`, `owner`, `status`, `follow_up_date`.
- [ ] Partners: `tier`, `status`, `partner_name`.
- [ ] Commissions: `status`, `amount`, `currency`, `partner_ref`.
- [ ] Certifications: `expires_date`, `renewal_date`, `status`.
- [ ] Tasks: `status`, `priority`, `due`, `scheduled`, `projects`, `contexts`.

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

