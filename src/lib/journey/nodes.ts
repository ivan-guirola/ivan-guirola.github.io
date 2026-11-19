const BOOLEAN = ['true', 'false'];
const SINGLE = ['outcome'];

export const knownOutcomes: Record<string, string[]> = {
  AccountActiveDecisionNode: BOOLEAN,
  AgentDataStoreDecisionNode: BOOLEAN,
  AttributeCollectorNode: SINGLE,
  AttributePresentDecisionNode: BOOLEAN,
  CreateObjectNode: ['CREATED', 'FAILURE'],
  DataStoreDecisionNode: BOOLEAN,
  IdentifyExistingUserNode: BOOLEAN,
  IdentityStoreDecisionNode: ['TRUE', 'FALSE', 'LOCKED', 'CANCELLED', 'EXPIRED'],
  IncrementLoginCountNode: SINGLE,
  InnerTreeEvaluatorNode: BOOLEAN,
  LdapDecisionNode: ['TRUE', 'FALSE', 'LOCKED', 'CANCELLED', 'EXPIRED'],
  MessageNode: BOOLEAN,
  OneTimePasswordCollectorDecisionNode: BOOLEAN,
  OneTimePasswordGeneratorNode: SINGLE,
  OneTimePasswordSmsSenderNode: SINGLE,
  OneTimePasswordSmtpSenderNode: SINGLE,
  PasswordCollectorNode: SINGLE,
  PatchObjectNode: ['PATCHED', 'FAILURE'],
  PersistentCookieDecisionNode: BOOLEAN,
  RetryLimitDecisionNode: ['Retry', 'Reject'],
  SetFailureUrlNode: SINGLE,
  SetPersistentCookieNode: SINGLE,
  SetSuccessUrlNode: SINGLE,
  UsernameCollectorNode: SINGLE,
  ValidatedPasswordNode: SINGLE,
  ValidatedUsernameNode: SINGLE,
  ZeroPageLoginNode: ['true', 'false', 'Referer'],
};

const descriptions: Record<string, string> = {
  AccountActiveDecisionNode: 'Checks that the account is active and not locked.',
  AttributeCollectorNode: 'Asks the user for some details of their profile.',
  AttributePresentDecisionNode: 'Checks whether the user has a value in a given field.',
  ChoiceCollectorNode: 'Lets the user choose between several options.',
  CreateObjectNode: 'Creates a new account with the details collected so far.',
  DataStoreDecisionNode: 'Checks the username and password against the user directory.',
  IdentifyExistingUserNode: 'Looks for an existing account that matches the details given.',
  IdentityStoreDecisionNode: 'Checks the username and password against the user directory.',
  IncrementLoginCountNode: 'Adds one to the number of times the user has signed in.',
  InnerTreeEvaluatorNode: 'Runs another journey and continues with its result.',
  LdapDecisionNode: 'Checks the username and password against an LDAP directory.',
  MessageNode: 'Shows a message and lets the user answer yes or no.',
  OneTimePasswordCollectorDecisionNode: 'Asks for the one-time code and checks it.',
  OneTimePasswordGeneratorNode: 'Creates a one-time code.',
  OneTimePasswordSmsSenderNode: 'Sends the one-time code by text message.',
  OneTimePasswordSmtpSenderNode: 'Sends the one-time code by email.',
  PageNode: 'Shows one screen with the steps inside it.',
  PasswordCollectorNode: 'Asks for the password.',
  PatchObjectNode: 'Updates the account with the details collected so far.',
  PersistentCookieDecisionNode: 'Checks for a cookie that keeps the user signed in.',
  RetryLimitDecisionNode: 'Counts the attempts and stops after the limit.',
  ScriptedDecisionNode: 'Runs a script that decides which way to go.',
  SelectIdPNode: 'Lets the user pick the provider to sign in with.',
  SetFailureUrlNode: 'Sets where the user goes if sign-in fails.',
  SetPersistentCookieNode: 'Sets a cookie that keeps the user signed in.',
  SetSuccessUrlNode: 'Sets where the user goes after signing in.',
  SocialProviderHandlerNode: 'Signs the user in with an external provider.',
  UsernameCollectorNode: 'Asks for the username.',
  ValidatedPasswordNode: 'Asks for the password.',
  ValidatedUsernameNode: 'Asks for the username.',
  WebAuthnAuthenticationNode: 'Signs the user in with a passkey or security key.',
  WebAuthnRegistrationNode: 'Registers a new passkey or security key.',
  ZeroPageLoginNode: 'Reads the username and password from the request headers.',
};

export function describeType(type: string): string | undefined {
  return descriptions[type];
}

export function typeLabel(type: string): string {
  const words = type
    .replace(/Node$/, '')
    .replace(/IdP/g, 'Idp')
    .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
    .replace(/([A-Z]+)([A-Z][a-z])/g, '$1 $2')
    .trim();
  if (!words) return type;
  return words.charAt(0) + words.slice(1).toLowerCase().replace(/\b(idp|ldap|sms|smtp|url|otp)\b/g, (match) => (match === 'idp' ? 'IdP' : match.toUpperCase()));
}

export function outcomeLabel(outcome: string): string {
  if (outcome === 'outcome') return 'Next';
  const lower = outcome.toLowerCase();
  return lower.charAt(0).toUpperCase() + lower.slice(1);
}

const isLocalised = (value: unknown): value is Record<string, string> =>
  typeof value === 'object' &&
  value !== null &&
  !Array.isArray(value) &&
  Object.keys(value).length > 0 &&
  Object.entries(value).every(([key, text]) => /^[a-z]{2}([-_][A-Za-z]{2})?$/.test(key) && typeof text === 'string');

export function formatValue(value: unknown): string {
  if (typeof value === 'string') return value;
  if (isLocalised(value)) {
    const entries = Object.entries(value);
    return entries.length === 1 ? entries[0][1] : entries.map(([lang, text]) => `${lang}: ${text}`).join(' / ');
  }
  if (Array.isArray(value) && value.every((item) => typeof item === 'string')) return value.join(', ');
  return JSON.stringify(value);
}
