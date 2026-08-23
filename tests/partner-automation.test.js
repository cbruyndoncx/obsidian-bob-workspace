const assert = require('assert');
const { loadMainFunctions } = require('./load-main-functions');

/* Commission auto-create and partner expiry reminders.
 *
 * Both are skip-by-default guards: most calls are supposed to do nothing. Testing
 * only that they stay quiet proves nothing, so every case below asserts a verdict
 * — the acting branch as well as the skipping one. */

const ENTITIES = {
  deal:    { typeFilter: 'deal', valueField: 'deal_value', wonStages: ['won'], folder: '30-CLIENTS' },
  partner: { typeFilter: 'partner', folder: '20-COMPANY/35-PARTNERS' },
  commission: { typeFilter: 'commission', folder: '20-COMPANY/35-PARTNERS' },
};

const mk = (path, frontmatter) => ({
  path, name: path.split('/').pop(), basename: path.split('/').pop().replace(/\.md$/, ''), frontmatter,
});

function harness({ deals = [], partners = [], commissions = [] } = {}) {
  const created = [];
  const notices = [];
  const byKey = { deal: deals, partner: partners, commission: commissions };
  const app = {
    metadataCache: { getFileCache: (f) => ({ frontmatter: f.frontmatter || {} }) },
    vault: {
      getAbstractFileByPath: (p) => created.find((c) => c.path === p) || null,
      createFolder: async () => {},
      create: async (path, body) => { created.push({ path, body }); },
    },
  };
  const fns = loadMainFunctions(['maybeCreateCommissionForWonDeal', 'pushPartnerExpiryReminders', 'dealPartnerName', 'dealAtRisk', 'nakedRef'], {
    ENTITIES,
    dealWonStages: (def) => def.wonStages || ['won'],
    dealValueField: (def) => def.valueField || 'deal_value',
    readEntity: (a, f) => ({ file: f, frontmatter: f.frontmatter, basename: f.basename }),
    entityValue: (e, key, def) => (e.frontmatter || {})[key],
    listEntities: (a, key) => (byKey[key] || []).map((f) => ({ file: f, frontmatter: f.frontmatter, basename: f.basename })),
    reminderId: () => 'rem_test',
    daysUntil: (raw) => {
      const v = String(raw || '').slice(0, 10);
      if (!v) return null;
      const today = new Date(); today.setHours(0, 0, 0, 0);
      return Math.round((new Date(v).getTime() - today.getTime()) / 86400000);
    },
    CERT_WARN_DAYS: 60,
    REG_WARN_DAYS: 30,
    DEAL_STALE_DAYS: 30,
    CERT_REMIND_LEAD_DAYS: 30,
    REG_REMIND_LEAD_DAYS: 7,
    obsidian: { Notice: function (msg) { notices.push(msg); } },
  });
  return { ...fns, app, created, notices };
}

const inDays = (n) => {
  const d = new Date(); d.setHours(0, 0, 0, 0); d.setDate(d.getDate() + n);
  return d.toISOString().slice(0, 10);
};

