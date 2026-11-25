# Enviro Monitor with one shared login

All seven stations are configured. Use the same username and password on the
overview and on any station link. The browser opens a sign-in prompt. Each
station link limits the dashboard, history, and reports to that station. The
shared login also grants access to the overview and all seven stations.

## Test on your PC

Use Node.js 24. In PowerShell:

```powershell
npm ci
npm run build
$env:MONITOR_USERNAME = "enviro"
$env:MONITOR_PASSWORD = Read-Host "Enter a strong password of at least 16 characters"
npm start
```

Open http://localhost:8080/?station=1340 and sign in. Local HTTP is for testing
on this PC. Share only the HTTPS URL of the hosted app.

## Deploy on Render

1. Put the extracted files in a new GitHub repository. Use a private repository
   if you want to keep the source private. Do not commit credentials or data.
2. Create a Render **Web Service** from that repository. Use Node.js 24, set the
   build command to `npm ci --include=dev && npm run build`, and set the start
   command to `npm start`. Choose an always-on instance for background polling.
3. Set the environment variables `MONITOR_USERNAME` and `MONITOR_PASSWORD`.
   Choose a long, unique password and share it separately from the links.
4. Attach a persistent disk at `/var/data` and set `MONITOR_DATA_DIR=/var/data`
   if history must survive restarts or redeploys. Run a single service instance
   when using the file archive.
5. Open the HTTPS URL assigned by Render. Append a station suffix from the table.

| Location | Suffix |
| --- | --- |
| RIL SEC8 5B GATE | /?station=1340 |
| RIL SEC10 | /?station=1341 |
| RIL SEC 2A SR | /?station=1339 |
| METROPOLIS SALES OFFICE | /?station=1338 |
| RIL SEC11 | /?station=1337 |
| RIL Sec 3 AQMS2 | /?station=474 |
| RIL Sec 5 AQMS1 | /?station=473 |

The root URL shows the seven-station overview after login. The server polls on
startup and roughly every ten minutes, and keeps the most recent 30 days.
The protected server starts its own archive.

## Retire the previous public copy

To restrict access to your dashboard and collected history, disable GitHub
Pages and the old collection workflow. The old repository's public
`measurements` branch and prior public copies need separate removal or access
restriction. Earlier downloads and the upstream logger API are outside this
login's control. To migrate the existing measurements, place the old
`archive.json` on the new persistent disk before the first collection.
