import { GRANT_TYPES, type Grant, type TokenScenario } from './token';
import type { Answer, NodeScenario } from './node';

/** Legacy Scripted Decision node scripts, written the way they are found in older AM deployments. */

export interface NodeSample {
  id: string;
  title: string;
  summary: string;
  code: string;
  scenario: NodeScenario;
  answers?: Answer[];
}

const base = (fields: Partial<NodeScenario>): NodeScenario => ({
  outcomes: ['true', 'false'],
  shared: {},
  transient: {},
  users: {},
  headers: {},
  parameters: {},
  cookies: {},
  http: [],
  ...fields,
});

const USERS = {
  bjensen: { givenName: ['Barbara'], mail: ['bjensen@example.com'], department: ['Sales'] },
  scarter: { givenName: ['Sam'], mail: ['scarter@example.com'] },
};

export const NODE_SAMPLES: NodeSample[] = [
  {
    id: 'login',
    title: 'Sign-in form',
    summary: 'Asks for the username and password and keeps them for the next nodes.',
    code: `var fr = JavaImporter(
  org.forgerock.openam.auth.node.api.Action,
  javax.security.auth.callback.NameCallback,
  javax.security.auth.callback.PasswordCallback,
  java.lang.String
);

if (callbacks.isEmpty()) {
  action = fr.Action.send(
    new fr.NameCallback("User Name"),
    new fr.PasswordCallback("Password", false)
  ).build();
} else {
  var username = fr.String(callbacks.get(0).getName());
  var password = fr.String(callbacks.get(1).getPassword());

  sharedState.put("username", username);
  if (!password) {
    action = fr.Action.goTo("false").withErrorMessage("Enter your password.").build();
  } else {
    transientState.put("password", password);
    logger.message("Credentials collected for {}", username);
    action = fr.Action.goTo("true").build();
  }
}
`,
    scenario: base({}),
    answers: ['bjensen', 'Ch4ngeit!'],
  },
  {
    id: 'risk',
    title: 'Ask a risk service',
    summary: 'Sends the user and IP address to an external API and chooses the path from its score.',
    code: `var fr = JavaImporter(org.forgerock.openam.auth.node.api.Action);

var username = nodeState.get("username").asString();
var password = secrets.getGenericSecret("scripted.node.risk.password").getAsUtf8();
var credentials = java.util.Base64.getEncoder().encodeToString(
  new java.lang.String("journeys:" + password).getBytes()
);

var request = new org.forgerock.http.protocol.Request();
request.setUri("https://risk.example.com/v1/score");
request.setMethod("POST");
request.getHeaders().add("Content-Type", "application/json");
request.getHeaders().add("Authorization", "Basic " + credentials);
request.setEntity(JSON.stringify({
  user: username,
  ip: requestHeaders.get("X-Forwarded-For").get(0)
}));

var response = httpClient.send(request).get();

if (response.getStatus().getCode() === 200) {
  var score = JSON.parse(response.getEntity().getString()).score;
  sharedState.put("riskScore", score);
  logger.message("Risk score for {}: {}", username, score);
  action = fr.Action.goTo(score > 70 ? "high" : "low").build();
} else {
  logger.error("The risk service answered " + response.getStatus().getCode());
  action = fr.Action.goTo("error").build();
}
`,
    scenario: base({
      outcomes: ['low', 'high', 'error'],
      shared: { username: 'bjensen' },
      headers: { 'X-Forwarded-For': ['203.0.113.24'] },
      secrets: { 'scripted.node.risk.password': 'r1sk-s3cret' },
      http: [{ url: 'https://risk.example.com/v1/score', method: 'POST', status: 200, body: { score: 82, reasons: ['new device', 'unusual country'] } }],
    }),
  },
  {
    id: 'profile',
    title: 'Check the user profile',
    summary: 'Reads the department from the profile and records which channel the user signed in from.',
    code: `var fr = JavaImporter(org.forgerock.openam.auth.node.api.Action);

var username = nodeState.get("username").asString();
var department = idRepository.getAttribute(username, "department");

if (department.isEmpty()) {
  action = fr.Action.goTo("false")
    .withErrorMessage("Your account has no department. Contact the service desk.")
    .build();
} else {
  sharedState.put("department", department.iterator().next());

  var channel = requestParameters.get("channel");
  if (channel !== null) {
    idRepository.setAttribute(username, "lastChannel", [String(channel.get(0))]);
  }
  action = fr.Action.goTo("true").build();
}
`,
    scenario: base({
      shared: { username: 'bjensen' },
      users: USERS,
      parameters: { channel: ['mobile-app'] },
    }),
  },
  {
    id: 'mfa',
    title: 'Choose how to confirm it is you',
    summary: 'Shows a message and a choice, then follows the path of the method the user picked.',
    code: `var fr = JavaImporter(
  org.forgerock.openam.auth.node.api.Action,
  javax.security.auth.callback.ChoiceCallback,
  javax.security.auth.callback.TextOutputCallback
);

var methods = ["Authenticator app", "Text message", "Email"];
var paths = ["otp", "sms", "email"];

if (callbacks.isEmpty()) {
  var name = nodeState.get("givenName");
  action = fr.Action.send(
    new fr.TextOutputCallback(fr.TextOutputCallback.INFORMATION,
      "Hello " + (name ? name.asString() : "") + ", choose how to confirm it is you."),
    new fr.ChoiceCallback("Method", methods, 0, false)
  ).build();
} else {
  var selected = callbacks.get(1).getSelectedIndexes()[0];
  sharedState.put("mfaMethod", paths[selected]);
  action = fr.Action.goTo(paths[selected]).build();
}
`,
    scenario: base({ outcomes: ['otp', 'sms', 'email'], shared: { username: 'bjensen', givenName: 'Barbara' } }),
    answers: [null, [1]],
  },
];

