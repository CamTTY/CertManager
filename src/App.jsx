import React, { useState, useEffect, useRef, useCallback } from 'react';
import './styles/index.css';
import {
  uuid, delay, generatePassphrase, formatExpirationDate, formatRelativeTime, copyToClipboard, downloadTextFile, MOCK_CERTS_BASE, mockFetchCerts, mockRenewCert, mockExportCert, mockCreateCert, mapVenafiCert, dedupeByHostname, realFetchCerts, CERT_SERVICE_URL, realExportCert, realMintAndDownload, realCreateCert, realRetireCert, inferCertType, PFX_EXTENSION_TAGS, pkcs12ExtensionForTags, pkcs12ExtensionForCert, tagFormatPreference, exportFormatFromPref, certServiceFetch, KEY_ALGORITHMS, NEW_CERT_CSR_DEFAULTS, NEW_CERT_TYPES,
} from './lib.js';
import {
  StatusBadge, Logo, EyeIcon, CopyBtn, PassphraseField, LogEntry, ActivityLog, CertManageModal, NewCertModal, COLUMNS, CertRow, CertTableSkeleton, CertTableEmpty, CertTable, REFRESH_OPTIONS, THEME_OPTIONS, selectValueToString, stringToSelectValue, STATUS_BADGES, CertDashboard, SettingsPanel, ThemedSelect, ThemeApplier, POCBanner, Header,
} from './components.jsx';

