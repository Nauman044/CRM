/* =====================================================================
   Dispatch Link – auth.js  (shared by every page)
   Licence (allowedUsers + expiry) · login · roles · session guard
   Roles: admin -> hub.html | sales -> crm.html | dispatcher -> dms.html
   ===================================================================== */
const DL = (() => {
  const DBS = ["https://data-scrapper-eddcf-default-rtdb.firebaseio.com/",
               "https://data-scraper-2-default-rtdb.firebaseio.com/",
               "https://data-scraper-3-default-rtdb.firebaseio.com/"];
  const KEY = 'dl_session', HOME = { admin: 'hub.html', sales: 'crm.html', dispatcher: 'dms.html' };
  const FATAL = ['EXPIRED', 'NO_COMPANY', 'BAD_LOGIN', 'REMOVED'];
  const MSGS = {
    EMPTY: 'Please enter your username and password.',
    BAD_LOGIN: 'Invalid username or password.',
    NOT_ACTIVATED: 'This company has no password yet. Use "Create your password" below.',
    NOT_ALLOWED: 'This username is not authorised. Contact Dispatch Link admin.',
    ALREADY: 'Password is already created for this company. Please sign in.',
    SHORT: 'Password must be at least 6 characters.',
    MISMATCH: 'Passwords do not match.',
    EXPIRED: 'Subscription has expired! Contact Admin.',
    NO_COMPANY: 'Company not found or no longer active.',
    REMOVED: 'Your access has been removed. Contact your admin.',
    NO_SHEET: 'Dispatch team login is not ready yet: your admin must connect the Google Sheet in DMS > Settings.',
    ACCESS_REMOVED: 'Your access has been removed. Contact your admin.',
    NETWORK: 'No internet connection.',
    SHEET_NET: 'Cannot reach the Google Sheet link. Check: (1) the URL ends with /exec, (2) Apps Script > Deploy > Manage deployments: Execute as = Me, Who has access = Anyone, (3) after any code change deploy a New version. Test: open the link in a new tab - it must show {"ok":true,...}.',
    PERMISSION: 'Firebase blocked the request. Check the Realtime Database rules (see README).',
    BAD_RESPONSE: 'Google Sheet did not answer. Admin: re-deploy the Apps Script as Web app (access: Anyone).'
  };
  const msg = e => MSGS[e && e.message] || ('Something went wrong: ' + ((e && e.message) || e));
  const err = m => { throw new Error(m); };
  const enc = new TextEncoder();
  const hex = b => [...new Uint8Array(b)].map(x => x.toString(16).padStart(2, '0')).join('');
  const newSalt = () => hex(crypto.getRandomValues(new Uint8Array(16)));
  async function hashPw(pw, salt) {                 // salted PBKDF2-SHA256 (same as the old DMS)
    const k = await crypto.subtle.importKey('raw', enc.encode(pw), 'PBKDF2', false, ['deriveBits']);
    return hex(await crypto.subtle.deriveBits({ name: 'PBKDF2', salt: enc.encode(salt), iterations: 100000, hash: 'SHA-256' }, k, 256));
  }
  const today = () => new Date().toISOString().slice(0, 10);
  async function jf(u, o) {
    let r;
    try { r = await fetch(u, o && o.body ? { ...o, headers: { 'Content-Type': 'application/json' } } : o); }
    catch (e) { console.error('Request failed:', u, e); err('NETWORK'); }
    if (!r.ok) err('PERMISSION');
    return r.json();
  }
  async function sheet(url, action, x) {
    for (let i = 0; ; i++) {
      try { return await sheet1(url, action, x); }
      catch (e) { if (i >= 4 || !['BAD_RESPONSE', 'SHEET_NET'].includes(e.message)) throw e; await new Promise(r => setTimeout(r, 1000 * (i + 1))); }
    }
  }
  let LAST = '';
  function jsonp(url, payload) {                     // <script> transport: no CORS, follows redirects
    return new Promise((res, rej) => {
      const cb = 'dlcb' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6), s = document.createElement('script');
      let t; const done = () => { delete window[cb]; s.remove(); clearTimeout(t); };
      const q = 'p=' + encodeURIComponent(JSON.stringify(payload)) + '&callback=' + cb;
      if (q.length > 7000) return rej(new Error('SHEET_NET'));
      t = setTimeout(() => { done(); LAST = 'script transport timeout'; rej(new Error('SHEET_NET')); }, 30000);
      window[cb] = d => { done(); res(d); };
      s.onerror = () => { done(); LAST = 'script transport blocked'; rej(new Error('SHEET_NET')); };
      s.onload = () => setTimeout(() => { if (window[cb]) { done(); LAST = 'script transport got no data (redeploy Code.gs as New version)'; rej(new Error('BAD_RESPONSE')); } }, 50);
      s.src = url + (url.includes('?') ? '&' : '?') + q;
      document.head.appendChild(s);
    });
  }
  async function sheetCall(url, payload, safe) {     // fetch first; if the browser blocks it, use the script transport
    let r;
    try { r = await fetch(url, { method: 'POST', body: JSON.stringify(payload) }); }
    catch (e) { LAST = 'fetch blocked: ' + e; return jsonp(url, payload); }
    try { return await r.json(); }
    catch { LAST = 'non-JSON reply (HTTP ' + r.status + ')'; if (safe) return jsonp(url, payload); err('BAD_RESPONSE'); }
  }
  async function sheet1(url, action, x) {
    if (!/^https:\/\/script\.google\.com\//.test(url || '')) err('NO_SHEET');
    return sheetCall(url, { action, ...x }, true);
  }

  /* ---------- companies (licence) ---------- */
  async function companies() {
    let failed = 0;
    const res = await Promise.all(DBS.map(u => jf(u + 'allowedUsers.json').catch(() => { failed++; return null; })));
    if (failed === DBS.length) err('NETWORK');
    const all = {};
    res.forEach((us, i) => us && Object.keys(us).forEach(k => { if (us[k] && typeof us[k] === 'object') all[k] = { ...us[k], id: k, dbUrl: us[k].dbUrl || DBS[i] }; }));
    return all;
  }
  async function company(id) {
    const all = await companies(), want = String(id || '').trim().toLowerCase();
    const k = Object.keys(all).find(x => x === id) || Object.keys(all).find(x => x.toLowerCase() === want);
    return k ? all[k] : null;
  }
  const expiry = c => { if (!c) err('NO_COMPANY'); if (c.expires && today() > c.expires) err('EXPIRED'); return c; };
  const base = c => c.dbUrl.endsWith('/') ? c.dbUrl : c.dbUrl + '/';
  const patchCompany = (c, o) => Promise.all(Object.keys(o).map(k => {   // one PUT/DELETE per field
    const u = base(c) + 'allowedUsers/' + c.id + '/' + k + '.json';
    return o[k] === null ? jf(u, { method: 'DELETE' }) : jf(u, { method: 'PUT', body: JSON.stringify(o[k]) });
  }));
  const salesUrl = (c, u) => base(c) + 'sales_users/' + c.id + (u ? '/' + u : '') + '.json';

  /* ---------- sales agents (CRM logins, stored in the company's own database) ---------- */
  const salesList = async c => (await jf(salesUrl(c))) || {};
  async function salesPut(c, u, name, pw) {
    const salt = newSalt(), hash = await hashPw(pw, salt);
    return jf(salesUrl(c, u), { method: 'PUT', body: JSON.stringify({ name, salt, hash, created: Date.now() }) });
  }
  const salesDel = (c, u) => jf(salesUrl(c, u), { method: 'DELETE' });

  /* ---------- session ---------- */
  const session = () => { try { return JSON.parse(localStorage.getItem(KEY)); } catch { return null; } };
  const home = s => HOME[s.role] || 'index.html';
  function enter(s) { localStorage.setItem(KEY, JSON.stringify(s)); localStorage.setItem('dl_logged_client', s.company); return home(s); }
  function logout() { localStorage.removeItem(KEY); localStorage.removeItem('dl_logged_client'); location.replace('index.html'); }

  async function login(tab, u, p, co) {              // returns the page to open
    u = (u || '').trim(); co = (co || '').trim();
    if (!u || !p) err('EMPTY');
    if (!co) {                                       // company admin
      const c = await company(u);
      if (!c) err('BAD_LOGIN');
      if (!c.hash) err('NOT_ACTIVATED');
      if (await hashPw(p, c.salt) !== c.hash) err('BAD_LOGIN');
      expiry(c);
      return enter({ role: 'admin', username: c.id, name: c.name || c.id, company: c.id, hash: c.hash });
    }
    const c = expiry(await company(co)); u = u.toLowerCase();
    if (tab === 'crm') {                             // sales agent
      const r = await jf(salesUrl(c, u));
      if (!r || await hashPw(p, r.salt) !== r.hash) err('BAD_LOGIN');
      return enter({ role: 'sales', username: u, name: r.name || u, company: c.id, hash: r.hash });
    }
    const { salt } = await sheet(c.sheetUrl, 'salt', { username: u });   // dispatcher (checked in company's Google Sheet)
    const h = await hashPw(p, salt), r = await sheet(c.sheetUrl, 'login', { u, h });
    if (r.error) err(r.error);
    return enter({ role: 'dispatcher', username: u, name: r.name, company: c.id, hash: h });
  }

  async function activate(u, p, p2) {                // client creates his own password (once)
    u = (u || '').trim();
    const c = await company(u);
    if (!c) err('NOT_ALLOWED');
    expiry(c);
    if (c.hash) err('ALREADY');
    if ((p || '').length < 6) err('SHORT');
    if (p !== p2) err('MISMATCH');
    const salt = newSalt(), hash = await hashPw(p, salt);
    await patchCompany(c, { salt, hash, activated: Date.now() });
    return enter({ role: 'admin', username: c.id, name: c.name || c.id, company: c.id, hash });
  }

  /* ---------- guard: every protected page calls this first ---------- */
  async function verify(s) {                         // licence + account still valid?
    const c = expiry(await company(s.company));
    if (s.role === 'admin' && c.hash !== s.hash) err('BAD_LOGIN');
    if (s.role === 'sales') { const r = await jf(salesUrl(c, s.username)); if (!r || r.hash !== s.hash) err('REMOVED'); }
    return c;
  }
  async function guard(roles) {
    const s = session();
    if (!s) { location.replace('index.html'); return null; }
    if (!roles.includes(s.role)) { location.replace(home(s)); return null; }
    const bad = e => { if (FATAL.includes(e.message)) { alert(msg(e)); logout(); } };
    try { await verify(s); } catch (e) { bad(e); if (FATAL.includes(e.message)) return null; }
    setInterval(() => verify(s).catch(bad), 60000);   // expiry / removal is enforced while the app is open
    return s;
  }
  return { sheetCall, lastErr: () => LAST, msg, login, activate, guard, verify, session, logout, company, patchCompany, salesList, salesPut, salesDel, hashPw };
})();
