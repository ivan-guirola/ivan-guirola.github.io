export interface Answers {
  actor?: 'person' | 'service' | 'device';
  app?: 'web' | 'spa' | 'native';
  backend?: boolean;
  onBehalf?: boolean;
  exposure?: 'internal' | 'internet';
  sensitive?: boolean;
  offline?: boolean;
}

export type Question = keyof Answers;
export type Flow = 'authorizationCode' | 'deviceCode' | 'clientCredentials' | 'tokenExchange';
export type Extra =
  | 'bff'
  | 'bffAdvised'
  | 'systemBrowser'
  | 'par'
  | 'senderConstrained'
  | 'refresh'
  | 'refreshRotation'
  | 'shortTokens';

export interface Recommendation {
  flow: Flow;
  client: 'confidential' | 'public';
  clientAuth: 'none' | 'secret' | 'key';
  extras: Extra[];
  avoid: ('implicit' | 'password')[];
}

const keepsCredential = (answers: Answers) =>
  answers.actor === 'service' || answers.app === 'web' || (answers.app === 'spa' && answers.backend === true);

export function questionsFor(answers: Answers): Question[] {
  const questions: Question[] = ['actor'];
  if (answers.actor === 'person') {
    questions.push('app');
    if (answers.app === 'spa') questions.push('backend');
  }
  if (answers.actor === 'service') questions.push('onBehalf');
  if (keepsCredential(answers)) questions.push('exposure');
  questions.push('sensitive');
  if (answers.actor !== 'service') questions.push('offline');
  return questions;
}

export function nextQuestion(answers: Answers): Question | null {
  return questionsFor(answers).find((question) => answers[question] === undefined) ?? null;
}

function flowOf(answers: Answers): Flow {
  if (answers.actor === 'device') return 'deviceCode';
  if (answers.actor === 'service') return answers.onBehalf ? 'tokenExchange' : 'clientCredentials';
  return 'authorizationCode';
}

export function recommend(answers: Answers): Recommendation | null {
  if (nextQuestion(answers) !== null) return null;

  const confidential = keepsCredential(answers);
  const person = answers.actor === 'person';
  const wanted: Record<Extra, boolean | undefined> = {
    bff: answers.app === 'spa' && answers.backend,
    bffAdvised: answers.app === 'spa' && !answers.backend && answers.sensitive,
    systemBrowser: answers.app === 'native',
    par: person && answers.sensitive,
    senderConstrained: answers.sensitive,
    refresh: confidential && answers.offline,
    refreshRotation: !confidential && answers.offline,
    shortTokens: !confidential,
  };

  return {
    flow: flowOf(answers),
    client: confidential ? 'confidential' : 'public',
    clientAuth: !confidential ? 'none' : answers.exposure === 'internal' && !answers.sensitive ? 'secret' : 'key',
    extras: (Object.keys(wanted) as Extra[]).filter((extra) => wanted[extra]),
    avoid: person ? ['implicit', 'password'] : answers.actor === 'device' ? ['password'] : [],
  };
}
