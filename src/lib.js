// CertManager logic layer — utilities, mock API, Venafi live API, cert_service client.
// Extracted verbatim from the original single-file index.html.

// ─────────────────────────────────────────────────────────────
// UTILITIES
// ─────────────────────────────────────────────────────────────
function uuid() {
  return Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
}

function delay(ms) {
  return new Promise(r => setTimeout(r, ms));
}

function generatePassphrase() {
  const CHARS = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghjkmnpqrstuvwxyz23456789';
  const bytes = crypto.getRandomValues(new Uint8Array(20));
  return Array.from(bytes).map(b => CHARS[b % CHARS.length]).join('');
}

// Display format for expiration dates. Storage stays ISO (YYYY-MM-DD) because
// it's used for new Date() comparisons in dedupe / sort logic; only the
// rendered string changes.
function formatExpirationDate(iso) {
  if (!iso) return '—';
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(iso);
  if (!m) return iso;
  const [, y, mo, d] = m;
  return `${mo}-${d}-${y}`;
}

function formatRelativeTime(date) {
  if (!date) return '—';
  const diff = Math.floor((Date.now() - date.getTime()) / 1000);
  if (diff < 10)   return 'just now';
  if (diff < 60)   return `${diff}s ago`;
  if (diff < 120)  return '1 min ago';
  if (diff < 3600) return `${Math.floor(diff / 60)} mins ago`;
  return `${Math.floor(diff / 3600)}h ago`;
}

async function copyToClipboard(text) {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    try {
      const el = document.createElement('textarea');
      el.value = text;
      el.style.cssText = 'position:fixed;opacity:0;top:0;left:0;';
      document.body.appendChild(el);
      el.select();
      document.execCommand('copy');
      document.body.removeChild(el);
      return true;
    } catch { return false; }
  }
}

