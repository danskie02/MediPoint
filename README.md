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

## System styles

Pages under `front/system` load `system-base.css`, optional shared components from `system-components.css`, and a page-specific stylesheet such as `profile.css` or `history.css`. Keep reusable shell, sidebar, header, and button rules in the shared files; keep page-only layout rules in the matching page file.
