#
# Copyright 2021 Venafi, Inc.
#
# Licensed under the Apache License, Version 2.0 (the "License");
# you may not use this file except in compliance with the License.
# You may obtain a copy of the License at
#
#  http://www.apache.org/licenses/LICENSE-2.0
#
# Unless required by applicable law or agreed to in writing, software
# distributed under the License is distributed on an "AS IS" BASIS,
# WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
# See the License for the specific language governing permissions and
# limitations under the License.
#
#!/usr/bin/env python
"""
CertDownload — library + CLI for Venafi Cloud keystore operations.

Two flows:
  - download_existing(cert_id, ...)        Download keystore for an existing cert.
  - mint_and_download(cert_type, cn, ...)  Mint a new cert via Cloud Key Generation
                                           (CKG) using DC_CIT_ID or INT_CIT_ID, then
                                           download its keystore.

Both functions return a dict shaped like:
  {
    'certificate_id': str,
    'certificate':    str,    # PEM-encoded leaf
    'chain':          str,    # PEM-encoded intermediates / root (root_first controls order)
    'private_key':    str,    # PEM-encoded encrypted private key
    'zip_bytes':      bytes,  # raw keystore ZIP — handy for portal blob delivery
    'export_format':  str,
  }
"""
import argparse
import base64
import io
import logging
import random
import string
import sys
import time
import zipfile
from os import environ, makedirs, path

import requests
import urllib.parse as urlparse
from nacl.encoding import Base64Encoder
from nacl.public import PublicKey, SealedBox

import config

# ── URL templates ─────────────────────────────────────────────────────────
URL_APP_DETAILS      = "{}/outagedetection/v1/applications/name/{}"
URL_CERT_REQUEST     = "{}/outagedetection/v1/certificaterequests"
URL_CERT_REQUEST_ONE = "{}/outagedetection/v1/certificaterequests/{}"
URL_DEK_HASH         = "{}/outagedetection/v1/certificates/{}"
URL_DEK_PUBLIC_KEY   = "{}/v1/edgeencryptionkeys/{}"
URL_CERT_KEYSTORE    = "{}/outagedetection/v1/certificates/{}/keystore"
URL_CERT_RETIREMENT  = "{}/outagedetection/v1/certificates/retirement"
URL_CERT_TAGS_APPLY  = "{}/outagedetection/v1/certificates/tags/_apply"   # bulk-assign tags
URL_CERT_TAGS_LEGACY = "{}/outagedetection/v1/certificates/_action/applyTags"  # older variant

# Async issuance: internal CITs often return an empty certificateIds array on
# the initial POST and populate it once the CA backend completes. Poll up to
# this many seconds for the request to reach a terminal state.
CERT_REQUEST_POLL_TIMEOUT_SEC = 120
CERT_REQUEST_POLL_INTERVAL_SEC = 2
HTTP_STATUS_GOOD   = (200, 201, 202)

# Apache OOTB application server type — required by /certificaterequests; do not change.
APP_SRV_TYPE_ID = '784938d1-ef0d-11eb-9461-7bb533ba575b'

# Map portal-friendly cert types to the CIT IDs in config.py.
CIT_BY_TYPE = {
    'digicert': config.DC_CIT_ID,   # DigiCert Standard SSL
    'internal': config.INT_CIT_ID,  # Internal Certificate Request
}

logging.basicConfig(level=logging.INFO)
log = logging.getLogger("vaas-script")


# ── Public API ────────────────────────────────────────────────────────────

def _normalize_vault_url(url):
    """Strip trailing slashes so URL templates don't produce '//' which some
    Venafi edge nodes treat as a different (auth-restricted) path."""
    if not url:
        return url
    return url.rstrip('/')


def download_existing(
    cert_id,
    private_key_password,
    *,
    vault_url=None,
    api_key=None,
    export_format='PEM',
    root_first=True,
):
    """Download keystore for an existing certificate by ID.

    Skips the cert-request step entirely; goes straight to dekHash → DEK public key →
    SealedBox-encrypted passphrase → keystore ZIP. Works for any cert in the tenant
    that has a ``dekHash`` (i.e. was minted via CKG or had its private key uploaded).
    """
    vault_url = _normalize_vault_url(vault_url or config.CA_URL)
    api_key   = api_key   or config.API_KEY
    headers   = _build_headers(api_key)
    password  = _coerce_password(private_key_password)

    log.info("download_existing: cert_id=%s format=%s", cert_id, export_format)
    zip_bytes = _fetch_keystore(cert_id, password, headers, vault_url, export_format)
    return _bundle_result(cert_id, zip_bytes, export_format, root_first)