function downloadTextFile(content, filename) {
  const blob = new Blob([content], { type: 'text/plain' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url; a.download = filename;
  document.body.appendChild(a); a.click();
  document.body.removeChild(a); URL.revokeObjectURL(url);
}

// ─────────────────────────────────────────────────────────────
// MOCK CERTIFICATE DATA
// ─────────────────────────────────────────────────────────────
const MOCK_CERTS_BASE = [
  {
    id: 'cert-001', name: 'api.optimus.internal',
    subject: 'CN=api.optimus.internal, O=Optimus Corp, C=US',
    tags: ['Synapsys', 'PowerFrame'],
    issuer: 'Optimus Internal CA G2', expirationDate: '2026-04-29',
    daysRemaining: 2, status: 'Critical',
    thumbprint: 'A3:F2:91:BC:44:D1:7E:09:55:AA:31:CF:88:1B:20:4D',
  },
  {
    id: 'cert-002', name: 'auth.optimus.internal',
    subject: 'CN=auth.optimus.internal, O=Optimus Corp, C=US',
    tags: ['Synapsys', 'Synergy', 'SymApp', 'Finboa'],
    issuer: 'Optimus Internal CA G2', expirationDate: '2026-05-03',
    daysRemaining: 6, status: 'Critical',
    thumbprint: 'B1:CC:04:2A:88:F3:90:D2:11:7B:55:E4:09:AB:C2:3F',
  },
  {
    id: 'cert-003', name: 'dashboard.optimus.com',
    subject: 'CN=dashboard.optimus.com, O=Optimus Corp, C=US',
    tags: ['Synergy'],
    issuer: 'DigiCert TLS RSA SHA256 2020 CA1', expirationDate: '2026-05-17',
    daysRemaining: 20, status: 'Warning',
    thumbprint: '5D:11:F7:BC:33:04:CC:9A:22:1E:88:40:D3:BB:09:7F',
  },
  {
    id: 'cert-004', name: 'reporting.optimus.internal',
    subject: 'CN=reporting.optimus.internal, O=Optimus Corp, C=US',
    tags: ['Finboa', 'PowerFrame'],
    issuer: 'Optimus Internal CA G2', expirationDate: '2026-05-22',
    daysRemaining: 25, status: 'Warning',
    thumbprint: 'C9:44:2E:FF:71:B0:55:D3:80:12:AC:77:31:6F:DD:81',
  },
  {
    id: 'cert-005', name: 'vpn.optimus.internal',
    subject: 'CN=vpn.optimus.internal, O=Optimus Corp, C=US',
    tags: ['Synapsys', 'Synergy'],
    issuer: 'Optimus Internal CA G2', expirationDate: '2026-07-15',
    daysRemaining: 79, status: 'Healthy',
    thumbprint: '7A:8B:C5:D6:E7:F8:09:1A:2B:3C:4D:5E:6F:70:81:92',
  },
  {
    id: 'cert-006', name: 'storage.optimus.internal',
    subject: 'CN=storage.optimus.internal, O=Optimus Corp, C=US',
    tags: ['PowerFrame', 'SymApp'],
    issuer: 'Optimus Internal CA G2', expirationDate: '2026-09-03',
    daysRemaining: 129, status: 'Healthy',
    thumbprint: 'D4:E5:F6:07:18:29:3A:4B:5C:6D:7E:8F:90:A1:B2:C3',
  },
  {
    id: 'cert-007', name: 'mail.optimus.com',
    subject: 'CN=mail.optimus.com, O=Optimus Corp, C=US',
    tags: ['Synergy'],
    issuer: 'Sectigo RSA Domain Validation CA', expirationDate: '2027-01-11',
    daysRemaining: 259, status: 'Healthy',
    thumbprint: 'E3:F4:05:16:27:38:49:5A:6B:7C:8D:9E:AF:B0:C1:D2',
  },
  {
    id: 'cert-008', name: 'legacy-portal.optimus.com',
    subject: 'CN=legacy-portal.optimus.com, O=Optimus Corp, C=US',
    tags: ['SymApp'],
    issuer: 'DigiCert SHA2 Secure Server CA', expirationDate: '2026-02-01',
    daysRemaining: -85, status: 'Expired',
    thumbprint: '22:AB:CD:EF:01:23:45:67:89:AB:CD:EF:01:23:45:67',
  },
  {
    id: 'cert-009', name: 'ci.optimus.internal',
    subject: 'CN=ci.optimus.internal, O=Optimus Corp, C=US',
    tags: ['Synapsys'],
    issuer: 'Optimus Internal CA G2', expirationDate: '2026-06-10',
    daysRemaining: 44, status: 'Healthy',
    thumbprint: 'F1:02:13:24:35:46:57:68:79:8A:9B:AC:BD:CE:DF:E0',
  },
  {
    id: 'cert-010', name: 'metrics.optimus.internal',
    subject: 'CN=metrics.optimus.internal, O=Optimus Corp, C=US',
    tags: ['Finboa', 'PowerFrame'],
    issuer: 'Optimus Internal CA G2', expirationDate: '2026-05-12',
    daysRemaining: 15, status: 'Warning',
    thumbprint: '33:44:55:66:77:88:99:AA:BB:CC:DD:EE:FF:00:11:22',
  },
];

// ─────────────────────────────────────────────────────────────
// MOCK API LAYER
// ─────────────────────────────────────────────────────────────

// Fetches certificates — uses Venafi live API when Settings are populated,
// falls back to mock data otherwise (POC mode).
async function mockFetchCerts(settings = {}) {
  if (settings.vaultUrl && settings.vaultToken) {
    return realFetchCerts(settings); // live path — see realFetchCerts above
  }
  // ── mock fallback (POC mode) ──────────────────────────────
  await delay(700 + Math.random() * 400);
  return MOCK_CERTS_BASE.map(c => ({ ...c, renewedAt: null, downloadedAt: null, deployedAt: null }));
}

// TODO (production): replace mock with real fetch call
// POST /api/v1/certificates/{id}/renew  body: { passphrase }
async function mockRenewCert(certId, _passphrase) {
  await delay(800 + Math.random() * 400);
  if (Math.random() < 0.05) throw new Error('Certificate renewal failed: CA unreachable (mock)');
  return { success: true, certId, renewedAt: new Date().toISOString() };
}

// TODO (production): replace mock with real fetch call
// GET /api/v1/certificates/{id}/export?format=PFX|PEM
async function mockExportCert(certId, format = 'PFX') {
  await delay(600 + Math.random() * 400);
  if (format === 'PEM') {
    const pemData = `-----BEGIN CERTIFICATE-----\nMOCK_PEM_CERT_DATA_FOR_${certId}_${Date.now()}\n-----END CERTIFICATE-----\n-----BEGIN ENCRYPTED PRIVATE KEY-----\nMOCK_PEM_KEY_DATA\n-----END ENCRYPTED PRIVATE KEY-----`;
    return new Blob([pemData], { type: 'application/x-pem-file' });
  }
  return new Blob([`MOCK_PFX_BINARY_DATA_FOR_${certId}_${Date.now()}`], { type: 'application/x-pkcs12' });
}

// TODO (production): replace mock with real fetch calls
// POST /api/tokens  →  POST /api/scheduleActions  →  GET /api/dailyJobs (poll)
// Deploy flow disabled — see ./deploy_future/ for the parked PowerShell script,
// cert_service endpoint, and modal UI snippet to re-enable it later.

// TODO (production): replace mock with real fetch call
// POST /api/v1/certificates/request
async function mockCreateCert(payload) {
  await delay(1000 + Math.random() * 600);
  const id = 'cert-' + Array.from(crypto.getRandomValues(new Uint8Array(4))).map(b => b.toString(16).padStart(2,'0')).join('');
  return { success: true, certificateId: id };
}

// ─────────────────────────────────────────────────────────────
// VENAFI CLOUD — LIVE API INTEGRATION
// NOTE: api.venafi.cloud must allow CORS from your host.
// When opening via file://, a local proxy or http:// server is required.
// ─────────────────────────────────────────────────────────────

// Maps one Venafi certificate search result → portal cert shape.
// Field names reflect Venafi TLS Protect Cloud v1 response schema.
// Verify against a real API response and adjust if needed.
function mapVenafiCert(raw) {
  const expirationDate = raw.validityEnd?.slice(0, 10) ?? '';
  const daysRemaining  = Math.floor((new Date(raw.validityEnd) - Date.now()) / 86_400_000);
  const status = daysRemaining < 0   ? 'Expired'
               : daysRemaining <= 7  ? 'Critical'
               : daysRemaining <= 30 ? 'Warning'
               : 'Healthy';
  return {
    id:            raw.id ?? raw.managedCertificateId ?? raw.fingerprint,
    name:          raw.subjectCN?.[0] ?? raw.subjectDN ?? '',
    subject:       raw.subjectDN ?? '',
    tags:          Array.isArray(raw.tags) ? raw.tags : [],
    issuer:        raw.issuerCN?.[0] ?? raw.issuerDN ?? '',
    expirationDate,
    daysRemaining,
    status,
    thumbprint:    raw.fingerprintSha256 ?? raw.fingerprint ?? '',
    // Subject components — used to seed the CSR when re-issuing this cert
    // so the new CSR matches whatever the Venafi CIT policy requires.
    subjectO:      raw.subjectO ?? '',
    subjectOU:     Array.isArray(raw.subjectOU) ? raw.subjectOU : [],
    subjectL:      raw.subjectL ?? '',
    subjectST:     raw.subjectST ?? '',
    subjectC:      raw.subjectC ?? '',
    sanDnsNames:   Array.isArray(raw.subjectAlternativeNameDns) ? raw.subjectAlternativeNameDns : [],
    applicationIds: Array.isArray(raw.applicationIds) ? raw.applicationIds : [],
    renewedAt:     null,
    downloadedAt:  null,
    deployedAt:    null,
  };
}

// Venafi can return multiple ACTIVE certs for the same hostname (different issuers,
// different tags, overlapping validity windows). The dashboard collapses duplicates
// only when hostname + issuer + tag-set all match — different issuer or different
// tag means the cert serves a different purpose and gets its own row. Within a
// matching group, the cert with the latest expiry wins.
function dedupeByHostname(certs) {
  const byKey = new Map();
  for (const c of certs) {
    const host    = (c.name   || '').toLowerCase();
    if (!host) continue;
    const issuer  = (c.issuer || '').toLowerCase();
    const tagsKey = (Array.isArray(c.tags) ? c.tags : [])
      .map(t => String(t).toLowerCase())
      .sort()
      .join('|');
    const key = `${host}::${issuer}::${tagsKey}`;
    const prev = byKey.get(key);
    if (!prev || new Date(c.expirationDate) > new Date(prev.expirationDate)) {
      byKey.set(key, c);
    }
  }
  return Array.from(byKey.values());
}

// Resolves a single Application name to its Venafi application ID. There is no
// get-application-by-name endpoint, so we list every application once
// (GET /outagedetection/v1/applications → { applications: [{ id, name, ... }] }) and match
// the name exactly (case-insensitive). Returns the id, or null if no match.
async function resolveApplicationId(settings, name) {
  const res = await fetch(`${settings.vaultUrl}/outagedetection/v1/applications`, {
    method: 'GET',
    headers: { 'accept': 'application/json', 'tppl-api-key': settings.vaultToken },
  });
  if (!res.ok) throw new Error(`Venafi applications API ${res.status} ${res.statusText}`);
  const json = await res.json();
  const apps = Array.isArray(json.applications) ? json.applications : [];
  const match = apps.find(a => String(a.name || '').toLowerCase() === name.toLowerCase());
  return match ? match.id : null;
}

// Active when vaultUrl + vaultToken are set in Settings.
// Pulls ACTIVE certs scoped to the configured Application:
//   1. resolve the Application name → ID  GET  /outagedetection/v1/applications
//   2. search ACTIVE certs                POST /outagedetection/v1/certificatesearch
// Only certs assigned to that Application are returned; with no name configured (or it
// doesn't resolve) we return [] rather than pulling the whole tenant.
async function realFetchCerts(settings, onLog) {
  const name = (settings.applicationName || '').trim();
  if (!name) return [];

  const log = typeof onLog === 'function' ? onLog : () => {};
  const appId = await resolveApplicationId(settings, name);
  if (!appId) {
    log('WARN', `Application not found in Venafi: ${name}`);
    return [];
  }
  log('INFO', `Resolved application "${name}"; searching for ACTIVE certificates…`);

  // `applicationId` is not a valid certificatesearch field (the API rejects it with 400),
  // so we search all ACTIVE certs — paging through every result — and match each cert's
  // own `applicationIds` against the resolved ID on the client side.
  const idSet  = new Set([appId]);
  const PAGE   = 1000;
  const MAX_PAGES = 50;        // safety cap → up to 50k certs
  let pageNumber = 0;
  const returned = [];
  while (pageNumber < MAX_PAGES) {
    const res = await fetch(`${settings.vaultUrl}/outagedetection/v1/certificatesearch`, {
      method: 'POST',
      headers: {
        'accept':       'application/json',
        'content-type': 'application/json',
        'tppl-api-key': settings.vaultToken,
      },
      body: JSON.stringify({
        expression: {
          operands: [{
            operands: [{ field: 'certificateStatus', operator: 'MATCH', value: 'ACTIVE' }],
            operator: 'AND',
          }],
        },
        paging: { pageNumber, pageSize: PAGE },
      }),
    });
    if (!res.ok) throw new Error(`Venafi API ${res.status} ${res.statusText}`);
    const json = await res.json();
    const batch = json.certificates ?? [];
    returned.push(...batch);
    if (batch.length < PAGE) break;
    pageNumber += 1;
  }

  // Keep only certs actually assigned to one of the resolved applications.
  const scoped = returned
    .map(mapVenafiCert)
    .filter(c => c.applicationIds.some(id => idSet.has(id)));
  log('INFO', `Search returned ${returned.length} ACTIVE cert(s); ${scoped.length} matched application "${name}".`);
  return dedupeByHostname(scoped);
}

// Local Python bridge that wraps CertDownload.py's keystore flow. Run with
//   python cert_service.py
// from the repo root. The portal POSTs to it whenever live credentials are set.
const CERT_SERVICE_URL = 'http://127.0.0.1:8765';

// Real keystore download — POSTs to cert_service which calls
// CertDownload.download_existing(cert_id, ...) and streams back a ZIP blob.
async function realExportCert(cert, exportFormat, settings, passphrase) {
  return certServiceFetch('/api/download/existing', {
    certificateId: cert.id,
    passphrase,
    exportFormat,
    apiKey:   settings.vaultToken || undefined,
    vaultUrl: settings.vaultUrl   || undefined,
  });
}

// Real mint + download — POSTs to cert_service which calls
// CertDownload.mint_and_download(cert_type, cn, ...) and streams back the
// freshly-issued cert's keystore as a ZIP blob.
async function realMintAndDownload(cert, exportFormat, settings, passphrase) {
  // Build CSR attrs from the existing cert so the new CSR satisfies the
  // CIT's distinguished-name policy (Venafi rejects mismatched O/L/ST/C).
  const csrAttrs = {
    commonName:   cert.name,
    organization: cert.subjectO  || undefined,
    organizationalUnits: (cert.subjectOU && cert.subjectOU.length) ? cert.subjectOU : undefined,
    locality:     cert.subjectL  || undefined,
    state:        cert.subjectST || undefined,
    country:      cert.subjectC  || undefined,
    subjectAlternativeNamesByType: {
      dnsNames: (cert.sanDnsNames && cert.sanDnsNames.length) ? cert.sanDnsNames : [cert.name],
    },
  };
  return certServiceFetch('/api/download/mint', {
    certType:    inferCertType(cert),
    commonName:  cert.name,
    csrAttrs,
    passphrase,
    exportFormat,
    // Carry the source cert's tags onto the renewed cert so the Venafi UI
    // shows the same product grouping.
    tags:        Array.isArray(cert.tags) && cert.tags.length ? cert.tags : undefined,
    apiKey:   settings.vaultToken || undefined,
    vaultUrl: settings.vaultUrl   || undefined,
  });
}

// Issue a brand-new cert via the same /api/download/mint endpoint used by
// renewal — Venafi's CKG flow doesn't distinguish "renew" from "new". Caller
// supplies the form values; this helper handles the body shape, including the
// hardcoded JH subject defaults and the RSA keyTypeParameters.
async function realCreateCert(form, settings, passphrase) {
  const algoMeta = KEY_ALGORITHMS.find(k => k.value === form.keyAlgo) || KEY_ALGORITHMS[0];
  const cn       = form.commonName.trim();
  const sans     = (form.sanDnsNames && form.sanDnsNames.length) ? form.sanDnsNames : [cn];

  const csrAttrs = {
    commonName:   cn,
    ...NEW_CERT_CSR_DEFAULTS,
    keyTypeParameters: {
      keyType:   algoMeta.algo,
      keyLength: algoMeta.size,
    },
    subjectAlternativeNamesByType: { dnsNames: sans },
  };

  // Assign the new cert to the Application Name configured in Settings, so it lands in the
  // same Application the dashboard searches (and shows up on refresh). Falls back to the
  // service's configured default when no name is set.
  const appName = (settings.applicationName || '').trim();

  return certServiceFetch('/api/download/mint', {
    certType:    form.certType,
    commonName:  cn,
    csrAttrs,
    passphrase,
    exportFormat: form.exportFormat || 'PEM',
    tags:         (form.tags && form.tags.length) ? form.tags : undefined,
    validity:     form.validity || undefined,
    appName:      appName || undefined,
    apiKey:   settings.vaultToken || undefined,
    vaultUrl: settings.vaultUrl   || undefined,
  });
}

// Retire the old cert in Venafi after a successful renewal so it drops out of
// the dashboard's ACTIVE search and (with addToBlocklist) can't be re-issued.
async function realRetireCert(certId, settings) {
  const res = await fetch(`${CERT_SERVICE_URL}/api/cert/retire`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      certificateIds: [certId],
      addToBlocklist: true,
      apiKey:   settings.vaultToken || undefined,
      vaultUrl: settings.vaultUrl   || undefined,
    }),
  });
  const json = await res.json().catch(() => ({}));
  if (!res.ok || !json.ok) {
    throw new Error(json.error || `cert_service ${res.status}`);
  }
  return json;
}

