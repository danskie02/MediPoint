# MediPoint dependency summary

This project is mostly a static website with a few local development tools required for validation and Supabase edge functions.

## What is required

- Python 3.x
  - Used by [format_css.py](format_css.py) and [tests/static-checks.ps1](tests/static-checks.ps1)
- Deno
  - Required to run the Supabase edge functions in [supabase/functions](supabase/functions)
- Supabase CLI
  - Required to start the local Supabase environment defined in [supabase/config.toml](supabase/config.toml)

## Notes

- The frontend pages are plain HTML, CSS, and JavaScript, so there are no Node.js or npm packages to install for the UI itself.
- The Supabase client import in the function code is loaded from the internet at runtime via esm.sh, so no local package installation is required for that dependency.

## Windows installation

Run this from the repository root in PowerShell:

```powershell
Set-ExecutionPolicy -Scope Process Bypass
.\install-dependencies.ps1
```

## Verify the installation

After the script completes, confirm the tools are available:

```powershell
python --version
deno --version
supabase --version
```

## Start the local Supabase environment

If you want to run the backend functions locally:

```powershell
supabase start
```

## Optional local checks

```powershell
& .\tests\static-checks.ps1
```