def mint_and_download(
    cert_type,
    common_name,
    private_key_password,
    *,
    vault_url=None,
    api_key=None,
    app_name=None,
    cit_alias=None,
    csr_attrs=None,
    tags=None,
    validity='P7D',
    export_format='PEM',
    root_first=True,
):
    """Mint a new certificate via CKG and download its keystore.

    ``cert_type`` selects the CIT:
      'digicert' → config.DC_CIT_ID    (DigiCert Standard SSL)
      'internal' → config.INT_CIT_ID   (Internal Certificate Request)

    ``cit_alias`` optionally overrides via the application's
    ``certificateIssuingTemplateAliasIdMap`` (the original script's path); if set,
    it wins over ``cert_type``.
    """
    vault_url = _normalize_vault_url(vault_url or config.CA_URL)
    api_key   = api_key   or config.API_KEY
    app_name  = app_name  or config.APP_NAME
    headers   = _build_headers(api_key)
    password  = _coerce_password(private_key_password)

    # Resolve the CIT ID — alias path first (if explicitly requested), else cert_type.
    if cit_alias:
        app_id, alias_map = _get_application(app_name, headers, vault_url)
        cit_id = alias_map.get(cit_alias)
        if not cit_id:
            raise ValueError(
                "CIT alias {!r} not found in application {!r}".format(cit_alias, app_name)
            )
    else:
        key = (cert_type or '').lower()
        cit_id = CIT_BY_TYPE.get(key)
        if not cit_id:
            raise ValueError(
                "Unknown cert_type {!r}; expected one of {}".format(
                    cert_type, sorted(CIT_BY_TYPE.keys())
                )
            )
        # Still need app_id for the cert-request body.
        app_id, _ = _get_application(app_name, headers, vault_url)

    log.info(
        "mint_and_download: cert_type=%s cn=%s cit=%s app=%s",
        cert_type, common_name, cit_id, app_name,
    )

    # Pass tags into the cert request body — Venafi applies them at issuance time,
    # which works under the same Issuer role as the request itself (no extra
    # permissions). If that's not honored on this tenant, _apply_tags() runs as
    # a best-effort fallback below.
    cert_id = _request_certificate(
        app_id=app_id, cit_id=cit_id, common_name=common_name,
        validity=validity, csr_attrs=csr_attrs, tags=tags,
        headers=headers, vault_url=vault_url,
    )

    if tags:
        _apply_tags(cert_id, tags, headers, vault_url)

    zip_bytes = _fetch_keystore(cert_id, password, headers, vault_url, export_format)
    return _bundle_result(cert_id, zip_bytes, export_format, root_first)


def retire_certificates(
    cert_ids,
    *,
    vault_url=None,
    api_key=None,
    add_to_blocklist=True,
):
    """Retire one or more certs via POST /outagedetection/v1/certificates/retirement.

    Removes them from the ACTIVE search results so the dashboard no longer surfaces
    them. ``add_to_blocklist=True`` prevents the same cert from being re-issued or
    re-imported under the same fingerprint.
    """
    if not cert_ids:
        raise ValueError("retire_certificates requires at least one cert id")

    vault_url = _normalize_vault_url(vault_url or config.CA_URL)
    api_key   = api_key or config.API_KEY
    headers   = _build_headers(api_key)
    body      = {
        'certificateIds':  list(cert_ids),
        'addToBlocklist':  bool(add_to_blocklist),
    }
    uri = URL_CERT_RETIREMENT.format(vault_url)

    log.info("retire_certificates: ids=%s addToBlocklist=%s", cert_ids, add_to_blocklist)
    r = requests.post(url=uri, headers=headers, json=body)
    if r.status_code not in HTTP_STATUS_GOOD:
        raise RuntimeError(
            "Error retiring certs {} (HTTP {} {}): {}".format(
                cert_ids, r.status_code, r.reason, _decode_error_body(r),
            )
        )
    # Some Venafi responses return JSON, some return an empty body on 204-style
    # success — be tolerant.
    try:
        return r.json()
    except ValueError:
        return {'status': 'retired', 'certificateIds': list(cert_ids)}