// CIT selection: digicert | internal. Inferred from the existing cert's issuer.
function inferCertType(cert) {
  const issuer = (cert.issuer || '').toLowerCase();
  return issuer.includes('digicert') ? 'digicert' : 'internal';
}

// Tag-based PKCS12 extension override — these product groups consume the
// keystore as a .pfx (Windows tooling expectation) even though the bytes are
// identical to a .p12.
const PFX_EXTENSION_TAGS = new Set([
  'synergy',
  'opcon test',
  'synapsys',
  'optimus intranet',
  'synergy esign',
]);

function pkcs12ExtensionForTags(tags) {
  const wantsPfx = (Array.isArray(tags) ? tags : []).some(t => PFX_EXTENSION_TAGS.has(String(t).toLowerCase()));
  return wantsPfx ? 'pfx' : 'p12';
}

function pkcs12ExtensionForCert(cert) {
  return pkcs12ExtensionForTags(cert.tags);
}

// User-defined per-tag preference (set in the New Cert modal). First matching
// tag wins. Returns 'pem' | 'p12' | 'pfx' or null if no tag has a preference.
function tagFormatPreference(tags, prefs) {
  if (!prefs || !tags) return null;
  for (const t of tags) {
    const v = prefs[String(t).toLowerCase()];
    if (v) return v;
  }
  return null;
}

