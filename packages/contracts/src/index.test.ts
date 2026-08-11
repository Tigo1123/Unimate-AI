import { describe, expect, it } from 'vitest';
import { chatMessageSchema, courseSchema, registerSchema } from './index.js';

describe('shared contracts', () => {
  it.each([
    'EXPLAIN',
    'SUMMARIZE',
    'CREATE_EXAM_QUESTIONS',
    'STUDY_FIRST',
    'SIMPLIFY',
    'EXAM_PREP',
  ] as const)('accepts the %s study action', (action) => {
    expect(chatMessageSchema.parse({ content: 'Study this', action }).action).toBe(action);
  });
  it('normalizes registration email', () => {
    expect(
      registerSchema.parse({
        email: ' STUDENT@EXAMPLE.COM ',
        password: 'password123',
        fullName: 'Alex Student',
      }).email,
    ).toBe('student@example.com');
  });
  it('rejects invalid course colors', () => {
    expect(() =>
      courseSchema.parse({ semesterId: crypto.randomUUID(), name: 'Networks', color: 'green' }),
    ).toThrow();
  });
});
