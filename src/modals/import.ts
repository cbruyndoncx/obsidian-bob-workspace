import { csvTemplateForEntity, parseCSV, sampleValueForField } from '../csv';
import { ENTITIES, primaryField, primaryFieldKey } from '../entities';
import { createEntity } from '../notes';
import { DEFAULT_SETTINGS, entityFolder } from '../settings';
import { ensureFolderSync } from '../utils';
import { configuredFieldAliases, getXLSX, normalizedImportHeader, safeSheetName, workbookEntityKeyFromSheet, writeWorkbookToVault } from '../workbook';
import { WORKSPACE_CONFIG, workspaceConfiguredEntityEntries } from '../workspace-config';
import * as obsidian from 'obsidian';
export class CadenceImportModal extends obsidian.Modal {
  // Migrated from untyped main.js: instance fields are not yet declared.
  [key: string]: any;
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
    Object.entries<any>(configuredFieldAliases(def)).forEach(([header, fieldKey]) => {
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
    const mappedKeys = new Set(Object.values<any>(this.mapping).filter(Boolean));
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
    const primaryHeader = Object.entries<any>(this.mapping).find(([_, v]) => v === primaryKey);
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
        const contextValues: any = {};
        Object.entries<any>(this.mapping).forEach(([header, key]) => {
          if (!key) return;
          const idx = this.headers.indexOf(header);
          const val = String(row[idx] || '').trim();
          if (val) contextValues[key] = val;
        });
        const file = await createEntity(this.app, this.entityKey, primaryValue, { values: contextValues });
        const extras: any = {};
        Object.entries<any>(this.mapping).forEach(([header, key]) => {
          if (!key || key === primaryKey) return;
          const idx = this.headers.indexOf(header);
          let val: any = String(row[idx] || '').trim();
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
            Object.entries<any>(extras).forEach(([k, v]) => {
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