// Map a preference value → Venafi exportFormat ('PEM' | 'PKCS12' downstream).
// 'p12' and 'pfx' are both PKCS12 — the difference is just the saved extension.
function exportFormatFromPref(pref) {
  if (pref === 'pem') return 'PEM';
  if (pref === 'p12' || pref === 'pfx') return 'PFX';
  return null;
}

async function certServiceFetch(path, body) {
  const res = await fetch(`${CERT_SERVICE_URL}${path}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    let msg;
    try {
      const data = await res.json();
      msg = data.error || res.statusText;
    } catch {
      msg = await res.text().catch(() => res.statusText);
    }
    throw new Error(`cert_service ${res.status}: ${msg}`);
  }
  return res.blob();
}

// ─────────────────────────────────────────────────────────────
// CERT TYPE / KEY ALGORITHM / CSR DEFAULTS
// ─────────────────────────────────────────────────────────────
const KEY_ALGORITHMS = [
  { value:'RSA_2048', label:'RSA 2048', algo:'RSA', size:2048 },
  { value:'RSA_4096', label:'RSA 4096', algo:'RSA', size:4096 },
];

// Hardcoded subject defaults — the Venafi CIT only accepts these specific
// values (e.g. O ∈ ["JACK HENRY & ASSOCIATES, INC", ...], L="Monett",
// ST="Missouri"). Surfacing them as fields would just give the user ways to
// fail; baking them in keeps the form to "what's actually variable".
const NEW_CERT_CSR_DEFAULTS = {
  organization: 'JACK HENRY & ASSOCIATES, INC',
  locality:     'Monett',
  state:        'Missouri',
  country:      'US',
};

const NEW_CERT_TYPES = [
  { value:'digicert', label:'DigiCert Standard SSL' },
  { value:'internal', label:'Internal Certificate Request' },
];

// ─────────────────────────────────────────────────────────────
// SUB-COMPONENTS
// ─────────────────────────────────────────────────────────────

export {
  uuid, delay, generatePassphrase, formatExpirationDate, formatRelativeTime, copyToClipboard, downloadTextFile, MOCK_CERTS_BASE, mockFetchCerts, mockRenewCert, mockExportCert, mockCreateCert, mapVenafiCert, dedupeByHostname, realFetchCerts, CERT_SERVICE_URL, realExportCert, realMintAndDownload, realCreateCert, realRetireCert, inferCertType, PFX_EXTENSION_TAGS, pkcs12ExtensionForTags, pkcs12ExtensionForCert, tagFormatPreference, exportFormatFromPref, certServiceFetch, KEY_ALGORITHMS, NEW_CERT_CSR_DEFAULTS, NEW_CERT_TYPES,
};
