// @vitest-environment jsdom
import { describe, expect, it } from 'vitest';
import { formatXml, parseSaml, samlValidity } from './saml';

const P = 'xmlns:samlp="urn:oasis:names:tc:SAML:2.0:protocol"';
const A = 'xmlns:saml="urn:oasis:names:tc:SAML:2.0:assertion"';
const SIG = '<ds:Signature xmlns:ds="http://www.w3.org/2000/09/xmldsig#"><ds:SignedInfo/></ds:Signature>';

const response = ({ messageSigned = false, assertionSigned = true, status = 'Success' } = {}) => `<?xml version="1.0"?>
<samlp:Response ${P} ${A} ID="_r1" IssueInstant="2026-11-16T10:00:00Z" Destination="https://app.test/acs">
  <saml:Issuer>https://idp.test</saml:Issuer>
  ${messageSigned ? SIG : ''}
  <samlp:Status><samlp:StatusCode Value="urn:oasis:names:tc:SAML:2.0:status:${status}"/></samlp:Status>
  <saml:Assertion ID="_a1" IssueInstant="2026-11-16T10:00:00Z">
    <saml:Issuer>https://idp.test</saml:Issuer>
    ${assertionSigned ? SIG : ''}
    <saml:Subject>
      <saml:NameID Format="urn:oasis:names:tc:SAML:1.1:nameid-format:emailAddress">ana@example.com</saml:NameID>
    </saml:Subject>
    <saml:Conditions NotBefore="2026-11-16T09:55:00Z" NotOnOrAfter="2026-11-16T10:05:00Z">
      <saml:AudienceRestriction><saml:Audience>https://app.test</saml:Audience></saml:AudienceRestriction>
    </saml:Conditions>
    <saml:AuthnStatement SessionIndex="_s1"/>
    <saml:AttributeStatement>
      <saml:Attribute Name="email"><saml:AttributeValue>ana@example.com</saml:AttributeValue></saml:Attribute>
      <saml:Attribute Name="urn:oid:1.3.6.1.4.1.5923.1.1.1.7" FriendlyName="roles">
        <saml:AttributeValue>user</saml:AttributeValue>
        <saml:AttributeValue>admin</saml:AttributeValue>
      </saml:Attribute>
    </saml:AttributeStatement>
  </saml:Assertion>
</samlp:Response>`;

describe('parseSaml', () => {
  it('summarises a login response', () => {
    expect(parseSaml(response())).toEqual({
      type: 'Response',
      id: '_r1',
      issueInstant: '2026-11-16T10:00:00Z',
      issuer: 'https://idp.test',
      destination: 'https://app.test/acs',
      status: 'Success',
      nameId: 'ana@example.com',
      nameIdFormat: 'emailAddress',
      audiences: ['https://app.test'],
      notBefore: '2026-11-16T09:55:00Z',
      notOnOrAfter: '2026-11-16T10:05:00Z',
      sessionIndex: '_s1',
      attributes: [
        { name: 'email', values: ['ana@example.com'] },
        { name: 'roles', values: ['user', 'admin'] },
      ],
      signed: { message: false, assertion: true },
      encrypted: false,
    });
  });

  it('tells a signed message from a signed assertion', () => {
    expect(parseSaml(response({ messageSigned: true, assertionSigned: false })).signed).toEqual({ message: true, assertion: false });
    expect(parseSaml(response({ messageSigned: false, assertionSigned: false })).signed).toEqual({ message: false, assertion: false });
  });

  it('reports a failed status', () => {
    expect(parseSaml(response({ status: 'Requester' })).status).toBe('Requester');
  });

  it('summarises a login request', () => {
    const request = `<samlp:AuthnRequest ${P} ${A} ID="_q1" IssueInstant="2026-11-16T10:00:00Z" Destination="https://idp.test/sso" AssertionConsumerServiceURL="https://app.test/acs"><saml:Issuer>https://app.test</saml:Issuer></samlp:AuthnRequest>`;
    expect(parseSaml(request)).toMatchObject({
      type: 'AuthnRequest',
      issuer: 'https://app.test',
      destination: 'https://idp.test/sso',
      acsUrl: 'https://app.test/acs',
      attributes: [],
      audiences: [],
    });
  });

  it('detects an encrypted assertion', () => {
    const xml = `<samlp:Response ${P} ${A} ID="_r"><saml:EncryptedAssertion/></samlp:Response>`;
    expect(parseSaml(xml)).toMatchObject({ encrypted: true, nameId: undefined });
  });

  it('rejects malformed XML', () => {
    expect(() => parseSaml('<samlp:Response')).toThrow(/XML/);
  });

  it('rejects XML that is not a SAML message', () => {
    expect(() => parseSaml('<note><to>Ana</to></note>')).toThrow(/SAML/);
  });
});

describe('samlValidity', () => {
  const summary = parseSaml(response());
  const at = (time: string) => samlValidity(summary, Date.parse(time));

  it('is valid inside the window', () => {
    expect(at('2026-11-16T10:00:00Z')).toBe('valid');
  });

  it('is expired at or after NotOnOrAfter', () => {
    expect(at('2026-11-16T10:05:00Z')).toBe('expired');
  });

  it('is not yet valid before NotBefore', () => {
    expect(at('2026-11-16T09:00:00Z')).toBe('notYetValid');
  });

  it('has no window when the message carries no conditions', () => {
    expect(samlValidity(parseSaml(`<samlp:LogoutRequest ${P} ID="_l"/>`), Date.now())).toBe('noWindow');
  });
});

describe('formatXml', () => {
  it('indents nested elements and keeps text on the same line', () => {
    expect(formatXml('<a><b>text</b><c><d/></c></a>')).toBe('<a>\n  <b>text</b>\n  <c>\n    <d/>\n  </c>\n</a>');
  });

  it('normalises input that is already indented', () => {
    expect(formatXml('<a>\n      <b/>\n</a>')).toBe('<a>\n  <b/>\n</a>');
  });

  it('keeps the XML declaration at the top level', () => {
    expect(formatXml('<?xml version="1.0"?><a><b/></a>')).toBe('<?xml version="1.0"?>\n<a>\n  <b/>\n</a>');
  });
});
