/* =====================================================================
   Dispatch Link – scraper-core.js
   Sections: 1 Config/DB routing · 2 Shift & cleanup · 3 Notifications
             4 Login/Identity · 5 Sessions · 6 IndexedDB · 7 UI framework
             8 Filters · 9 Email · 10 Calls · 11 Follow-ups & Team share
             12 Remarks/CSV/History · 13 Scraper
   ===================================================================== */

/* ---------- 1. CONFIG & PER-CLIENT DATABASE ROUTING ---------- */
(function injectFavicon() {
    let link = document.querySelector("link[rel*='icon']");
    if (!link) { link = document.createElement('link'); link.rel = 'icon'; document.head.appendChild(link); }
    link.type = 'image/png';
    link.href = "https://cdn.jsdelivr.net/gh/mrartist048/fmcsa-control@main/favicon.png";
})();

const FIREBASE_DB_URL_1 = "https://data-scrapper-eddcf-default-rtdb.firebaseio.com/";
const FIREBASE_DB_URL_2 = "https://data-scraper-2-default-rtdb.firebaseio.com/";
const FIREBASE_DB_URL_3 = "https://data-scraper-3-default-rtdb.firebaseio.com/";
const ALL_DB_URLS = [FIREBASE_DB_URL_1, FIREBASE_DB_URL_2, FIREBASE_DB_URL_3];

let allowedUsers = {};
let currentClient = localStorage.getItem("dl_logged_client") || "";
let FIREBASE_DB_URL = FIREBASE_DB_URL_1;   // always re-resolved to the client's own database
let userLimit = 0;
let dispatcherNickname = "";