# ── Helpers ───────────────────────────────────────────────────────────────

def _build_headers(api_key):
    return {
        'accept': 'application/json',
        'content-type': 'application/json',
        'tppl-api-key': api_key,
    }


def _coerce_password(pw):
    """Accept either str or bytes; return bytes for SealedBox.encrypt."""
    if isinstance(pw, bytes):
        return pw
    if isinstance(pw, str):
        return pw.encode('utf-8')
    raise TypeError("private_key_password must be str or bytes")


def _get_application(app_name, headers, vault_url):
    """Return (app_id, certificate_issuing_template_alias_id_map)."""
    escaped = urlparse.quote(app_name)
    uri = URL_APP_DETAILS.format(vault_url, escaped)
    r = requests.get(url=uri, headers=headers)
    if r.status_code not in HTTP_STATUS_GOOD:
        raise RuntimeError(
            "Error retrieving application {!r}: {}".format(app_name, get_http_response(r))
        )
    payload = r.json()
    return payload['id'], payload.get('certificateIssuingTemplateAliasIdMap', {})


def _request_certificate(*, app_id, cit_id, common_name, validity, csr_attrs, tags=None, headers, vault_url):
    """POST /certificaterequests, then poll until the cert is issued; returns the cert id."""
    body = {
        'isVaaSGenerated': True,
        'applicationId': app_id,
        'certificateIssuingTemplateId': cit_id,
        'applicationServerTypeId': APP_SRV_TYPE_ID,
        'validityPeriod': validity,
        'csrAttributes': csr_attrs or _default_csr_attrs(common_name),
    }
    # Tag application at issuance — works under the Issuer role. Tenants that
    # ignore this field aren't harmed; tags are picked up by the post-issuance
    # _apply_tags() fallback (which needs a higher-tier role).
    if tags:
        body['tags'] = list(tags)
    uri = URL_CERT_REQUEST.format(vault_url)
    r = requests.post(url=uri, headers=headers, json=body)
    if r.status_code not in HTTP_STATUS_GOOD:
        raise RuntimeError(
            "Error requesting certificate CN={}: {}".format(common_name, get_http_response(r))
        )

    payload = r.json()
    request_blob = (payload.get('certificateRequests') or [{}])[0]
    request_id   = request_blob.get('id')
    cert_ids     = request_blob.get('certificateIds') or []

    # Synchronous case (DigiCert and other fast issuers): cert id is already populated.
    if cert_ids:
        return cert_ids[0]

    # Async case (internal CITs): poll the request until ISSUED, FAILED, or timeout.
    if not request_id:
        raise RuntimeError(
            "Cert request response had no certificateIds and no request id to poll: {}".format(payload)
        )
    return _poll_certificate_request(request_id, common_name, headers, vault_url)


def _poll_certificate_request(request_id, common_name, headers, vault_url):
    """Poll GET /certificaterequests/{id} until issued. Returns cert id on success."""
    uri      = URL_CERT_REQUEST_ONE.format(vault_url, request_id)
    deadline = time.monotonic() + CERT_REQUEST_POLL_TIMEOUT_SEC
    last_status = None
    while time.monotonic() < deadline:
        r = requests.get(url=uri, headers=headers)
        if r.status_code not in HTTP_STATUS_GOOD:
            raise RuntimeError(
                "Error polling certificate request {}: {}".format(request_id, get_http_response(r))
            )
        body = r.json()
        # Some Venafi responses wrap the request in a list; some return it bare.
        if 'certificateRequests' in body:
            blob = (body.get('certificateRequests') or [{}])[0]
        else:
            blob = body

        status   = blob.get('status') or blob.get('certificateRequestStatus')
        cert_ids = blob.get('certificateIds') or []
        if cert_ids:
            log.info("Cert request %s issued (status=%s) → %s", request_id, status, cert_ids[0])
            return cert_ids[0]

        terminal_failure = (status or '').upper() in ('FAILED', 'REJECTED', 'CANCELLED', 'CANCELED')
        if terminal_failure:
            raise RuntimeError(
                "Cert request {} for CN={} ended in status {}: {}".format(
                    request_id, common_name, status, blob.get('errorInformation') or blob,
                )
            )

        if status != last_status:
            log.info("Cert request %s status=%s (waiting for issuance)…", request_id, status)
            last_status = status
        time.sleep(CERT_REQUEST_POLL_INTERVAL_SEC)

    raise RuntimeError(
        "Cert request {} for CN={} did not reach ISSUED within {}s (last status={})".format(
            request_id, common_name, CERT_REQUEST_POLL_TIMEOUT_SEC, last_status,
        )
    )


