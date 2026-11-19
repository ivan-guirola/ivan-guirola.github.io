export interface SamlSummary {
  type: string;
  id?: string;
  issueInstant?: string;
  issuer?: string;
  destination?: string;
  acsUrl?: string;
  status?: string;
  nameId?: string;
  nameIdFormat?: string;
  audiences: string[];
  notBefore?: string;
  notOnOrAfter?: string;
  sessionIndex?: string;
  attributes: { name: string; values: string[] }[];
  signed: { message: boolean; assertion: boolean };
  encrypted: boolean;
}

const MESSAGES = ['Response', 'AuthnRequest', 'LogoutRequest', 'LogoutResponse', 'Assertion'];

const lastSegment = (value: string | undefined) => value?.split(/[:/]/).pop() || undefined;
const content = (element: Element | undefined) => element?.textContent?.trim() || undefined;
const attribute = (element: Element | undefined, name: string) => element?.getAttribute(name) ?? undefined;

export function parseSaml(xml: string): SamlSummary {
  const document = new DOMParser().parseFromString(xml, 'application/xml');
  if (document.getElementsByTagName('parsererror').length > 0) throw new Error('Malformed XML');

  const root = document.documentElement;
  if (!MESSAGES.includes(root.localName) || !root.namespaceURI?.includes('urn:oasis:names:tc:SAML')) {
    throw new Error('Not a SAML message');
  }

  const all = Array.from(document.getElementsByTagName('*'));
  const first = (name: string) => all.find((element) => element.localName === name);
  const every = (name: string) => all.filter((element) => element.localName === name);
  const child = (parent: Element | undefined, name: string) =>
    Array.from(parent?.children ?? []).find((element) => element.localName === name);

  const assertion = root.localName === 'Assertion' ? root : first('Assertion');
  const nameId = first('NameID');
  const conditions = first('Conditions');

  return {
    type: root.localName,
    id: attribute(root, 'ID'),
    issueInstant: attribute(root, 'IssueInstant'),
    issuer: content(child(root, 'Issuer') ?? first('Issuer')),
    destination: attribute(root, 'Destination'),
    acsUrl: attribute(root, 'AssertionConsumerServiceURL'),
    status: lastSegment(attribute(first('StatusCode'), 'Value')),
    nameId: content(nameId),
    nameIdFormat: lastSegment(attribute(nameId, 'Format')),
    audiences: every('Audience').map((element) => content(element) ?? ''),
    notBefore: attribute(conditions, 'NotBefore'),
    notOnOrAfter: attribute(conditions, 'NotOnOrAfter'),
    sessionIndex: attribute(first('AuthnStatement'), 'SessionIndex'),
    attributes: every('Attribute').map((element) => ({
      name: element.getAttribute('FriendlyName') ?? element.getAttribute('Name') ?? '',
      values: Array.from(element.children)
        .filter((value) => value.localName === 'AttributeValue')
        .map((value) => value.textContent?.trim() ?? ''),
    })),
    signed: {
      message: child(root, 'Signature') !== undefined && root !== assertion,
      assertion: child(assertion, 'Signature') !== undefined,
    },
    encrypted: first('EncryptedAssertion') !== undefined,
  };
}

export type SamlValidity = 'valid' | 'expired' | 'notYetValid' | 'noWindow';

export function samlValidity(summary: SamlSummary, now: number): SamlValidity {
  const start = summary.notBefore ? Date.parse(summary.notBefore) : NaN;
  const end = summary.notOnOrAfter ? Date.parse(summary.notOnOrAfter) : NaN;
  if (Number.isNaN(start) && Number.isNaN(end)) return 'noWindow';
  if (now >= end) return 'expired';
  if (now < start) return 'notYetValid';
  return 'valid';
}

export function formatXml(xml: string): string {
  let depth = 0;
  return xml
    .trim()
    .replace(/>\s+</g, '><')
    .replace(/></g, '>\n<')
    .split('\n')
    .map((line) => {
      if (line.startsWith('</')) depth = Math.max(depth - 1, 0);
      const out = '  '.repeat(depth) + line;
      const opens = /^<[^!?/]/.test(line) && !line.endsWith('/>') && !line.includes('</');
      if (opens) depth += 1;
      return out;
    })
    .join('\n');
}
