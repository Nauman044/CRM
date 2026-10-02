/**
 * Dispatch Link - Google Sheets backend (Apps Script Web App)
 * Every company uses its OWN copy of this sheet + script, so one company's data is never visible to another.
 * Google Sheet = database for: team logins, carriers, loads, settings.
 * Firebase = only the admin username/password (checked in the app). The first admin who links this sheet
 * becomes its owner; nobody else can link or open it.
 *
 * Setup: Google Sheet > Extensions > Apps Script > paste this file > Deploy > New deployment > Web app
 *   Execute as: Me | Who has access: Anyone -> copy the /exec URL.
 *   Then in the app: sign in as admin > Settings > Configure Google Sheet > paste the URL.
 * (No extra permissions or editing needed. If you change this code later: Deploy > Manage deployments > Edit > New version.)
 */
const SHEETS = {
  Carriers: ['id', 'mc', 'company', 'owner', 'phone', 'truck', 'dispatcher', 'commission', 'status', 'length'],
  Loads: ['id', 'carrierId', 'booked', 'status', 'rate', 'pct', 'origin', 'dest', 'dispatcher'],
  Users: ['id', 'username', 'name', 'role', 'status', 'salt', 'hash'],
  Settings: ['key', 'value']
};
const NUM = { rate: 1, pct: 1, commission: 1 };

function sheet_(name) {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  let s = ss.getSheetByName(name);
  if (!s) {
    s = ss.insertSheet(name);
    s.appendRow(SHEETS[name]);
    s.setFrozenRows(1);
    s.getRange(2, 1, 1000, SHEETS[name].length).setNumberFormat('@');
  }
  const h = s.getRange(1, 1, 1, SHEETS[name].length).getValues()[0]; // adds new columns to older sheets
  if (h.join() !== SHEETS[name].join()) s.getRange(1, 1, 1, SHEETS[name].length).setValues([SHEETS[name]]);
  return s;
}

function out_(o) {
  return ContentService.createTextOutput(JSON.stringify(o)).setMimeType(ContentService.MimeType.JSON);
}

let MEMO = {}; // per-request cache: each sheet is read once, cleared on every write
function rows_(name) {
  if (!MEMO[name]) MEMO[name] = rowsRaw_(name);
  return MEMO[name];
}

function rowsRaw_(name) {
  const v = sheet_(name).getDataRange().getValues();
  const h = v.shift();
  return v.filter(function (r) { return r[0] !== ''; }).map(function (r) {
    const o = {};
    h.forEach(function (k, i) {
      let x = r[i];
      if (x instanceof Date) x = Utilities.formatDate(x, Session.getScriptTimeZone(), "yyyy-MM-dd'T'HH:mm");
      o[k] = NUM[k] ? Number(x) || 0 : String(x);
    });
    return o;
  });
}

// insert or update one row (matched by first column) – always stored as text
function put_(name, row) {
  MEMO = {};
  const s = sheet_(name), cols = SHEETS[name];
  const vals = cols.map(function (k) { return row[k] === undefined ? '' : row[k]; });
  const ids = s.getRange(1, 1, s.getLastRow(), 1).getValues().map(function (r) { return String(r[0]); });
  const i = ids.indexOf(String(row[cols[0]]));
  const rg = s.getRange(i > 0 ? i + 1 : s.getLastRow() + 1, 1, 1, cols.length);
  rg.setNumberFormat('@');
  rg.setValues([vals]);
}

// the admin who linked this sheet first owns it (stored in Settings: owner_u / owner_h)
function owner_() {
  const c = {};
  rows_('Settings').forEach(function (r) { c[r.key] = r.value; });
  return c.owner_u ? { u: c.owner_u, h: c.owner_h } : null;
}

function auth_(u, h) {
  if (!u || !h) return null;
  const o = owner_();
  if (o && o.u === u) return o.h === h ? { role: 'owner', name: u } : null;
  const m = rows_('Users').filter(function (x) { return x.username === u && x.role === 'team'; })[0];
  if (!m || m.hash !== h) return null;
  if (m.status === 'disabled') return { err: 'ACCESS_REMOVED' };
  return { role: 'team', name: m.name };
}

// GET works in two ways: plain (health check) or with ?p=<json>&callback=<fn> (script-tag transport for browsers that block cross-site fetch)
function doGet(e) {
  const p = (e && e.parameter) || {};
  if (!p.p) return out_({ ok: true, info: 'Dispatch Link backend' });
  const res = doPost({ postData: { contents: p.p } }).getContent();
  const cb = String(p.callback || '');
  if (/^[A-Za-z0-9_]+$/.test(cb)) return ContentService.createTextOutput(cb + '(' + res + ');').setMimeType(ContentService.MimeType.JAVASCRIPT);
  return ContentService.createTextOutput(res).setMimeType(ContentService.MimeType.JSON);
}

