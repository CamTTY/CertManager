import React, { useState, useEffect, useRef, useCallback } from 'react';
import {
  uuid, delay, generatePassphrase, formatExpirationDate, formatRelativeTime, copyToClipboard, downloadTextFile, MOCK_CERTS_BASE, mockFetchCerts, mockRenewCert, mockExportCert, mockCreateCert, mapVenafiCert, dedupeByHostname, realFetchCerts, CERT_SERVICE_URL, realExportCert, realMintAndDownload, realCreateCert, realRetireCert, inferCertType, PFX_EXTENSION_TAGS, pkcs12ExtensionForTags, pkcs12ExtensionForCert, tagFormatPreference, exportFormatFromPref, certServiceFetch, KEY_ALGORITHMS, NEW_CERT_CSR_DEFAULTS, NEW_CERT_TYPES,
} from './lib.js';

function StatusBadge({ status }) {
  const map = {
    Critical: { cls: 'badge-critical', dot: '●', label: 'Critical' },
    Warning:  { cls: 'badge-warning',  dot: '●', label: 'Warning'  },
    Healthy:  { cls: 'badge-healthy',  dot: '●', label: 'Healthy'  },
    Expired:  { cls: 'badge-expired',  dot: '■', label: 'Expired'  },
  };
  const cfg = map[status] || map.Healthy;
  return <span className={`badge ${cfg.cls}`}><span>{cfg.dot}</span>{cfg.label}</span>;
}

function Logo() {
  return (
    <svg className="app-logo" width="145" height="38" viewBox="0 0 290 76" fill="none" xmlns="http://www.w3.org/2000/svg" aria-label="Optimus">
      <path d="M115.317 54.37C105.993 54.37 100.85 47.969 100.85 39.903V37.276C100.85 29.247 105.993 22.846 115.317 22.846C124.604 22.846 129.71 29.247 129.71 37.276V39.903C129.71 47.969 124.567 54.37 115.317 54.37ZM106.215 40.236C106.215 45.416 108.99 49.745 115.317 49.745C121.607 49.745 124.382 45.416 124.382 40.236V36.943C124.382 31.837 121.607 27.471 115.317 27.471C108.99 27.471 106.215 31.837 106.215 36.906V40.236ZM139.478 29.95V33.169C140.662 31.43 143.03 29.58 147.1 29.58C153.723 29.58 157.756 34.205 157.756 40.717V43.344C157.756 49.745 153.686 54.37 147.174 54.37C143.141 54.37 140.699 52.52 139.478 50.892V62.584H134.483V29.95H139.478ZM139.478 44.01C139.774 47.414 141.883 50.041 146.064 50.041C150.615 50.041 152.613 46.896 152.613 43.122V40.828C152.613 37.128 150.578 33.909 146.027 33.909C141.92 33.909 139.774 36.536 139.478 39.977V44.01ZM178.527 29.95V34.279H170.868V45.86C170.868 48.82 171.386 49.671 173.384 49.671H178.527V54H172.274C167.168 54 165.91 51.447 165.91 46.822V34.279H159.657V29.95H162.469C165.651 29.839 166.576 27.582 166.502 23.216H171.46C171.46 26.694 170.757 29.469 168.981 29.95H178.527ZM183.171 29.95H188.166V54H183.171V29.95ZM182.542 25.362C182.542 23.845 183.578 22.846 185.65 22.846C187.759 22.846 188.795 23.845 188.795 25.362C188.795 26.731 187.759 27.804 185.65 27.804C183.578 27.804 182.542 26.731 182.542 25.362ZM224.25 39.607C224.25 36.832 223.436 33.872 219.44 33.872C214.852 33.872 214.112 37.683 214.112 39.681V54H209.117V39.607C209.117 36.906 208.303 33.872 204.307 33.872C199.756 33.872 198.979 37.683 198.979 39.681V54H193.984V29.95H198.979V32.947C200.422 30.727 202.605 29.58 205.676 29.58C209.561 29.58 211.855 31.356 213.039 33.798C214.482 31.356 216.924 29.58 220.698 29.58C226.433 29.58 229.245 33.502 229.245 38.682V54H224.25V39.607ZM251.324 54V49.967C249.733 52.52 247.143 54.37 243.258 54.37C237.819 54.37 234.526 50.633 234.526 44.565V29.95H239.521V44.01C239.521 47.932 241.334 50.078 245.108 50.078C250.288 50.078 251.287 46.045 251.287 43.714L251.324 44.343V29.95H256.319V54H251.324ZM276.911 40.273C282.091 41.346 283.386 43.788 283.386 46.896C283.386 51.151 281.018 54.37 272.508 54.37C263.665 54.37 260.779 51.188 260.779 45.786V45.157H265.959V45.749C265.959 49.079 268.105 50.115 272.471 50.115C276.837 50.115 278.243 49.042 278.243 47.192C278.243 45.564 277.022 44.713 274.284 44.047L268.66 42.9C263.073 41.938 261.556 39.533 261.556 36.536C261.556 32.762 264.035 29.58 271.805 29.58C280.241 29.58 282.757 33.021 282.757 37.461V38.016H277.577V37.498C277.577 34.686 275.616 33.835 271.805 33.835C269.03 33.835 266.736 34.464 266.736 36.277C266.736 37.572 267.735 38.312 270.325 38.867L276.911 40.273Z" fill="white"/>
      <path fillRule="evenodd" clipRule="evenodd" d="M38.6137 62.8475C38.6137 66.8963 35.3315 70.1785 31.2827 70.1785H21.0065C12.1664 70.1785 5 63.0121 5 54.172V21.0065C5 12.1664 12.1664 5 21.0065 5H42.3912C48.8975 5 54.172 10.2744 54.172 16.7808C54.172 19.256 56.1786 21.2626 58.6538 21.2626C65.0187 21.2626 70.1785 26.4224 70.1785 32.7873V44.6001C70.1785 48.6489 66.8963 51.9311 62.8475 51.9311C58.7987 51.9311 55.5165 48.6489 55.5165 44.6001V24.1438C55.5165 21.6685 53.51 19.662 51.0347 19.662H24.1438C21.6685 19.662 19.662 21.6685 19.662 24.1438V51.0347C19.662 53.51 21.6685 55.5165 24.1438 55.5165H31.2827C35.3315 55.5165 38.6137 58.7987 38.6137 62.8475Z" fill="url(#optimus-logo-grad)"/>
      <defs>
        <linearGradient id="optimus-logo-grad" x1="-24.7724" y1="38.5282" x2="38.5282" y2="101.829" gradientUnits="userSpaceOnUse">
          <stop stopColor="#304EEB"/>
          <stop offset="1" stopColor="#E164EF"/>
        </linearGradient>
      </defs>
    </svg>
  );
}

function EyeIcon({ visible }) {
  if (visible) return (
    <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
      <path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19m-6.72-1.07a3 3 0 1 1-4.24-4.24"/>
      <line x1="1" y1="1" x2="23" y2="23"/>
    </svg>
  );
  return (
    <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
      <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/>
      <circle cx="12" cy="12" r="3"/>
    </svg>
  );
}

