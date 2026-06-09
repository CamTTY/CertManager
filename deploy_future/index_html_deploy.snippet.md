# Deploy snippets removed from index.html

These chunks were stripped when the Deploy stage was disabled. Paste them back
when re-enabling the feature, alongside the cert_service endpoint and PowerShell
script in this folder.

---

## 1. Helper functions

### `blobToBase64` (placed near `realExportCert`)

```js
// Convert a Blob to a base64 string (no data: prefix). Used to ship the
// downloaded PFX bytes to cert_service for deploy.
function blobToBase64(blob) {
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => {
      const dataUrl = r.result;
      const idx = dataUrl.indexOf(',');
      resolve(idx >= 0 ? dataUrl.slice(idx + 1) : dataUrl);
    };
    r.onerror = reject;
    r.readAsDataURL(blob);
  });
}
```

### `mockOpConDeploy` (offline POC path)

```js
async function* mockOpConDeploy(payload) {
  const t0 = Date.now();
  yield { step:1, level:'INFO',    message:`Authenticating with OpCon at ${payload.deployUrl || 'opcon.mock.internal'}…`, done:false, error:false };
  await delay(900);
  yield { step:1, level:'API',     message:`POST /api/tokens → 200 OK (${Date.now()-t0}ms) — session token acquired`, done:false, error:false };
  await delay(400);
  yield { step:2, level:'INFO',    message:`Triggering job "${payload.jobName}" on schedule "${payload.scheduleName}"…`, done:false, error:false };
  await delay(700);
  yield { step:2, level:'API',     message:`POST /api/scheduleActions → 200 OK — job queued for ${payload.targetHostname}`, done:false, error:false };
  await delay(5000);
  yield { step:3, level:'API',     message:`GET /api/dailyJobs?scheduleName=${payload.scheduleName}&jobName=${payload.jobName} → Job Status: Running`, done:false, error:false };
  await delay(5000);
  yield { step:3, level:'API',     message:`GET /api/dailyJobs → Job Status: Running (certificate binding in progress)`, done:false, error:false };
  await delay(5000);
  yield { step:4, level:'SUCCESS', message:`GET /api/dailyJobs → Job Status: Finished OK (${Math.round((Date.now()-t0)/1000)}s total)`, done:true, error:false };
}
```

---

## 2. State + effects (inside `CertManageModal`)

```js
const [includeDeploy,   setIncludeDeploy]   = useState(false);
const [deployForm, setDeployForm] = useState({
  targetHostname:'', pfxRemotePath:'C:\\Certs\\renewed.pfx',
  iisSiteName:'Default Web Site', iisPort:'443',
  oldThumbprint: cert.thumbprint || '', replaceStore:true, updateIIS:true,
});

function setDeployField(key, val) { setDeployForm(f => ({ ...f, [key]: val })); }

// Deploy needs the freshly-downloaded PFX bytes; force Download on whenever
// Deploy is checked (and lock the Download checkbox while Deploy is on).
useEffect(() => {
  if (includeDeploy && !includeDownload) setIncludeDownload(true);
}, [includeDeploy]);
```

The Download checkbox needs the lock logic too:

```jsx
<input
  type="checkbox"
  checked={includeDownload}
  onChange={e => !running && !includeDeploy && setIncludeDownload(e.target.checked)}
  disabled={running || includeDeploy}
/>
<span className="checkbox-label" style={{fontWeight:600}}>
  Download certificate bundle
  {includeDeploy && <span style={{fontWeight:400,color:'var(--text-dim)',marginLeft:6,fontSize:11}}>— required for Deploy</span>}
</span>
```

---

## 3. Plan entry (in `handleStart`)

```js
...(includeDeploy ? [{ id:'deploy', label:`Deploy to ${deployForm.targetHostname||'server'}`, status:'pending', message:'' }] : []),
```

Also: keep `let downloadedPfx = null;` at the top of `handleStart`, and set
`downloadedPfx = blob;` after each successful download branch (combined-mint
branch and the standalone download branch).

---

## 4. Deploy step (live + mock fallback) inside `handleStart`

