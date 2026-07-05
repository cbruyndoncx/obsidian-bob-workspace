/*
 * Centralized UI help text — the single source for every on-screen explanation
 * (field hovers, widget guides, and the collapsible help panels in the Surface
 * Designer and Settings tabs). Kept in one module so copy is easy to maintain
 * and to translate: a translator edits only this file, and a localized build
 * can swap it wholesale. The renderers (CadenceAppView / CadenceSettingTab) read
 * from these tables and contain no help strings of their own.
 *
 * A help "line" is either a plain sentence or a [term, description] pair
 * rendered as "term — description".
 */

export type HelpLine = string | [string, string];

export interface HelpSection {
  heading: string;
  lines: HelpLine[];
}

/** A titled, multi-section help topic shown in a collapsible panel. */
export interface HelpTopic {
  title: string;
  sections: HelpSection[];
}

/** Per-widget guide shown in the widget editor's help panel. */
export interface WidgetGuide {
  what: string;
  use: string;
  fields: [string, string][];
}

/* ── Field-level hover help (widget editor form labels) ─────────── */
export const FIELD_HELP: Record<string, string> = {
  title: 'Heading shown at the top of this widget.',
  entity: 'Which record type to read (e.g. task, contact). The widget lists these.',
  titleFields: 'Frontmatter fields to use as each row’s title (first non-empty wins).',
  metaFields: 'Frontmatter fields shown as the small grey subtitle on each row.',
  placeholder: 'Grey hint text shown inside the empty input.',
  eyebrow: 'Small label above the date (defaults to the weekday).',
  empty: 'Message shown when there are no rows to display.',
  section: 'Heading in today’s daily note to bind to (e.g. ## Journal).',
  limit: 'Maximum number of rows to show.',
  view: 'Which view inside the selected Base to use (leave blank for its default).',
  base: 'Read rows from an existing .base file instead of the entity. Optional.',
  field: 'Frontmatter field this widget reads its number/value from.',
  metric: 'How to aggregate the field across records (count, sum, average…).',
  accent: 'Colour accent for this widget.',
};

/* ── One-line intro shown as a hover on the widget "Settings" section ── */
export const WIDGET_INTRO: Record<string, string> = {
  'date-hero': 'Shows today’s date. No data source needed.',
  'quick-add': 'A text box that adds a task to today’s note when you press Enter. No data source needed.',
  'note-section': 'An editable text area bound to a heading in today’s daily note (e.g. the journal).',
  'task-list': 'A checklist of tasks. Choose where the tasks come from under “Where do the tasks come from?” below.',
  list: 'A read-only list of records. Choose the source below.',
  metric: 'A single number (a count or total) from a record type.',
  kanban: 'A board of cards grouped into columns.',
};

/** Hover on the "Where does the data come from?" source section. */
export const SOURCE_SECTION_HELP =
  'Pick a Mode: “built-in” uses a prepared planner/home section; “recent”/“due” list records of the Entity above; “base” reads an existing .base file. Most Today widgets use built-in → planner.';