const safeKey = s => String(s || "").replace(/[.#$\/\[\]]/g, "_");
const esc = s => String(s ?? "").replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const jsq = s => String(s ?? "").replace(/\\/g, "\\\\").replace(/'/g, "\\'");
const qs = sel => document.querySelector(sel);
/* icons come from the SVG sprite inside index.html (no emojis anywhere) */
const ico = n => `<svg class="ico" aria-hidden="true"><use href="#i-${n}"/></svg>`;
const LOGO_URL = "https://cdn.jsdelivr.net/gh/mrartist048/fmcsa-control@main/favicon.png";
const LOGO_IMG = `<span class="brand-tile"><img src="${LOGO_URL}" alt="Dispatch Link" onerror="this.replaceWith(Object.assign(document.createElement('span'),{className:'logo-fallback',textContent:'DL'}))"></span>`;

function resolveClientDb() {
    const u = allowedUsers[currentClient];
    const url = (u && u.dbUrl) || FIREBASE_DB_URL_1;
    FIREBASE_DB_URL = url.endsWith("/") ? url : url + "/";
}

/* Merges users of all 3 databases; every user remembers the DB it came from */
async function fetchAllowedUsersFromFirebase() {
    const res = await Promise.all(ALL_DB_URLS.map(u =>
        fetch(`${u}allowedUsers.json`).then(r => r.json()).catch(() => null)));
    allowedUsers = {};
    res.forEach((users, i) => {
        if (!users) return;
        Object.keys(users).forEach(k => {
            allowedUsers[k] = Object.assign({}, users[k], { dbUrl: users[k].dbUrl || ALL_DB_URLS[i] });
        });
    });
    resolveClientDb();
}

if (!window.name || !window.name.startsWith("dl_inst_")) {
    window.name = "dl_inst_" + Math.random().toString(36).substr(2, 9) + "_" + Date.now() + "_" + Math.floor(Math.random() * 100000);
}
const tabUniqueId = window.name;

const usStatesMap = {
    AL: "Alabama", AK: "Alaska", AZ: "Arizona", AR: "Arkansas", CA: "California", CO: "Colorado", CT: "Connecticut",
    DE: "Delaware", FL: "Florida", GA: "Georgia", HI: "Hawaii", ID: "Idaho", IL: "Illinois", IN: "Indiana", IA: "Iowa",
    KS: "Kansas", KY: "Kentucky", LA: "Louisiana", ME: "Maine", MD: "Maryland", MA: "Massachusetts", MI: "Michigan",
    MN: "Minnesota", MS: "Mississippi", MO: "Missouri", MT: "Montana", NE: "Nebraska", NV: "Nevada", NH: "New Hampshire",
    NJ: "New Jersey", NM: "New Mexico", NY: "New York", NC: "North Carolina", ND: "North Dakota", OH: "Ohio",
    OK: "Oklahoma", OR: "Oregon", PA: "Pennsylvania", RI: "Rhode Island", SC: "South Carolina", SD: "South Dakota",
    TN: "Tennessee", TX: "Texas", UT: "Utah", VT: "Vermont", VA: "Virginia", WA: "Washington", WV: "West Virginia",
    WI: "Wisconsin", WY: "Wyoming"
};

/* ---------- 2. SHIFT (USA TIME) & CLEANUP ---------- */
function getCurrentShiftDateKey() {
    const parts = new Intl.DateTimeFormat([], { timeZone: "America/New_York", year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', hour12: false }).formatToParts(new Date());
    const p = {}; parts.forEach(x => { p[x.type] = x.value; });
    const d = new Date(`${p.year}-${p.month}-${p.day}T00:00:00`);
    if (parseInt(p.hour) < 3) d.setDate(d.getDate() - 1);   // shift changes at 3 AM USA time
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

function checkAndClearLocalStorageOnShiftChange() {
    const cur = getCurrentShiftDateKey(), tracker = `dl_shift_date_tracker_${currentClient}`;
    const last = localStorage.getItem(tracker);
    if (last && last !== cur) {
        const remove = [];
        for (let i = 0; i < localStorage.length; i++) {
            const k = localStorage.key(i);
            if (k && (k.includes('dl_call_logs_') || k.includes('dl_subj_') || k.includes('dl_body_'))) remove.push(k);
        }
        remove.forEach(k => localStorage.removeItem(k));
    }
    localStorage.setItem(tracker, cur);
}

/* Removes remote call logs that fail keepFn (works for old array data and new keyed data) */
async function pruneRemoteLogs(keepFn) {
    if (!currentClient || !dispatcherNickname) return;
    const base = `${FIREBASE_DB_URL}call_logs/${currentClient}/${safeKey(dispatcherNickname)}.json`;
    try {
        const logs = await (await fetch(base)).json();
        if (!logs) return;
        const patch = {};
        Object.entries(logs).forEach(([k, l]) => { if (!l || !keepFn(l)) patch[k] = null; });
        if (Object.keys(patch).length) await fetch(base, { method: 'PATCH', body: JSON.stringify(patch) });
    } catch (e) { console.error("Prune failed:", e); }
}
async function cleanupOldFirebaseData() {       // keeps the last 7 days only
    const cut = new Date(); cut.setDate(cut.getDate() - 7);
    return pruneRemoteLogs(l => l.shiftDate && new Date(l.shiftDate) >= cut);
}
function performAutomaticDataCleanup() {
    if (currentClient) checkAndClearLocalStorageOnShiftChange();
}

/* ---------- 3. NOTIFICATIONS & LIMIT MODAL ---------- */
function showLimitExceededModal(message) {
    const old = document.getElementById('dlLimitExceededModal'); if (old) old.remove();
    const m = document.createElement('div');
    m.id = 'dlLimitExceededModal';
    m.className = 'overlay show';
    m.style.zIndex = 999999999;
    m.innerHTML = `
      <div class="modal-card center danger">
        <div class="big-ico">${ico('alert')}</div>
        <h3>License Limit Exceeded</h3>
        <p class="muted">${message}</p>
        <div class="note-box">Need to increase your active device/tab limit?<br>Contact Admin: <b>03700684849</b></div>
        <button class="btn-primary block" onclick="window.location.reload()">OK, Understood</button>
      </div>`;
    document.body.appendChild(m);
}

function showPremiumNotification(message, duration = 4500) {
    const t = document.createElement('div');
    t.className = 'toast';
    t.innerHTML = `<i></i><span>${message}</span>`;
    (document.getElementById('toastStack') || document.body).appendChild(t);
    requestAnimationFrame(() => t.classList.add('in'));
    setTimeout(() => { t.classList.remove('in'); setTimeout(() => t.remove(), 450); }, duration);
}

/* dark / light mode */
function syncThemeBtn() {
    const b = document.getElementById('themeSwitch');
    if (b) b.setAttribute('aria-checked', document.documentElement.dataset.theme === 'dark' ? 'true' : 'false');
}
window.toggleTheme = function () {
    const t = document.documentElement.dataset.theme === 'dark' ? 'light' : 'dark';
    document.documentElement.dataset.theme = t;
    try { localStorage.setItem('dl_theme', t); } catch (e) {}
    syncThemeBtn();
};

/* status bar + progress card */
function setStatus(html, type = 'idle') {
    const b = document.getElementById('status');
    if (b) { b.className = 'status ' + type; b.innerHTML = html; }
}
function setProgress(pct, label) {
    const p = document.getElementById('kpiProgress'), bar = document.getElementById('kpiProgressBar');
    if (p) p.textContent = label !== undefined ? label : pct + '%';
    if (bar) bar.style.width = pct + '%';
}
function updateCallKpi() {
    const el = document.getElementById('kpiCalls');
    if (!el || !currentClient || !dispatcherNickname) return;
    const logs = JSON.parse(localStorage.getItem(`dl_call_logs_${currentClient}_${dispatcherNickname}`)) || [];
    el.textContent = logs.filter(l => l.shiftDate === getCurrentShiftDateKey()).length;
}

/* ---------- 4. LOGIN & AGENT IDENTITY ---------- */
function renderLoginScreen() {
    DL.logout(); return;   // login lives on index.html now
    const o = document.createElement('div');
    o.id = 'dlLoginOverlay';
    o.innerHTML = `
      <div class="login-brand">
        <div class="login-top">${LOGO_IMG}<span>Dispatch Link</span></div>
        <div class="login-copy">
          <div class="login-headline">Built for freight dispatch teams.</div>
          <p>Lead processing, calling and follow-up CRM in one secure workspace.</p>
          <ul class="login-points">
            <li>${ico('check')}FMCSA lead scanning by MC range</li>
            <li>${ico('check')}One-click calling with live call status</li>
            <li>${ico('check')}Follow-up pipeline and team sharing</li>
          </ul>
        </div>
        <div class="login-legal">&copy; ${new Date().getFullYear()} Dispatch Link. All rights reserved.</div>
      </div>
      <div class="login-card">
        <div class="login-form">
          <div class="login-head">Sign in</div>
          <p class="login-sub">Enter the credentials issued to your company.</p>
          <label for="dlLoginUser">Username</label>
          <input type="text" id="dlLoginUser" placeholder="Enter your username" autocomplete="username">
          <label for="dlLoginPass">Password</label>
          <div class="login-pw">
            <input type="password" id="dlLoginPass" placeholder="Enter your password" autocomplete="current-password" onkeydown="if(event.key==='Enter')processLogin()">
            <button type="button" class="login-eye" onclick="togglePasswordVisibility()" id="dlEyeIcon" title="Show or hide password" aria-label="Show or hide password">${ico('eye')}</button>
          </div>
          <button class="login-btn" onclick="processLogin()">Sign in</button>
          <div id="dlLoginError" class="login-error"></div>
          <div class="login-help">Need access? Contact admin: <b>03700684849</b><br>
            <a href="mailto:info@dispatchlink.online">info@dispatchlink.online</a></div>
        </div>
      </div>`;
    document.body.appendChild(o);
}

window.togglePasswordVisibility = function () {
    const p = document.getElementById('dlLoginPass'), e = document.getElementById('dlEyeIcon');
    if (!p) return;
    const show = p.type === 'password';
    p.type = show ? 'text' : 'password';
    e.innerHTML = ico(show ? 'eye-off' : 'eye');
};

window.processLogin = async function () {
    const u = document.getElementById('dlLoginUser').value.trim();
    const p = document.getElementById('dlLoginPass').value.trim();
    const err = document.getElementById('dlLoginError');
    const fail = msg => { err.style.display = "block"; err.innerText = msg; };

    await fetchAllowedUsersFromFirebase();
    const cfg = allowedUsers[u];
    if (!cfg || cfg.pass !== p) return fail("Invalid Username or Password!");
    if (new Date().toISOString().split('T')[0] > cfg.expires) return fail("Subscription has expired! Contact Admin.");

    localStorage.setItem("dl_logged_client", u);
    currentClient = u;
    resolveClientDb();
    await dbReady;
    saveAppDataToIndexedDB("settings", { key: "client_login", value: u });
    window.location.reload();
};

function setupDispatcherIdentity() {
    return new Promise(async resolve => {
        await dbReady;
        getAppDataFromIndexedDB("settings", "agent_nickname", saved => {
            dispatcherNickname = (DL.session() || {}).name || saved || "";
            if (dispatcherNickname && dispatcherNickname !== saved) saveAppDataToIndexedDB("settings", { key: "agent_nickname", value: dispatcherNickname });
            if (!dispatcherNickname) {
                const name = prompt("Welcome! Please enter your name (e.g., Nauman, Ali, Bilal):");
                dispatcherNickname = (name && name.trim()) ? name.trim() : "User_" + Math.floor(100 + Math.random() * 900);
                saveAppDataToIndexedDB("settings", { key: "agent_nickname", value: dispatcherNickname });
            }
            injectNicknameProfileUI();
            resolve();
        });
    });
}

function injectNicknameProfileUI() {
    if (document.getElementById('dlNickProfilePanel')) return;
    const bar = qs('.app-bar'), heading = qs('h1, h2, .heading') || document.body;
    const initial = (dispatcherNickname || '?').trim().charAt(0).toUpperCase();
    const panel = document.createElement('div');
    panel.id = 'dlNickProfilePanel';
    panel.innerHTML = `
      <button type="button" class="me-btn" id="dlMeBtn" aria-haspopup="true" aria-expanded="false" onclick="toggleAgentDropdown(event)">
        <span class="me-avatar">${esc(initial)}</span><span id="dlDispCurrentName">${esc(dispatcherNickname)}</span>${ico('chevron')}
      </button>
      <div class="settings-menu" id="dlAgentDropdownMenu" role="menu" aria-label="Account menu">
        <div class="sm-head"><span class="me-avatar lg">${esc(initial)}</span><div><b>${esc(dispatcherNickname)}</b><small>Workspace: ${esc(currentClient)}</small></div></div>
        <div class="sm-list">
          <button type="button" class="sm-item" onclick="openSettingsModal()">${ico('settings')}Settings</button>
          ${DL.session().role === 'admin' ? `<button type="button" class="sm-item" onclick="openAdminPanelPrompt()">${ico('shield')}Admin panel</button>` : ''}
          <button type="button" class="sm-item danger" onclick="logoutUser()">${ico('logout')}Sign out</button>
        </div>
      </div>`;
    if (bar) bar.appendChild(panel); else heading.parentNode.insertBefore(panel, heading.nextSibling);

    const modal = document.createElement('div');
    modal.className = 'overlay'; modal.id = 'dlSettingsModal';
    modal.onclick = e => { if (e.target === modal) closeSettingsModal(); };
    modal.innerHTML = `
      <div class="modal-card set-card" role="dialog" aria-modal="true" aria-labelledby="dlSettingsTitle">
        <button class="x" onclick="closeSettingsModal()" aria-label="Close">${ico('x')}</button>
        <h3 id="dlSettingsTitle">Settings</h3>
        <p class="muted">Personalise your workspace. Changes apply to this account only.</p>
        <div class="set-sec">
          <label for="dlNameInput">Display name</label>
          <div class="sm-inline">
            <input type="text" id="dlNameInput" value="${esc(dispatcherNickname)}" maxlength="40" autocomplete="off" onkeydown="if(event.key==='Enter')changeDispatcherName()">
            <button type="button" class="btn-primary" onclick="changeDispatcherName()">Save</button>
          </div>
        </div>
        <div class="set-sec">
          <div class="sm-row">
            <div class="set-theme">${ico('sun')}${ico('moon')}<div><b>Dark mode</b><small>Switch between light and dark appearance</small></div></div>
            <button type="button" class="switch" id="themeSwitch" role="switch" aria-checked="false" aria-label="Dark mode" onclick="toggleTheme()"><span></span></button>
          </div>
        </div>
      </div>`;
    document.body.appendChild(modal);
    syncThemeBtn();
    document.addEventListener('click', e => {
        if (!e.target.closest('#dlNickProfilePanel')) closeAgentDropdown();
    });
}

window.openSettingsModal = function () {
    closeAgentDropdown();
    const m = document.getElementById('dlSettingsModal'), i = document.getElementById('dlNameInput');
    if (i) i.value = dispatcherNickname;
    if (m) m.classList.add('show');
};
window.closeSettingsModal = function () {
    const m = document.getElementById('dlSettingsModal'); if (m) m.classList.remove('show');
};

function closeAgentDropdown() {
    const dd = document.getElementById('dlAgentDropdownMenu'), btn = document.getElementById('dlMeBtn');
    if (dd) dd.classList.remove('open');
    if (btn) btn.setAttribute('aria-expanded', 'false');
}

window.toggleAgentDropdown = function (e) {
    e.stopPropagation();
    const dd = document.getElementById('dlAgentDropdownMenu'), btn = document.getElementById('dlMeBtn');
    if (!dd) return;
    const open = dd.classList.toggle('open');
    if (btn) btn.setAttribute('aria-expanded', open ? 'true' : 'false');
    if (open) { const i = document.getElementById('dlNameInput'); if (i) i.value = dispatcherNickname; }
};

window.changeDispatcherName = function () {
    if (DL.session()) { showPremiumNotification("Your display name is managed by your admin.", 2800); return; }
    const inp = document.getElementById('dlNameInput'), n = inp ? inp.value.trim() : "";
    if (!n) { showPremiumNotification("Please enter a display name.", 2500); return; }
    if (n === dispatcherNickname) { showPremiumNotification("Display name is unchanged.", 2200); return; }
    dispatcherNickname = n;
    saveAppDataToIndexedDB("settings", { key: "agent_nickname", value: dispatcherNickname });
    showPremiumNotification("Display name updated. Reloading...", 1500);
    updateActiveSessionData().finally(() => setTimeout(() => window.location.reload(), 600));
};

function dropSession() {
    try { fetch(`${FIREBASE_DB_URL}sessions/${currentClient}/${safeKey(tabUniqueId)}.json`, { method: 'DELETE', keepalive: true }); } catch (e) {}
}

window.logoutUser = function () {
    dropSession();
    DL.logout();
};

window.openAdminPanelPrompt = function () { window.location.href = 'hub.html'; };

/* ---------- 5. LICENSE / SESSION HEARTBEAT ---------- */
async function initializeAccessControl() {
    await fetchAllowedUsersFromFirebase();
    if (!currentClient || !allowedUsers[currentClient]) { renderLoginScreen(); return; }

    const cfg = allowedUsers[currentClient];
    userLimit = cfg.maxLaptops || 0;
    if (new Date().toISOString().split('T')[0] > cfg.expires) {
        alert("Your subscription has expired.");
        localStorage.removeItem("dl_logged_client");
        renderLoginScreen();
        return;
    }

    await setupDispatcherIdentity();
    document.body.classList.remove('dl-locked');
    updateCallKpi();
    showPremiumNotification(`License Active: Verified for "${currentClient}" (Expires: ${cfg.expires})`);
    performAutomaticDataCleanup();
    cleanupOldFirebaseData();
    await checkGlobalSessions();
    setInterval(checkGlobalSessions, 5000);
}

async function updateActiveSessionData() {
    if (!currentClient) return;
    try {
        await fetch(`${FIREBASE_DB_URL}sessions/${currentClient}/${safeKey(tabUniqueId)}/nickname.json`, { method: 'PUT', body: JSON.stringify(dispatcherNickname) });
    } catch (e) { console.error("Failed to update session nickname:", e); }
}

async function checkGlobalSessions() {
    if (!currentClient) return;
    const now = Date.now(), tabKey = safeKey(tabUniqueId);
    const timeKey = `dl_fixed_login_time_${currentClient}_${dispatcherNickname}`;
    const shiftKey = getCurrentShiftDateKey();
    let loginTime = localStorage.getItem(timeKey);
    if (!loginTime || localStorage.getItem(`${timeKey}_date`) !== shiftKey) {
        loginTime = new Date().toLocaleTimeString();
        localStorage.setItem(timeKey, loginTime);
        localStorage.setItem(`${timeKey}_date`, shiftKey);
    }
    try {
        const data = await (await fetch(`${FIREBASE_DB_URL}sessions/${currentClient}.json`)).json() || {};
        const active = {};
        Object.keys(data).forEach(k => { if (data[k] && data[k].timestamp && now - data[k].timestamp < 12000) active[k] = data[k]; });

        if (userLimit > 0 && !active[tabKey] && Object.keys(active).length >= userLimit) {
            if (typeof scraping !== 'undefined' && scraping) stopScraping();
            showLimitExceededModal(`Your global license limit for "<b>${esc(currentClient)}</b>" has been reached. Max allowed active tabs/devices is <b>${userLimit}</b>. Scraping has been paused safely.`);
            return;
        }
        await fetch(`${FIREBASE_DB_URL}sessions/${currentClient}/${tabKey}.json`, {
            method: 'PUT',
            body: JSON.stringify({ instanceId: tabUniqueId, nickname: dispatcherNickname, timestamp: now, loginTime })
        });
    } catch (e) { console.error("Session sync failed:", e); }
}

window.addEventListener('beforeunload', () => {
    if (currentClient) dropSession();
});

async function bootstrap() {
    const sess = await DL.guard(['admin', 'sales']);      // RBAC: admin + sales agents only
    if (!sess) return;
    currentClient = sess.company;
    await fetchAllowedUsersFromFirebase();
    if (!currentClient || !allowedUsers[currentClient]) renderLoginScreen();
    else initializeAccessControl();
}
if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', bootstrap);
else setTimeout(bootstrap, 200);

/* ---------- 6. INDEXEDDB ---------- */
let db;
let currentHistoryId = null;
let availableCategories = new Set();
let scraping = false;
let scrapedData = [];

const dbReady = new Promise(resolve => {
    const req = indexedDB.open("DispatchLinkHistoryDB", 2);
    req.onupgradeneeded = e => {
        const d = e.target.result;
        if (!d.objectStoreNames.contains("history")) d.createObjectStore("history", { keyPath: "id", autoIncrement: true });
        if (!d.objectStoreNames.contains("followups")) d.createObjectStore("followups", { keyPath: "mc" });
        if (!d.objectStoreNames.contains("settings")) d.createObjectStore("settings", { keyPath: "key" });
    };
    req.onsuccess = e => { db = e.target.result; resolve(db); };
    req.onerror = () => resolve(null);
});
dbReady.then(() => {
    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', injectHistoryUIFramework);
    else injectHistoryUIFramework();
});

function saveAppDataToIndexedDB(store, obj) {
    if (!db) return;
    try { db.transaction(store, "readwrite").objectStore(store).put(obj); } catch (e) { console.error("IndexedDB save error:", e); }
}
function getAppDataFromIndexedDB(store, key, cb) {
    if (!db) return cb(null);
    try {
        const r = db.transaction(store, "readonly").objectStore(store).get(key);
        r.onsuccess = () => cb(r.result ? r.result.value : null);
        r.onerror = () => cb(null);
    } catch (e) { cb(null); }
}
function getAllAppDataFromIndexedDB(store, cb) {
    if (!db) return cb([]);
    try {
        const r = db.transaction(store, "readonly").objectStore(store).getAll();
        r.onsuccess = () => cb(r.result || []);
        r.onerror = () => cb([]);
    } catch (e) { cb([]); }
}

/* ---------- 7. UI INIT (markup = index.html, design = style.css) ---------- */
const DEFAULT_REMARKS_TEMPLATE = "Truck Type:\nLength:\nAccessories:\nLoad:\nZip Code:\nSummary:";
const DISPOSITIONS = [
    ['Hung up', '#B42318'], ['Voicemail', '#7C3AED'], ['Not interested', '#C2410C'],
    ['Do not Call', '#1D4ED8'], ['Follow up', '#15803D'], ['Sale Closed', '#0F766E']
];

const DISP_ICONS = { 'Hung up': 'phoneoff', 'Voicemail': 'voicemail', 'Not interested': 'xcircle', 'Do not Call': 'ban', 'Follow up': 'calendar', 'Sale Closed': 'trophy' };
function injectHistoryUIFramework() {
    document.title = "Dispatch Link";
    syncThemeBtn();

    const opts = document.getElementById('dispOptions');
    if (opts) opts.innerHTML = DISPOSITIONS.map(([n, col]) =>
        `<button class="disp-opt" style="--c:${col}" onclick="submitCallDisposition('${n}')"><span class="disp-ico">${ico(DISP_ICONS[n] || 'check')}</span><span class="disp-txt">${n}</span></button>`).join('');

    const headRow = qs('table tr');
    if (headRow && !document.getElementById('remarksHeaderCol')) {
        const mk = (id, text, cls) => { const th = document.createElement('th'); th.id = id; th.innerText = text; if (cls) th.className = cls; return th; };
        const powerTh = headRow.children[8];
        const veh = mk('vehicleTypeHeaderCol', 'Vehicles');
        if (powerTh && powerTh.nextSibling) headRow.insertBefore(veh, powerTh.nextSibling); else headRow.appendChild(veh);
        headRow.appendChild(mk('remarksHeaderCol', 'Remarks', 'remarks-cell-container'));
        headRow.appendChild(mk('followUpHeaderCol', 'Action'));
    }

    injectAdvancedFilterBar();
    injectEmailProposalPanel();
    window.addEventListener('scroll', updateFloatingNav);
    /* leads table: wheel always scrolls the table first, then hands over to the page (never gets stuck) */
    const tblBox = qs('.table-responsive');
    if (tblBox) tblBox.addEventListener('wheel', e => {
        if (e.ctrlKey || Math.abs(e.deltaX) > Math.abs(e.deltaY)) return;
        const dy = e.deltaMode === 1 ? e.deltaY * 40 : e.deltaY, max = tblBox.scrollHeight - tblBox.clientHeight;
        const can = dy > 0 ? tblBox.scrollTop < max - 1 : tblBox.scrollTop > 0;
        e.preventDefault();
        if (can) tblBox.scrollTop += dy; else window.scrollBy({ top: dy, behavior: 'instant' });
    }, { passive: false });
    updateFloatingNav();
    updateCallKpi();
}

function updateFloatingNav() {
    const y = window.pageYOffset || document.documentElement.scrollTop;
    const called = qs('.phone-clickable-cell.active-called-cell') !== null;
    const up = document.getElementById('dlScrollUpBtn'), down = document.getElementById('dlScrollDownBtn');
    if (up) up.style.display = y > 250 ? 'flex' : 'none';
    if (down) down.style.display = (y < 300 && called) ? 'flex' : 'none';
}

window.scrollToTopScreen = function () {
    window.scrollTo({ top: 0, behavior: 'smooth' });
    const s = document.getElementById('startMc'); if (s) s.focus();
};
window.scrollToLastCalledLead = function () {
    const c = qs('.phone-clickable-cell.active-called-cell');
    if (c) { c.scrollIntoView({ behavior: 'smooth', block: 'center' }); showPremiumNotification("Jumped to last called lead!", 2000); }
    else showPremiumNotification("No call logged yet in this session.", 2500);
};

/* drawers */
function syncScrim() {
    const s = document.getElementById('drawerScrim');
    if (s) s.classList.toggle('show', !!qs('.drawer.open'));
    document.querySelectorAll('.nav-tab[data-panel]').forEach(t => {
        const d = document.getElementById(t.dataset.panel);
        t.classList.toggle('active', !!(d && d.classList.contains('open')));
    });
}
window.closeDrawers = function () {
    document.querySelectorAll('.drawer').forEach(d => d.classList.remove('open'));
    syncScrim();
};

/* contact us */
window.openContactModal = function () {
    closeDrawers(); closeAgentDropdown();
    const cfg = allowedUsers[currentClient] || {};
    const acc = document.getElementById('dlContactAccount');
    if (acc) acc.innerHTML =
        `<div><small>Workspace</small><b>${esc(currentClient || '-')}</b></div>` +
        `<div><small>License valid until</small><b>${esc(cfg.expires || '-')}</b></div>` +
        `<div><small>Active agent</small><b>${esc(dispatcherNickname || '-')}</b></div>`;
    const m = document.getElementById('dlContactModal'); if (m) m.style.display = 'flex';
};
window.closeContactModal = function () {
    const m = document.getElementById('dlContactModal'); if (m) m.style.display = 'none';
};
window.copyContactValue = function (text, label) {
    navigator.clipboard.writeText(text).then(
        () => showPremiumNotification(`${label} copied.`, 2000),
        () => showPremiumNotification(`Copy failed. Please copy ${label.toLowerCase()} manually.`, 3000));
};
document.addEventListener('keydown', e => {
    if (e.key !== 'Escape') return;
    closeDrawers(); closeContactModal(); closeAgentDropdown();
    const c = document.getElementById('dlCallingDetailModal'); if (c) c.style.display = 'none';
});

/* ---------- 8. FILTERS ---------- */
function toggleCategoryDropdown(e) {
    e.stopPropagation();
    const l = document.getElementById('categoryDropdownCheckList');
    if (l) l.classList.toggle('visible');
}
window.addEventListener('click', e => {
    if (!e.target.closest('#categoryDropdownCheckList')) {
        const l = document.getElementById('categoryDropdownCheckList');
        if (l) l.classList.remove('visible');
    }
});

function updateCategoryCheckboxes() {
    const box = document.getElementById('checkboxListContainer');
    if (!box) return;
    const checked = Array.from(document.querySelectorAll('.cat-checkbox:checked')).map(cb => cb.value);
    const cats = Array.from(availableCategories).sort();
    box.innerHTML = cats.length ? cats.map(cat =>
        `<li><label><input type="checkbox" class="cat-checkbox" value="${esc(cat)}" ${checked.includes(cat) ? 'checked' : ''} onchange="applyAdvancedFilters()"><span>${esc(cat)}</span></label></li>`).join('')
        : `<li class="dd-item" style="color:var(--mut)">Categories appear after scanning</li>`;
}

function rebuildCategoriesFromData() {
    availableCategories.clear();
    scrapedData.forEach(r => (r.carrierDetails || '').split(', ').forEach(c => { if (c.trim()) availableCategories.add(c.trim()); }));
    updateCategoryCheckboxes();
}

function injectAdvancedFilterBar() {
    populateStateDropdown();
    populateVehicleTypeCheckboxes();
    updateCategoryCheckboxes();
    document.addEventListener('click', e => {
        const v = document.getElementById('vehicleDropdown');
        if (v && !v.contains(e.target)) v.classList.remove('open');
    });
}

window.toggleVehicleDropdown = function (e) {
    e.stopPropagation();
    document.getElementById('vehicleDropdown').classList.toggle('open');
};

function stateOfAddress(addr) {
    const a = (addr || "").toUpperCase();
    return Object.keys(usStatesMap).find(code => new RegExp(`\\b${code}\\b(?=\\s+\\d{5}(-\\d{4})?)`).test(a)) || null;
}

function populateStateDropdown() {
    const sel = document.getElementById('stateDropdownSelect');
    if (!sel) return;
    const counts = {};
    scrapedData.forEach(r => { const c = stateOfAddress(r.address); if (c) counts[c] = (counts[c] || 0) + 1; });
    const cur = sel.value;
    sel.innerHTML = '<option value="">All States</option>';
    const codes = Object.keys(counts).sort((a, b) => usStatesMap[a].localeCompare(usStatesMap[b]));
    const maxLen = Math.max(0, ...codes.map(c => `${usStatesMap[c]} (${c})`.length));
    codes.forEach(c => {
        const label = `${usStatesMap[c]} (${c})`;
        const o = document.createElement('option');
        o.value = c;
        o.textContent = label + "\u00A0".repeat(Math.max(2, maxLen - label.length + 4)) + counts[c];
        sel.appendChild(o);
    });
    sel.value = cur;
    updateVisibleRecordCount();
}

function populateVehicleTypeCheckboxes() {
    const box = document.getElementById('vehicleCheckboxList');
    if (!box) return;
    const checked = new Set(Array.from(box.querySelectorAll('input:checked')).map(cb => cb.value));
    box.innerHTML = ["Straight Trucks", "Truck Tractors", "Trailers"].map(v =>
        `<label class="dd-item"><input type="checkbox" value="${v}" ${checked.has(v) ? 'checked' : ''} onchange="applyAdvancedFilters()"><span>${v}</span></label>`).join('');
}

window.applyAdvancedFilters = function () {
    const state = (document.getElementById('stateDropdownSelect')?.value || "").toUpperCase();
    const q = (document.getElementById('universalSearchInput')?.value || "").toLowerCase().trim();
    const cats = Array.from(document.querySelectorAll('.cat-checkbox:checked')).map(cb => cb.value);
    const vehs = Array.from(document.querySelectorAll('#vehicleCheckboxList input:checked')).map(cb => cb.value.toLowerCase());

    document.querySelectorAll('#resultsTable tr').forEach((row, i) => {
        const rec = scrapedData[i];
        if (!rec) return;
        const okState = !state || new RegExp(`\\b${state}\\b(?=\\s+\\d{5}(-\\d{4})?)`).test((row.cells[6]?.textContent || "").toUpperCase());
        const okSearch = !q || [0, 2, 5].some(c => (row.cells[c]?.textContent || "").toLowerCase().includes(q));
        const vt = (row.cells[9]?.textContent || "").toLowerCase();
        const okVeh = !vehs.length || vehs.some(v => vt.includes(v));
        const okCat = !cats.length || cats.every(c => (rec.carrierDetails || "").includes(c));
        row.style.display = (okState && okSearch && okVeh && okCat) ? "" : "none";
    });
    const cBtn = document.querySelector('#categoryDropdownCheckList .dd-btn'), vBtn = document.getElementById('vehicleDropdownBtn');
    if (cBtn) cBtn.textContent = cats.length ? `Categories (${cats.length})` : 'Categories';
    if (vBtn) vBtn.textContent = vehs.length ? `Vehicle types (${vehs.length})` : 'Vehicle types';
    updateVisibleRecordCount();
};

window.resetAdvancedFilters = function () {
    const s = document.getElementById('stateDropdownSelect'), i = document.getElementById('universalSearchInput');
    if (s) s.value = ""; if (i) i.value = "";
    document.querySelectorAll('#vehicleCheckboxList input, .cat-checkbox').forEach(cb => cb.checked = false);
    applyAdvancedFilters();
};

function updateVisibleRecordCount() {
    const rows = document.querySelectorAll('#resultsTable tr');
    let n = 0; rows.forEach(r => { if (r.style.display !== 'none' && r.cells.length > 2) n++; });
    const b = document.getElementById('visibleRecordCountBadge'); if (b) b.textContent = n;
}

/* ---------- 9. EMAIL PROPOSAL ---------- */
function injectEmailProposalPanel() {
    const s = document.getElementById('propSubjectInput'), b = document.getElementById('propBodyInput');
    if (!s || !b) return;
    s.value = localStorage.getItem(`dl_subj_${currentClient}`) || "Dispatch Service Proposal";
    b.value = localStorage.getItem(`dl_body_${currentClient}`) || "Hello {company},\n\nWe found your profile via FMCSA. We offer dispatching services at 5% rate.\n\nBest Regards.";
}
window.toggleProposalPanel = function () { document.getElementById('premiumProposalWrapper').classList.toggle('open'); };
window.saveProposalTemplateSettings = function () {
    localStorage.setItem(`dl_subj_${currentClient}`, document.getElementById('propSubjectInput').value);
    localStorage.setItem(`dl_body_${currentClient}`, document.getElementById('propBodyInput').value);
    document.getElementById('premiumProposalWrapper').classList.remove('open');
    showPremiumNotification("Email template saved.", 2500);
};

window.triggerOneClickEmailPitch = function (email, company) {
    if (!email || email === 'N/A') return;
    const subj = localStorage.getItem(`dl_subj_${currentClient}`) || "Dispatch Proposal";
    const body = (localStorage.getItem(`dl_body_${currentClient}`) || "Hello").replace(/{company}/gi, company);
    const mailto = `mailto:${email}?subject=${encodeURIComponent(subj)}&body=${encodeURIComponent(body)}`;
    const gmail = `https://mail.google.com/mail/?view=cm&fs=1&to=${email}&su=${encodeURIComponent(subj)}&body=${encodeURIComponent(body)}`;
    const w = window.open(mailto, '_blank');
    setTimeout(() => {
        try { if (!w || w.location.href === 'about:blank' || w.document.body.innerHTML === '') { if (w) w.location.href = gmail; } } catch (e) {}
    }, 500);
};

window.copyEmailToClipboard = function (el, email) {
    if (!email || email === 'N/A') return;
    navigator.clipboard.writeText(email).then(() => {
        const b = document.createElement('span');
        b.className = 'premium-copy-badge'; b.innerText = "Copied!";
        el.appendChild(b); setTimeout(() => b.remove(), 1200);
    });
};

function buildEmailCellMarkup(email, company) {
    if (!email || email === 'N/A') return `<td class="cell-na">N/A</td>`;
    return `<td><div class="email-cell">
      <span class="email-copy" title="Click to copy" onclick="copyEmailToClipboard(this.parentNode,'${jsq(email)}')">${esc(email)}</span>
      <a href="#" onclick="triggerOneClickEmailPitch('${jsq(email)}','${jsq(company)}');return false;" class="premium-pitch-btn">Send</a></div></td>`;
}

/* ---------- 10. PHONE CALLS & DISPOSITIONS ---------- */
let activeCallPhone = null, pendingReviewPhone = null, activeCallCellElement = null;
let callStatusCache = null;
const statusSlug = s => String(s || '').toLowerCase().replace(/\s+/g, '-');
function lastStatusFor(phone) {
    if (!callStatusCache) {
        callStatusCache = {};
        const logs = JSON.parse(localStorage.getItem(`dl_call_logs_${currentClient}_${dispatcherNickname}`)) || [];
        const shift = getCurrentShiftDateKey();
        logs.forEach(l => { if (l.shiftDate === shift) callStatusCache[l.phone] = l.status; });
    }
    return callStatusCache[phone] || '';
}
function statusChip(phone) {
    const st = lastStatusFor(phone);
    return `<span class="call-status${st ? ' st-' + statusSlug(st) : ''}" data-phone="${esc(phone)}"${st ? '' : ' hidden'}>${esc(st)}</span>`;
}
function refreshStatusChips(phone, status) {
    document.querySelectorAll('.call-status').forEach(c => {
        if (c.dataset.phone === phone) { c.hidden = false; c.className = 'call-status st-' + statusSlug(status); c.textContent = status; }
    });
}

/* Every call is stored under its own key in the CLIENT'S OWN database:
   call_logs/<client>/<agent>/<callId>  -> admin totals stay exact across tabs/devices */
window.logCallCountWithDisposition = async function (phone, cell, status) {
    if (!phone || phone === 'N/A') return;
    const entry = {
        id: Date.now().toString(36) + Math.random().toString(36).slice(2, 6),
        phone, dispatcher: dispatcherNickname, status,
        shiftDate: getCurrentShiftDateKey(),
        date: new Date().toLocaleString(),
        timestamp: Date.now()
    };
    const storageKey = `dl_call_logs_${currentClient}_${dispatcherNickname}`;
    const logs = JSON.parse(localStorage.getItem(storageKey)) || [];
    logs.push(entry);
    localStorage.setItem(storageKey, JSON.stringify(logs));
    callStatusCache = null;
    refreshStatusChips(phone, status);
    updateCallKpi();

    try {
        await fetch(`${FIREBASE_DB_URL}call_logs/${currentClient}/${safeKey(dispatcherNickname)}/${entry.id}.json`, { method: 'PUT', body: JSON.stringify(entry) });
    } catch (e) { console.error("Failed to sync call log to DB:", e); }

    showPremiumNotification(`Call Logged [${status}] for ${phone}`, 2500);
    if (cell) {
        document.querySelectorAll('.phone-clickable-cell').forEach(el => el.classList.remove('active-called-cell'));
        cell.classList.add('active-called-cell');
    }
    const down = document.getElementById('dlScrollDownBtn'); if (down) down.style.display = 'none';
};

window.openDispositionModal = function (phone) {
    pendingReviewPhone = phone;
    const span = document.getElementById('dispTargetPhoneNum'), m = document.getElementById('dlDispositionModal');
    if (span) span.innerText = phone;
    if (m) m.style.display = 'flex';
};

window.submitCallDisposition = function (status) {
    const m = document.getElementById('dlDispositionModal'); if (m) m.style.display = 'none';
    if (pendingReviewPhone) {
        logCallCountWithDisposition(pendingReviewPhone, activeCallCellElement, status);
        pendingReviewPhone = null; activeCallCellElement = null;
    }
};

window.openCallingDetailModal = function () {
    const logs = JSON.parse(localStorage.getItem(`dl_call_logs_${currentClient}_${dispatcherNickname}`)) || [];
    const today = logs.filter(l => l.shiftDate === getCurrentShiftDateKey());
    const by = {}; today.forEach(l => { by[l.status] = (by[l.status] || 0) + 1; });
    document.getElementById('dlCallingBody').innerHTML =
        `<div class="stat-row total"><span>Total calls logged</span><b>${today.length}</b></div>` +
        DISPOSITIONS.map(([n, col]) => `<div class="stat-row"><span><i class="dot" style="--c:${col}"></i>${n}</span><b>${by[n] || 0}</b></div>`).join('');
    document.getElementById('dlCallingDetailModal').style.display = 'flex';
};

function markCalled(cell, phone) {
    activeCallPhone = phone;
    activeCallCellElement = cell;
    if (cell) {
        document.querySelectorAll('.phone-clickable-cell').forEach(el => el.classList.remove('active-called-cell'));
        cell.classList.add('active-called-cell');
    }
}

window.copyPhoneToClipboardDirect = function (event, container, phone) {
    event.stopPropagation();
    if (!phone || phone === 'N/A') return;
    markCalled(container.closest('td').querySelector('.phone-clickable-cell'), phone);
    navigator.clipboard.writeText(phone).catch(() => {});
    const b = document.createElement('span');
    b.className = 'phone-copy-badge'; b.innerText = "Copied!";
    container.appendChild(b); setTimeout(() => b.remove(), 1200);
    setTimeout(() => openDispositionModal(phone), 2500);
};

/* click on the number: dial + copy, then ALWAYS ask for the call status */
window.handlePhoneInteraction = function (cell, phone) {
    if (!phone || phone === 'N/A') return;
    markCalled(cell, phone);
    navigator.clipboard.writeText(phone).catch(() => {});
    window.location.href = `tel:${phone}`;
    setTimeout(() => openDispositionModal(phone), 2500);
    updateFloatingNav();
};

function buildPhoneCellMarkup(phone) {
    if (!phone || phone === 'N/A') return `<td class="cell-na">N/A</td>`;
    const p = jsq(phone);
    return `<td class="phone-clickable-container">
      <a href="tel:${esc(phone)}" onclick="handlePhoneInteraction(this,'${p}');return false;" class="phone-clickable-cell" title="Click to Call">
        <div class="phone-cell-content"><span class="phone-icon-span">${ico('phone')}</span><span class="clickable-phone-text">${esc(phone)}</span></div></a>
      <span class="phone-hover-copy-icon" onclick="copyPhoneToClipboardDirect(event,this,'${p}')" title="Copy number">${ico('copy')}</span>
      ${statusChip(phone)}</td>`;
}

/* ---------- 11. FOLLOW-UPS & TEAM SHARING ---------- */
let currentFollowUpFilterMode = 'today';
let pendingFollowUpIndex = null, pendingFollowUpRowBtn = null;

window.addLeadToFollowUpList = function (index, btn) {
    const rec = scrapedData[index];
    if (!rec) return;
    getAllAppDataFromIndexedDB("followups", store => {
        if (store.some(r => r.mc === rec.mc)) return alert("This carrier is already added to your Follow-Up list.");
        pendingFollowUpIndex = index; pendingFollowUpRowBtn = btn;
        document.getElementById('dlModalDateInput').value = new Date().toISOString().split('T')[0];
        document.getElementById('dlModalTimeInput').value = new Date().toTimeString().substring(0, 5);
        document.getElementById('dlDatePickerModal').style.display = 'flex';
    });
};

window.closeFollowUpModal = function () {
    document.getElementById('dlDatePickerModal').style.display = 'none';
    pendingFollowUpIndex = null; pendingFollowUpRowBtn = null;
};

function formatTime12Hour(t) {
    const [h, m] = t.split(':'); let hh = parseInt(h);
    const ap = hh >= 12 ? 'PM' : 'AM'; hh = hh % 12 || 12;
    return `${hh}:${m} ${ap}`;
}

window.confirmFollowUpSchedule = function () {
    if (pendingFollowUpIndex === null) return;
    const rec = scrapedData[pendingFollowUpIndex];
    if (!rec) return;
    const d = document.getElementById('dlModalDateInput').value, t = document.getElementById('dlModalTimeInput').value;
    if (!d) return alert("Please select a valid date.");
    rec.addedAt = new Date().toLocaleString();
    rec.followUpDate = d;
    rec.followUpTime = t ? formatTime12Hour(t) : "N/A";
    rec.sharedBy = dispatcherNickname;
    saveAppDataToIndexedDB("followups", rec);
    updateRealTimeHistory(scrapedData, !scraping);
    showPremiumNotification(`Added MC ${rec.mc} for Follow-Up on ${rec.followUpDate}`, 3500);
    if (pendingFollowUpRowBtn) { const row = pendingFollowUpRowBtn.closest('tr'); if (row) row.classList.add('is-followed'); }
    closeFollowUpModal();
    if (document.getElementById('dlFollowUpDrawer').classList.contains('open')) renderFollowUpItems();
};

window.toggleFollowUpDrawer = function () {
    const d = document.getElementById('dlFollowUpDrawer'), h = document.getElementById('dlHistoryDrawer');
    if (!d) return;
    if (h) h.classList.remove('open');
    if (d.classList.contains('open')) { d.classList.remove('open'); syncScrim(); return; }
    d.classList.add('open'); syncScrim();
    document.getElementById('followUpSearchInput').value = "";
    currentFollowUpFilterMode = 'today';
    updateFollowUpFilterButtonsUI();
    renderFollowUpItems();
};

window.filterFollowUpsByDate = function (mode) {
    currentFollowUpFilterMode = mode;
    updateFollowUpFilterButtonsUI();
    renderFollowUpItems();
};

function updateFollowUpFilterButtonsUI() {
    const t = document.getElementById('fubtnToday'), a = document.getElementById('fubtnAll');
    if (!t || !a) return;
    t.classList.toggle('active', currentFollowUpFilterMode === 'today');
    a.classList.toggle('active', currentFollowUpFilterMode !== 'today');
}

window.clearFollowUpFilters = function () {
    document.getElementById('followUpSearchInput').value = "";
    currentFollowUpFilterMode = 'all';
    updateFollowUpFilterButtonsUI();
    renderFollowUpItems();
};

window.deleteFollowUpItem = function (mc) {
    if (!confirm("Remove carrier from Follow-Ups?")) return;
    const tx = db.transaction("followups", "readwrite");
    tx.objectStore("followups").delete(mc);
    tx.oncomplete = () => {
        renderFollowUpItems();
        document.querySelectorAll('#resultsTable tr').forEach(row => { if (parseInt(row.cells[0]?.textContent) === mc) row.classList.remove('is-followed'); });
    };
};

window.downloadFollowUpsCSV = function () {
    getAllAppDataFromIndexedDB("followups", store => {
        if (!store.length) return alert("The follow-up list is currently empty.");
        triggerCSVDownload(store, `DispatchLink_FollowUps_${dispatcherNickname}.csv`);
    });
};

window.toggleSelectAllFollowUps = function (master) {
    document.querySelectorAll('.followup-select-checkbox').forEach(cb => cb.checked = master.checked);
};

function renderFollowUpItems() {
    const list = document.getElementById('drawerFollowUpList');
    if (!list) return;
    getAllAppDataFromIndexedDB("followups", data => {
        data = data.reverse();
        const q = (document.getElementById('followUpSearchInput')?.value || "").toLowerCase().trim();
        const today = new Date().toISOString().split('T')[0];
        const empty = txt => `<p class="muted" style="text-align:center;margin-top:30px;font-style:italic">${txt}</p>`;
        if (!data.length) { list.innerHTML = empty("No follow-up leads saved yet."); return; }

        const html = data.filter(it => {
            if (currentFollowUpFilterMode === 'today' && it.followUpDate !== today) return false;
            if (q && ![it.mc, it.name, it.phone].some(v => String(v || "").toLowerCase().includes(q))) return false;
            return true;
        }).map(it => `
          <div class="lead-card">
            <div class="lc-top"><label><input type="checkbox" class="followup-select-checkbox" value="${it.mc}">${esc(it.addedAt)}</label>
              <span class="when">${esc(it.followUpDate || 'N/A')} @ ${esc(it.followUpTime || 'N/A')}</span></div>
            <div class="lc-name"><span>${esc(it.name)}</span>${it.sharedBy ? `<em>Sent by: ${esc(it.sharedBy)}</em>` : ""}</div>
            <div class="lc-line"><b>MC:</b> ${it.mc} &nbsp;|&nbsp; <b>Phone:</b> ${esc(it.phone || 'N/A')}</div>
            <div class="lc-line"><b>Email:</b> ${esc(it.email || 'N/A')}</div>
            <div class="lc-remarks"><b>Remarks:</b> ${esc(it.remarks || 'No remarks added')}</div>
            <div class="lc-actions"><span class="sp"></span>
              <button class="mini" onclick="shareFollowUpByMc(${it.mc})">Share</button>
              <button class="mini info" onclick="triggerOneClickEmailPitch('${jsq(it.email)}','${jsq(it.name)}')">Send</button>
              <button class="mini bad" onclick="deleteFollowUpItem(${it.mc})">Drop</button></div>
          </div>`).join('');
        list.innerHTML = html || empty(`No matching follow-up records found for ${currentFollowUpFilterMode === 'today' ? "today" : "this filter"}.`);
    });
}

/* ----- team sharing (inbox per agent inside the client's own database) ----- */
let pendingShareRecords = [];

window.openTeamShareModal = async function (records) {
    if (!records || !records.length) return;
    pendingShareRecords = records;
    const box = document.getElementById('dlTeamMembersRadioList');
    box.innerHTML = `<div class="modal-msg">Loading team members...</div>`;
    document.getElementById('dlTeamSelectModal').style.display = 'flex';
    try {
        const [s, r, c] = await Promise.all([
            fetch(`${FIREBASE_DB_URL}sessions/${currentClient}.json`).then(x => x.json()),
            fetch(`${FIREBASE_DB_URL}shift_reports/${currentClient}.json`).then(x => x.json()),
            fetch(`${FIREBASE_DB_URL}call_logs/${currentClient}.json?shallow=true`).then(x => x.json())
        ]);
        const sessions = s || {}, names = new Set();
        Object.values(sessions).forEach(v => { if (v && v.nickname) names.add(v.nickname); });
        Object.keys(r || {}).forEach(n => names.add(n));
        Object.keys(c || {}).forEach(n => names.add(n));
        names.delete(dispatcherNickname); names.delete(safeKey(dispatcherNickname));
        if (!names.size) { box.innerHTML = `<div class="modal-msg">No other team members found.</div>`; return; }

        const now = Date.now();
        box.innerHTML = Array.from(names).map((name, i) => {
            const sess = Object.values(sessions).find(v => v && v.nickname === name);
            const online = sess && sess.timestamp && now - sess.timestamp < 12000;
            return `<label><input type="radio" name="teamMemberRadio" value="${esc(name)}" ${i === 0 ? 'checked' : ''}><span><b>${esc(name)}</b> (${online ? 'Online' : 'Offline'})</span></label>`;
        }).join('');
    } catch (e) {
        console.error("Failed to fetch team members:", e);
        box.innerHTML = `<div class="modal-msg">Error loading team members.</div>`;
    }
};

window.closeTeamSelectModal = function () {
    document.getElementById('dlTeamSelectModal').style.display = 'none';
    pendingShareRecords = [];
};

window.confirmTeamShareAction = async function () {
    const sel = document.querySelector('input[name="teamMemberRadio"]:checked');
    if (!sel) return alert("Please select a team member from the list.");
    const target = sel.value;
    pendingShareRecords.forEach(r => r.sharedBy = dispatcherNickname);
    try {
        const url = `${FIREBASE_DB_URL}shared_leads/${currentClient}/${safeKey(target)}.json`;
        let list = await (await fetch(url)).json() || [];
        if (!Array.isArray(list)) list = Object.values(list);
        let added = 0;
        pendingShareRecords.forEach(rec => { if (!list.some(r => r.mc === rec.mc)) { list.push(rec); added++; } });
        if (added) {
            await fetch(url, { method: 'PUT', body: JSON.stringify(list) });
            showPremiumNotification(`Successfully shared ${added} lead(s) with ${target}!`, 4000);
            document.querySelectorAll('.followup-select-checkbox:checked').forEach(cb => cb.checked = false);
        } else alert(`Selected lead(s) are already present in ${target}'s shared inbox.`);
        closeTeamSelectModal();
    } catch (e) {
        console.error("Team share action failed:", e);
        alert("Failed to share leads with team member. Check connection.");
    }
};

window.shareFollowUpByMc = function (mc) {
    getAllAppDataFromIndexedDB("followups", store => openTeamShareModal(store.filter(r => r.mc === mc)));
};
window.shareSelectedFollowUpsToTeam = function () {
    const picked = Array.from(document.querySelectorAll('.followup-select-checkbox:checked')).map(cb => parseInt(cb.value));
    if (!picked.length) return alert("Please select at least one follow-up record to share with your team.");
    getAllAppDataFromIndexedDB("followups", store => openTeamShareModal(store.filter(r => picked.includes(r.mc))));
};

async function pollIncomingSharedLeads() {
    if (!currentClient || !dispatcherNickname) return;
    try {
        const inbox = `${FIREBASE_DB_URL}shared_leads/${currentClient}/${safeKey(dispatcherNickname)}.json`;
        let leads = await (await fetch(inbox)).json();
        if (!leads) return;
        if (!Array.isArray(leads)) leads = Object.values(leads);
        if (!leads.length) return;
        getAllAppDataFromIndexedDB("followups", async local => {
            let fresh = false;
            leads.forEach(l => { if (!local.some(r => r.mc === l.mc)) { saveAppDataToIndexedDB("followups", l); fresh = true; } });
            if (fresh) {
                showPremiumNotification("You received new shared follow-up leads from your team!", 5000);
                if (document.getElementById('dlFollowUpDrawer')?.classList.contains('open')) renderFollowUpItems();
                await fetch(inbox, { method: 'DELETE' });
            }
        });
    } catch (e) { console.error("Polling shared leads failed:", e); }
}
setInterval(pollIncomingSharedLeads, 60000);

/* ---------- 12. REMARKS · CSV · HISTORY ---------- */
window.remarksFocus = function (i, ta) {
    if (!ta.value.trim()) { ta.value = DEFAULT_REMARKS_TEMPLATE; if (scrapedData[i]) scrapedData[i].remarks = DEFAULT_REMARKS_TEMPLATE; }
};
window.remarksBlur = function (i, ta) {
    const labels = ["Truck Type:", "Length:", "Accessories:", "Load:", "Zip Code:", "Summary:"];
    const lines = ta.value.split('\n');
    const hasData = labels.some((l, n) => lines[n] && lines[n].replace(l, "").trim() !== "");
    if (!hasData) {
        ta.value = "";
        if (scrapedData[i]) { scrapedData[i].remarks = ""; updateRealTimeHistory(scrapedData, false); }
    }
};
window.syncRemarksData = function (i, ta) {
    if (scrapedData[i]) { scrapedData[i].remarks = ta.value; updateRealTimeHistory(scrapedData, false); }
};

const csvCell = v => `"${String(v ?? "").replace(/"/g, '""')}"`;
function generateCSVString(records) {
    let csv = "MC Number,USDOT Number,Company Name,Entity Type,Operating Status,Phone,Address,Email,Power Units,Vehicle Type,Carrier Details,Follow-Up Date,Follow-Up Time,Shared By,Remarks\n";
    records.forEach(r => {
        csv += [r.mc, r.usdot, r.name, r.entityType, r.status, r.phone, r.address, r.email, r.powerUnits, r.vehicleType || 'N/A',
            r.carrierDetails || "", r.followUpDate || 'N/A', r.followUpTime || 'N/A', r.sharedBy || dispatcherNickname, r.remarks || ""].map(csvCell).join(",") + "\n";
    });
    return csv;
}
function triggerCSVDownload(records, filename) {
    const a = document.createElement('a');
    a.href = URL.createObjectURL(new Blob([generateCSVString(records)], { type: 'text/csv;charset=utf-8;' }));
    a.download = filename; a.click();
}

/* one renderer for live scraping, history "Open" and "Resume" */
function rowHTML(r, i, followed) {
    return `<tr${followed ? ' class="is-followed"' : ''}>
      <td><b>${r.mc}</b></td><td>${esc(r.usdot)}</td><td data-i="${esc(String(r.name || '?').trim().charAt(0).toUpperCase())}">${esc(r.name)}</td><td><span class="chip-type">${esc(r.entityType)}</span></td>
      <td><span class="badge badge-active">${esc(r.status)}</span></td>
      ${buildPhoneCellMarkup(r.phone)}<td>${esc(r.address)}</td>${buildEmailCellMarkup(r.email, r.name)}
      <td>${esc(r.powerUnits)}</td><td style="white-space:nowrap!important;"><b>${esc(r.vehicleType || 'N/A')}</b></td>
      <td class="remarks-cell-container"><textarea class="remarks-input-field" placeholder="Click to add remarks..." onfocus="remarksFocus(${i},this)" onblur="remarksBlur(${i},this)" oninput="syncRemarksData(${i},this)">${esc(r.remarks || '')}</textarea></td>
      <td><button onclick="addLeadToFollowUpList(${i},this)" class="premium-followup-btn">Follow</button></td></tr>`;
}

function paintTable(done) {
    getAllAppDataFromIndexedDB("followups", fu => {
        const set = new Set(fu.map(f => f.mc));
        document.getElementById('resultsTable').innerHTML = scrapedData.map((r, i) => rowHTML(r, i, set.has(r.mc))).join('');
        rebuildCategoriesFromData();
        populateStateDropdown();
        populateVehicleTypeCheckboxes();
        applyAdvancedFilters();
        if (done) done();
    });
}

window.toggleHistoryDrawer = function () {
    const d = document.getElementById('dlHistoryDrawer'), f = document.getElementById('dlFollowUpDrawer');
    if (!d) return;
    if (f) f.classList.remove('open');
    if (d.classList.contains('open')) d.classList.remove('open');
    else { d.classList.add('open'); renderHistoryItems(); }
    syncScrim();
};

function renderHistoryItems() {
    const list = document.getElementById('drawerHistoryList');
    if (!list || !db) return;
    const req = db.transaction("history", "readonly").objectStore("history").getAll();
    req.onsuccess = () => {
        const data = (req.result || []).reverse();
        if (!data.length) { list.innerHTML = `<p class="muted" style="text-align:center;margin-top:30px;font-style:italic">No history records found yet.</p>`; return; }
        const sheetsTotal = data.length, leadsTotal = data.reduce((s, it) => s + (it.records ? it.records.length : (it.totalRecords || 0)), 0);
        const head = `<div class="hist-stats"><div><b>${sheetsTotal}</b><span>Saved sheets</span></div><div><b>${leadsTotal}</b><span>Total leads</span></div></div>`;
        list.innerHTML = head + data.map(it => {
            const n = it.records ? it.records.length : (it.totalRecords || 0), dis = n === 0 ? 'disabled' : '';
            const rp = String(it.range || '').split('-').map(s => s.trim());
            const rangeHTML = rp.length === 2 ? `<span>${esc(rp[0])}</span><i>to</i><span>${esc(rp[1])}</span>` : `<span>${esc(it.range)}</span>`;
            const done = it.status === 'Completed';
            return `
              <div class="hist-card ${done ? 'is-done' : 'is-part'}">
                <div class="hc-top">
                  <span class="hc-ico">${ico('folder')}</span>
                  <div class="hc-title"><small>MC range</small><div class="hc-range">${rangeHTML}</div></div>
                  <span class="hc-status ${done ? 'ok' : 'bad'}">${esc(it.status)}</span>
                </div>
                <div class="hc-meta"><span>${ico('clock')}${esc(it.date)}</span><span class="hc-count"><b>${n}</b> active carriers</span></div>
                <div class="hc-actions">
                  <button class="hc-btn main" ${dis} onclick="resumeHistorySheet(${it.id})">${ico('refresh')}Resume</button>
                  <button class="hc-btn" onclick="loadHistorySheetToTable(${it.id})">${ico('external')}Open</button>
                  <button class="hc-btn" ${dis} onclick="downloadHistoryCSV(${it.id})">${ico('download')}CSV</button>
                  <button class="hc-btn del" onclick="deleteHistoryItem(${it.id})" title="Delete" aria-label="Delete">${ico('trash')}</button>
                </div>
              </div>`;
        }).join('');
    };
}

function getHistoryItem(id, cb) {
    const r = db.transaction("history", "readonly").objectStore("history").get(id);
    r.onsuccess = () => { if (r.result) cb(r.result); };
}

window.loadHistorySheetToTable = function (id) {
    if (scraping) return alert("A scan is running. Please press Stop first.");
    getHistoryItem(id, item => {
        if (!item.records) return;
        scrapedData = item.records;
        currentHistoryId = item.id;
        const parts = (item.range || "").split('-');
        if (parts.length === 2) {
            document.getElementById('startMc').value = parts[0].trim();
            document.getElementById('endMc').value = parts[1].trim();
            document.getElementById('startMc').dispatchEvent(new Event('input'));
        }
        paintTable(toggleHistoryDrawer);
    });
};

window.resumeHistorySheet = function (id) {
    if (scraping) return alert("A scan is running. Please press Stop first.");
    getHistoryItem(id, item => {
        if (!item.range) return;
        const [a, b] = item.range.split('-').map(s => parseInt(s.trim()));
        document.getElementById('startMc').value = a;
        document.getElementById('endMc').value = b;
        document.getElementById('startMc').dispatchEvent(new Event('input'));
        scrapedData = item.records || [];
        currentHistoryId = item.id;
        window.activeScrapeRange = item.range;
        paintTable(() => {
            toggleHistoryDrawer();
            let next = a;
            if (scrapedData.length) {
                const mx = Math.max(...scrapedData.map(r => parseInt(r.mc)));
                if (!isNaN(mx) && mx >= a) next = mx + 1;
            }
            startScraping(next, b);
        });
    });
};

window.downloadHistoryCSV = function (id) {
    getHistoryItem(id, item => {
        if (item.records && item.records.length) triggerCSVDownload(item.records, `History_MC_${item.range.replace(/\s+/g, '_')}.csv`);
    });
};

window.deleteHistoryItem = function (id) {
    if (!confirm("Delete this sheet from history?")) return;
    const tx = db.transaction("history", "readwrite");
    tx.objectStore("history").delete(id);
    tx.oncomplete = renderHistoryItems;
};

function updateRealTimeHistory(records, completed = false) {
    if (!db || currentHistoryId === null) return;
    const store = db.transaction("history", "readwrite").objectStore("history");
    const req = store.get(currentHistoryId);
    req.onsuccess = () => {
        const d = req.result;
        if (d) { d.totalRecords = records.length; d.records = records; d.status = completed ? "Completed" : "Interrupted (Auto-Saved)"; store.put(d); }
    };
}

/* ---------- 13. FMCSA SCRAPER ---------- */
window.stopScraping = function () {
    scraping = false;
    setStatus("<strong>Scan paused safely.</strong> Click Start to resume or run again.", 'paused');
    if (currentHistoryId) updateRealTimeHistory(scrapedData, false);
};

const cellText = c => (c ? c.textContent.trim().replace(/\s+/g, ' ') : '');

async function processSingleMCWithDetailedError(mc, box) {
    const maxRetries = 3;
    for (let attempt = 1; attempt <= maxRetries; attempt++) {
        try {
            /* global license limit check */
            const sData = await (await fetch(`${FIREBASE_DB_URL}sessions/${currentClient}.json`)).json() || {};
            const now = Date.now();
            const activeCount = Object.values(sData).filter(s => s && s.timestamp && now - s.timestamp < 12000).length;
            if (userLimit > 0 && activeCount > userLimit) {
                if (box) box.innerHTML = `<strong>Global License Limit Exceeded (${activeCount}/${userLimit}). Pausing scraping...</strong>`;
                return { status: "limit_exceeded" };
            }

            const response = await fetch(`https://safer.fmcsa.dot.gov/query.asp?searchtype=ANY&query_type=queryCarrierSnapshot&query_param=MC_MX&query_string=${mc}`);
            if (!response.ok) {
                if (box) box.innerHTML = `<strong>Safer Server Issue (Attempt ${attempt}/${maxRetries}). Retrying...</strong>`;
                await new Promise(r => setTimeout(r, 2000 * attempt));
                continue;
            }
            const html = await response.text();
            if (html.includes("Record not found") || html.includes("No records found") || !html.includes("USDOT Number:")) return { status: "not_found" };

            const rec = { mc, usdot: 'N/A', name: 'N/A', entityType: 'N/A', status: 'N/A', phone: 'N/A', address: 'N/A', email: 'N/A', powerUnits: 'N/A', vehicleType: 'N/A', carrierDetails: '', remarks: '', followUpDate: '', followUpTime: '', sharedBy: dispatcherNickname };
            const el = document.createElement('html');
            el.innerHTML = html;
            const cells = el.querySelectorAll('td, th');

            for (let i = 0; i < cells.length; i++) {
                const t = cells[i].textContent.trim(), next = cells[i + 1];
                if (!next) continue;
                if (t.startsWith("Legal Name:") || t.startsWith("Entity Name:")) rec.name = cellText(next);
                if (t.startsWith("USDOT Number:")) rec.usdot = next.textContent.trim().split(/\s+/)[0];
                if (t.startsWith("Entity Type:")) rec.entityType = cellText(next);
                if (t.startsWith("Operating Authority Status:")) {
                    const raw = next.textContent.toUpperCase();
                    if (raw.includes("NOT AUTHORIZED")) rec.status = "NOT AUTHORIZED";
                    else if (raw.includes("AUTHORIZED") || raw.includes("ACTIVE")) rec.status = "AUTHORIZED";
                    else rec.status = cellText(next);
                }
                if (t.startsWith("Power Units:")) rec.powerUnits = cellText(next);
                if (t.startsWith("Phone:")) rec.phone = cellText(next);
                if (t.startsWith("Physical Address:") || (t.startsWith("Address:") && !t.includes("Mailing"))) rec.address = cellText(next);
            }
            if (rec.status !== "AUTHORIZED") return { status: "filtered_out" };

            /* carrier operation categories (rows marked with X) */
            const details = [];
            el.querySelectorAll('table tr').forEach(row => {
                const rc = row.querySelectorAll('td');
                rc.forEach((cell, idx) => {
                    if (cell.textContent.trim().toLowerCase() === 'x') {
                        const label = rc[idx + 1] || rc[idx - 1];
                        if (label) {
                            const v = cellText(label);
                            if (v && v.toLowerCase() !== 'x' && !details.includes(v)) { details.push(v); availableCategories.add(v); }
                        }
                    }
                });
            });
            if (details.length) rec.carrierDetails = details.join(', ');

            /* SMS portal -> vehicles + email */
            if (rec.usdot !== 'N/A') {
                try {
                    const sms = await fetch(`https://ai.fmcsa.dot.gov/SMS/Carrier/${rec.usdot}/CarrierRegistration.aspx`);
                    if (sms.ok) {
                        const smsHtml = await sms.text();
                        const sEl = document.createElement('html');
                        sEl.innerHTML = smsHtml;
                        const vlist = [];
                        sEl.querySelectorAll('table tr').forEach(row => {
                            const cols = row.querySelectorAll('td, th');
                            if (cols.length >= 4) {
                                const vt = cols[0].textContent.trim().replace(/\*$/, "").trim();
                                const total = [1, 2, 3].reduce((s, k) => s + (parseInt(cols[k].textContent.trim()) || 0), 0);
                                if (total > 0 && ["Straight Trucks", "Truck Tractors", "Trailers"].includes(vt)) vlist.push(`${vt} ${total}`);
                            }
                        });
                        if (vlist.length) rec.vehicleType = vlist.join(" | ");

                        const emails = smsHtml.match(/[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/g) || [];
                        const good = emails.find(m => !/fmcsa|dot\.gov/i.test(m));
                        if (good) rec.email = good;
                    }
                } catch (smsErr) { console.warn(`SMS Portal warning for USDOT ${rec.usdot}:`, smsErr.message); }
            }
            return { status: "success", data: rec };
        } catch (err) {
            if (box) box.innerHTML = `<strong>Safer Server Issue on MC ${mc}. Retrying (${attempt}/${maxRetries})...</strong>`;
            await new Promise(r => setTimeout(r, 3000 * attempt));
        }
    }
    return { status: "error", message: `Failed after retries for MC ${mc}` };
}

window.startScraping = async function (overrideStart = null, overrideEnd = null) {
    const start = overrideStart !== null ? overrideStart : parseInt(document.getElementById('startMc').value);
    const end = overrideEnd !== null ? overrideEnd : parseInt(document.getElementById('endMc').value);
    const box = document.getElementById('status');

    if (isNaN(start) || isNaN(end) || start > end) { setStatus("Please enter a valid MC range.", 'error'); return; }

    const rangeStr = `${start} - ${end}`;
    if (!currentHistoryId || window.activeScrapeRange !== rangeStr) {
        if (overrideStart === null) {
            currentHistoryId = null; scrapedData = []; availableCategories.clear();
            document.getElementById('resultsTable').innerHTML = '';
        }
        window.activeScrapeRange = rangeStr;
    }

    scraping = true;
    const show = (id, v) => { const e = document.getElementById(id); if (e) e.style.display = v; };
    show('startBtn', 'none');
    show('stopBtn', 'inline-flex'); show('downloadBtn', 'none');

    setStatus("Connecting to FMCSA…", 'running');
    setProgress(0);

    if (!currentHistoryId && db) {
        const item = { id: Date.now(), date: new Date().toLocaleString('en-US', { hour12: true }), range: rangeStr, totalRecords: scrapedData.length, status: "Interrupted (Auto-Saved)", records: scrapedData };
        currentHistoryId = item.id;
        db.transaction("history", "readwrite").objectStore("history").add(item);
    }

    let effectiveStart = start;
    if (scrapedData.length) {
        const mx = Math.max(...scrapedData.map(r => parseInt(r.mc)));
        if (!isNaN(mx) && mx >= start && mx < end) effectiveStart = mx + 1;
    }

    const total = end - start + 1, t0 = Date.now();
    let processed = effectiveStart - start, errors = [];
    const followed = await new Promise(res => getAllAppDataFromIndexedDB("followups", f => res(new Set(f.map(x => x.mc)))));

    for (let mc = effectiveStart; mc <= end; mc++) {
        if (!scraping) break;
        const result = await processSingleMCWithDetailedError(mc, box);

        if (result.status === "limit_exceeded") {
            stopScraping();
            showLimitExceededModal(`Your global license limit for "${esc(currentClient)}" has been reached. Max allowed active tabs/devices is <b>${userLimit}</b>. Scraping has been paused safely.`);
            break;
        }
        processed++;

        if (result.status === "error") errors.push(result.message);
        else {
            errors = [];
            if (result.status === "success" && result.data && !scrapedData.some(x => String(x.mc) === String(result.data.mc))) {
                scrapedData.push(result.data);
                updateRealTimeHistory(scrapedData, false);
                updateCategoryCheckboxes();
                const tbody = document.getElementById('resultsTable');
                const ph = tbody.querySelector('.empty'); if (ph) ph.closest('tr').remove();
                tbody.insertAdjacentHTML('beforeend', rowHTML(result.data, scrapedData.length - 1, followed.has(result.data.mc)));
            }
        }

        const pct = Math.floor((processed / total) * 100);
        setProgress(pct);
        if (scraping) setStatus(`Scanning MC <b>${mc}</b> &nbsp;·&nbsp; ${processed}/${total} &nbsp;·&nbsp; ${scrapedData.length} leads found${errors.length ? ' &nbsp;·&nbsp; <span class="warn">retrying…</span>' : ''}`, 'running');
        populateStateDropdown();
        populateVehicleTypeCheckboxes();
        applyAdvancedFilters();
        await new Promise(r => setTimeout(r, 350));
    }

    const wasStopped = !scraping;
    scraping = false;
    show('startBtn', 'inline-flex'); show('stopBtn', 'none');

    if (!wasStopped) {
        setStatus(`<strong>Completed!</strong> Found ${scrapedData.length} valid records.`, 'done');
        setProgress(100);
    }
    if (scrapedData.length) {
        show('downloadBtn', 'inline-flex');
        updateRealTimeHistory(scrapedData, !wasStopped);
    }
};

window.downloadCSV = function () {
    if (scrapedData.length) {
        triggerCSVDownload(scrapedData, `DispatchLink_Data_${document.getElementById('startMc').value}_to_${document.getElementById('endMc').value}.csv`);
    }
};