function App() {
  const [settings, setSettings] = useState({
    vaultUrl:'', vaultToken:'',
    applicationName:'',
    theme: 'dark',                  // 'dark' | 'light' | 'meg'
    // { "<lowercase tag name>": "pem" | "p12" | "pfx" } — set when the user
    // adds a new tag via the New Cert modal; drives download format defaults
    // for any cert carrying that tag.
    tagFormatPreferences: {},
  });
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [certs, setCerts]               = useState([]);
  const [loading, setLoading]           = useState(false);
  const [lastRefreshed, setLastRefreshed] = useState(null);
  const [tick, setTick]                 = useState(0);
  const [sortConfig, setSortConfig]     = useState({ key:'daysRemaining', dir:'asc' });
  const [modal, setModal]             = useState({ type:null, certId:null });
  const [passphrases, setPassphrases] = useState({});
  const [logEntries, setLogEntries]     = useState([]);
  const [logState, setLogState]         = useState('collapsed'); // 'collapsed' | 'normal' | 'expanded'
  const [refreshInterval, setRefreshInterval] = useState(null); // ms; null = off

  function addLog(level, message) {
    setLogEntries(prev => [...prev, { id:uuid(), timestamp:Date.now(), level, message }]);
  }

  const selectedCert = certs.find(c => c.id === modal.certId) || null;

  function openModal(certId) {
    setPassphrases(p => ({ ...p, [certId]: generatePassphrase() }));
    setModal({ type:'manage', certId });
  }

  function openNewCertModal() { setModal({ type:'new-cert', certId:null }); }

  function closeModal() { setModal({ type:null, certId:null }); }

  function addCert(newCert) {
    setCerts(prev => [newCert, ...prev]);
  }

  function updateCert(certId, patch) {
    setCerts(prev => prev.map(c => c.id === certId ? { ...c, ...patch } : c));
  }

  function removeCert(certId) {
    setCerts(prev => prev.filter(c => c.id !== certId));
  }

  // Union of all tags currently present on dashboard certs — used by the
  // New Certificate modal to offer existing-tag chips alongside a +Custom input.
  const existingTags = React.useMemo(() => {
    const seen = new Map();
    certs.forEach(c => (c.tags || []).forEach(t => {
      const key = String(t).toLowerCase();
      if (key && !seen.has(key)) seen.set(key, t);
    }));
    return Array.from(seen.values()).sort((a,b) => a.localeCompare(b));
  }, [certs]);

  // Persist a user-defined tag→format preference. Stored on settings so it
  // survives like the rest of the configuration.
  function setTagPreference(tagName, format) {
    if (!tagName || !format) return;
    setSettings(prev => ({
      ...prev,
      tagFormatPreferences: {
        ...(prev.tagFormatPreferences || {}),
        [String(tagName).toLowerCase()]: format,
      },
    }));
  }

  // After a brand-new cert is issued it's already tied to the Application it was issued
  // under, so it'll be picked up by the next application-scoped search — we just need to
  // refresh the dashboard so it appears.
  function refreshAfterIssue() {
    fetchCerts();
  }

  const fetchCerts = useCallback(async () => {
    setLoading(true);
    const isLive = !!(settings.vaultUrl && settings.vaultToken);
    addLog('API', isLive
      ? `POST ${settings.vaultUrl}/outagedetection/v1/certificatesearch — fetching certificate inventory…`
      : 'GET /api/v1/certificates — fetching certificate inventory (POC mock)…'
    );
    const t0 = Date.now();
    try {
      const data = isLive
        ? await realFetchCerts(settings, addLog)
        : await mockFetchCerts(settings);
      setCerts(prev => {
        const stateMap = {};
        prev.forEach(c => {
          stateMap[c.id] = {
            renewedAt:    c.renewedAt,
            downloadedAt: c.downloadedAt,
            deployedAt:   c.deployedAt,
            // If this cert was renewed, preserve the updated status/expiry so a
            // refresh can't overwrite them with stale data.
            ...(c.renewedAt ? {
              status: c.status,
              daysRemaining: c.daysRemaining,
              expirationDate: c.expirationDate,
            } : {}),
          };
        });
        return data.map(c => ({ ...c, ...(stateMap[c.id] || {}) }));
      });
      setLastRefreshed(new Date());
      addLog('API', isLive
        ? `POST /outagedetection/v1/certificatesearch → 200 OK (${Date.now()-t0}ms) — ${data.length} certificates loaded`
        : `GET /api/v1/certificates → 200 OK (${Date.now()-t0}ms) — ${data.length} certificates loaded`
      );
    } catch (err) {
      addLog('ERROR', isLive
        ? `POST /outagedetection/v1/certificatesearch → failed: ${err.message}`
        : `GET /api/v1/certificates → failed: ${err.message}`
      );
    } finally {
      setLoading(false);
    }
  }, [settings]);

  // Initial load + "last refreshed" ticker
  useEffect(() => {
    fetchCerts();
  }, [fetchCerts]);

  useEffect(() => {
    const ticker = setInterval(() => setTick(t => t+1), 15_000);
    return () => clearInterval(ticker);
  }, []);

  // Reactive auto-refresh — re-runs whenever the interval setting or fetcher changes
  useEffect(() => {
    if (!refreshInterval) return;
    const id = setInterval(fetchCerts, refreshInterval);
    return () => clearInterval(id);
  }, [refreshInterval, fetchCerts]);

  function handleSort(key) {
    setSortConfig(prev => prev.key === key ? { key, dir:prev.dir==='asc'?'desc':'asc' } : { key, dir:'asc' });
  }

  const closeSettings = () => setSettingsOpen(false);

  return (
    <div className="app-container">
      <Header settingsOpen={settingsOpen} onToggleSettings={() => setSettingsOpen(s => !s)} />
      {!(settings.vaultUrl && settings.vaultToken) && <POCBanner />}
      {settingsOpen && <div className="settings-backdrop" onClick={closeSettings} />}
      <SettingsPanel open={settingsOpen} settings={settings} onClose={closeSettings} onSave={next => { setSettings(next); addLog('INFO', 'Settings saved.'); }} />
      <ThemeApplier theme={settings.theme} />
      <div className="main-content">
        <CertDashboard
          certs={certs} loading={loading} lastRefreshed={lastRefreshed} tick={tick}
          sortConfig={sortConfig} onSort={handleSort} onRefresh={fetchCerts}
          refreshInterval={refreshInterval} onSetRefreshInterval={setRefreshInterval}
          onManage={openModal}
          onNewCert={openNewCertModal}
        />
      </div>
      {modal.type === 'manage' && (
        <CertManageModal
          cert={selectedCert} passphrase={passphrases[modal.certId]||''}
          settings={settings} addLog={addLog} onUpdateCert={updateCert} onClose={closeModal}
          onRemoveCert={removeCert}
          onRequestRefresh={fetchCerts}
        />
      )}
      {modal.type === 'new-cert' && (
        <NewCertModal
          addLog={addLog}
          settings={settings}
          existingTags={existingTags}
          onCertIssued={refreshAfterIssue}
          onSetTagPreference={setTagPreference}
          onClose={closeModal}
        />
      )}
      <ActivityLog
        logEntries={logEntries} logState={logState} setLogState={setLogState}
        onClear={() => { setLogEntries([]); setTimeout(() => addLog('INFO','Activity log cleared.'),50); }}
      />
    </div>
  );
}

// ─────────────────────────────────────────────────────────────
// MOUNT
// ─────────────────────────────────────────────────────────────

export default App;