/* ── Per-widget comprehensive guide (widget editor help panel) ──── */
export const WIDGET_GUIDES: Record<string, WidgetGuide> = {
  'date-hero': { what: 'Shows today’s weekday, day, month and year.', use: 'A header for the Today screen. Needs no data.', fields: [['Eyebrow', 'small label above the date (defaults to the weekday)']] },
  'quick-add': { what: 'A text box that appends a task to today’s daily note when you press Enter.', use: 'Fast capture on the Today screen.', fields: [['Placeholder', 'grey hint text inside the box']] },
  'note-section': { what: 'An editable text area bound to a heading in today’s daily note; saves when you click away.', use: 'A journal / notes area on the Today screen.', fields: [['Section', 'which heading to bind to, e.g. ## Journal']] },
  'task-list': { what: 'A checklist of tasks with checkboxes you can tick. Ticking writes the change back.', use: 'Today’s tasks, or any filtered task list.', fields: [['Entity', 'read task records (e.g. task)'], ['Base', 'or read from a .base file + View'], ['Mode = built-in → planner', 'use the prepared “today” list'], ['Limit', 'max rows shown']] },
  list: { what: 'A read-only list of records.', use: 'Recent or due items from a record type.', fields: [['Entity', 'which record type'], ['Mode', 'recent / due / base'], ['Title/Meta fields', 'what to show per row']] },
  metric: { what: 'A single big number.', use: 'A count or total (e.g. open deals).', fields: [['Field', 'which value to read'], ['Metric', 'count / sum / average…']] },
  gauge: { what: 'A dial showing a value against a maximum (e.g. 72/100).', use: 'A score or completion percentage.', fields: [['Field', 'the value to read'], ['Metric', 'how to aggregate it'], ['Max', 'the full-scale value (default 100)'], ['Suffix', 'text after the number, e.g. %']] },
  progress: { what: 'A horizontal bar filling toward a target.', use: 'Progress toward a goal (e.g. days active this month).', fields: [['Field', 'the value'], ['Max', 'the target'], ['Suffix', 'text after the number'], ['Label', 'caption under the bar']] },
  heatmap: { what: 'A calendar grid coloured by activity per day.', use: 'Streaks / cadence over recent days.', fields: [['Date field', 'the date each record is placed on'], ['Field', 'value that sets colour intensity'], ['Days', 'how many days back'], ['Columns', 'grid width (7 = weeks)']] },
  'bar-chart': { what: 'Bars comparing a value across groups.', use: 'Counts or totals by status, owner, month…', fields: [['Entity', 'which records'], ['Group by', 'field that defines the bars'], ['Metric', 'count / sum of…'], ['Field', 'value to aggregate (for sum/avg)']] },
  kanban: { what: 'A board of cards in columns you can drag between.', use: 'A pipeline or status board.', fields: [['Entity', 'which records'], ['Group by', 'field that defines the columns'], ['Groups', 'fixed column order (optional)'], ['Title/Meta fields', 'what each card shows']] },
  selector: { what: 'A dropdown that filters the other widgets on this dashboard.', use: 'Let the viewer pick a client, stage, month…', fields: [['Key', 'the filter name other widgets read (required)'], ['Entity/Field', 'where the options come from'], ['All label', 'text for the “no filter” option']] },
  'date-range': { what: 'A date-range picker that filters the dashboard.', use: 'This month / last 30 days / custom.', fields: [['Key', 'the filter name (required)'], ['Default', 'the range selected on load'], ['Presets', 'the ranges offered']] },
  markdown: { what: 'A block of formatted text.', use: 'Notes, instructions, links, headings.', fields: [['Body / Text', 'the markdown to render'], ['Section', 'or pull text from a note heading']] },
  actions: { what: 'A row of buttons.', use: 'Quick actions — create a record, run a command, open a surface.', fields: [['Actions', 'the buttons: label + what each does']] },
  'base-link': { what: 'A button that opens a .base file in Obsidian.', use: 'Jump to a full Base view.', fields: [['Base', 'the .base file'], ['View', 'which view to open'], ['Label', 'button text']] },
  'base-embed': { what: 'A compact list rendered from a .base file’s rows.', use: 'Show Base results inline as a simple list.', fields: [['Base', 'the .base file'], ['View', 'which view supplies the rows'], ['Limit', 'max rows']] },
  'base-view': { what: 'A live, fully-rendered Obsidian Base view embedded in the card.', use: 'The real Base table/board inside a dashboard.', fields: [['Base', 'the .base file'], ['View', 'which view to render'], ['Height', 'card height'], ['Fallback', 'what to show if it can’t render']] },
  merge: { what: 'One list combining rows from several sources.', use: 'e.g. tasks from two folders in a single list.', fields: [['Merge', 'the list of sources to combine']] },
};

