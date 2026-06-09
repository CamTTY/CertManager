#!/usr/bin/env python
"""
cert_service — local HTTP bridge between the browser portal (index.html) and
CertDownload.py.

The portal calls these endpoints; the service wraps the Python keystore flow
(which needs PyNaCl SealedBox encryption that's painful to do in-browser).

Run:
    pip install -r requirements.txt
    python cert_service.py

Endpoints:
    POST /api/download/existing    Body: { certificateId, passphrase, exportFormat?,
                                           apiKey?, vaultUrl? }
                                   Returns: keystore ZIP (application/zip).

    POST /api/download/mint        Body: { certType, commonName, passphrase,
                                           exportFormat?, validity?, appName?,
                                           citAlias?, apiKey?, vaultUrl? }
                                   Returns: keystore ZIP (application/zip).

    POST /api/cert/retire          Body: { certificateIds | certificateId,
                                           addToBlocklist?, apiKey?, vaultUrl? }
                                   Drops the cert(s) from the ACTIVE search results.

    GET  /api/health               Sanity check; returns {"ok": true}.

The Deploy endpoint is currently disabled — see ./deploy_future/ for the parked
PowerShell script and snippet to re-enable it later.
"""
import io
import logging
import traceback

from flask import Flask, request, jsonify, send_file
from flask_cors import CORS

import CertDownload
import config

# NOTE: the /api/deploy endpoint and deploy_cert.ps1 PowerShell wrapper are
# parked in ./deploy_future/ until we re-enable the deploy stage. See
# deploy_future/cert_service_deploy.py.snippet for the endpoint code.

logging.basicConfig(level=logging.INFO)
log = logging.getLogger("cert-service")

app = Flask(__name__)
# Permissive CORS for local development — portal runs from file:// or a different
# localhost origin. Tighten this when deploying to a hosted environment.
CORS(app, resources={r"/api/*": {"origins": "*"}})


@app.get('/api/health')
def health():
    return jsonify({'ok': True, 'service': 'cert_service'})


@app.post('/api/download/existing')
def api_download_existing():
    body = request.get_json(force=True, silent=True) or {}
    try:
        cert_id  = body['certificateId']
        password = body['passphrase']
    except KeyError as e:
        return jsonify({'error': 'missing field: {}'.format(e.args[0])}), 400

    try:
        result = CertDownload.download_existing(
            cert_id=cert_id,
            private_key_password=password,
            vault_url=body.get('vaultUrl') or config.CA_URL,
            api_key=body.get('apiKey')   or config.API_KEY,
            export_format=body.get('exportFormat', 'PEM'),
        )
    except Exception as e:
        log.error("download_existing failed: %s", e)
        traceback.print_exc()
        return jsonify({'error': str(e)}), 500

    return _keystore_response(result, fallback_name=cert_id)


@app.post('/api/download/mint')
def api_mint_and_download():
    body = request.get_json(force=True, silent=True) or {}
    try:
        cert_type   = body['certType']
        common_name = body['commonName']
        password    = body['passphrase']
    except KeyError as e:
        return jsonify({'error': 'missing field: {}'.format(e.args[0])}), 400

    csr_attrs = body.get('csrAttrs')
    # Filter out null/empty values so the script's defaults can fill in only
    # the gaps. Only forward the dict if it actually carries content.
    if isinstance(csr_attrs, dict):
        csr_attrs = {k: v for k, v in csr_attrs.items() if v not in (None, '', [])}
        if not csr_attrs:
            csr_attrs = None
    raw_tags = body.get('tags')
    tags = [t for t in raw_tags if isinstance(t, str) and t.strip()] if isinstance(raw_tags, list) else None

    log.info(
        "mint request: cn=%s cert_type=%s csr_keys=%s tags=%s",
        common_name, cert_type,
        sorted(csr_attrs.keys()) if isinstance(csr_attrs, dict) else None,
        tags,
    )

    try:
        result = CertDownload.mint_and_download(
            cert_type=cert_type,
            common_name=common_name,
            private_key_password=password,
            vault_url=body.get('vaultUrl') or config.CA_URL,
            api_key=body.get('apiKey')   or config.API_KEY,
            app_name=body.get('appName'),
            cit_alias=body.get('citAlias'),
            csr_attrs=csr_attrs,
            tags=tags,
            validity=body.get('validity', 'P7D'),
            export_format=body.get('exportFormat', 'PEM'),
        )
    except ValueError as e:
        return jsonify({'error': str(e)}), 400
    except Exception as e:
        log.error("mint_and_download failed: %s", e)
        traceback.print_exc()
        return jsonify({'error': str(e)}), 500

    return _keystore_response(result, fallback_name=result['certificate_id'])


def _keystore_response(result, fallback_name):
    """Format-aware delivery.

    PEM   → assemble a single .pem bundle (leaf cert + chain + private key) so the
            user gets one file, not a ZIP archive.
    PKCS12 / DER / JKS → stream the binary keystore as-is.
    """
    fmt = (result.get('export_format') or '').upper()

    if fmt == 'PEM':
        bundle = _assemble_pem_bundle(result)
        return send_file(
            io.BytesIO(bundle.encode('utf-8')),
            mimetype='application/x-pem-file',
            as_attachment=True,
            download_name='{}.pem'.format(fallback_name),
        )

    ext_by_fmt = {'PKCS12': 'p12', 'JKS': 'jks', 'DER': 'der'}
    ext = ext_by_fmt.get(fmt, 'bin')
    return send_file(
        io.BytesIO(result['keystore_bytes']),
        mimetype='application/octet-stream',
        as_attachment=True,
        download_name='{}.{}'.format(fallback_name, ext),
    )


# ── Retire ────────────────────────────────────────────────────────────────

@app.post('/api/cert/retire')
def api_cert_retire():
    """Retire one or more certs in Venafi so they drop out of the dashboard.

    Body: { "certificateIds": [...], "addToBlocklist"?: bool, "apiKey"?, "vaultUrl"? }
    Or single-cert convenience: { "certificateId": "...", ... }
    """
    body = request.get_json(force=True, silent=True) or {}
    cert_ids = body.get('certificateIds')
    if not cert_ids and body.get('certificateId'):
        cert_ids = [body['certificateId']]
    if not cert_ids:
        return jsonify({'error': 'missing certificateId(s)'}), 400

    try:
        result = CertDownload.retire_certificates(
            cert_ids=cert_ids,
            vault_url=body.get('vaultUrl') or config.CA_URL,
            api_key=body.get('apiKey')   or config.API_KEY,
            add_to_blocklist=bool(body.get('addToBlocklist', True)),
        )
    except ValueError as e:
        return jsonify({'ok': False, 'error': str(e)}), 400
    except Exception as e:
        log.error("retire failed: %s", e)
        traceback.print_exc()
        return jsonify({'ok': False, 'error': str(e)}), 500

    return jsonify({'ok': True, 'result': result})


def _assemble_pem_bundle(result):
    """Concatenate leaf cert + chain + private key into a single PEM string."""
    parts = []
    if result.get('certificate'):
        parts.append(result['certificate'].strip())
    if result.get('chain'):
        parts.append(result['chain'].strip())
    if result.get('private_key'):
        parts.append(result['private_key'].strip())
    return '\n\n'.join(parts) + '\n'


if __name__ == '__main__':
    app.run(host='127.0.0.1', port=8765, debug=False)