```js
// ── Deploy ──
if (includeDeploy) {
  const isLive = !!(settings.vaultUrl && settings.vaultToken);
  markStep('deploy', { status:'running' });
  addLog('INFO', `[${cert.name}] Starting deployment to ${deployForm.targetHostname}…`);

  if (isLive) {
    if (!downloadedPfx) {
      const msg = 'No PFX available — Download must run before Deploy';
      markStep('deploy', { status:'error', message:msg });
      addLog('ERROR', `[${cert.name}] ${msg}`);
      setRunning(false); return;
    }
    const t2 = Date.now();
    try {
      const pfxBase64 = await blobToBase64(downloadedPfx);
      const res = await fetch(`${CERT_SERVICE_URL}/api/deploy`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          targetServer:  deployForm.targetHostname,
          siteName:      deployForm.iisSiteName,
          bindingPort:   parseInt(deployForm.iisPort, 10) || 443,
          oldThumbprint: deployForm.oldThumbprint || undefined,
          replaceStore:  !!deployForm.replaceStore,
          updateIIS:     !!deployForm.updateIIS,
          pfxBase64,
          pfxPassphrase: passphrase,
        }),
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok || !json.ok) {
        const errMsg = json.error || `cert_service ${res.status}`;
        const errStep = json.errorStep ? ` (step: ${json.errorStep})` : '';
        (json.steps || []).forEach(s => addLog('INFO', `[${cert.name}] ${s.message}`));
        throw new Error(`${errMsg}${errStep}`);
      }
      addLog('API', `POST ${CERT_SERVICE_URL}/api/deploy → 200 OK (${Date.now()-t2}ms)`);
      json.steps.forEach(s => addLog('INFO', `[${cert.name}] ${s.message}`));
      const newThumb = json.result.thumbprint;
      onUpdateCert(cert.id, { deployedAt: Date.now(), thumbprint: newThumb });
      addLog('SUCCESS', `[${cert.name}] ✓ Deployed to ${deployForm.targetHostname} — new thumbprint ${newThumb}`);
      markStep('deploy', { status:'done', message:`Deployed — ${String(newThumb).slice(0,12)}…` });
    } catch (err) {
      markStep('deploy', { status:'error', message:err.message });
      addLog('ERROR', `[${cert.name}] Deployment failed: ${err.message}`);
      setRunning(false); return;
    }
  } else {
    // Mock path — kept for offline POC use.
    const payload = { ...deployForm, certId:cert.id };
    try {
      for await (const update of mockOpConDeploy(payload)) {
        markStep('deploy', { status:'running', message:update.message });
        addLog(update.level, `[${cert.name}] ${update.message}`);
        if (update.done) {
          markStep('deploy', { status:'done', message:'Finished OK' });
          onUpdateCert(cert.id, { deployedAt:Date.now() });
          addLog('SUCCESS', `[${cert.name}] ✓ Deployment to ${deployForm.targetHostname} complete`);
          break;
        }
        if (update.error) {
          markStep('deploy', { status:'error', message:update.message });
          addLog('ERROR', `[${cert.name}] Deployment failed: ${update.message}`);
          setRunning(false); return;
        }
      }
    } catch (err) {
      markStep('deploy', { status:'error', message:err.message });
      addLog('ERROR', `[${cert.name}] Deploy error: ${err.message}`);
      setRunning(false); return;
    }
  }
}
```

---

## 5. Deploy form JSX block

```jsx
<div className="manage-option-block">
  <label className="checkbox-row" style={{marginBottom: includeDeploy ? 12 : 0}}>
    <input type="checkbox" checked={includeDeploy} onChange={e => !running && setIncludeDeploy(e.target.checked)} disabled={running} />
    <span className="checkbox-label" style={{fontWeight:600}}>Deploy via PowerShell</span>
  </label>
  {includeDeploy && (
    <div className="deploy-form-grid">
      <div className="deploy-form-field full-width">
        <label className="modal-label">Target Hostname *</label>
        <input className="deploy-input" placeholder="server01.optimus.internal" value={deployForm.targetHostname} onChange={e => setDeployField('targetHostname',e.target.value)} disabled={running} />
      </div>
      <div className="deploy-form-field full-width">
        <label className="modal-label">PFX Remote Path</label>
        <input className="deploy-input" value={deployForm.pfxRemotePath} onChange={e => setDeployField('pfxRemotePath',e.target.value)} disabled={running} />
      </div>
      <div className="deploy-form-field">
        <label className="modal-label">IIS Site Name</label>
        <input className="deploy-input" value={deployForm.iisSiteName} onChange={e => setDeployField('iisSiteName',e.target.value)} disabled={running} />
      </div>
      <div className="deploy-form-field">
        <label className="modal-label">IIS Port</label>
        <input className="deploy-input" value={deployForm.iisPort} onChange={e => setDeployField('iisPort',e.target.value)} disabled={running} />
      </div>
      <div className="deploy-form-field full-width">
        <label className="modal-label">Old Thumbprint (optional)</label>
        <input className="deploy-input" placeholder="Leave blank to skip removal" value={deployForm.oldThumbprint} onChange={e => setDeployField('oldThumbprint',e.target.value)} disabled={running} />
      </div>
      <div className="deploy-form-field full-width" style={{display:'flex',gap:20}}>
        <label className="checkbox-row">
          <input type="checkbox" checked={deployForm.replaceStore} onChange={e => setDeployField('replaceStore',e.target.checked)} disabled={running} />
          <span className="checkbox-label">Replace Personal Store</span>
        </label>
        <label className="checkbox-row">
          <input type="checkbox" checked={deployForm.updateIIS} onChange={e => setDeployField('updateIIS',e.target.checked)} disabled={running} />
          <span className="checkbox-label">Update IIS Binding</span>
        </label>
      </div>
    </div>
  )}
</div>
```

---

## 6. Start button disabled conditions to merge back

```js
disabled={running
  || (!includeRenew && !includeDownload && !includeDeploy)
  || (includeDeploy && !deployForm.targetHostname.trim())}
```
