import { describe, expect, it } from 'vitest';
import { tokenScenario } from './samples';
import { encodeJwt, ISSUER, nativeClaims, runToken } from './token';

const NOW = 1795161600;
const signedIn = () => tokenScenario('authorization_code', 'bjensen', NOW);
const decode = (jwt: string) => JSON.parse(Buffer.from(jwt.split('.')[1], 'base64url').toString('utf8'));

describe('nativeClaims', () => {
  it('writes the claims of a client-side token in AM’s order', () => {
    const claims = nativeClaims(signedIn());
    expect(Object.keys(claims)).toEqual([
      'sub', 'cts', 'auth_level', 'auditTrackingId', 'subname', 'iss', 'tokenName', 'token_type', 'authGrantId',
      'aud', 'nbf', 'grant_type', 'scope', 'auth_time', 'realm', 'exp', 'iat', 'expires_in', 'jti',
    ]);
    expect(claims).toMatchObject({ sub: 'bjensen', iss: ISSUER, aud: 'banking-web', exp: NOW + 3600, scope: ['profile', 'accounts', 'payments'] });
    expect(nativeClaims(tokenScenario('client_credentials', 'bjensen', NOW))).toMatchObject({ sub: '(usr!reporting-app)', subname: 'reporting-app' });
  });
});

describe('runToken', () => {
  it('issues the token unchanged when the script does nothing', () => {
    const result = runToken('// nothing to do', 'next', signedIn());
    expect(result).toMatchObject({ status: 'issued', added: [], changed: [], removed: [], extra: {} });
    expect(decode(result.jwt)).toEqual(result.native);
    expect(result.size).toBe(result.nativeSize);
  });

  it('puts setField() in the token and the introspection, and addExtraData() only in the response', () => {
    const result = runToken('accessToken.setField("tier", "gold");\naccessToken.addExtraData("hint", "x");', 'next', signedIn());
    expect(result.added).toEqual(['tier']);
    expect(decode(result.jwt).tier).toBe('gold');
    expect(result.introspection.tier).toBe('gold');
    expect(result.response).toMatchObject({ hint: 'x', token_type: 'Bearer', scope: 'profile accounts payments' });
    expect(decode(result.jwt)).not.toHaveProperty('hint');
    expect(Object.keys(result.response)[0]).toBe('access_token');
  });

  it('flags native claims that were changed or removed', () => {
    const result = runToken('accessToken.setField("aud", "other");\naccessToken.removeTokenName();\naccessToken.setScope(["profile"]);', 'next', signedIn());
    expect(result.changed).toEqual(['aud', 'scope']);
    expect(result.removed).toEqual(['tokenName']);
    expect(result.response.scope).toBe('profile');
  });

  it('moves the expiry and the expires_in that clients read', () => {
    const result = runToken(`accessToken.setExpiryTime((${NOW} + 300) * 1000);`, 'next', signedIn());
    expect(result.claims).toMatchObject({ exp: NOW + 300, expires_in: 300 });
    expect(result.response.expires_in).toBe(300);
  });

  it('gives legacy scripts Java sets and JsonValue', () => {
    const code = `var scope = accessToken.getScope();
accessToken.setField("count", scope.size());
accessToken.setField("mails", identity.getAttributes(["mail"]).get("mail"));
accessToken.setField("asList", scope.toArray());
accessToken.addExtraJsonData("perm", function () { return org.forgerock.json.JsonValue.json({ a: 1 }); });`;
    const result = runToken(code, 'legacy', signedIn());
    expect(result.claims).toMatchObject({ count: 3, mails: ['bjensen@example.com'], asList: ['profile', 'accounts', 'payments'] });
    expect(result.extra).toEqual({ perm: { a: 1 } });
  });

  it('fails like AM when a legacy script reads a missing identity', () => {
    const result = runToken('accessToken.setField("mail", identity.getAttribute("mail"));', 'legacy', tokenScenario('jwt_bearer', 'bjensen', NOW));
    expect(result).toMatchObject({ status: 'error', error: { message: expect.stringMatching(/TypeError/), line: 1 } });
    expect(result.jwt).toBe(encodeJwt(result.native));
  });

  it('tells next-generation scripts whether the identity exists', () => {
    const code = 'accessToken.setField("known", identity.exists());\nidentity.setAttribute("seen", ["yes"]);';
    expect(runToken(code, 'next', tokenScenario('jwt_bearer', 'bjensen', NOW)).claims.known).toBe(false);
    const result = runToken(`${code}\nidentity.store();`, 'next', signedIn());
    expect(result.profile).toEqual([{ user: 'bjensen', attribute: 'seen', values: ['yes'], saved: true }]);
    expect(runToken('identity.store();', 'next', tokenScenario('jwt_bearer', 'bjensen', NOW)).error!.message).toMatch(/not a known identity/);
  });

  it('keeps unsaved profile changes visible', () => {
    const result = runToken('identity.addAttribute("seen", "yes");', 'next', signedIn());
    expect(result.profile).toEqual([{ user: 'bjensen', attribute: 'seen', values: ['yes'], saved: false }]);
    const legacy = runToken('identity.addAttribute("seen", "yes");', 'legacy', signedIn());
    expect(legacy.profile[0].saved).toBe(true);
  });

  it('has a session only when the user signed in through the browser', () => {
    const code = 'accessToken.setField("ip", session ? session.getProperty("Host") : "none");';
    expect(runToken(code, 'legacy', signedIn()).claims.ip).toBe('203.0.113.24');
    expect(runToken(code, 'next', tokenScenario('client_credentials', 'bjensen', NOW)).claims.ip).toBe('none');
  });

  it('reads the client and request properties', () => {
    const code = `accessToken.setField("tier", clientProperties.get("customProperties").get("tier"));
accessToken.setField("ip", requestProperties.requestHeaders["X-Forwarded-For"][0]);
accessToken.setField("locale", requestProperties.get("requestParams").get("ui_locales").get(0));
accessToken.setFields({ realm2: requestProperties.get("realm") });`;
    expect(runToken(code, 'next', signedIn()).claims).toMatchObject({ tier: 'gold', ip: '203.0.113.24', locale: 'es-ES', realm2: '/alpha' });
  });

  it('answers the getters of the AccessToken interface', () => {
    const code = `accessToken.setField("x", [accessToken.getClientId(), accessToken.getResourceOwnerId(), accessToken.getRealm(), accessToken.getGrantType(),
  accessToken.getTokenType(), accessToken.getTokenName(), accessToken.getAuthLevel(), accessToken.getExpiryTime() > 0,
  accessToken.getTokenId().length > 0, accessToken.getAuditTrackingId().length > 0, accessToken.getAuthGrantId().length > 0, accessToken.getAuthTimeSeconds()]);
accessToken.setField("custom", accessToken.getCustomFields().size());
accessToken.setField("all", accessToken.toMap().get("iss"));`;
    const result = runToken(code, 'next', signedIn());
    expect(result.claims.x).toEqual(['banking-web', 'bjensen', '/alpha', 'authorization_code', 'Bearer', 'access_token', 1, true, true, true, true, NOW]);
    expect(result.claims).toMatchObject({ custom: 1, all: ISSUER });
  });
});
