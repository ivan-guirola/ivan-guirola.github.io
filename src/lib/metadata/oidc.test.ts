import { describe, expect, it } from 'vitest';
import { EC_CERT } from './samples';
import { checkDiscovery, discoveryUrl, parseDiscovery, parseJwks } from './oidc';

const document = {
  issuer: 'https://login.example.com/realms/demo',
  authorization_endpoint: 'https://login.example.com/realms/demo/auth',
  token_endpoint: 'https://login.example.com/realms/demo/token',
  userinfo_endpoint: 'https://login.example.com/realms/demo/userinfo',
  jwks_uri: 'https://login.example.com/realms/demo/certs',
  end_session_endpoint: 'https://login.example.com/realms/demo/logout',
  scopes_supported: ['openid', 'profile', 'email'],
  response_types_supported: ['code', 'id_token'],
  grant_types_supported: ['authorization_code', 'refresh_token', 'client_credentials'],
  id_token_signing_alg_values_supported: ['RS256', 'ES256'],
  code_challenge_methods_supported: ['S256'],
  token_endpoint_auth_methods_supported: ['client_secret_basic', 'private_key_jwt'],
  subject_types_supported: ['public'],
};
const json = (overrides: object = {}) => JSON.stringify({ ...document, ...overrides });

describe('parseDiscovery', () => {
  it('reads the issuer', () => {
    expect(parseDiscovery(json()).issuer).toBe('https://login.example.com/realms/demo');
  });

  it('lists every endpoint and the key set address, in document order', () => {
    expect(parseDiscovery(json()).endpoints).toEqual([
      { name: 'authorization_endpoint', url: 'https://login.example.com/realms/demo/auth' },
      { name: 'token_endpoint', url: 'https://login.example.com/realms/demo/token' },
      { name: 'userinfo_endpoint', url: 'https://login.example.com/realms/demo/userinfo' },
      { name: 'jwks_uri', url: 'https://login.example.com/realms/demo/certs' },
      { name: 'end_session_endpoint', url: 'https://login.example.com/realms/demo/logout' },
    ]);
  });

  it('reads what the provider supports', () => {
    const discovery = parseDiscovery(json());
    expect(discovery.scopes).toEqual(['openid', 'profile', 'email']);
    expect(discovery.responseTypes).toEqual(['code', 'id_token']);
    expect(discovery.grantTypes).toEqual(['authorization_code', 'refresh_token', 'client_credentials']);
    expect(discovery.signingAlgorithms).toEqual(['RS256', 'ES256']);
    expect(discovery.pkceMethods).toEqual(['S256']);
    expect(discovery.clientAuthMethods).toEqual(['client_secret_basic', 'private_key_jwt']);
  });

  it('leaves lists empty when the document omits them', () => {
    const discovery = parseDiscovery(JSON.stringify({ issuer: 'https://a.example', jwks_uri: 'https://a.example/k' }));
    expect(discovery.scopes).toEqual([]);
    expect(discovery.pkceMethods).toEqual([]);
    expect(discovery.endpoints).toEqual([{ name: 'jwks_uri', url: 'https://a.example/k' }]);
  });

  it('ignores endpoints that are not text', () => {
    expect(parseDiscovery(json({ token_endpoint: 42 })).endpoints.map((e) => e.name)).not.toContain('token_endpoint');
  });

  it('rejects malformed JSON', () => {
    expect(() => parseDiscovery('{"issuer":')).toThrow('Malformed JSON');
  });

  it('rejects JSON without an issuer', () => {
    expect(() => parseDiscovery('{"keys":[]}')).toThrow('Not a discovery document');
    expect(() => parseDiscovery('[1,2]')).toThrow('Not a discovery document');
    expect(() => parseDiscovery('null')).toThrow('Not a discovery document');
  });
});

