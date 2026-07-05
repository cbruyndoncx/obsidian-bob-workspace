import { loadBuiltinDashboardDefaults } from './nav';
import type { DashboardCard, DashboardConfig, WidgetSourceConfig } from './types';
export const BUILTIN_DASHBOARD_DEFAULTS: Record<string, DashboardConfig> = loadBuiltinDashboardDefaults();

export const PURE_DASHBOARD_WIDGET_TYPES = [
  'list',
  'task-list',
  'quick-add',
  'date-hero',
  'note-section',
  'metric',
  'gauge',
  'progress',
  'heatmap',
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

export interface DashboardWidgetCatalogEntry {
  id: string;
  label: string;
  status: 'implemented' | 'partial' | 'planned' | (string & {});
  description: string;
  config: string[];
  examples: string[];
}

export const DASHBOARD_WIDGET_CATALOG: DashboardWidgetCatalogEntry[] = [
  {
    id: 'metric',
    label: 'Metric stat',
    status: 'implemented',
    description: 'Top-row KPI cards driven by count and aggregate stats. Supports count, open, sum, avg, weighted forecast, win rate, capture rate and unique counts.',
    config: ['label', 'entity', 'count', 'metric', 'field', 'source', 'sub', 'accent'],
    examples: ['client-work.dashboard', 'crm.pipeline', 'reports.sales'],
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
    id: 'task-list',
    label: 'Task list (interactive)',
    status: 'implemented',
    description: 'Checklist of tasks with toggleable checkboxes. TaskNote-record rows (entity/base sources) write their status back; source can be a built-in daily section, a task entity, or a Base + view.',
    config: ['title', 'entity', 'source', 'limit', 'empty'],
    examples: ['planner.today TODAY TASKS', 'Tasks.base + view'],
  },
  {
    id: 'quick-add',
    label: 'Quick-add input',
    status: 'implemented',
    description: 'Text input that appends a checkbox task to today\'s daily note on Enter.',
    config: ['title', 'placeholder'],
    examples: ['planner.today capture'],
  },
  {
    id: 'date-hero',
    label: 'Date hero',
    status: 'implemented',
    description: 'Read-only header showing today\'s weekday, day, month and year.',
    config: ['eyebrow'],
    examples: ['planner.today header'],
  },
  {
    id: 'note-section',
    label: 'Note section editor',
    status: 'implemented',
    description: 'Editable text bound to a body section of today\'s daily note (default: the Journal heading), saved on blur.',
    config: ['title', 'section'],
    examples: ['planner.today journal'],
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
    id: 'gauge',
    label: 'Score gauge',
    status: 'implemented',
    description: 'Circular score dial for 0-100 health, readiness, completion, or quality scores. Can use explicit values, built-in source fields, provider rows, or entity aggregates.',
    config: ['title', 'entity', 'source', 'field', 'metric', 'value', 'max', 'target', 'suffix', 'label', 'sub'],
    examples: ['reports.productivity', 'gamification dashboards'],
  },
  {
    id: 'progress',
    label: 'Progress bar',
    status: 'implemented',
    description: 'Linear percent-built bar for completion, readiness, or current/target progress. Supports explicit values, source fields, built-in provider rows, and entity aggregates.',
    config: ['title', 'entity', 'source', 'field', 'metric', 'value', 'max', 'target', 'suffix', 'label', 'sub'],
    examples: ['home', 'reports.productivity', 'project dashboards'],
  },
  {
    id: 'heatmap',
    label: 'Streak heatmap',
    status: 'implemented',
    description: 'Calendar-like square grid for daily cadence, streaks, and contribution-style activity. Buckets source rows or entity notes by date.',
    config: ['title', 'entity', 'source', 'dateField', 'field', 'metric', 'days', 'columns', 'empty'],
    examples: ['reports.productivity', 'content cadence dashboards'],
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
    status: 'implemented',
    description: 'Compact inline list preview of a Base file\'s rows (title + meta per row). For the full live Base UI (any view type) use base-view; for a link that opens the Base in a tab use base-link.',
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

/** Freeform dashboard blueprint as authored in workspace.json. */
export interface DashboardBlueprint {
  title?: string;
  subtitle?: string;
  contextFilter?: string;
  legend?: string;
  kind?: string;
  stats?: DashboardCard[];
  controls?: DashboardCard[];
  layout?: (DashboardCard | DashboardCard[])[][];
  conditionalRows?: Array<{ cards?: DashboardCard[] }>;
}

/** A row produced by a built-in dashboard provider (freeform values bag). */
export interface ProviderRow {
  value?: unknown;
  values?: Record<string, unknown>;
  [key: string]: unknown;
}

export function dashboardWidgetKind(card: DashboardCard): string {
  if (!card || typeof card !== 'object') return '';
  return String(card.kind || '').trim();
}

export function collectDashboardWidgetKinds(card: DashboardCard, kinds = new Set<string>()): Set<string> {
  if (!card || typeof card !== 'object' || Array.isArray(card)) return kinds;
  const kind = dashboardWidgetKind(card);
  if (kind) kinds.add(kind);
  if (Array.isArray(card.merge)) {
    kinds.add('merge');
    card.merge.forEach((source) => collectDashboardWidgetKinds(source, kinds));
  }
  return kinds;
}

export function countDashboardCards(config: DashboardBlueprint = {}): number {
  let count = 0;
  for (const row of config.layout || []) {
    for (const col of row || []) {
      count += Array.isArray(col) ? col.length : 1;
    }
  }
  count += (config.conditionalRows || []).reduce((sum, row) => sum + (Array.isArray(row?.cards) ? row.cards.length : 0), 0);
  return count;
}

export function summarizeDashboardBlueprint(id: string, config: DashboardBlueprint = {}) {
  const widgetKinds = new Set<string>();
  const sourceKinds = new Set<string>();
  const kind = String(
    config.kind || (String(id || '').startsWith('reports.') ? 'report' : String(id || '').startsWith('planner.') ? 'planner' : 'dashboard')
  ).trim().toLowerCase() || 'dashboard';
  (config.stats || []).forEach((stat) => {
    widgetKinds.add('metric');
    if (stat.metric) sourceKinds.add(`metric:${stat.metric}`);
    if (stat.count === 'open' || stat.count === 'active') sourceKinds.add('count:open');
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

export function dashboardProviderRowValue(row: ProviderRow, field = ''): number {
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