/** Legacy OAuth2 Access Token Modification scripts. */

export interface TokenSample {
  id: string;
  title: string;
  summary: string;
  code: string;
}

export const TOKEN_SAMPLES: TokenSample[] = [
  {
    id: 'profile',
    title: 'Add profile data',
    summary: 'Copies the email address and phone number from the user profile into the token.',
    code: `// Adds the user's email address and phone number to the token.
if (identity != null) {
  accessToken.setField("mail", identity.getAttribute("mail"));
  accessToken.setField("phone", identity.getAttribute("telephoneNumber").iterator().next());
}

// The session is only there when the user signed in through the browser.
if (session) {
  accessToken.setField("ipAddress", session.getProperty("Host"));
}
`,
  },
  {
    id: 'external',
    title: 'Ask an external service',
    summary: 'Calls an entitlements API and adds the plan and regions it returns.',
    code: `var subject = accessToken.getResourceOwnerId();

var request = new org.forgerock.http.protocol.Request();
request.setUri("https://entitlements.example.com/v1/subjects/" + subject);
request.setMethod("GET");
request.getHeaders().add("Accept", "application/json");

var response = httpClient.send(request).getOrThrow();

if (response.getStatus() === org.forgerock.http.protocol.Status.OK) {
  var entitlements = JSON.parse(response.getEntity().getString());
  accessToken.setField("plan", entitlements.plan);
  accessToken.setField("regions", entitlements.regions);
} else {
  logger.error("No entitlements for {}: {}", subject, response.getStatus());
}
`,
  },
  {
    id: 'lifetime',
    title: 'Shorter tokens for one client',
    summary: 'Reads a lifetime from the client’s custom properties and sets an earlier expiry.',
    code: `// Custom property on the client: tokenLifetimeSeconds=300
var custom = clientProperties.get("customProperties");
var lifetime = custom.get("tokenLifetimeSeconds");

if (lifetime !== null) {
  accessToken.setExpiryTime(new Date().getTime() + Number(lifetime) * 1000);
  logger.message("Token lifetime for {} set to {} seconds",
    clientProperties.get("clientId"), lifetime);
}
`,
  },
  {
    id: 'response',
    title: 'Data for the client only',
    summary: 'Adds values next to the token in the response, which the token itself does not carry.',
    code: `var fr = JavaImporter(org.forgerock.json.JsonValue);

var locales = requestProperties.get("requestParams").get("ui_locales");
accessToken.addExtraData("ui_locale", function () {
  return locales !== null ? String(locales.get(0)) : "en";
});

if (scopes.contains("payments")) {
  accessToken.addExtraJsonData("payment_limits", function () {
    return fr.JsonValue.json({ daily: 2000, currency: "EUR" });
  });
}
`,
  },
];

export const TOKEN_PEOPLE = {
  bjensen: { mail: ['bjensen@example.com'], telephoneNumber: ['+44 117 496 0228'], givenName: ['Barbara'] },
  scarter: { mail: ['scarter@example.com'], givenName: ['Sam'] },
} satisfies Record<string, Record<string, string[]>>;

export type TokenPerson = keyof typeof TOKEN_PEOPLE;

/** The request behind the token: who signed in, with which grant, from which client. */
export function tokenScenario(grant: Grant, person: TokenPerson, now: number): TokenScenario {
  const signedIn = grant === 'authorization_code';
  return {
    grant,
    user: grant === 'jwt_bearer' ? null : grant === 'client_credentials' ? { name: 'reporting-app', attributes: {} } : { name: person, attributes: TOKEN_PEOPLE[person] },
    client: {
      clientId: grant === 'client_credentials' ? 'reporting-app' : 'banking-web',
      customProperties: { tokenLifetimeSeconds: '300', tier: 'gold' },
      allowedScopes: ['openid', 'profile', 'accounts', 'payments'],
      redirectUris: ['https://banking.example.com/callback'],
    },
    scopes: grant === 'client_credentials' ? ['accounts'] : ['profile', 'accounts', 'payments'],
    requestParams: {
      grant_type: [GRANT_TYPES[grant]],
      ...(signedIn ? { code: ['N3aJp0WwX3m5hY'], redirect_uri: ['https://banking.example.com/callback'], ui_locales: ['es-ES'] } : {}),
    },
    requestHeaders: { 'X-Forwarded-For': ['203.0.113.24'], 'User-Agent': ['Mozilla/5.0'] },
    session: signedIn ? { Host: '203.0.113.24', AuthLevel: '1', Service: 'Login' } : null,
    http: [
      { url: 'https://entitlements.example.com/v1/subjects/bjensen', method: 'GET', status: 200, body: { plan: 'premium', regions: ['eu', 'uk'] } },
      { url: 'https://entitlements.example.com/v1/subjects/scarter', method: 'GET', status: 200, body: { plan: 'basic', regions: ['eu'] } },
    ],
    now,
    lifetime: 3600,
  };
}