function CopyBtn({ text, label = 'Copy', copiedLabel = 'Copied!' }) {
  const [copied, setCopied] = useState(false);
  async function handleCopy() {
    await copyToClipboard(text);
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  }
  return (
    <button className={`copy-btn ${copied ? 'copied' : ''}`} onClick={handleCopy}>
      {copied ? copiedLabel : label}
    </button>
  );
}

function PassphraseField({ passphrase, onChange, disabled }) {
  const [show, setShow] = useState(false);
  return (
    <div>
      <div className="passphrase-field">
        <input
          type={show ? 'text' : 'password'}
          className="passphrase-input"
          value={passphrase}
          onChange={onChange ? e => onChange(e.target.value) : undefined}
          readOnly={!onChange}
          disabled={disabled}
          spellCheck={false}
          autoComplete="new-password"
        />
        <button className="eye-btn" onClick={() => setShow(s => !s)} title={show ? 'Hide' : 'Show'} type="button">
          <EyeIcon visible={show} />
        </button>
        <CopyBtn text={passphrase} />
      </div>
      <div className="passphrase-warning">
        <span>⚠</span>
        <span>
          {onChange
            ? 'Auto-generated password — save it before closing; it will not be shown again.'
            : 'Save this passphrase — it will not be shown again.'}
        </span>
      </div>
    </div>
  );
}

function LogEntry({ entry }) {
  const ts = new Date(entry.timestamp);
  const timeStr = ts.toTimeString().slice(0,8) + '.' + String(ts.getMilliseconds()).padStart(3,'0');
  return (
    <div className="log-entry">
      <span className="log-ts">{timeStr}</span>
      <span className={`log-level level-${entry.level}`}>[{entry.level}]</span>
      <span className={`log-msg level-${entry.level}`}>{entry.message}</span>
    </div>
  );
}

