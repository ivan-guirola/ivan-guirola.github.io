// @vitest-environment jsdom
import { describe, expect, it } from 'vitest';
import { EC_CERT, RSA_CERT } from './samples';
import { parseSamlMetadata } from './saml';

const MD = 'xmlns:md="urn:oasis:names:tc:SAML:2.0:metadata"';
const DS = 'xmlns:ds="http://www.w3.org/2000/09/xmldsig#"';
const BINDING = 'urn:oasis:names:tc:SAML:2.0:bindings';

const key = (certificate: string, use?: string) =>
  `<md:KeyDescriptor${use ? ` use="${use}"` : ''}><ds:KeyInfo><ds:X509Data><ds:X509Certificate>${certificate}</ds:X509Certificate></ds:X509Data></ds:KeyInfo></md:KeyDescriptor>`;

const idp = `<?xml version="1.0"?>
<md:EntityDescriptor ${MD} ${DS} entityID="https://idp.example.com/saml" validUntil="2030-01-01T00:00:00Z">
  <md:IDPSSODescriptor WantAuthnRequestsSigned="true" protocolSupportEnumeration="urn:oasis:names:tc:SAML:2.0:protocol">
    ${key(RSA_CERT, 'signing')}
    ${key(EC_CERT, 'encryption')}
    <md:SingleLogoutService Binding="${BINDING}:HTTP-Redirect" Location="https://idp.example.com/slo"/>
    <md:NameIDFormat>urn:oasis:names:tc:SAML:1.1:nameid-format:emailAddress</md:NameIDFormat>
    <md:NameIDFormat>urn:oasis:names:tc:SAML:2.0:nameid-format:persistent</md:NameIDFormat>
    <md:SingleSignOnService Binding="${BINDING}:HTTP-Redirect" Location="https://idp.example.com/sso"/>
    <md:SingleSignOnService Binding="${BINDING}:HTTP-POST" Location="https://idp.example.com/sso"/>
  </md:IDPSSODescriptor>
</md:EntityDescriptor>`;

const sp = `<EntityDescriptor xmlns="urn:oasis:names:tc:SAML:2.0:metadata" ${DS} entityID="https://app.example.com">
  <SPSSODescriptor AuthnRequestsSigned="false" WantAssertionsSigned="true" protocolSupportEnumeration="urn:oasis:names:tc:SAML:2.0:protocol">
    ${key(RSA_CERT).replaceAll('md:', '')}
    <AssertionConsumerService Binding="${BINDING}:HTTP-POST" Location="https://app.example.com/acs" index="0" isDefault="true"/>
    <AssertionConsumerService Binding="${BINDING}:HTTP-Artifact" Location="https://app.example.com/acs2" index="1"/>
  </SPSSODescriptor>
</EntityDescriptor>`;

describe('parseSamlMetadata', () => {
  it('reads the entity of an identity provider', () => {
    const [entity] = parseSamlMetadata(idp);
    expect(entity.entityId).toBe('https://idp.example.com/saml');
    expect(entity.validUntil).toBe('2030-01-01T00:00:00Z');
    expect(entity.roles).toHaveLength(1);
    expect(entity.roles[0].kind).toBe('idp');
  });

  it('lists endpoints with a short binding name', () => {
    const [role] = parseSamlMetadata(idp)[0].roles;
    expect(role.endpoints).toEqual([
      { service: 'SingleLogoutService', binding: 'HTTP-Redirect', location: 'https://idp.example.com/slo' },
      { service: 'SingleSignOnService', binding: 'HTTP-Redirect', location: 'https://idp.example.com/sso' },
      { service: 'SingleSignOnService', binding: 'HTTP-POST', location: 'https://idp.example.com/sso' },
    ]);
  });

  it('reads each key with its use and its certificate', () => {
    const [role] = parseSamlMetadata(idp)[0].roles;
    expect(role.keys.map((k) => [k.use, k.certificate?.subject])).toEqual([
      ['signing', 'idp.example.com'],
      ['encryption', 'old.example.com'],
    ]);
  });

  it('reads name ID formats by their last segment', () => {
    expect(parseSamlMetadata(idp)[0].roles[0].nameIdFormats).toEqual(['emailAddress', 'persistent']);
  });

  it('reads the signing requirements of an identity provider', () => {
    expect(parseSamlMetadata(idp)[0].roles[0].wantsRequestsSigned).toBe(true);
  });

  it('reads a service provider without namespace prefixes', () => {
    const [entity] = parseSamlMetadata(sp);
    const [role] = entity.roles;
    expect(entity.entityId).toBe('https://app.example.com');
    expect(entity.validUntil).toBeUndefined();
    expect(role.kind).toBe('sp');
    expect(role.signsRequests).toBe(false);
    expect(role.wantsAssertionsSigned).toBe(true);
    expect(role.endpoints).toEqual([
      { service: 'AssertionConsumerService', binding: 'HTTP-POST', location: 'https://app.example.com/acs', index: 0, isDefault: true },
      { service: 'AssertionConsumerService', binding: 'HTTP-Artifact', location: 'https://app.example.com/acs2', index: 1 },
    ]);
  });

  it('treats a key with no use as valid for both', () => {
    expect(parseSamlMetadata(sp)[0].roles[0].keys[0].use).toBe('both');
  });

  it('keeps a key whose certificate cannot be read, with the error', () => {
    const broken = idp.replace(RSA_CERT, 'AAAA');
    const [first] = parseSamlMetadata(broken)[0].roles[0].keys;
    expect(first.certificate).toBeUndefined();
    expect(first.error).toBe('Not a certificate');
  });

  it('reads every entity of an EntitiesDescriptor', () => {
    const strip = (xml: string) => xml.replace(/<\?xml[^>]*\?>/, '');
    const both = `<md:EntitiesDescriptor ${MD}>${strip(idp)}${sp}</md:EntitiesDescriptor>`;
    expect(parseSamlMetadata(both).map((e) => e.entityId)).toEqual([
      'https://idp.example.com/saml',
      'https://app.example.com',
    ]);
  });

  it('reads an entity that is both identity provider and service provider', () => {
    const both = idp.replace(
      '</md:EntityDescriptor>',
      `<md:SPSSODescriptor protocolSupportEnumeration="x"><md:AssertionConsumerService Binding="${BINDING}:HTTP-POST" Location="https://idp.example.com/acs" index="0"/></md:SPSSODescriptor></md:EntityDescriptor>`,
    );
    expect(parseSamlMetadata(both)[0].roles.map((r) => r.kind)).toEqual(['idp', 'sp']);
  });

  it('rejects malformed XML', () => {
    expect(() => parseSamlMetadata('<md:EntityDescriptor')).toThrow('Malformed XML');
  });

  it('rejects XML that is not SAML metadata', () => {
    expect(() => parseSamlMetadata('<html><body/></html>')).toThrow('Not SAML metadata');
  });

  it('rejects a SAML message that is not metadata', () => {
    const response = '<samlp:Response xmlns:samlp="urn:oasis:names:tc:SAML:2.0:protocol" ID="_1"/>';
    expect(() => parseSamlMetadata(response)).toThrow('Not SAML metadata');
  });
});