def _apply_tags(cert_id, tags, headers, vault_url):
    """Best-effort post-issuance tag application.

    The primary path is to include ``tags`` in the cert request body (handled in
    ``_request_certificate``), which works under the Issuer role. This function
    is the fallback for tenants that don't honor that field. It targets the
    per-cert resource (PATCH); other shapes were tried in earlier iterations and
    consistently 403'd on Issuer-role keys, so this single attempt keeps the log
    clean. If your tenant has tag-write protected by role and tags don't appear,
    you'll need either:
      • a higher-tier API key (one with tag:write scope), OR
      • to confirm Venafi accepted the request-body 'tags' field for this CIT.
    """
    if not tags:
        return
    tag_list = list(tags)
    uri = URL_DEK_HASH.format(vault_url, cert_id)  # /outagedetection/v1/certificates/{id}
    try:
        r = requests.patch(url=uri, headers=headers, json={"tags": tag_list})
    except requests.RequestException as e:
        log.warning("Post-issuance tag apply network error for %s: %s", cert_id, e)
        return
    if r.status_code in HTTP_STATUS_GOOD:
        log.info("Post-issuance tags %s applied to cert %s", tag_list, cert_id)
        return
    if r.status_code == 403:
        log.info(
            "Post-issuance tag apply not permitted (HTTP 403) — relying on tags "
            "passed in the request body. Verify in Venafi UI that cert %s shows tags %s.",
            cert_id, tag_list,
        )
        return
    log.warning(
        "Post-issuance tag apply failed for cert %s (HTTP %s): %s",
        cert_id, r.status_code, get_http_response(r),
    )


def _default_csr_attrs(common_name):
    return {
        'commonName': common_name,
        'organization': 'Venafi, Inc.',
        'organizationalUnits': ['Product Management'],
        'locality': 'Salt Lake City',
        'state': 'Utah',
        'country': 'US',
        'subjectAlternativeNamesByType': {'dnsNames': [common_name]},
    }


def _get_dek_hash(cert_id, headers, vault_url):
    uri = URL_DEK_HASH.format(vault_url, cert_id)
    r = requests.get(url=uri, headers=headers)
    if r.status_code not in HTTP_STATUS_GOOD:
        raise RuntimeError(
            "Error fetching dekHash for cert_id={}: {}".format(cert_id, get_http_response(r))
        )
    dek_hash = r.json().get("dekHash")
    if not dek_hash:
        raise RuntimeError(
            "Certificate {} has no dekHash; its private key was not generated by Venafi "
            "and cannot be downloaded via this flow.".format(cert_id)
        )
    return dek_hash


def _get_dek_public_key(dek_hash, headers, vault_url):
    uri = URL_DEK_PUBLIC_KEY.format(vault_url, dek_hash)
    r = requests.get(url=uri, headers=headers)
    if r.status_code not in HTTP_STATUS_GOOD:
        raise RuntimeError(
            "Error fetching DEK public key for dekHash={}: {}".format(
                dek_hash, get_http_response(r)
            )
        )
    return PublicKey(r.json()["key"], encoder=Base64Encoder)


def _encrypt_passphrase(public_key, password_bytes):
    """SealedBox-encrypt the passphrase against the DEK public key, return base64 str."""
    box = SealedBox(public_key)
    return base64.b64encode(box.encrypt(password_bytes)).decode("utf-8")