/* ── Commission on won deal ── */
(async () => {
  const partner = mk('20-COMPANY/35-PARTNERS/acme/profile.md', { type: 'partner', partner_name: 'Acme', commission_rate: 15 });

  // Acting branch: won + partner + declared rate → one file, amount computed.
  {
    const deal = mk('30-CLIENTS/x/deal-a.md', { type: 'deal', partner_ref: '[[Acme]]', deal_value: 10000 });
    const h = harness({ partners: [partner] });
    const made = await h.maybeCreateCommissionForWonDeal(h.app, deal, 'won');
    assert.strictEqual(made, true, 'won partner deal creates a commission');
    assert.strictEqual(h.created.length, 1);
    assert.match(h.created[0].body, /amount: 1500/, 'amount = value × rate%');
    assert.match(h.created[0].body, /rate_pct: 15/, 'the rate used is recorded on the note');
    assert.match(h.created[0].body, /status: earned/, 'records the liability, does not settle it');
    assert.match(h.created[0].body, /partner_ref: "\[\[Acme\]\]"/, 'wikilink brackets are not doubled');
  }

  // Declared field left blank → amount 0 and the note says why. No invented rate.
  {
    const bare = mk('20-COMPANY/35-PARTNERS/none/profile.md', { type: 'partner', partner_name: 'NoRate' });
    const deal = mk('30-CLIENTS/x/deal-b.md', { type: 'deal', partner_ref: '[[NoRate]]', deal_value: 10000 });
    const h = harness({ partners: [bare] });
    assert.strictEqual(await h.maybeCreateCommissionForWonDeal(h.app, deal, 'won'), true);
    assert.match(h.created[0].body, /amount: 0/, 'no rate → amount 0, never a guessed default');
    assert.match(h.created[0].body, /Amount not computed/, 'the note explains the blank');
    assert.doesNotMatch(h.created[0].body, /rate_pct:/, 'no rate_pct key when there is no rate');
  }

  // Skipping branches, each asserted rather than assumed.
  {
    const deal = mk('30-CLIENTS/x/deal-c.md', { type: 'deal', partner_ref: '[[Acme]]', deal_value: 500 });
    const h = harness({ partners: [partner] });
    assert.strictEqual(await h.maybeCreateCommissionForWonDeal(h.app, deal, 'negotiation'), false, 'non-won stage does nothing');
    assert.strictEqual(h.created.length, 0);
  }
  {
    const deal = mk('30-CLIENTS/x/deal-d.md', { type: 'deal', deal_value: 500 });
    const h = harness({ partners: [partner] });
    assert.strictEqual(await h.maybeCreateCommissionForWonDeal(h.app, deal, 'won'), false, 'no partner named → no commission');
    assert.strictEqual(h.created.length, 0);
  }
  {
    const deal = mk('30-CLIENTS/x/deal-e.md', { type: 'deal', partner_ref: '[[Acme]]', deal_value: 500 });
    const existing = mk('c/commission-old.md', { type: 'commission', deal_ref: '[[deal-e]]' });
    const h = harness({ partners: [partner], commissions: [existing] });
    assert.strictEqual(await h.maybeCreateCommissionForWonDeal(h.app, deal, 'won'), false, 'idempotent: existing deal_ref blocks a duplicate');
    assert.strictEqual(h.created.length, 0);
  }

  /* ── Expiry reminders ── */
  const host = (overrides = {}) => ({
    settings: { reminders: [], expiryReminderSeen: {}, ...overrides },
    saveSettings: async () => {},
    refreshOpenViews: () => {},
  });

  {
    const files = [
      mk('c/cert-in-window.md',  { type: 'certification', status: 'active',   name: 'CCNP', partner_ref: '[[Acme]]', expires_date: inDays(30) }),
      mk('c/cert-far-out.md',    { type: 'certification', status: 'active',   name: 'Far',  expires_date: inDays(120) }),
      mk('c/cert-renewed.md',    { type: 'certification', status: 'renewed',  name: 'Done', expires_date: inDays(5) }),
      mk('c/reg-approved.md',    { type: 'registration',  status: 'approved', title: 'Vodacom', expires_date: inDays(10) }),
      mk('c/reg-submitted.md',   { type: 'registration',  status: 'submitted', title: 'Pending', expires_date: inDays(10) }),
      mk('c/reg-far-out.md',     { type: 'registration',  status: 'approved', title: 'Later', expires_date: inDays(90) }),
      mk('c/no-date.md',         { type: 'certification', status: 'active',   name: 'Undated' }),
    ];
    const h = harness();
    const st = host();
    const n = await h.pushPartnerExpiryReminders(h.app, st, files);
    assert.strictEqual(n, 2, 'only the in-window cert and the approved in-window registration raise reminders');
    const texts = st.settings.reminders.map((r) => r.text).sort();
    assert.match(texts[0], /^Registration Vodacom expires .* — close or extend$/);
    assert.match(texts[1], /^Renew CCNP at Acme — expires /);
    assert.ok(st.settings.reminders.every((r) => new Date(r.when).getTime() >= Date.now() - 86400000),
      'a reminder never lands at a past date where no inbox bucket would show it');

    // Same sweep run again is a no-op — the whole point of seen-tracking.
    assert.strictEqual(await h.pushPartnerExpiryReminders(h.app, st, files), 0, 'second sweep raises nothing');

    // Renewing to a new expiry is a new expiry, so it raises a fresh reminder.
    const renewed = files.map((f) => f.path === 'c/cert-in-window.md'
      ? mk(f.path, { ...f.frontmatter, expires_date: inDays(45) })
      : f);
    assert.strictEqual(await h.pushPartnerExpiryReminders(h.app, st, renewed), 1, 'a new expiry date raises a new reminder');
  }

  // The off switch actually switches it off.
  {
    const h = harness();
    const st = host({ partnerExpiryReminders: false });
    const files = [mk('c/cert.md', { type: 'certification', status: 'active', name: 'X', expires_date: inDays(1) })];
    assert.strictEqual(await h.pushPartnerExpiryReminders(h.app, st, files), 0, 'disabled → nothing raised');
    assert.strictEqual(st.settings.reminders.length, 0);
  }

  /* ── Attribution + at-risk resolvers ── */
  {
    const h = harness();
    const dd = ENTITIES.deal;
    const rec = (fm) => ({ frontmatter: fm, basename: 'd' });

    // The bug this resolver exists to fix: analytics read `partner` alone, so a
    // deal written with the DECLARED field was invisible to partner attribution.
    assert.strictEqual(h.dealPartnerName(rec({ partner_ref: '[[Acme]]' }), dd), 'Acme', 'declared partner_ref resolves');
    assert.strictEqual(h.dealPartnerName(rec({ partner: 'Acme' }), dd), 'Acme', 'legacy partner key still resolves');
    assert.strictEqual(h.dealPartnerName(rec({ partner_ref: '[[Acme|Acme Ltd]]' }), dd), 'Acme', 'alias stripped');
    assert.strictEqual(h.dealPartnerName(rec({}), dd), '', 'unattributed deal resolves to empty');

    const ago = (n) => { const d = new Date(); d.setDate(d.getDate() - n); return d.toISOString().slice(0, 10); };
    const ahead = (n) => { const d = new Date(); d.setDate(d.getDate() + n); return d.toISOString().slice(0, 10); };
    assert.match(h.dealAtRisk(rec({ expected_close: ago(5) }), dd), /overdue/, 'past close date is at risk');
    assert.match(h.dealAtRisk(rec({ last_contact: ago(45) }), dd), /no contact/, '45 days untouched is at risk');
    assert.strictEqual(h.dealAtRisk(rec({ expected_close: ahead(30), last_contact: ago(5) }), dd), null, 'healthy deal is not at risk');
    assert.strictEqual(h.dealAtRisk(rec({ last_contact: ago(20) }), dd), null, 'inside the 30-day window is not at risk');
    // A deal with no dates at all cannot be judged, and must not be guessed at.
    assert.strictEqual(h.dealAtRisk(rec({}), dd), null, 'no dates → not flagged');
  }

  console.log('partner-automation.test.js: ok');
})().catch((e) => { console.error(e); process.exit(1); });