function doPost(e) {
  let lock = null;
  MEMO = {};
  try {
    const d = JSON.parse(e.postData.contents), a = d.action;

    if (a === 'salt') { // login step 1: salt of a team user (random fake salt if unknown)
      const m = rows_('Users').filter(function (x) { return x.username === d.username && x.role === 'team'; })[0];
      return out_({ salt: m && m.salt ? m.salt : Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, 'x' + d.username).map(function (b) { return ('0' + (b & 255).toString(16)).slice(-2); }).join('') });
    }
    if (a === 'claim') { // admin links this sheet: first admin becomes the owner, anyone else is refused
      if (!d.u || !d.h) return out_({ error: 'BAD_LOGIN' });
      lock = LockService.getScriptLock();
      lock.waitLock(15000);
      const o = owner_();
      if (!o) { put_('Settings', { key: 'owner_u', value: d.u }); put_('Settings', { key: 'owner_h', value: d.h }); }
      else if (o.u !== d.u || o.h !== d.h) return out_({ error: 'SHEET_OWNED' });
      return out_({ ok: true });
    }
    if (!owner_()) return out_({ error: 'NOT_CLAIMED' });
    const me = auth_(d.u, d.h);
    if (!me) return out_({ error: 'BAD_LOGIN' });
    if (me.err) return out_({ error: me.err });
    const own = me.role === 'owner';

    if (a === 'login') return out_({ ok: true, role: me.role, name: me.name });

    if (a === 'pull') {
      const mine = function (r) { return own || r.dispatcher === me.name; };
      const cfg = {};
      rows_('Settings').forEach(function (r) { cfg[r.key] = r.value; });
      delete cfg.owner_u; delete cfg.owner_h;
      return out_({
        Carriers: rows_('Carriers').filter(mine),
        Loads: rows_('Loads').filter(mine),
        Settings: own ? cfg : (cfg.pct !== undefined ? { pct: cfg.pct } : {}),
        Users: own ? rows_('Users').filter(function (x) { return x.role === 'team'; }).map(function (x) {
          return { id: x.username, username: x.username, name: x.name, role: 'team', status: x.status || 'active' };
        }) : []
      });
    }

    lock = LockService.getScriptLock();
    lock.waitLock(15000);

    if (a === 'upsert' || a === 'delete') {
      if (d.sheet !== 'Carriers' && d.sheet !== 'Loads') return out_({ error: 'bad sheet' });
      if (a === 'delete') {
        if (!own) return out_({ error: 'forbidden' });
        const s = sheet_(d.sheet);
        const ids = s.getRange(1, 1, s.getLastRow(), 1).getValues().map(function (r) { return String(r[0]); });
        const i = ids.indexOf(String(d.id));
        if (i > 0) s.deleteRow(i + 1);
        MEMO = {};
        return out_({ ok: true });
      }
      const row = d.row;
      if (!own) { // team can only touch their own rows
        const old = rows_(d.sheet).filter(function (r) { return r.id === String(row.id); })[0];
        if (old && old.dispatcher !== me.name) return out_({ error: 'forbidden' });
        row.dispatcher = me.name;
      }
      put_(d.sheet, row);
      return out_({ ok: true });
    }

    if (!own) return out_({ error: 'forbidden' }); // everything below is admin only

    if (a === 'setcfg') {
      ['name', 'addr', 'pay', 'disp', 'pct'].forEach(function (k) { put_('Settings', { key: k, value: d.cfg[k] === undefined ? '' : d.cfg[k] }); });
      return out_({ ok: true });
    }
    if (a === 'adduser') {
      const u = String(d.username || '');
      if (!/^[a-z0-9_-]{3,}$/.test(u)) return out_({ error: 'BAD_LOGIN' });
      const adm = owner_();
      const old = rows_('Users').filter(function (x) { return x.username === u; })[0];
      if ((adm && adm.u === u) || (old && old.status !== 'disabled')) return out_({ error: 'USER_TAKEN' });
      put_('Users', { id: u, username: u, name: d.name, role: 'team', status: 'active', salt: d.salt, hash: d.hash });
      return out_({ ok: true });
    }
    if (a === 'setpw' || a === 'disable') {
      const u = rows_('Users').filter(function (x) { return x.username === d.username && x.role === 'team'; })[0];
      if (!u) return out_({ error: 'BAD_LOGIN' });
      if (a === 'setpw') { u.salt = d.salt; u.hash = d.hash; } else u.status = 'disabled';
      put_('Users', u);
      return out_({ ok: true });
    }
    return out_({ error: 'bad action' });
  } catch (err) {
    return out_({ error: String(err) });
  } finally {
    if (lock) lock.releaseLock();
  }
}
