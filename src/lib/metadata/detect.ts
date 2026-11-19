export type Input =
  | { kind: 'url'; url: string }
  | { kind: 'saml'; xml: string }
  | { kind: 'oidc'; json: string }
  | { kind: 'jwks'; json: string }
  | { kind: 'unknown' };

export function detectInput(input: string): Input {
  const text = input.trim();
  if (/^https?:\/\/\S+$/.test(text)) return { kind: 'url', url: text };
  if (text.startsWith('<')) {
    return text.includes('urn:oasis:names:tc:SAML:2.0:metadata') ? { kind: 'saml', xml: text } : { kind: 'unknown' };
  }
  if (text.startsWith('{')) {
    try {
      const document = JSON.parse(text);
      if (typeof document.issuer === 'string') return { kind: 'oidc', json: text };
      if (Array.isArray(document.keys)) return { kind: 'jwks', json: text };
    } catch {}
  }
  return { kind: 'unknown' };
}