/* ── Topic panels (Surface Designer + Settings tabs) ────────────── */
export const HELP_TOPICS: Record<string, HelpTopic> = {
  'designer-overview': {
    title: 'How the Surface Designer works',
    sections: [
      { heading: 'The basics', lines: [
        'A surface (like Home or Today) is a dashboard made of widgets arranged in rows and columns.',
        'Pick a surface from the Dashboard dropdown, edit it on the left, and see a live preview on the right.',
      ] },
      { heading: 'Built-in vs custom', lines: [
        ['Built-in', 'the layout shipped with the workspace. Read-only until you Customize it.'],
        ['Customize', 'copies the built-in layout into your workspace.json as editable widgets.'],
        ['Reset to built-in', 'discards your changes and goes back to the shipped layout.'],
      ] },
      { heading: 'Editing widgets', lines: [
        'Each box in the Layout is a widget. Click Edit on a widget to change its type and settings.',
        'Hover any field label (dotted underline) for a short explanation.',
        'Drag widgets between columns; use + Col / + Add row to change the grid.',
      ] },
      { heading: 'Saving', lines: [
        'Click Save to write your changes to workspace.json. Switch to JSON mode to edit the raw config.',
      ] },
    ],
  },
  'modules-overview': {
    title: 'How Modules work',
    sections: [
      { heading: 'What this tab does', lines: [
        'Each card is a module (CRM, Planner, Finance…). Toggle it on/off to show or hide its whole section in the left navigation.',
      ] },
      { heading: 'The rows inside a card', lines: [
        ['Primary surface', 'a top-level nav item (e.g. Contacts). Toggle hides just that item.'],
        ['Secondary tab', 'an indented sub-tab shown inside a parent surface (e.g. Meetings under Client Work).'],
        ['Folder', 'where this record type’s notes live.'],
        ['Base', 'an optional .base file giving the list its columns/filters/view.'],
        ['View', 'which view of the Base to use. Each option is labelled with its type: a “table” view renders as the plugin’s editable inline table (create/edit/bulk); a board/calendar/card view renders as a live, read-only Obsidian Base embed inline. Both show inline — an “Open Base” action opens the full view in a tab.'],
      ] },
      { heading: 'Dashboards', lines: [
        ['built-in / ✎ custom chip', 'whether a surface uses the shipped dashboard or your own.'],
        ['Edit dashboard button', 'opens the Surface Designer for that surface (Customize / Reset there).'],
      ] },
    ],
  },
  'navigation-overview': {
    title: 'How Navigation works',
    sections: [
      { heading: 'The idea', lines: [
        'This designer defines your left-hand navigation: which groups and items appear, and in what order.',
      ] },
      { heading: 'Two levels', lines: [
        ['Primary', 'top-level items shown directly in the left rail.'],
        ['Secondary tab', 'sub-tabs shown inside a parent surface, not in the left rail.'],
      ] },
      { heading: 'Editing', lines: [
        'Drag items to reorder or move them between groups.',
        'Each item points at an entity (record type) or a dashboard route.',
        'Changes apply to workspace.json — click Save and apply when done.',
      ] },
    ],
  },
  'workspace-overview': {
    title: 'How the Workspace definition works',
    sections: [
      { heading: 'What this is', lines: [
        'workspace.json is the single file that composes your whole workspace: navigation, dashboards, Base mappings, schemas and portable settings.',
        'It lives next to the plugin data and is the source of truth — the other Settings tabs are friendlier editors for parts of it.',
      ] },
      { heading: 'Editing safely', lines: [
        ['Format', 'tidies the JSON.'],
        ['Save and apply', 'validates, writes the file, and reloads the workspace.'],
        ['Restore backup', 'loads the last saved backup into the editor.'],
      ] },
      { heading: 'Tip', lines: [
        'Prefer the Navigation, Modules and Surface Designer tabs for day-to-day changes; use this raw editor for bulk edits or blocks with no dedicated UI.',
      ] },
    ],
  },
  'review-overview': {
    title: 'What the Review tab shows',
    sections: [
      { heading: 'Purpose', lines: [
        'A read-only summary of your current workspace.json — navigation, dashboards, bases, schemas and settings — so you can sanity-check the whole configuration in one place.',
      ] },
      { heading: 'Using it', lines: [
        'Switch the inner tabs to inspect each area. Nothing here is editable — make changes in the other tabs or the Surface Designer.',
      ] },
    ],
  },
  'dashboards-overview': {
    title: 'How the Dashboards tab works',
    sections: [
      { heading: 'What this is', lines: [
        'The same dashboard/layout editor as the Surface Designer, embedded here for each configurable surface.',
      ] },
      { heading: 'Key actions', lines: [
        ['Customize', 'turn a built-in dashboard into editable widgets.'],
        ['Reset to built-in', 'discard your changes.'],
        ['Edit a widget', 'change its type and settings; hover field labels for help.'],
      ] },
    ],
  },
  'widgets-overview': {
    title: 'What the Widget catalog is',
    sections: [
      { heading: 'Purpose', lines: [
        'A reference list of every widget type you can add to a dashboard, with what each one does.',
      ] },
      { heading: 'Where you use them', lines: [
        'Add and configure widgets in the Dashboards tab or the Surface Designer; this tab is the catalogue you pick from.',
      ] },
    ],
  },
  'datamodel-overview': {
    title: 'How the Data model works',
    sections: [
      { heading: 'The idea', lines: [
        'Record types (contact, task, invoice…) are defined by schema YAML files. This tab creates and edits those definitions — the shape of your data.',
      ] },
      { heading: 'What you can set', lines: [
        ['Identity & location', 'the type name and which folder its notes live in.'],
        ['Fields', 'the frontmatter properties, their types and options.'],
        ['Discriminators', 'extra frontmatter that distinguishes sub-types.'],
        ['Defaults & aliases', 'starting values and import synonyms.'],
      ] },
      { heading: 'Bases', lines: [
        'Generate missing bases writes a .base file for each record type so it has columns and a view. A backup is written before every save.',
      ] },
    ],
  },
  'planner-overview': {
    title: 'Planner settings',
    sections: [
      { heading: 'What this controls', lines: [
        'How the planner reads and writes tasks: the task mode (checkboxes in daily notes vs TaskNotes), the headings it looks for, and project folders.',
      ] },
      { heading: 'Related', lines: [
        'The Today / Calendar screens themselves are dashboards — edit their layout in the Surface Designer, not here.',
      ] },
    ],
  },
  'app-overview': {
    title: 'App settings',
    sections: [
      { heading: 'What lives here', lines: [
        'Personal preferences that aren’t part of the shared workspace: reminders, daily-note folder/heading, week start, currency, team categories and appearance.',
      ] },
      { heading: 'Note', lines: [
        'These are stored per-install (in plugin data), not in workspace.json, so they don’t travel with a shared template.',
      ] },
    ],
  },
  'exports-overview': {
    title: 'Export groups',
    sections: [
      { heading: 'Purpose', lines: [
        'Define which record types are bundled together into each sheet when you export an XLSX workbook.',
      ] },
    ],
  },
  'data-overview': {
    title: 'Import & export',
    sections: [
      { heading: 'What you can do', lines: [
        ['Export XLSX', 'write your records to an Excel workbook (one sheet per group).'],
        ['Import XLSX / CSV', 'bring records in, mapping columns to entity fields.'],
      ] },
      { heading: 'Tip', lines: [
        'Import matches columns to fields using each entity’s field aliases, so common header names map automatically.',
      ] },
    ],
  },
};
