import { describe, expect, it } from 'vitest';
import { describeType, formatValue, outcomeLabel, typeLabel } from './nodes';

describe('node labels', () => {
  it('turns a node type into words', () => {
    expect(typeLabel('DataStoreDecisionNode')).toBe('Data store decision');
    expect(typeLabel('OneTimePasswordSmtpSenderNode')).toBe('One time password SMTP sender');
    expect(typeLabel('SelectIdPNode')).toBe('Select IdP');
    expect(typeLabel('Node')).toBe('Node');
  });

  it('names outcomes the way people read them', () => {
    expect(outcomeLabel('outcome')).toBe('Next');
    expect(outcomeLabel('true')).toBe('True');
    expect(outcomeLabel('FAILURE')).toBe('Failure');
  });

  it('explains common node types in plain words', () => {
    expect(describeType('RetryLimitDecisionNode')).toBe('Counts the attempts and stops after the limit.');
    expect(describeType('SomethingCustomNode')).toBeUndefined();
  });
});

describe('formatValue', () => {
  it('shows translated texts, lists and other values plainly', () => {
    expect(formatValue({ en: 'Continue' })).toBe('Continue');
    expect(formatValue({ en: 'Yes', es: 'Sí' })).toBe('en: Yes / es: Sí');
    expect(formatValue(['a', 'b'])).toBe('a, b');
    expect(formatValue(5)).toBe('5');
    expect(formatValue({ a: 1 })).toBe('{"a":1}');
    expect(formatValue('x')).toBe('x');
  });
});
