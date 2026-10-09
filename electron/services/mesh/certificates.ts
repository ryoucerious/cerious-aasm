import { createHash, randomBytes, X509Certificate } from 'crypto';

/**
 * Mesh CA and node certificates. The joining node generates its own key; a member signs
 * that public key with the mesh CA. The node private key is never sent or replicated.
 */
interface ForgeCert {
  publicKey: unknown;
  serialNumber: string;
  validity: { notBefore: Date; notAfter: Date };
  setSubject(attrs: Array<{ name: string; value: string }>): void;
  setIssuer(attrs: unknown): void;
  setExtensions(exts: unknown[]): void;
  sign(key: unknown, md: unknown): void;
  verify(child: ForgeCert): boolean;
  subject: { attributes: unknown };
}

interface ForgeApi {
  pki: {
    rsa: {
      generateKeyPair(bits: number): { publicKey: unknown; privateKey: unknown };
      setPublicKey(n: unknown, e: unknown): unknown;
    };
    createCertificate(): ForgeCert;
    certificateToPem(cert: ForgeCert): string;
    certificateFromPem(pem: string): ForgeCert;
    privateKeyToPem(key: unknown): string;
    privateKeyFromPem(pem: string): unknown;
    publicKeyToPem(key: unknown): string;
    publicKeyFromPem(pem: string): unknown;
  };
  md: { sha256: { create(): unknown } };
}

function forge(): ForgeApi {
  return require('node-forge') as ForgeApi;
}

export interface KeyPair {
  publicKeyPem: string;
  privateKeyPem: string;
}

export interface SignedCert {
  certPem: string;
  serial: string;
}

const CERT_NOT_BEFORE_SKEW_MS = 60 * 60 * 1000;

function validity(years: number): { notBefore: Date; notAfter: Date } {
  const notBefore = new Date(Date.now() - CERT_NOT_BEFORE_SKEW_MS);
  const notAfter = new Date(notBefore);
  notAfter.setFullYear(notAfter.getFullYear() + years);
  return { notBefore, notAfter };
}

/** Hosts a peer will dial. An IP has to be in the certificate or rqlite rejects the connection. */
export function altNamesForHosts(hosts: string[]): Array<{ type: number; ip?: string; value?: string }> {
  const seen = new Set<string>();
  const names: Array<{ type: number; ip?: string; value?: string }> = [];
  for (const host of hosts) {
    const value = host.trim();
    if (!value || seen.has(value)) continue;
    seen.add(value);
    if (/^(\d{1,3}\.){3}\d{1,3}$/.test(value)) names.push({ type: 7, ip: value });
    else names.push({ type: 2, value });
  }
  return names;
}

