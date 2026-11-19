import { describe, expect, it } from 'vitest';
import { certificateStatus, fingerprint, parseCertificate } from './certificate';
import { EC_CERT, LEAF_CERT, RSA_CERT } from './samples';

const DAY = 86_400_000;

describe('parseCertificate', () => {
  it('reads subject, issuer, serial and validity of an RSA certificate', () => {
    const cert = parseCertificate(RSA_CERT);
    expect(cert.subject).toBe('idp.example.com');
    expect(cert.issuer).toBe('idp.example.com');
    expect(cert.serial).toBe('51f434a28e59b4e5812045d309f0f28f1b5fc8ef');
    expect(cert.notBefore).toBe(Date.UTC(2026, 0, 1));
    expect(cert.notAfter).toBe(Date.UTC(2036, 0, 1));
  });

  it('reports the key type and size', () => {
    expect(parseCertificate(RSA_CERT).key).toBe('RSA 2048');
    expect(parseCertificate(EC_CERT).key).toBe('EC P-256');
    expect(parseCertificate(LEAF_CERT).key).toBe('EC P-384');
  });

  it('tells self-signed certificates from issued ones', () => {
    expect(parseCertificate(RSA_CERT).selfSigned).toBe(true);
    const leaf = parseCertificate(LEAF_CERT);
    expect(leaf.selfSigned).toBe(false);
    expect(leaf.subject).toBe('sp.example.com');
    expect(leaf.issuer).toBe('Example CA');
  });

  it('accepts PEM armour and line breaks', () => {
    const pem = `-----BEGIN CERTIFICATE-----\n${EC_CERT.replace(/(.{64})/g, '$1\n')}\n-----END CERTIFICATE-----`;
    expect(parseCertificate(pem).subject).toBe('old.example.com');
  });

  it('rejects text that is not Base64', () => {
    expect(() => parseCertificate('not a certificate!')).toThrow('Not a certificate');
  });

  it('rejects Base64 that is not a certificate', () => {
    expect(() => parseCertificate(btoa('hello world, this is plain text'))).toThrow('Not a certificate');
  });

  it('rejects a truncated certificate', () => {
    expect(() => parseCertificate(RSA_CERT.slice(0, 200))).toThrow('Not a certificate');
  });
});

describe('certificateStatus', () => {
  const cert = parseCertificate(RSA_CERT);

  it('is valid well inside the window', () => {
    expect(certificateStatus(cert, Date.UTC(2030, 0, 1))).toBe('valid');
  });

  it('is expiring soon in the last 30 days', () => {
    expect(certificateStatus(cert, cert.notAfter - 29 * DAY)).toBe('expiringSoon');
    expect(certificateStatus(cert, cert.notAfter - 31 * DAY)).toBe('valid');
  });

  it('is expired from the end date on', () => {
    expect(certificateStatus(cert, cert.notAfter)).toBe('expired');
  });

  it('is not yet valid before the start date', () => {
    expect(certificateStatus(cert, cert.notBefore - 1)).toBe('notYetValid');
  });

  it('takes the warning period as a parameter', () => {
    expect(certificateStatus(cert, cert.notAfter - 80 * DAY, 90)).toBe('expiringSoon');
  });
});

describe('fingerprint', () => {
  it('is the SHA-256 of the certificate, as openssl prints it', async () => {
    expect(await fingerprint(EC_CERT)).toBe(
      'C8:AD:59:19:83:4B:80:1E:C9:FC:B1:B7:3E:F9:08:3D:BC:43:35:58:03:64:C5:C4:9A:96:6B:0E:55:DF:9A:5B',
    );
  });
});