# Portal export-format names → Venafi /keystore exportFormat values.
# Venafi rejects 'PFX' with an empty-body HTTP error; the spec calls this PKCS12.
_KEYSTORE_FORMAT_ALIASES = {
    'PFX':    'PKCS12',
    'PKCS12': 'PKCS12',
    'PEM':    'PEM',
    'DER':    'DER',
    'JKS':    'JKS',
}


def _fetch_keystore(cert_id, password_bytes, headers, vault_url, export_format):
    """Walk dekHash → public key → encrypt passphrase → POST /keystore. Return ZIP bytes."""
    dek_hash    = _get_dek_hash(cert_id, headers, vault_url)
    public_key  = _get_dek_public_key(dek_hash, headers, vault_url)
    encrypted   = _encrypt_passphrase(public_key, password_bytes)

    api_format = _KEYSTORE_FORMAT_ALIASES.get((export_format or '').upper())
    if not api_format:
        raise ValueError(
            "Unsupported exportFormat {!r}; expected one of {}".format(
                export_format, sorted(set(_KEYSTORE_FORMAT_ALIASES.values()))
            )
        )

    keystore_headers = dict(headers)
    # Accept either octet-stream (success) or json (error body) so Venafi sends back
    # a structured error when our request is rejected.
    keystore_headers['accept'] = 'application/octet-stream, application/json'
    body = {
        'exportFormat': api_format,
        'encryptedPrivateKeyPassphrase': encrypted,
        'encryptedKeystorePassphrase': '',
        'certificateLabel': '',
    }
    uri = URL_CERT_KEYSTORE.format(vault_url, cert_id)
    r = requests.post(url=uri, headers=keystore_headers, json=body)
    if r.status_code not in HTTP_STATUS_GOOD:
        raise RuntimeError(
            "Error downloading keystore for cert_id={} (HTTP {} {}, format={!r}): {}".format(
                cert_id, r.status_code, r.reason, api_format, _decode_error_body(r),
            )
        )
    return r.content


def _decode_error_body(response):
    """Best-effort decode of an error response body for inclusion in exceptions."""
    try:
        return response.json()
    except Exception:
        pass
    try:
        text = response.text
        if text:
            return text
    except Exception:
        pass
    raw = getattr(response, 'content', b'')
    return repr(raw) if raw else '<empty body>'


def _bundle_result(cert_id, keystore_bytes, export_format, root_first):
    """Wrap the keystore response into the public return shape.

    Venafi's /keystore endpoint only returns a ZIP archive for ``exportFormat=PEM``
    (containing the cert + chain + key as separate PEM files). For PKCS12 / JKS / DER
    it returns the keystore as a single binary blob — there's nothing to extract.
    """
    if (export_format or '').upper() == 'PEM':
        certificate, chain, private_key = extract_zip_files(keystore_bytes, root_first)
    else:
        certificate, chain, private_key = None, None, None
    return {
        'certificate_id': cert_id,
        'certificate':    certificate,
        'chain':          chain,
        'private_key':    private_key,
        'keystore_bytes': keystore_bytes,
        # Back-compat alias — older callers still expect 'zip_bytes'.
        'zip_bytes':      keystore_bytes,
        'export_format':  export_format,
    }


def get_http_response(response):
    """Decode a requests.Response body for human-readable error logging."""
    header = response.headers.get('Content-Type')
    if header == 'application/json':
        return response.json()
    elif header == 'text/plain':
        return response.text
    return response.content


def random_word(length):
    letters = string.ascii_lowercase + string.digits
    return ''.join(random.choice(letters) for _ in range(length))


def extract_zip_files(data, root_first):
    """Extract the leaf cert, intermediate chain, and private key from a Venafi keystore ZIP.

    Position layout in the ``*_root-first.pem`` member:
      [0] -> root cert
      [1] -> intermediate cert
      [2] -> our certificate
    """
    zip_data    = zipfile.ZipFile(io.BytesIO(data))
    private_key = None
    all_certs   = []
    chain       = None
    certificate = None

    for info in zip_data.infolist():
        if info.filename.endswith('.key'):
            with zip_data.open(info) as f:
                private_key = f.read().decode("utf-8").strip()
        elif info.filename.endswith('_root-first.pem'):
            with zip_data.open(info) as f:
                all_certs = f.read().decode("utf-8").strip().split('\n\n')

    if all_certs:
        for i in range(len(all_certs)):
            if i < len(all_certs) - 1:
                if not chain:
                    chain = all_certs[i]
                else:
                    val1 = chain if root_first else all_certs[i]
                    val2 = all_certs[i] if root_first else chain
                    chain = "{}\n{}".format(val1, val2)
            else:
                certificate = all_certs[i]

    return certificate, chain, private_key


