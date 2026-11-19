# MediPoint prototype

MediPoint is a browser-only kiosk and health-tracking prototype. Open `front/welcome.html` to start the demo.

## Important boundary

The current kiosk generates simulated values. They are clearly labeled in the interface and must not be used for diagnosis or treatment. Browser storage is suitable for a local demonstration only; it is not a secure medical-record database.

Before production use, replace browser storage and self-registration with a server that provides authenticated sessions, server-enforced student/clinical roles, encrypted storage and transport, audit logging, consent/retention controls, and validated device integrations. Clinical rules and recommendations also require review and approval by qualified clinicians.

## Static validation

Run the repository checks from PowerShell:

```powershell
Set-ExecutionPolicy -Scope Process -ExecutionPolicy Bypass
& .\tests\static-checks.ps1
```

The checks validate local asset links, duplicate IDs, basic tag balance, empty files, and accidental direct storage parsing outside the shared data module.

## Thermal printer

The kiosk sends assessment results to the ESC/POS print service on the same host as the kiosk page. On the Raspberry Pi, connect and power on the USB printer, then check that `/dev/usb/lp0` exists. Start the web app from the repository root with `python3 -m http.server 5500` and open `http://127.0.0.1:5500/front/welcome.html`. The printer URL follows the page's hostname automatically, so `localhost` is not accidentally used when the page is opened through the Pi's network address.

The print service runs separately from the web app:

```sh
python3 printer/print_server.py
```

Keep it running while printing. Check `http://127.0.0.1:8765/health` for the service status when using the same machine. By default, the service listens on the Pi's network interfaces and allows HTTP requests from a kiosk page using the same hostname. Restrict port `8765` to the trusted local network with the Pi's firewall. If the kiosk is hosted on another machine or hostname, set the exact kiosk page origin in `MEDIPOINT_PRINTER_ALLOWED_ORIGINS`:

```sh
MEDIPOINT_PRINTER_ALLOWED_ORIGINS=http://raspberrypi.local:5500 \
python3 printer/print_server.py
```

`MEDIPOINT_PRINTER_HOST` can limit the listener to a specific interface; its default is `0.0.0.0`. Only allow trusted kiosk origins and restrict port `8765` to the local network with the Pi's firewall. The service account needs write access to the printer device. If `/dev/usb/lp0` is owned by group `lp`, add the account that runs the service to that group, then sign out and back in:

```sh
sudo usermod -aG lp "$USER"
```

If the device appears at a different path, set `MEDIPOINT_PRINTER_DEVICE` before starting the service. `window.MEDIPOINT_PRINTER_URL` can override the browser's automatically selected `http://<page-host>:8765` URL when the print service is hosted elsewhere.

When opening the kiosk directly as a `file://` URL, browsers send the opaque origin `null`. To allow that local page, run the printer service on loopback with the `null` origin explicitly enabled:

```sh
MEDIPOINT_PRINTER_HOST=127.0.0.1 MEDIPOINT_PRINTER_ALLOWED_ORIGINS=null \
python3 printer/print_server.py
```

Do not expose a service that allows the `null` origin on a network interface. For kiosk pages served over HTTP, leave `MEDIPOINT_PRINTER_ALLOWED_ORIGINS` unset unless the kiosk uses a different host; same-host origins are allowed automatically.

## CareMate AI model

The Random Forest triage model (`caremate_rf_model.joblib` + `caremate_encoders.joblib`) runs through a small Python API in `backend/caremate/`.

1. Install dependencies (once):

```powershell
& .\install-dependencies.ps1
```

2. Start the CareMate API:

```powershell
& .\backend\caremate\start.ps1
```

3. Optional: copy `front/login-pages/medipoint-config.example.js` to `medipoint-config.js` and set `window.MEDIPOINT_CAREMATE_URL` if the API is not on `http://127.0.0.1:8000`.

4. Complete a kiosk assessment. When all vitals are recorded, the kiosk calls CareMate, stores the recommendation locally, and sends it to Supabase when configured. Respiratory Rate is optional for the Random Forest model but is stored, shown in summaries/portals, and included in CareMate interpretations and abnormal-vital safeguards when present.

For Supabase Edge Functions, set the secret `CAREMATE_API_URL` (for example `http://host.docker.internal:8000` during local Supabase development) so `store-assessment` can enrich assessments server-side.

## System styles

Pages under `front/system` load `system-base.css`, optional shared components from `system-components.css`, and a page-specific stylesheet such as `profile.css` or `history.css`. Keep reusable shell, sidebar, header, and button rules in the shared files; keep page-only layout rules in the matching page file.
