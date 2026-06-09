# deploy_future/

Parking lot for the disabled Deploy stage of the certificate workflow. The
portal currently runs only Renew + Download; this folder holds everything
needed to re-enable the IIS deployment step.

## What's here

| File | Role |
|---|---|
| `deploy_cert.ps1` | Parameterized PowerShell script that copies a PFX to a target Windows server via PSRemoting, imports it into `LocalMachine\My`, swaps the IIS HTTPS binding, and (optionally) removes the old certificate. Reads passphrase from `$env:CERT_PASSPHRASE`. |
| `cert_service_deploy.py.snippet` | The Flask `/api/deploy` endpoint plus `_parse_deploy_output` parser, including the imports and module-level constants to add back to `cert_service.py`. |
| `index_html_deploy.snippet.md` | All portal-side pieces removed from `index.html`: the `blobToBase64` helper, the `mockOpConDeploy` generator, `includeDeploy` / `deployForm` state, the auto-check effect, the `handleStart` deploy block (live + mock), the deploy form JSX, and the Start-button disabled conditions. |

## To re-enable

1. Move `deploy_cert.ps1` back to the project root (or update `DEPLOY_SCRIPT`
   in the snippet to point at this folder).
2. Paste the contents of `cert_service_deploy.py.snippet` back into
   `cert_service.py` — imports at top, endpoint + parser at bottom.
3. From `index_html_deploy.snippet.md`, paste each of the six chunks back into
   `index.html` in their original locations.
4. Restart `cert_service.py`. PSRemoting / pwsh prereqs unchanged from the
   original integration.