function ActivityLog({ logEntries, logState, setLogState, onClear }) {
  const bottomRef = useRef(null);
  const [confirmClear, setConfirmClear] = useState(false);
  const collapsed = logState === 'collapsed';
  const expanded  = logState === 'expanded';

  useEffect(() => {
    if (collapsed) return;
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [logEntries.length, collapsed]);

  function handleCopyLog() {
    const text = logEntries.map(e => `${new Date(e.timestamp).toISOString()} [${e.level}] ${e.message}`).join('\n');
    copyToClipboard(text);
  }

  function handleExportLog() {
    const text = logEntries.map(e => `${new Date(e.timestamp).toISOString()} [${e.level}] ${e.message}`).join('\n');
    downloadTextFile(text, `certmanager-log-${Date.now()}.txt`);
  }

  const lastEntry = logEntries[logEntries.length - 1] || null;

  return (
    <div className={`log-panel ${expanded ? 'expanded' : ''} ${collapsed ? 'collapsed' : ''}`}>
      {collapsed ? (
        <div className="log-status-bar" onClick={() => setLogState('normal')} title="Click to expand activity log">
          <span className="log-status-label">
            <span className={`log-status-dot${lastEntry ? ` dot-${lastEntry.level}` : ''}`} />
            ACTIVITY
          </span>
          {lastEntry ? (
            <span className={`log-status-msg msg-${lastEntry.level}`}>
              {lastEntry.message}
            </span>
          ) : (
            <span className="log-status-msg">No entries yet</span>
          )}
          <div className="log-status-right" onClick={e => e.stopPropagation()}>
            <span className="log-count-pill">{logEntries.length}</span>
            <button className="log-expand-chevron" onClick={() => setLogState('normal')} title="Expand log">▴</button>
          </div>
        </div>
      ) : (
        <div className="log-header">
          <div className="log-header-left">
            <span className="log-title">Activity Log</span>
            <span className="log-badge">{logEntries.length}</span>
          </div>
          <div className="log-header-right">
            <button className="btn btn-ghost btn-xs" onClick={handleCopyLog}>Copy Log</button>
            <button className="btn btn-ghost btn-xs" onClick={handleExportLog}>Export</button>
            {confirmClear ? (
              <>
                <span style={{fontSize:11,color:'var(--text-muted)'}}>Confirm clear?</span>
                <button className="btn btn-danger btn-xs" onClick={() => { onClear(); setConfirmClear(false); }}>Yes</button>
                <button className="btn btn-ghost btn-xs" onClick={() => setConfirmClear(false)}>No</button>
              </>
            ) : (
              <button className="btn btn-ghost btn-xs" onClick={() => setConfirmClear(true)}>Clear</button>
            )}
            <button className="btn btn-ghost btn-xs" onClick={() => setLogState(expanded ? 'normal' : 'expanded')}>
              {expanded ? '⊟ Collapse' : '⊞ Expand'}
            </button>
            <button
              className="btn btn-ghost btn-xs"
              onClick={() => setLogState('collapsed')}
              title="Minimize to status bar"
            >
              ▾ Minimize
            </button>
          </div>
        </div>
      )}
      {!collapsed && (
        <div className="log-entries">
          {logEntries.length === 0 && (
            <div style={{color:'var(--text-dim)',fontStyle:'italic',padding:'8px 0',fontSize:11}}>
              No log entries yet. Actions will appear here.
            </div>
          )}
          {logEntries.map(entry => <LogEntry key={entry.id} entry={entry} />)}
          <div ref={bottomRef} />
        </div>
      )}
    </div>
  );
}

function CertManageModal({ cert, passphrase, settings, addLog, onUpdateCert, onRemoveCert, onClose, onRequestRefresh }) {
  if (!cert) return null;

  // All actions are explicit opt-in — nothing is pre-selected on open.
  const [includeRenew,    setIncludeRenew]    = useState(false);
  const [includeDownload, setIncludeDownload] = useState(false);
  // Default export format: tag preference wins (set via the New Cert modal),
  // then DigiCert→PEM heuristic, then PFX for everything else.
  const [exportFormat,    setExportFormat]    = useState(() => {
    const fromPref = exportFormatFromPref(
      tagFormatPreference(cert.tags, settings.tagFormatPreferences)
    );
    return fromPref || (inferCertType(cert) === 'digicert' ? 'PEM' : 'PFX');
  });
  const [running,  setRunning]  = useState(false);
  const [finished, setFinished] = useState(false);
  const [steps,    setSteps]    = useState([]);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [deleting, setDeleting] = useState(false);
  // Editable copy of the auto-generated passphrase. Reseeds when the prop
  // changes (e.g. opening the modal on a different cert).
  const [passphraseDraft, setPassphraseDraft] = useState(passphrase);
  useEffect(() => { setPassphraseDraft(passphrase); }, [passphrase]);

  const isExpired  = cert.daysRemaining < 0;
  const isCritical = cert.daysRemaining <= 7 && cert.daysRemaining >= 0;
  const isPEM      = exportFormat === 'PEM';

  function markStep(id, patch) { setSteps(prev => prev.map(s => s.id === id ? { ...s, ...patch } : s)); }

  // Auto-check Download whenever Renew is turned on — renewing without
  // delivering the new keystore is rarely useful. The user can still uncheck
  // Download manually after the fact.
  useEffect(() => {
    if (includeRenew && !includeDownload) setIncludeDownload(true);
  }, [includeRenew]);

  async function handleStart() {
    const isLive = !!(settings.vaultUrl && settings.vaultToken);
    // When live + both renew and download are checked, the two operations collapse
    // into a single Venafi mint_and_download call (CKG mints a fresh cert and the
    // same call returns its keystore). The UI shows them as one combined step.
    const combinedMint = isLive && includeRenew && includeDownload;

    const plan = [
      ...(combinedMint
        ? [{ id:'renew-download', label:`Renew + download (${exportFormat})`, status:'running', message:'' }]
        : [
            ...(includeRenew    ? [{ id:'renew',    label:'Renew Certificate',                          status:'running', message:'' }] : []),
            ...(includeDownload ? [{ id:'download', label:`Download ${exportFormat} bundle`,            status:'pending', message:'' }] : []),
          ]
      ),
    ];
    setSteps(plan);
    setRunning(true);

    // ── Combined: Renew + Download (live mint_and_download flow) ──
    if (combinedMint) {
      const t0 = Date.now();
      addLog('INFO', `[${cert.name}] Mint + download via Venafi CKG (cert_type=${inferCertType(cert)})…`);
      try {
        const blob = await realMintAndDownload(cert, exportFormat, settings, passphraseDraft);
        addLog('API',     `POST ${CERT_SERVICE_URL}/api/download/mint → 200 OK (${Date.now()-t0}ms)`);
        addLog('SUCCESS', `[${cert.name}] New certificate minted. Passphrase: [REDACTED]`);
        const certPref = tagFormatPreference(cert.tags, settings.tagFormatPreferences);
        const mintExt = certPref || (isPEM ? 'pem' : pkcs12ExtensionForCert(cert));
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href=url; a.download=`${cert.name}.${mintExt}`;
        document.body.appendChild(a); a.click(); document.body.removeChild(a); URL.revokeObjectURL(url);
        addLog('SUCCESS', `[${cert.name}] Downloaded — ${cert.name}.${mintExt}`);
        const d = new Date(); d.setFullYear(d.getFullYear()+1);
        onUpdateCert(cert.id, {
          renewedAt:Date.now(), downloadedAt:Date.now(),
          status:'Healthy', daysRemaining:365, expirationDate:d.toISOString().slice(0,10),
        });
        markStep('renew-download', { status:'done', message:`${cert.name}.${mintExt} saved — renewed 365d` });

        // Retire the old cert so it drops out of the dashboard's ACTIVE search.
        // Best-effort — a retire failure does NOT roll back the renewal.
        try {
          addLog('INFO', `[${cert.name}] Retiring old certificate ${cert.id}…`);
          const tR = Date.now();
          await realRetireCert(cert.id, settings);
          addLog('API',     `POST ${CERT_SERVICE_URL}/api/cert/retire → 200 OK (${Date.now()-tR}ms) — ${cert.id}`);
          addLog('SUCCESS', `[${cert.name}] Old certificate retired`);
        } catch (err) {
          addLog('WARNING', `[${cert.name}] Old certificate retirement failed: ${err.message} (renewed cert is still valid; retire manually in Venafi)`);
        }
        // Refresh the dashboard so the retired cert disappears and the new
        // cert appears (assuming it matches the configured DNS hostname filter).
        if (onRequestRefresh) onRequestRefresh();
      } catch (err) {
        addLog('ERROR', `[${cert.name}] Mint + download failed: ${err.message}`);
        markStep('renew-download', { status:'error', message:err.message });
        setRunning(false); return;
      }
    } else {
      // ── Renew (separate, mock-only path — live renew without download is intentionally
      //    not wired here; minting without delivering the keystore wastes the new cert) ──
      if (includeRenew) {
        addLog('INFO', `[${cert.name}] Initiating certificate renewal…`);
        const t0 = Date.now();
        try {
          await mockRenewCert(cert.id, passphraseDraft);
          addLog('API',     `POST /api/v1/certificates/${cert.id}/renew → 200 OK (${Date.now()-t0}ms)`);
          addLog('SUCCESS', `[${cert.name}] Certificate renewed. Passphrase: [REDACTED]`);
          const d = new Date(); d.setFullYear(d.getFullYear()+1);
          onUpdateCert(cert.id, { renewedAt:Date.now(), status:'Healthy', daysRemaining:365, expirationDate:d.toISOString().slice(0,10) });
          markStep('renew', { status:'done', message:'Renewed — 365 days remaining' });
        } catch (err) {
          addLog('ERROR', `[${cert.name}] Renewal failed: ${err.message}`);
          markStep('renew', { status:'error', message:err.message });
          setRunning(false); return;
        }
      }

      // ── Download (download_existing on live, mock blob otherwise) ──
      if (includeDownload) {
        markStep('download', { status:'running' });
        addLog('INFO', `[${cert.name}] Requesting ${exportFormat} export…`);
        const t1 = Date.now();
        try {
          const blob = isLive
            ? await realExportCert(cert, exportFormat, settings, passphraseDraft)
            : await mockExportCert(cert.id, exportFormat);
          addLog('API', isLive
            ? `POST ${CERT_SERVICE_URL}/api/download/existing → 200 OK (${Date.now()-t1}ms)`
            : `GET /api/v1/certificates/${cert.id}/export?format=${exportFormat} → 200 OK (${Date.now()-t1}ms)`
          );
          // Live path: PEM → assembled single .pem bundle (cert + chain + key);
          // PFX/PKCS12 → raw binary keystore. Extension priority: user tag
          // preference → built-in PFX override list → format default.
          // Mock path emits a single-file PEM/PFX for offline POC use.
          const certPref = tagFormatPreference(cert.tags, settings.tagFormatPreferences);
          const ext = certPref || (isPEM ? 'pem' : (isLive ? pkcs12ExtensionForCert(cert) : 'pfx'));
          const url = URL.createObjectURL(blob);
          const a = document.createElement('a');
          a.href=url; a.download=`${cert.name}.${ext}`;
          document.body.appendChild(a); a.click(); document.body.removeChild(a); URL.revokeObjectURL(url);
          addLog('SUCCESS', `[${cert.name}] Downloaded — ${cert.name}.${ext}`);
          onUpdateCert(cert.id, { downloadedAt:Date.now() });
          markStep('download', { status:'done', message:`${cert.name}.${ext} saved` });
        } catch (err) {
          addLog('ERROR', `[${cert.name}] Export failed: ${err.message}`);
          markStep('download', { status:'error', message:err.message });
          setRunning(false); return;
        }
      }
    }

    setRunning(false);
    setFinished(true);
  }

  // Retire the certificate via the CyberArk/Venafi Retire Certificate API so it
  // drops out of the dashboard's ACTIVE search. Guarded by an inline confirm.
  async function handleDelete() {
    const isLive = !!(settings.vaultUrl && settings.vaultToken);
    setDeleting(true);
    try {
      if (isLive) {
        addLog('INFO', `[${cert.name}] Retiring certificate ${cert.id}…`);
        const t0 = Date.now();
        await realRetireCert(cert.id, settings);   // already sends addToBlocklist:true
        addLog('API', `POST ${CERT_SERVICE_URL}/api/cert/retire → 200 OK (${Date.now()-t0}ms) — ${cert.id}`);
      } else {
        addLog('INFO', `[${cert.name}] Removing certificate ${cert.id} (POC mode)…`);
      }
      addLog('SUCCESS', `[${cert.name}] Certificate retired`);
      onRemoveCert(cert.id);   // optimistic local removal (covers mock + immediate UX)
      if (isLive && onRequestRefresh) onRequestRefresh();
      onClose();
    } catch (err) {
      addLog('ERROR', `[${cert.name}] Retire failed: ${err.message}`);
      setDeleting(false);
      setConfirmDelete(false);
    }
  }

  function StepIcon({ status }) {
    if (status === 'running') return <span className="spinner" style={{display:'inline-block',width:13,height:13,borderWidth:2,borderTopColor:'var(--secondary)',margin:0}} />;
    if (status === 'done')    return <span style={{color:'var(--status-healthy)'}}>✓</span>;
    if (status === 'error')   return <span style={{color:'var(--status-expired)'}}>✗</span>;
    return <span style={{color:'var(--text-dim)'}}>○</span>;
  }

  return (
    <div className="modal-overlay" onClick={e => !running && e.target === e.currentTarget && onClose()}>
      <div className="modal-box" style={{maxWidth:600}}>
        <div className="modal-title">Manage Certificate</div>

        <div style={{display:'grid',gridTemplateColumns:'1fr auto',gap:12,marginBottom:14,alignItems:'start'}}>
          <div>
            <div className="modal-label">Certificate</div>
            <div className="modal-value">{cert.name}</div>
          </div>
          <div style={{display:'flex',gap:16,textAlign:'right'}}>
            <div>
              <div className="modal-label">Expiration</div>
              <div className="modal-value" style={{fontSize:12}}>{formatExpirationDate(cert.expirationDate)}</div>
            </div>
            <div>
              <div className="modal-label">Days</div>
              <div className={`modal-value days-${cert.status.toLowerCase()}`}>
                {cert.daysRemaining < 0 ? `${cert.daysRemaining}` : `+${cert.daysRemaining}`}
              </div>
            </div>
          </div>
        </div>

        {(isExpired || isCritical) && (
          <div className="expiry-warning" style={{marginBottom:14}}>
            <span>⚠</span>
            <span>{isExpired
              ? `Expired ${Math.abs(cert.daysRemaining)} days ago — no longer valid.`
              : `Expires in ${cert.daysRemaining} day${cert.daysRemaining!==1?'s':''} — renewal urgent.`}
            </span>
          </div>
        )}

        {!finished && (
          <>
            <hr className="modal-divider" />
            <div className="manage-section-label" style={{marginBottom:8}}>Auto-Generated Passphrase</div>
            <div className="manage-option-block" style={{marginBottom:10}}>
              <PassphraseField
                passphrase={passphraseDraft}
                onChange={setPassphraseDraft}
                disabled={running}
              />
            </div>

            <div className="manage-option-block" style={{marginBottom:10}}>
              <label className="checkbox-row">
                <input type="checkbox" checked={includeRenew} onChange={e => !running && setIncludeRenew(e.target.checked)} disabled={running} />
                <span className="checkbox-label" style={{fontWeight:600}}>Renew Certificate</span>
              </label>
              {includeRenew && includeDownload && (
                <div style={{fontSize:11,color:'var(--text-dim)',marginTop:6,fontFamily:'var(--font-mono)'}}>
                  Renew + Download together mints a fresh certificate via Cloud Key Generation and returns its keystore.
                </div>
              )}
            </div>

            <div className="manage-option-block" style={{marginBottom:10}}>
              <label className="checkbox-row" style={{marginBottom: includeDownload ? 12 : 0}}>
                <input type="checkbox" checked={includeDownload} onChange={e => !running && setIncludeDownload(e.target.checked)} disabled={running} />
                <span className="checkbox-label" style={{fontWeight:600}}>Download Certificate</span>
              </label>
              {includeDownload && (
                <>
                  <div className="manage-section-label" style={{marginTop:8,marginBottom:6}}>Export Format</div>
                  <div style={{display:'flex',gap:8}}>
                    {['PFX','PEM'].map(fmt => (
                      <label key={fmt} style={{
                        display:'flex', alignItems:'center', gap:7, cursor:running?'not-allowed':'pointer',
                        flex:1, padding:'7px 12px',
                        background: exportFormat===fmt ? 'rgba(var(--accent-rgb),0.12)' : 'var(--bg-input)',
                        border: `1px solid ${exportFormat===fmt ? 'var(--secondary)' : 'var(--border)'}`,
                        borderRadius:5, transition:'all 0.15s',
                      }}>
                        <input type="radio" name="exportFormat" value={fmt} checked={exportFormat===fmt} onChange={() => !running && setExportFormat(fmt)} disabled={running} style={{accentColor:'var(--secondary)'}} />
                        <span style={{fontSize:13,fontFamily:'var(--font-mono)',color:'var(--text-primary)'}}>
                          {fmt==='PFX' ? 'PFX / PKCS#12' : 'PEM / X.509'}
                        </span>
                      </label>
                    ))}
                  </div>
                  <div style={{fontSize:11,color:'var(--text-dim)',marginTop:6,fontFamily:'var(--font-mono)'}}>
                    {isPEM ? 'Exports certificate + encrypted private key as Base64 PEM blocks.' : 'Exports certificate + private key as a password-protected binary bundle.'}
                  </div>
                </>
              )}
            </div>

            {/* Deploy stage temporarily disabled — see ./deploy_future/ */}
          </>
        )}

        {steps.length > 0 && (
          <>
            <hr className="modal-divider" />
            <div className="manage-section-label">Progress</div>
            <div className="manage-step-list">
              {steps.map(s => (
                <div key={s.id} className="manage-step">
                  <div className="manage-step-icon"><StepIcon status={s.status} /></div>
                  <div>
                    <div className="manage-step-label">{s.label}</div>
                    {s.message && <div className="manage-step-msg">{s.message}</div>}
                  </div>
                </div>
              ))}
            </div>
          </>
        )}

        <div className="modal-footer" style={{justifyContent:'space-between',alignItems:'center'}}>
          <div>
            {!finished && !confirmDelete && (
              <button className="btn btn-danger-solid" onClick={() => setConfirmDelete(true)} disabled={running}>
                Delete
              </button>
            )}
          </div>
          <div style={{display:'flex',gap:10,alignItems:'center'}}>
            {!finished && confirmDelete && (
              <span style={{fontSize:14,fontWeight:600,color:'#fff',marginRight:4}}>
                Retire this certificate?
              </span>
            )}
            {confirmDelete && !finished ? (
              <>
                <button className="btn btn-secondary" onClick={() => setConfirmDelete(false)} disabled={deleting}>Cancel</button>
                <button className="btn btn-danger-solid" onClick={handleDelete} disabled={deleting}>
                  {deleting ? <><span className="spinner" /> Retiring…</> : 'Yes, delete'}
                </button>
              </>
            ) : (
              <>
                <button className="btn btn-secondary" onClick={onClose} disabled={running || deleting}>{finished ? 'Close' : 'Cancel'}</button>
                {!finished && (
                  <button className="btn btn-primary" onClick={handleStart}
                    disabled={running || deleting || (!includeRenew && !includeDownload)}>
                    {running ? <><span className="spinner" /> Running…</> : '▶ Start'}
                  </button>
                )}
              </>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

const MAX_VALIDITY_DAYS = 365; // maximum certificate validity allowed by policy

function NewCertModal({ addLog, settings, existingTags, onCertIssued, onSetTagPreference, onClose }) {
  const [certType,      setCertType]      = useState('digicert');
  const [commonName,    setCommonName]    = useState('');
  const validityDays = MAX_VALIDITY_DAYS; // requests always mint at the max allowed validity
  const [keyAlgo,       setKeyAlgo]       = useState('RSA_2048');
  const [selectedTags,  setSelectedTags]  = useState([]);
  const [customTagInput, setCustomTagInput] = useState('');
  const [customTagFormat, setCustomTagFormat] = useState('p12');
  const [showAddTag,    setShowAddTag]    = useState(false);
  const [submitting,    setSubmitting]    = useState(false);
  const [done,          setDone]          = useState(false);
  const [newCertName,   setNewCertName]   = useState('');
  // Blob + filename held back from auto-download; user clicks Download on the
  // success screen if they want to save the keystore.
  const [issuedKeystore, setIssuedKeystore] = useState(null); // { blob, filename }
  const [issuedDownloaded, setIssuedDownloaded] = useState(false);
  // Passphrase shown to the user on the success screen so they can copy it
  // before closing — same UX as Manage → renewal.
  const [issuedPassphrase, setIssuedPassphrase] = useState('');

  const isLive = !!(settings.vaultUrl && settings.vaultToken);

  // Resolve export format: tag preference (if any selected tag has one) wins,
  // otherwise fall back to cert-type heuristic (DigiCert → PEM, Internal → PFX).
  const tagPref      = tagFormatPreference(selectedTags, settings.tagFormatPreferences);
  const tagPrefFmt   = exportFormatFromPref(tagPref);
  const exportFormat = tagPrefFmt || (certType === 'digicert' ? 'PEM' : 'PFX');

  // Combine known existing tags + any custom tags the user has added in this
  // session, deduped, sorted, case-insensitive.
  const tagOptions = React.useMemo(() => {
    const seen = new Map();
    const add = t => {
      const key = String(t).toLowerCase();
      if (key && !seen.has(key)) seen.set(key, t);
    };
    (existingTags || []).forEach(add);
    selectedTags.forEach(add);
    return Array.from(seen.values()).sort((a,b) => a.localeCompare(b));
  }, [existingTags, selectedTags]);

  function toggleTag(tag) {
    setSelectedTags(prev => prev.includes(tag) ? prev.filter(t => t !== tag) : [...prev, tag]);
  }

  function addCustomTag() {
    const t = customTagInput.trim();
    if (!t) return;
    if (!selectedTags.some(s => s.toLowerCase() === t.toLowerCase())) {
      setSelectedTags(prev => [...prev, t]);
    }
    if (onSetTagPreference) onSetTagPreference(t, customTagFormat);
    addLog('INFO', `Tag "${t}" preferred download format set to .${customTagFormat}.`);
    setCustomTagInput('');
    setCustomTagFormat('p12');
    setShowAddTag(false);
  }

  const validValidity = Number.isFinite(validityDays) && validityDays >= 1 && validityDays <= MAX_VALIDITY_DAYS;
  const canSubmit = !!(certType && commonName.trim() && keyAlgo && validValidity && !submitting);

  async function handleSubmit() {
    if (!canSubmit) return;
    setSubmitting(true);

    const cn         = commonName.trim();
    const passphrase = generatePassphrase();
    const validity   = `P${validityDays}D`;
    const algoMeta   = KEY_ALGORITHMS.find(k => k.value === keyAlgo);

    const appName = (settings.applicationName || '').trim();
    addLog('INFO', `New cert request: CN=${cn}, type=${certType}, algo=${algoMeta.label}, validity=${validityDays}d`
      + (appName ? `, application="${appName}"` : ''));
    if (!appName) {
      addLog('WARN', 'No Application Name set in Settings — cert will use the service default application.');
    }

    if (!isLive) {
      addLog('ERROR', 'Live mode required — set Cloud Base URL + API Key in Settings.');
      setSubmitting(false);
      return;
    }

    const t0 = Date.now();
    try {
      const blob = await realCreateCert(
        { certType, commonName: cn, keyAlgo, validity, exportFormat, tags: selectedTags },
        settings,
        passphrase,
      );
      addLog('API',     `POST ${CERT_SERVICE_URL}/api/download/mint → 200 OK (${Date.now()-t0}ms)`);
      addLog('SUCCESS', `Certificate issued: CN=${cn}. Passphrase: [REDACTED]`);

      // Stash the keystore for an optional user-initiated download. Extension
      // priority: explicit tag preference → tag-based PFX override → format default.
      const isPEM = exportFormat === 'PEM';
      const ext   = tagPref || (isPEM ? 'pem' : pkcs12ExtensionForTags(selectedTags));
      setIssuedKeystore({ blob, filename: `${cn}.${ext}` });
      setIssuedPassphrase(passphrase);

      setNewCertName(cn);
      setDone(true);

      // Tell the App to refresh the dashboard so the new cert appears (it's already
      // tied to the Application it was issued under, so the search will pick it up).
      if (onCertIssued) onCertIssued(cn);
    } catch (err) {
      addLog('ERROR', `Certificate request failed: ${err.message}`);
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="modal-overlay" onClick={e => !submitting && e.target === e.currentTarget && onClose()}>
      <div className="modal-box" style={{maxWidth:600}}>
        <div className="modal-title">New Certificate Request</div>

        {done ? (
          <div className="ncr-success">
            <div className="ncr-success-icon">✓</div>
            <div className="ncr-success-title">Certificate Issued</div>
            <div className="ncr-success-id">CN={newCertName} has been added to the dashboard.</div>
            {issuedPassphrase && (
              <div style={{marginTop:18,textAlign:'left'}}>
                <div className="manage-section-label" style={{marginBottom:6}}>Auto-Generated Passphrase</div>
                <PassphraseField passphrase={issuedPassphrase} />
              </div>
            )}
            {issuedKeystore && (
              <div style={{display:'flex',flexDirection:'column',alignItems:'center',gap:8,marginTop:18}}>
                <button
                  type="button"
                  className="btn btn-primary"
                  onClick={() => {
                    const url = URL.createObjectURL(issuedKeystore.blob);
                    const a = document.createElement('a');
                    a.href = url; a.download = issuedKeystore.filename;
                    document.body.appendChild(a); a.click(); document.body.removeChild(a); URL.revokeObjectURL(url);
                    addLog('SUCCESS', `Downloaded — ${issuedKeystore.filename}`);
                    setIssuedDownloaded(true);
                  }}
                >
                  ⬇ Download {issuedKeystore.filename}
                </button>
                <div style={{fontSize:11,color:'var(--text-dim)',fontFamily:'var(--font-mono)'}}>
                  {issuedDownloaded
                    ? 'Saved. The keystore is also retrievable from the dashboard via Manage → Download.'
                    : 'Skip this and the keystore is gone — re-download via Manage → Download on the dashboard.'}
                </div>
              </div>
            )}
          </div>
        ) : (
          <>
            {!isLive && (
              <div className="expiry-warning" style={{marginBottom:14}}>
                <span>⚠</span>
                <span>Configure Cloud Base URL + API Key in Settings to issue real certificates.</span>
              </div>
            )}

            {/* ── Common Name ── */}
            <div className="manage-section-label" style={{marginBottom:6}}>Common Name (CN) *</div>
            <div className="manage-option-block" style={{marginBottom:10}}>
              <input
                className="deploy-input" style={{width:'100%'}}
                placeholder="hostname.jhacorp.com"
                value={commonName}
                onChange={e => setCommonName(e.target.value)}
                disabled={submitting}
              />
              <div style={{fontSize:10,color:'var(--text-dim)',marginTop:5,fontFamily:'var(--font-mono)'}}>
                SAN auto-populated to match. CN will be added to the dashboard's DNS hostname filter on success.
              </div>
            </div>

            {/* ── Cert Type ── */}
            <div className="manage-section-label" style={{marginBottom:6}}>Issuing Template</div>
            <div className="manage-option-block" style={{marginBottom:10}}>
              <div className="ncr-algo-grid">
                {NEW_CERT_TYPES.map(t => (
                  <div key={t.value} className={`ncr-algo-btn ${certType===t.value?'selected':''}`}
                       onClick={() => !submitting && setCertType(t.value)}>
                    {t.label}
                  </div>
                ))}
              </div>
              <div style={{fontSize:10,color:'var(--text-dim)',marginTop:5,fontFamily:'var(--font-mono)'}}>
                {certType === 'digicert'
                  ? 'DigiCert Standard SSL — public CA, default export PEM.'
                  : 'Internal CA — default export PFX/PKCS12.'}
              </div>
            </div>

            {/* ── Key Algorithm ── */}
            <div className="manage-section-label" style={{marginBottom:6}}>Key Algorithm</div>
            <div className="manage-option-block" style={{marginBottom:10}}>
              <div className="ncr-algo-grid">
                {KEY_ALGORITHMS.map(k => (
                  <div key={k.value} className={`ncr-algo-btn ${keyAlgo===k.value?'selected':''}`}
                       onClick={() => !submitting && setKeyAlgo(k.value)}>
                    {k.label}
                  </div>
                ))}
              </div>
            </div>

            {/* ── Tags ── */}
            <div className="manage-section-label" style={{marginBottom:6}}>Certificate Tags</div>
            <div className="manage-option-block" style={{marginBottom:10}}>
              <div className="ncr-tag-picker">
                {tagOptions.map(tag => (
                  <span key={tag} className={`ncr-tag ${selectedTags.includes(tag)?'selected':''}`}
                        onClick={() => !submitting && toggleTag(tag)}>
                    {tag}
                  </span>
                ))}
                {!showAddTag && (
                  <span className="ncr-tag" onClick={() => !submitting && setShowAddTag(true)}
                        style={{borderStyle:'dashed'}}>+ New tag</span>
                )}
              </div>
              {showAddTag && (
                <div style={{display:'flex',flexDirection:'column',gap:8,marginTop:10,padding:10,background:'var(--bg-input)',border:'1px solid var(--border)',borderRadius:5}}>
                  <input
                    className="deploy-input"
                    placeholder="Tag name"
                    value={customTagInput}
                    onChange={e => setCustomTagInput(e.target.value)}
                    onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); addCustomTag(); } }}
                    autoFocus
                    disabled={submitting}
                  />
                  <div>
                    <div style={{fontSize:11,color:'var(--text-muted)',textTransform:'uppercase',letterSpacing:'0.5px',fontWeight:600,marginBottom:6}}>
                      Preferred download format for certs with this tag
                    </div>
                    <div style={{display:'flex',gap:6,justifyContent:'center'}}>
                      {[
                        { value:'pem', label:'.pem' },
                        { value:'p12', label:'.p12' },
                        { value:'pfx', label:'.pfx' },
                      ].map(f => (
                        <button key={f.value} type="button"
                                className={`ncr-algo-btn ${customTagFormat===f.value?'selected':''}`}
                                style={{padding:'6px 14px',fontSize:12,minWidth:80}}
                                onClick={() => !submitting && setCustomTagFormat(f.value)}>
                          {f.label}
                        </button>
                      ))}
                    </div>
                  </div>
                  <div style={{display:'flex',gap:6,justifyContent:'flex-end'}}>
                    <button type="button" className="btn btn-ghost btn-sm" onClick={() => { setShowAddTag(false); setCustomTagInput(''); }} disabled={submitting}>Cancel</button>
                    <button type="button" className="btn btn-primary btn-sm" onClick={addCustomTag} disabled={!customTagInput.trim() || !customTagFormat || submitting}>Add Tag</button>
                  </div>
                </div>
              )}
            </div>
          </>
        )}

        <div className="modal-footer">
          <button className="btn btn-secondary" onClick={onClose} disabled={submitting}>{done ? 'Close' : 'Cancel'}</button>
          {!done && (
            <button className="btn btn-primary" onClick={handleSubmit} disabled={!canSubmit}>
              {submitting ? <><span className="spinner" /> Submitting…</> : '⊕ Submit Request'}
            </button>
          )}
        </div>
      </div>
    </div>
  );
}

const COLUMNS = [
  { key:'name',           label:'Certificate Name', sortable:true  },
  { key:'issuer',         label:'Issuing CA',        sortable:true  },
  { key:'tags',           label:'Tags',              sortable:false },
  { key:'expirationDate', label:'Expiration',        sortable:true  },
  { key:'daysRemaining',  label:'Days',              sortable:true  },
  { key:'status',         label:'Status',            sortable:true  },
  { key:'actions',        label:'Actions',           sortable:false },
];

function CertRow({ cert, onManage }) {
  const daysClass = cert.status === 'Critical' ? 'days-critical' : cert.status === 'Warning' ? 'days-warning' : cert.status === 'Expired' ? 'days-expired' : 'days-healthy';
  const daysLabel = cert.daysRemaining < 0 ? `${cert.daysRemaining}d` : `+${cert.daysRemaining}d`;
  const H24 = 24 * 60 * 60 * 1000;
  const now = Date.now();
  const showRenewed    = cert.renewedAt    && (now - cert.renewedAt)    < H24;
  const showDownloaded = cert.downloadedAt && (now - cert.downloadedAt) < H24;
  const showDeployed   = cert.deployedAt   && (now - cert.deployedAt)   < H24;
  const fullyComplete  = !!(cert.renewedAt && cert.downloadedAt && cert.deployedAt);
  return (
    <tr className={`cert-row cert-row-${cert.status.toLowerCase()}`}>
      <td className="cert-td">
        <div className="cert-name">{cert.name}</div>
        {(showRenewed || showDownloaded || showDeployed) && (
          <div style={{display:'flex',gap:4,flexWrap:'wrap',marginTop:5}}>
            {showRenewed    && <span className="status-chip chip-renewed">✓ Renewed</span>}
            {showDownloaded && <span className="status-chip chip-downloaded">⬇ Downloaded</span>}
            {showDeployed   && <span className="status-chip chip-deployed">⚡ Deployed</span>}
          </div>
        )}
      </td>
      <td className="cert-td"><div className="issuer-cell">{cert.issuer || '—'}</div></td>
      <td className="cert-td">
        <div className="sans-list">
          {cert.tags.map(t => <span key={t} className="sans-tag">{t}</span>)}
        </div>
      </td>
      <td className="cert-td"><div className="expiry-date">{formatExpirationDate(cert.expirationDate)}</div></td>
      <td className="cert-td"><div className={`days-remaining ${daysClass}`}>{daysLabel}</div></td>
      <td className="cert-td"><StatusBadge status={cert.status} /></td>
      <td className="cert-td">
        <div className="action-cell">
          <button className="btn btn-secondary btn-sm" onClick={() => onManage(cert.id)}>
            ⚙ Manage
          </button>
        </div>
      </td>
    </tr>
  );
}

function CertTableSkeleton() {
  const widths = [
    ['70%','60%','40%','55%','30%','—','—'],
    ['60%','45%','30%','65%','25%','—','—'],
    ['75%','55%','50%','45%','35%','—','—'],
    ['55%','65%','45%','58%','28%','—','—'],
  ];
  return (
    <>
      {widths.map((row, ri) => (
        <tr key={ri} className="skeleton-row" style={{animationDelay:`${ri*0.06}s`}}>
          <td><div className="skeleton" style={{width:row[0]}} /></td>
          <td><div className="skeleton" style={{width:row[1]}} /></td>
          <td><div className="skeleton skeleton-tag" style={{width:'50px'}} /></td>
          <td><div className="skeleton" style={{width:row[3]}} /></td>
          <td><div className="skeleton" style={{width:'36px'}} /></td>
          <td><div className="skeleton" style={{width:'64px',height:'18px',borderRadius:'4px'}} /></td>
          <td><div className="skeleton" style={{width:'72px',height:'24px',borderRadius:'5px'}} /></td>
        </tr>
      ))}
    </>
  );
}

function CertTableEmpty({ hasFilter }) {
  return (
    <tr>
      <td colSpan={COLUMNS.length} className="empty-state-cell">
        <svg className="empty-state-icon" width="40" height="40" viewBox="0 0 40 40" fill="none" xmlns="http://www.w3.org/2000/svg">
          <rect x="7" y="3" width="22" height="28" rx="3" stroke="currentColor" strokeWidth="1.5" fill="none"/>
          <path d="M12 10h12M12 15h12M12 20h7" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"/>
          <circle cx="29" cy="29" r="8" fill="var(--bg-surface)" stroke="currentColor" strokeWidth="1.5"/>
          <path d="M26 29h6M29 26v6" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"/>
        </svg>
        <div className="empty-state-title">
          {hasFilter ? 'No certificates match this filter' : 'No certificates found'}
        </div>
        <div className="empty-state-sub">
          {hasFilter ? 'Try a different status filter or refresh the list' : 'Enter the correct Application name in Settings, then refresh the list'}
        </div>
      </td>
    </tr>
  );
}

function CertTable({ certs, sortConfig, onSort, onManage, loading, statusFilter }) {
  const sorted = [...certs].sort((a,b) => {
    const k = sortConfig.key;
    if (!k || k === 'actions' || k === 'sans') return 0;
    const cmp = typeof a[k] === 'number' ? a[k]-b[k] : String(a[k]).localeCompare(String(b[k]));
    return sortConfig.dir === 'asc' ? cmp : -cmp;
  });
  return (
    <div className="table-wrap">
      <table className="cert-table">
        <thead>
          <tr>
            {COLUMNS.map(col => (
              <th key={col.key} className={`cert-th ${col.sortable?'sortable':''} ${sortConfig.key===col.key?'sort-active':''}`} onClick={() => col.sortable && onSort(col.key)}>
                {col.label}
                {col.sortable && <span className="sort-indicator">{sortConfig.key===col.key ? (sortConfig.dir==='asc'?' ↑':' ↓') : ' ↕'}</span>}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {loading ? (
            <CertTableSkeleton />
          ) : sorted.length === 0 ? (
            <CertTableEmpty hasFilter={!!statusFilter} />
          ) : (
            sorted.map(cert => <CertRow key={cert.id} cert={cert} onManage={onManage} />)
          )}
        </tbody>
      </table>
    </div>
  );
}

const REFRESH_OPTIONS = [
  { label: '30s',  value: 30_000  },
  { label: '60s',  value: 60_000  },
  { label: '5min', value: 300_000 },
  { label: 'Off',  value: null    },
];

const THEME_OPTIONS = [
  { label: 'Dark Mode (default)', value: 'dark'  },
  { label: 'Light Mode',          value: 'light' },
  { label: 'Meg Mode',            value: 'meg'   },
];

// <select> only emits strings — round-trip primitives (null / number / string)
// through the option list so booleans and `null` survive a save.
function selectValueToString(v) {
  if (v === null || v === undefined) return '__null__';
  return String(v);
}
function stringToSelectValue(s, options) {
  const match = options.find(o => selectValueToString(o.value) === s);
  return match ? match.value : s;
}

const STATUS_BADGES = [
  { status:'Critical', cls:'badge-critical' },
  { status:'Warning',  cls:'badge-warning'  },
  { status:'Healthy',  cls:'badge-healthy'  },
  { status:'Expired',  cls:'badge-expired'  },
];

function CertDashboard({ certs, loading, lastRefreshed, tick, sortConfig, onSort, onRefresh, refreshInterval, onSetRefreshInterval, onManage, onNewCert }) {
  const [statusFilter, setStatusFilter] = useState(null);
  const counts = certs.reduce((acc,c) => { acc[c.status]=(acc[c.status]||0)+1; return acc; }, {});
  const activeLabel = REFRESH_OPTIONS.find(o => o.value === refreshInterval)?.label ?? 'Off';
  const filteredCerts = statusFilter ? certs.filter(c => c.status === statusFilter) : certs;

  function toggleFilter(status) {
    setStatusFilter(f => f === status ? null : status);
  }

  return (
    <div>
      {/* Row 1 — primary: title + filters | CTA */}
      <div className="dashboard-header">
        <div className="dashboard-title">
          Certificates
          {STATUS_BADGES.filter(({ status }) => (counts[status]||0) > 0).map(({ status, cls }) => (
            <span
              key={status}
              className={`badge ${cls} badge-filter ${statusFilter === status ? 'filter-active' : statusFilter ? 'filter-inactive' : ''}`}
              style={{fontSize:11}}
              onClick={() => toggleFilter(status)}
              title={statusFilter === status ? 'Clear filter' : `Show ${status} only`}
            >
              {counts[status]} {status}
            </span>
          ))}
        </div>
        <button className="btn btn-primary btn-sm" onClick={onNewCert}>
          ⊕ New Certificate
        </button>
      </div>
      {/* Row 2 — secondary: refresh metadata | interval controls */}
      <div className="dashboard-toolbar">
        <span className="dashboard-toolbar-meta">
          {lastRefreshed ? `Refreshed ${formatRelativeTime(lastRefreshed)}` : 'Not yet refreshed'}
          {refreshInterval ? ` · auto ${activeLabel}` : ''}
        </span>
        <div className="dashboard-toolbar-controls">
          <div className="refresh-interval-group">
            {REFRESH_OPTIONS.map(opt => (
              <button
                key={String(opt.value)}
                className={`refresh-interval-btn ${refreshInterval === opt.value ? 'active' : ''}`}
                onClick={() => onSetRefreshInterval(opt.value)}
                title={opt.value ? `Auto-refresh every ${opt.label}` : 'Disable auto-refresh'}
              >
                {opt.label}
              </button>
            ))}
          </div>
          <button className="btn btn-secondary btn-sm" onClick={onRefresh} disabled={loading}>
            {loading ? <><span className="spinner" style={{borderTopColor:'var(--text-primary)'}} /> Loading…</> : '↻ Refresh'}
          </button>
        </div>
      </div>
      <CertTable certs={filteredCerts} sortConfig={sortConfig} onSort={onSort} onManage={onManage} loading={loading} statusFilter={statusFilter} />
    </div>
  );
}

function SettingsPanel({ open, settings, onSave, onClose }) {
  const [showVaultToken,  setShowVaultToken]  = useState(false);
  const [draft, setDraft] = useState(settings);

  // Re-seed the draft from saved settings whenever the panel is opened
  // (or whenever saved settings change from elsewhere).
  useEffect(() => { if (open) setDraft(settings); }, [open, settings]);

  const dirty = Object.keys(draft).some(k => draft[k] !== settings[k]);

  const updateDraft = (k, v) => setDraft(prev => ({ ...prev, [k]: v }));
  const handleSave   = () => { if (dirty) onSave(draft); };
  const handleReset  = () => setDraft(settings);

  const fields = [
    { key:'vaultUrl',     label:'Cloud Base URL',               placeholder:'https://api.venafi.cloud',          type:'text',     show:null,           setShow:null           },
    { key:'vaultToken',   label:'API Key',                      placeholder:'••••••••••••••••',                  type:'password', show:showVaultToken, setShow:setShowVaultToken },
    { key:'theme',        label:'Theme',                        type:'select', options: THEME_OPTIONS },
    { key:'applicationName', label:'Application Name', placeholder:'My Biz App', type:'text', show:null,        setShow:null             },
  ];
  return (
    <div className={`settings-panel ${open ? 'open' : ''}`}>
      <div className="settings-drawer-header">
        <span className="settings-drawer-title">Settings</span>
        <button className="settings-drawer-close" onClick={onClose} type="button" title="Close">✕</button>
      </div>
      <div className="settings-drawer-body">
        <div className="settings-grid">
          {fields.map(f => (
            <div key={f.key} className="settings-field">
              <label>{f.label}</label>
              <div className="settings-input-wrap">
                {f.type === 'textarea' ? (
                  <textarea
                    className="settings-textarea"
                    placeholder={f.placeholder} value={draft[f.key] ?? ''}
                    onChange={e => updateDraft(f.key, e.target.value)}
                    rows={5} autoComplete="off" spellCheck={false}
                  />
                ) : f.type === 'select' ? (
                  <ThemedSelect
                    value={draft[f.key]}
                    options={f.options}
                    onChange={v => updateDraft(f.key, v)}
                  />
                ) : (
                  <input
                    type={f.type === 'password' ? (f.show ? 'text' : 'password') : 'text'}
                    placeholder={f.placeholder} value={draft[f.key] ?? ''}
                    onChange={e => updateDraft(f.key, e.target.value)} autoComplete="off"
                  />
                )}
                {f.type === 'password' && f.setShow && (
                  <button className="eye-btn" onClick={() => f.setShow(s => !s)} type="button">
                    <EyeIcon visible={f.show} />
                  </button>
                )}
              </div>
            </div>
          ))}
        </div>
      </div>
      <div className="settings-drawer-footer">
        <div className="settings-actions">
          <span className={`settings-dirty-indicator${dirty ? ' visible' : ''}`}>
            Unsaved changes
          </span>
          <button className="btn btn-secondary btn-sm" onClick={handleReset} disabled={!dirty} type="button">
            Reset
          </button>
          <button className="btn btn-primary btn-sm" onClick={handleSave} disabled={!dirty} type="button">
            Save Settings
          </button>
        </div>
      </div>
    </div>
  );
}

function ThemedSelect({ value, options, onChange }) {
  const [open, setOpen] = useState(false);
  const ref = useRef(null);
  const selected = options.find(o => o.value === value) ?? options[0];

  useEffect(() => {
    if (!open) return;
    const onDocDown = e => { if (ref.current && !ref.current.contains(e.target)) setOpen(false); };
    const onKey     = e => { if (e.key === 'Escape') setOpen(false); };
    document.addEventListener('mousedown', onDocDown);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDocDown);
      document.removeEventListener('keydown', onKey);
    };
  }, [open]);

  return (
    <div ref={ref} className={`themed-select ${open ? 'open' : ''}`}>
      <button type="button" className="themed-select-trigger" onClick={() => setOpen(o => !o)}>
        <span>{selected?.label ?? '—'}</span>
        <svg className="themed-select-caret" viewBox="0 0 10 10" fill="currentColor" aria-hidden="true">
          <path d="M5 7 1 3h8z"/>
        </svg>
      </button>
      {open && (
        <div className="themed-select-menu" role="listbox">
          {options.map(opt => {
            const isSelected = opt.value === value;
            return (
              <div
                key={selectValueToString(opt.value)}
                role="option"
                aria-selected={isSelected}
                className={`themed-select-option ${isSelected ? 'selected' : ''}`}
                onClick={() => { onChange(opt.value); setOpen(false); }}
              >
                <span>{opt.label}</span>
                {isSelected && <span className="themed-select-check">✓</span>}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

function ThemeApplier({ theme }) {
  useEffect(() => {
    document.documentElement.setAttribute('data-theme', theme || 'dark');
  }, [theme]);
  return null;
}

function POCBanner() {
  return (
    <div className="poc-banner">
      <div className="poc-banner-dot" />
      POC MODE — All API calls are mocked. Configure Settings to connect live endpoints.
    </div>
  );
}

function Header({ settingsOpen, onToggleSettings }) {
  return (
    <div className="header">
      <div className="header-left">
        <Logo />
        <span className="header-tagline">Certificate Manager</span>
      </div>
      <div className="header-right">
        <button className={`settings-toggle-btn ${settingsOpen ? 'active' : ''}`} onClick={onToggleSettings}>
          ⚙ Settings
        </button>
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────
// APP ROOT
// ─────────────────────────────────────────────────────────────

export {
  StatusBadge, Logo, EyeIcon, CopyBtn, PassphraseField, LogEntry, ActivityLog, CertManageModal, NewCertModal, COLUMNS, CertRow, CertTableSkeleton, CertTableEmpty, CertTable, REFRESH_OPTIONS, THEME_OPTIONS, selectValueToString, stringToSelectValue, STATUS_BADGES, CertDashboard, SettingsPanel, ThemedSelect, ThemeApplier, POCBanner, Header,
};
