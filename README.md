<div align="center">

# 🔐 CertManager

### A certificate lifecycle dashboard for Venafi TLS Protect Cloud

*List, renew, re-issue, download, and retire TLS certificates from a single, polished web portal.*

<br>

![React](https://img.shields.io/badge/React-18-61DAFB?style=for-the-badge&logo=react&logoColor=black)
![Vite](https://img.shields.io/badge/Vite-5-646CFF?style=for-the-badge&logo=vite&logoColor=white)
![Python](https://img.shields.io/badge/Python-Flask-3776AB?style=for-the-badge&logo=python&logoColor=white)
![Venafi](https://img.shields.io/badge/Venafi-TLS_Protect_Cloud-00A86B?style=for-the-badge)
![License](https://img.shields.io/badge/License-MIT-blue?style=for-the-badge)
![Status](https://img.shields.io/badge/Status-Proof_of_Concept-orange?style=for-the-badge)

</div>

---

## 📋 Overview

**CertManager** is a proof-of-concept web application that puts a clean, modern face on
**Venafi TLS Protect Cloud (VaaS)** — an enterprise certificate-authority platform. Managing
machine identities through Venafi's native console is powerful but heavy; this portal distills
the day-to-day certificate operations a platform or security engineer actually performs into a
fast, single-screen dashboard.

It surfaces every **ACTIVE** certificate scoped to a single Venafi Application and lets you:

- 🔍 **Browse** a live, sortable inventory of certificates with expiry tracking
- ♻️ **Renew / re-issue** certificates with a single click
- ➕ **Mint brand-new certificates** (DigiCert public or internal CA) from a guided form
- ⬇️ **Download** full keystores — PEM bundles, PKCS#12 (`.p12`/`.pfx`), JKS, or DER — with a
  securely generated passphrase
- 🗑️ **Retire** certificates (with optional blocklisting) so they drop out of rotation
- 📡 Watch every API call stream by in a built-in **activity log**

> 💡 The app boots in **mock mode** with realistic canned data, so you can explore the entire
> UI and every workflow **without any credentials**. Drop in a real Venafi API key and vault
> URL in Settings and it transparently switches to the live path.

---

## ✨ Highlights

| | |
|---|---|
| 🎨 **Three theme modes** | Dark, light, and a custom "meg" theme — applied reactively across the whole UI |
| 🔄 **Auto-refresh** | Configurable polling interval keeps the inventory fresh; "last refreshed" ticker |
| 🔐 **Secure passphrase generation** | One-time passphrases minted per download, with reveal/copy controls |
| 🏷️ **Tag-driven format defaults** | Per-tag download-format preferences (e.g. a `windows` tag → `.pfx`) that persist with settings |
| 📊 **Smart de-duplication** | Collapses certificate rows by hostname + issuer + tag set, keeping the latest expiry |
| 🧾 **Live API console** | Collapsible/expandable activity log mirrors real Venafi endpoints being called |
| 🧩 **Graceful mock ↔ live switch** | Every operation has parallel `mock*` and `real*` implementations |

---

## 🏗️ Architecture

CertManager is built in three cleanly separated tiers. The interesting engineering decision is
**why** there's a Python tier at all: Venafi's `/keystore` endpoint requires the download
passphrase to be **`SealedBox`-encrypted with PyNaCl** against a per-certificate key — crypto
that's impractical to perform in the browser. So keystore minting and downloads are delegated to
a tiny local Flask bridge, while plain inventory reads go straight from the browser to Venafi.

```
┌────────────────────────┐         ┌─────────────────────────┐         ┌────────────────────────┐
│   React + Vite UI       │  HTTPS  │   Venafi TLS Protect     │         │                          │
│   (src/)                │────────▶│   Cloud  (VaaS API)      │         │   Certificate inventory  │
│                          │  read   │                          │         │   lives here             │
│   • Dashboard            │◀────────│                          │         └────────────────────────┘
│   • Manage / New modals  │         └─────────────────────────┘
│   • Activity log         │
│   • Settings / themes    │         ┌─────────────────────────┐         ┌────────────────────────┐
│                          │  HTTP   │   Flask bridge           │  HTTPS  │   Venafi keystore /      │
│                          │────────▶│   cert_service.py        │────────▶│   certificate-request    │
│                          │ keystore│   (127.0.0.1:8765)       │  mint   │   endpoints              │
└────────────────────────┘  ops    │      │                   │         └────────────────────────┘
                                      │      ▼                   │
                                      │   CertDownload.py        │
                                      │   (PyNaCl SealedBox,     │
                                      │    PEM/PKCS12/JKS/DER)   │
                                      └─────────────────────────┘
```

### The three tiers

1. **React + Vite front end** (`src/`) — the portal UI. State-driven dashboard, modals, theming,
   and activity log, with no UI framework dependency beyond React itself.
2. **Flask bridge** (`cert_service.py`) — a small local HTTP service on `127.0.0.1:8765` that
   exposes download/mint/retire endpoints and wraps the Python crypto flow.
3. **Venafi client library** (`CertDownload.py`) — the actual Venafi Cloud API integration:
   certificate requests, polling for asynchronous issuance, keystore encryption, and ZIP
   extraction. Also usable as a standalone CLI.

---

## 🔬 Engineering details worth a look

A few of the non-obvious problems this project solves:

- **Application-scoped inventory without a search endpoint.** Venafi has no
  search-by-application API, so the client lists all applications to resolve a configured name
  → app ID, pages through *all* ACTIVE certs, then filters client-side by application — and
  de-duplicates the results.
- **Asynchronous certificate issuance.** Internal CA certificate requests issue *asynchronously*:
  the initial POST often returns no certificate ID, so the bridge **polls**
  `/certificaterequests/{id}` until the certificate reaches `ISSUED`. DigiCert, by contrast,
  issues synchronously — both paths are handled.
- **Renew == new cert.** Venafi doesn't distinguish renewal from issuance, so "renew" mints a
  fresh certificate carrying the old one's CSR subject and tags, then retires the original.
- **Format-aware delivery.** Only PEM comes back as a ZIP (cert + chain + key split into files);
  the bridge reassembles those into one `.pem` bundle, while PKCS#12 / JKS / DER stream through
  as a single binary blob.

---

## 🛠️ Tech Stack

**Frontend**
- React 18 + Vite 5
- Hand-rolled component library (`components.jsx`) — modals, themed selects, sortable table,
  status badges, activity log
- CSS custom-property theming (dark / light / custom)

**Backend / integration**
- Python 3 + Flask + Flask-CORS
- `requests` for the Venafi REST API
- **PyNaCl** for `SealedBox` passphrase encryption
- Standalone CLI mode via `CertDownload.py`

---

## 🚀 Getting Started

> This POC copy runs **standalone** — no IIS, no reverse proxy. You can explore the full UI in
> mock mode without ever touching the Python tier or supplying credentials.

### Prerequisites

- **Node.js** 18+
- **Python** 3.10+

### 1 — Front end

```bash
npm install
npm run dev        # Vite dev server on http://localhost:5173
```

Open the browser and you're in **mock mode** with sample certificates immediately.

### 2 — Python bridge (only needed for live downloads / minting)

```bash
pip install -r requirements.txt
python cert_service.py     # Flask service on http://127.0.0.1:8765
```

### 3 — Go live (optional)

Open the **Settings** panel in the UI and enter your Venafi **vault URL** and **API token**.
The dashboard switches from mock data to your real certificate inventory automatically.

---

## 🖥️ CLI usage

`CertDownload.py` also works on its own, no UI required:

```bash
# Download an existing certificate's keystore
python CertDownload.py existing --cert-id <id> --password <pw> [--format PEM|PFX]

# Mint a new certificate
python CertDownload.py mint --cert-type digicert|internal --cn <fqdn> --password <pw>
```

---

## 🔌 Bridge API reference

The Flask service exposes a small JSON API consumed by the portal:

| Method | Endpoint | Purpose |
|--------|----------|---------|
| `GET`  | `/api/health` | Health check → `{"ok": true}` |
| `POST` | `/api/download/existing` | Download the keystore for an existing certificate |
| `POST` | `/api/download/mint` | Mint a new certificate and return its keystore |
| `POST` | `/api/cert/retire` | Retire one or more certificates (optional blocklisting) |

---

## 📁 Project structure

```
CertManager-POC/
├── src/
│   ├── App.jsx           # Root component: state, data fetching, modal orchestration
│   ├── components.jsx    # UI component library (dashboard, modals, log, settings, themes)
│   ├── lib.js            # mock* + real* operations, formatting, Venafi data mapping
│   ├── main.jsx          # React entry point
│   └── styles/index.css  # Themed styling
├── cert_service.py       # Flask bridge (download / mint / retire endpoints)
├── CertDownload.py       # Venafi Cloud client + keystore crypto (also a CLI)
├── config.py             # Venafi tenant / CIT configuration
├── vite.config.js        # Vite dev server + /api proxy
└── requirements.txt      # Python dependencies
```

---

## ⚠️ Note

This is a **proof-of-concept** built to demonstrate a real Venafi integration and a clean
operational UX. It is not hardened for production: CORS is fully permissive for local
development, and configuration values live in `config.py`. **Do not commit real API keys or
credentials** — rotate any sample values before publishing.

---

<div align="center">

*Built as a portfolio piece demonstrating full-stack development, third-party API integration,*
*applied cryptography, and product-minded UX.*

</div>