describe('discoveryUrl', () => {
  it('adds the well-known path to an issuer', () => {
    expect(discoveryUrl('https://login.example.com/realms/demo')).toBe(
      'https://login.example.com/realms/demo/.well-known/openid-configuration',
    );
  });

  it('does not double the slash', () => {
    expect(discoveryUrl('https://login.example.com/')).toBe('https://login.example.com/.well-known/openid-configuration');
  });

  it('leaves a discovery address as it is', () => {
    const url = 'https://login.example.com/.well-known/openid-configuration';
    expect(discoveryUrl(url)).toBe(url);
  });

  it('leaves an OAuth authorization server metadata address as it is', () => {
    const url = 'https://login.example.com/.well-known/oauth-authorization-server';
    expect(discoveryUrl(url)).toBe(url);
  });
});

describe('checkDiscovery', () => {
  it('finds nothing in a consistent document', () => {
    const source = 'https://login.example.com/realms/demo/.well-known/openid-configuration';
    expect(checkDiscovery(parseDiscovery(json()), source)).toEqual([]);
  });

  it('reports an issuer that does not match the address it was read from', () => {
    const source = 'https://other.example.com/.well-known/openid-configuration';
    expect(checkDiscovery(parseDiscovery(json()), source)).toEqual([
      { code: 'issuerMismatch', detail: 'https://login.example.com/realms/demo' },
    ]);
  });

  it('ignores a trailing slash when comparing the issuer', () => {
    const discovery = parseDiscovery(json({ issuer: 'https://login.example.com/' }));
    expect(checkDiscovery(discovery, 'https://login.example.com/.well-known/openid-configuration')).toEqual([]);
  });

  it('does not check the issuer when the document was pasted', () => {
    expect(checkDiscovery(parseDiscovery(json()))).toEqual([]);
  });

  it('reports endpoints that do not use HTTPS', () => {
    const discovery = parseDiscovery(json({ token_endpoint: 'http://login.example.com/token' }));
    expect(checkDiscovery(discovery)).toEqual([{ code: 'insecureEndpoint', detail: 'token_endpoint' }]);
  });

  it('accepts plain HTTP on localhost', () => {
    const discovery = parseDiscovery(
      JSON.stringify({ issuer: 'http://localhost:8080', token_endpoint: 'http://localhost:8080/token' }),
    );
    expect(checkDiscovery(discovery)).toEqual([]);
  });
});

describe('parseJwks', () => {
  const n2048 = 'A'.repeat(342);

  it('describes RSA, EC and OKP keys', () => {
    const keys = parseJwks(
      JSON.stringify({
        keys: [
          { kty: 'RSA', kid: 'r1', use: 'sig', alg: 'RS256', n: n2048, e: 'AQAB' },
          { kty: 'EC', kid: 'e1', use: 'enc', crv: 'P-256', x: 'x', y: 'y' },
          { kty: 'OKP', crv: 'Ed25519', x: 'x' },
        ],
      }),
    );
    expect(keys).toEqual([
      { kid: 'r1', type: 'RSA 2048', use: 'sig', alg: 'RS256' },
      { kid: 'e1', type: 'EC P-256', use: 'enc' },
      { type: 'OKP Ed25519' },
    ]);
  });

  it('reads the certificate published with a key', () => {
    const [key] = parseJwks(JSON.stringify({ keys: [{ kty: 'EC', crv: 'P-256', x5c: [EC_CERT] }] }));
    expect(key.certificate?.subject).toBe('old.example.com');
  });

  it('ignores a certificate that cannot be read', () => {
    const [key] = parseJwks(JSON.stringify({ keys: [{ kty: 'EC', crv: 'P-256', x5c: ['AAAA'] }] }));
    expect(key).toEqual({ type: 'EC P-256' });
  });

  it('rejects JSON that is not a key set', () => {
    expect(() => parseJwks('{"issuer":"x"}')).toThrow('Not a key set');
    expect(() => parseJwks('{')).toThrow('Malformed JSON');
  });
});
