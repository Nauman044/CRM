DISPATCH LINK - UNIFIED (CRM + DMS)   keep ALL files in one folder, open index.html via Live Server / hosting

FILES
 index.html   login page (CRM Login | DMS Login tabs + "Create your password")
 auth.js      shared login, licence/expiry check, roles (used by every page)
 hub.html     ADMIN panel: open CRM / DMS / Team monitoring, licence status, create sales agents
 crm.html + scraper-core.js + style.css      CRM (old index.html)
 dms.html                                    Dispatch Management (old dispatch-module.html) + Code.gs (Google Sheet backend, unchanged)
 admin.html + admin.js + admin.css           Team monitoring (online users, leaderboard, shift reports)

HOW YOU ADD A NEW CLIENT (Firebase console, any of the 3 CRM databases)
 allowedUsers / <companyusername> :  { "expires": "2026-12-31", "maxLaptops": 5 }
 - NO password needed. Give the client the username only.
 - Client opens index.html > "Create your password" > sets his own password. Works until "expires".
 - To reset a forgotten admin password: delete "salt" and "hash" under that company; client creates a new one.
   (If a Google Sheet is already linked, also clear owner_u / owner_h rows in the Sheet's Settings tab.)

WHO GOES WHERE
 Admin            username + password (Company ID blank)  -> hub.html -> CRM / DMS / Monitoring
 Sales agent      CRM Login: username + password + Company ID -> crm.html only
 Dispatcher       DMS Login: username + password + Company ID -> dms.html only
 Admin creates sales agents in hub.html; dispatchers in DMS > Settings > Dispatch team access (as before).
 Wrong role opening a wrong page is sent back to its own page. Expired/removed users are signed out within 1 minute.

DMS SETUP (unchanged): admin opens DMS > Settings > Configure Google Sheet and pastes the Apps Script URL.