export function hostsFromEndpoint(endpoint: string): string[] {
  const stripped = endpoint.replace(/^[a-z][a-z0-9+.-]*:\/\//i, '').replace(/\/.*$/, '');
  if (!stripped) return [];
  const host = stripped.startsWith('[')
    ? stripped.slice(1, stripped.indexOf(']'))
    : stripped.replace(/:\d+$/, '');
  return host ? [host] : [];
}
export function generateKeyPair(): KeyPair {
  const keys = forge().pki.rsa.generateKeyPair(2048);
  return {
    publicKeyPem: forge().pki.publicKeyToPem(keys.publicKey),
    privateKeyPem: forge().pki.privateKeyToPem(keys.privateKey)
  };
}

export function createMeshCa(commonName: string): { certPem: string; keyPem: string; serial: string } {
  const api = forge();
  const keys = api.pki.rsa.generateKeyPair(2048);
  const cert = api.pki.createCertificate();
  cert.publicKey = keys.publicKey;
  cert.serialNumber = serialHex();
  const validityWindow = validity(10);
  cert.validity.notBefore = validityWindow.notBefore;
  cert.validity.notAfter = validityWindow.notAfter;
  const subject = [{ name: 'commonName', value: commonName }];
  cert.setSubject(subject);
  cert.setIssuer(subject);
  cert.setExtensions([
    { name: 'basicConstraints', cA: true },
    { name: 'keyUsage', keyCertSign: true, digitalSignature: true, cRLSign: true }
  ]);
  cert.sign(keys.privateKey, api.md.sha256.create());
  return {
    certPem: api.pki.certificateToPem(cert),
    keyPem: api.pki.privateKeyToPem(keys.privateKey),
    serial: normalizeSerial(cert.serialNumber)
  };
}

export function signNodeCertificate(
  caCertPem: string,
  caKeyPem: string,
  publicKeyPem: string,
  commonName: string,
  hosts: string[] = []
): SignedCert {
  const api = forge();
  const caCert = api.pki.certificateFromPem(caCertPem);
  const caKey = api.pki.privateKeyFromPem(caKeyPem);
  const cert = api.pki.createCertificate();
  cert.publicKey = api.pki.publicKeyFromPem(publicKeyPem);
  cert.serialNumber = serialHex();
  const validityWindow = validity(2);
  cert.validity.notBefore = validityWindow.notBefore;
  cert.validity.notAfter = validityWindow.notAfter;
  cert.setSubject([{ name: 'commonName', value: commonName }]);
  cert.setIssuer(caCert.subject.attributes);
  const altNames = altNamesForHosts(hosts);
  cert.setExtensions([
    { name: 'basicConstraints', cA: false },
    { name: 'keyUsage', digitalSignature: true, keyEncipherment: true },
    { name: 'extKeyUsage', serverAuth: true, clientAuth: true },
    ...(altNames.length ? [{ name: 'subjectAltName', altNames }] : [])
  ]);
  cert.sign(caKey, api.md.sha256.create());
  return { certPem: api.pki.certificateToPem(cert), serial: normalizeSerial(cert.serialNumber) };
}

export function publicKeyFromPrivatePem(privateKeyPem: string): string {
  const api = forge();
  const key = api.pki.privateKeyFromPem(privateKeyPem) as { n: unknown; e: unknown };
  return api.pki.publicKeyToPem(api.pki.rsa.setPublicKey(key.n, key.e));
}

export function certificateIssuedBy(certPem: string, caPem: string): boolean {
  try {
    const api = forge();
    return api.pki.certificateFromPem(caPem).verify(api.pki.certificateFromPem(certPem));
  } catch {
    return false;
  }
}

export function certificateCoversHost(certPem: string, host: string): boolean {
  const cert = forge().pki.certificateFromPem(certPem) as ForgeCert & {
    getExtension(name: string): { altNames?: Array<{ type: number; ip?: string; value?: string }> } | null;
  };
  const altNames = cert.getExtension('subjectAltName')?.altNames || [];
  const want = host.toLowerCase();
  return altNames.some(name => name.ip === host || (name.value || '').toLowerCase() === want);
}

/**
 * sha256 of the certificate's DER bytes, base64url. An enrollment token carries the mesh CA's,
 * so a joining node can tell the real mesh from anything in between before it sends the token.
 */
export function certificateFingerprint(certPem: string): string {
  return createHash('sha256').update(new X509Certificate(certPem).raw).digest('base64url');
}

/** The serial a peer sees when this certificate is presented, as stored in `nodes.cert_serial`. */
export function certificateSerial(certPem: string): string {
  return normalizeSerial(forge().pki.certificateFromPem(certPem).serialNumber);
}

export function normalizeSerial(serial: string): string {
  return serial.replace(/[^0-9a-fA-F]/g, '').toLowerCase().replace(/^0+/, '') || '0';
}

/**
 * A positive ASN.1 integer. Go rejects a serial whose first bit is set, and rqlite then
 * refuses the CA file, so the high bit is cleared before the certificate is signed.
 */
export function newCertificateSerial(): string {
  const bytes = randomBytes(16);
  bytes[0] &= 0x7f;
  if (bytes.every(byte => byte === 0)) bytes[15] = 1;
  return bytes.toString('hex');
}

function serialHex(): string {
  return newCertificateSerial();
}
