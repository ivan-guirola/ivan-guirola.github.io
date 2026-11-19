import { parseCertificate, type Certificate } from './certificate';

export interface Endpoint {
  service: string;
  binding: string;
  location: string;
  index?: number;
  isDefault?: boolean;
}

export interface MetadataKey {
  use: 'signing' | 'encryption' | 'both';
  certificate?: Certificate;
  source?: string;
  error?: string;
}

export interface Role {
  kind: 'idp' | 'sp';
  endpoints: Endpoint[];
  keys: MetadataKey[];
  nameIdFormats: string[];
  wantsRequestsSigned?: boolean;
  signsRequests?: boolean;
  wantsAssertionsSigned?: boolean;
}

export interface Entity {
  entityId: string;
  validUntil?: string;
  roles: Role[];
}

const NAMESPACE = 'urn:oasis:names:tc:SAML:2.0:metadata';
const ROLES: Record<string, Role['kind']> = { IDPSSODescriptor: 'idp', SPSSODescriptor: 'sp' };

const childrenOf = (parent: Element, name?: string) =>
  Array.from(parent.children).filter((element) => !name || element.localName === name);
const flag = (element: Element, name: string) =>
  element.hasAttribute(name) ? element.getAttribute(name) === 'true' : undefined;
const lastSegment = (value: string) => value.split(/[:/]/).pop() ?? value;

function keyOf(descriptor: Element): MetadataKey {
  const use = descriptor.getAttribute('use');
  const source = Array.from(descriptor.getElementsByTagName('*'))
    .find((element) => element.localName === 'X509Certificate')
    ?.textContent?.replace(/\s+/g, '');
  const key: MetadataKey = { use: use === 'signing' || use === 'encryption' ? use : 'both', source };
  try {
    key.certificate = parseCertificate(source ?? '');
  } catch (error) {
    key.error = (error as Error).message;
  }
  return key;
}

function endpointOf(element: Element): Endpoint {
  const endpoint: Endpoint = {
    service: element.localName,
    binding: element.getAttribute('Binding')!.split('bindings:').pop()!,
    location: element.getAttribute('Location') ?? '',
  };
  if (element.hasAttribute('index')) endpoint.index = Number(element.getAttribute('index'));
  if (element.getAttribute('isDefault') === 'true') endpoint.isDefault = true;
  return endpoint;
}

function roleOf(descriptor: Element): Role {
  const kind = ROLES[descriptor.localName];
  const role: Role = {
    kind,
    endpoints: childrenOf(descriptor)
      .filter((element) => element.hasAttribute('Binding'))
      .map(endpointOf),
    keys: childrenOf(descriptor, 'KeyDescriptor').map(keyOf),
    nameIdFormats: childrenOf(descriptor, 'NameIDFormat').map((element) => lastSegment(element.textContent!.trim())),
  };
  if (kind === 'idp') role.wantsRequestsSigned = flag(descriptor, 'WantAuthnRequestsSigned');
  else {
    role.signsRequests = flag(descriptor, 'AuthnRequestsSigned');
    role.wantsAssertionsSigned = flag(descriptor, 'WantAssertionsSigned');
  }
  return role;
}

function entityOf(element: Element): Entity {
  return {
    entityId: element.getAttribute('entityID') ?? '',
    validUntil: element.getAttribute('validUntil') ?? undefined,
    roles: childrenOf(element)
      .filter((child) => child.localName in ROLES)
      .map(roleOf),
  };
}

export function parseSamlMetadata(xml: string): Entity[] {
  const document = new DOMParser().parseFromString(xml, 'application/xml');
  if (document.getElementsByTagName('parsererror').length > 0) throw new Error('Malformed XML');

  const root = document.documentElement;
  const known = root.localName === 'EntityDescriptor' || root.localName === 'EntitiesDescriptor';
  if (!known || root.namespaceURI !== NAMESPACE) throw new Error('Not SAML metadata');

  const entities =
    root.localName === 'EntityDescriptor'
      ? [root]
      : Array.from(root.getElementsByTagName('*')).filter((element) => element.localName === 'EntityDescriptor');
  return entities.map(entityOf);
}
