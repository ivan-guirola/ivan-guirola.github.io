import { describe, expect, it } from 'vitest';
import { nextQuestion, questionsFor, recommend, type Answers } from './picker';

describe('nextQuestion', () => {
  it('starts by asking who signs in', () => {
    expect(nextQuestion({})).toBe('actor');
  });

  it('asks a person which kind of application it is', () => {
    expect(nextQuestion({ actor: 'person' })).toBe('app');
  });

  it('asks a browser application whether it has its own server', () => {
    expect(nextQuestion({ actor: 'person', app: 'spa' })).toBe('backend');
  });

  it('asks about exposure only when the application can keep a credential', () => {
    expect(nextQuestion({ actor: 'person', app: 'web' })).toBe('exposure');
    expect(nextQuestion({ actor: 'person', app: 'spa', backend: true })).toBe('exposure');
    expect(nextQuestion({ actor: 'person', app: 'spa', backend: false })).toBe('sensitive');
    expect(nextQuestion({ actor: 'person', app: 'native' })).toBe('sensitive');
    expect(nextQuestion({ actor: 'device' })).toBe('sensitive');
  });

  it('asks a service whether it acts for a user', () => {
    expect(nextQuestion({ actor: 'service' })).toBe('onBehalf');
    expect(nextQuestion({ actor: 'service', onBehalf: false })).toBe('exposure');
  });

  it('asks about long sessions only when a person is involved', () => {
    expect(nextQuestion({ actor: 'person', app: 'native', sensitive: false })).toBe('offline');
    expect(nextQuestion({ actor: 'device', sensitive: false })).toBe('offline');
    expect(nextQuestion({ actor: 'service', onBehalf: false, exposure: 'internal', sensitive: false })).toBeNull();
  });

  it('has nothing left to ask once everything is answered', () => {
    expect(nextQuestion({ actor: 'person', app: 'web', exposure: 'internet', sensitive: true, offline: false })).toBeNull();
  });
});

describe('questionsFor', () => {
  it('lists the questions that apply, in order', () => {
    expect(questionsFor({})).toEqual(['actor', 'sensitive', 'offline']);
    expect(questionsFor({ actor: 'person', app: 'spa', backend: true })).toEqual([
      'actor',
      'app',
      'backend',
      'exposure',
      'sensitive',
      'offline',
    ]);
    expect(questionsFor({ actor: 'service' })).toEqual(['actor', 'onBehalf', 'exposure', 'sensitive']);
  });
});

describe('recommend', () => {
  const cases: [string, Answers, object][] = [
    [
      'a server-side web application inside the company',
      { actor: 'person', app: 'web', exposure: 'internal', sensitive: false, offline: false },
      { flow: 'authorizationCode', client: 'confidential', clientAuth: 'secret', extras: [] },
    ],
    [
      'a server-side web application on the internet',
      { actor: 'person', app: 'web', exposure: 'internet', sensitive: false, offline: true },
      { flow: 'authorizationCode', client: 'confidential', clientAuth: 'key', extras: ['refresh'] },
    ],
    [
      'a browser application with its own server',
      { actor: 'person', app: 'spa', backend: true, exposure: 'internal', sensitive: false, offline: false },
      { flow: 'authorizationCode', client: 'confidential', clientAuth: 'secret', extras: ['bff'] },
    ],
    [
      'a browser application with no server',
      { actor: 'person', app: 'spa', backend: false, sensitive: false, offline: true },
      { flow: 'authorizationCode', client: 'public', clientAuth: 'none', extras: ['refreshRotation', 'shortTokens'] },
    ],
    [
      'a mobile application',
      { actor: 'person', app: 'native', sensitive: false, offline: false },
      { flow: 'authorizationCode', client: 'public', clientAuth: 'none', extras: ['systemBrowser', 'shortTokens'] },
    ],
    [
      'a device with no browser',
      { actor: 'device', sensitive: false, offline: true },
      { flow: 'deviceCode', client: 'public', clientAuth: 'none', extras: ['refreshRotation', 'shortTokens'] },
    ],
    [
      'an internal service calling an API as itself',
      { actor: 'service', onBehalf: false, exposure: 'internal', sensitive: false },
      { flow: 'clientCredentials', client: 'confidential', clientAuth: 'secret', extras: [] },
    ],
    [
      'a service passing a user request along',
      { actor: 'service', onBehalf: true, exposure: 'internet', sensitive: false },
      { flow: 'tokenExchange', client: 'confidential', clientAuth: 'key', extras: [] },
    ],
  ];

  it.each(cases)('recommends for %s', (_, answers, expected) => {
    expect(recommend(answers)).toMatchObject(expected);
  });

  it('uses a key instead of a secret for sensitive data, even inside the company', () => {
    const answers: Answers = { actor: 'service', onBehalf: false, exposure: 'internal', sensitive: true };
    expect(recommend(answers)?.clientAuth).toBe('key');
  });

  it('binds tokens to the client for sensitive data', () => {
    expect(recommend({ actor: 'service', onBehalf: false, exposure: 'internal', sensitive: true })?.extras).toEqual([
      'senderConstrained',
    ]);
  });

  it('adds pushed requests when a person signs in to something sensitive', () => {
    const answers: Answers = { actor: 'person', app: 'web', exposure: 'internet', sensitive: true, offline: false };
    expect(recommend(answers)?.extras).toEqual(['par', 'senderConstrained']);
  });

  it('advises a server for a sensitive browser application that has none', () => {
    const answers: Answers = { actor: 'person', app: 'spa', backend: false, sensitive: true, offline: false };
    expect(recommend(answers)?.extras).toEqual(['bffAdvised', 'par', 'senderConstrained', 'shortTokens']);
  });

  it('warns against the old flows whenever a person signs in', () => {
    expect(recommend({ actor: 'person', app: 'native', sensitive: false, offline: false })?.avoid).toEqual([
      'implicit',
      'password',
    ]);
    expect(recommend({ actor: 'device', sensitive: false, offline: false })?.avoid).toEqual(['password']);
    expect(recommend({ actor: 'service', onBehalf: false, exposure: 'internal', sensitive: false })?.avoid).toEqual([]);
  });

  it('returns nothing while questions remain', () => {
    expect(recommend({})).toBeNull();
    expect(recommend({ actor: 'person', app: 'spa' })).toBeNull();
  });
});