# ── CLI ───────────────────────────────────────────────────────────────────

def _write_outputs(result, out_dir):
    """Write certificate / chain / private_key / .zip to out_dir."""
    makedirs(out_dir, exist_ok=True)
    base = result['certificate_id']
    if result.get('certificate'):
        with open(path.join(out_dir, base + '.crt'), 'w') as f:
            f.write(result['certificate'])
    if result.get('chain'):
        with open(path.join(out_dir, base + '.chain.pem'), 'w') as f:
            f.write(result['chain'])
    if result.get('private_key'):
        with open(path.join(out_dir, base + '.key'), 'w') as f:
            f.write(result['private_key'])
    with open(path.join(out_dir, base + '.zip'), 'wb') as f:
        f.write(result['zip_bytes'])
    log.info("Wrote keystore artifacts to %s", out_dir)


def _cli():
    p = argparse.ArgumentParser(prog='CertDownload', description=__doc__)
    sub = p.add_subparsers(dest='command', required=True)

    p_existing = sub.add_parser('existing', help='Download keystore for an existing cert id.')
    p_existing.add_argument('--cert-id',  required=True)
    p_existing.add_argument('--password', required=True, help='Private key password (any string).')
    p_existing.add_argument('--format',   default='PEM', choices=['PEM', 'PFX'])
    p_existing.add_argument('--vault-url', default=None)
    p_existing.add_argument('--api-key',   default=None)
    p_existing.add_argument('--out',       default='./out')

    p_mint = sub.add_parser('mint', help='Mint a new cert via CKG and download its keystore.')
    p_mint.add_argument('--cert-type', required=True, choices=sorted(CIT_BY_TYPE.keys()),
                        help='digicert → DC_CIT_ID, internal → INT_CIT_ID')
    p_mint.add_argument('--cn',         required=True, help='Common name / FQDN.')
    p_mint.add_argument('--password',   required=True, help='Private key password.')
    p_mint.add_argument('--validity',   default='P7D')
    p_mint.add_argument('--format',     default='PEM', choices=['PEM', 'PFX'])
    p_mint.add_argument('--vault-url',  default=None)
    p_mint.add_argument('--api-key',    default=None)
    p_mint.add_argument('--app-name',   default=None)
    p_mint.add_argument('--cit-alias',  default=None)
    p_mint.add_argument('--out',        default='./out')

    args = p.parse_args()

    if args.command == 'existing':
        result = download_existing(
            cert_id=args.cert_id,
            private_key_password=args.password,
            vault_url=args.vault_url,
            api_key=args.api_key,
            export_format=args.format,
        )
    else:
        result = mint_and_download(
            cert_type=args.cert_type,
            common_name=args.cn,
            private_key_password=args.password,
            vault_url=args.vault_url,
            api_key=args.api_key,
            app_name=args.app_name,
            cit_alias=args.cit_alias,
            validity=args.validity,
            export_format=args.format,
        )

    _write_outputs(result, args.out)
    log.info("Success — cert_id=%s", result['certificate_id'])


if __name__ == '__main__':
    # Back-compat: honour the original env-var style if invoked with no args.
    if len(sys.argv) == 1 and environ.get('VAAS_DOMAIN') and environ.get('VAAS_PK_PASSWORD'):
        domain   = environ['VAAS_DOMAIN']
        password = environ['VAAS_PK_PASSWORD']
        alias    = environ.get('VAAS_CIT_ALIAS')
        cn       = "{}.{}".format(random_word(16), domain)
        result = mint_and_download(
            cert_type='digicert',  # legacy default
            common_name=cn,
            private_key_password=password,
            cit_alias=alias,
        )
        log.info("Success!!!")
        log.info("Certificate:\n%s", result['certificate'])
        log.info("Private Key:\n%s", result['private_key'])
        log.info("Full Chain:\n%s",  result['chain'])
    else:
        _cli()
