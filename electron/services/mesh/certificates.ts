import { randomBytes } from 'crypto';

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
  subject: { attributes: unknown };
}

interface ForgeApi {
  pki: {
    rsa: { generateKeyPair(bits: number): { publicKey: unknown; privateKey: unknown } };
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
  cert.validity.notBefore = new Date();
  cert.validity.notAfter = new Date();
  cert.validity.notAfter.setFullYear(cert.validity.notBefore.getFullYear() + 10);
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

export function signNodeCertificate(caCertPem: string, caKeyPem: string, publicKeyPem: string, commonName: string): SignedCert {
  const api = forge();
  const caCert = api.pki.certificateFromPem(caCertPem);
  const caKey = api.pki.privateKeyFromPem(caKeyPem);
  const cert = api.pki.createCertificate();
  cert.publicKey = api.pki.publicKeyFromPem(publicKeyPem);
  cert.serialNumber = serialHex();
  cert.validity.notBefore = new Date();
  cert.validity.notAfter = new Date();
  cert.validity.notAfter.setFullYear(cert.validity.notBefore.getFullYear() + 2);
  cert.setSubject([{ name: 'commonName', value: commonName }]);
  cert.setIssuer(caCert.subject.attributes);
  cert.setExtensions([
    { name: 'basicConstraints', cA: false },
    { name: 'keyUsage', digitalSignature: true, keyEncipherment: true },
    { name: 'extKeyUsage', serverAuth: true, clientAuth: true }
  ]);
  cert.sign(caKey, api.md.sha256.create());
  return { certPem: api.pki.certificateToPem(cert), serial: normalizeSerial(cert.serialNumber) };
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
