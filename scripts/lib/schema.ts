// zod schema mirroring src/bank/types.ts (ChapterFile) plus stricter content rules.

import { z } from 'zod';

export const CONCEPT_ID_RE = /^[a-z0-9]+(\.[a-z0-9-]+)+$/;

const text = z.string().refine((s) => s.trim().length > 0, 'must not be empty');

const numeric = z.strictObject({
  kind: z.literal('numeric'),
  prompt: text,
  answer: z.number().refine(Number.isFinite, 'answer must be a finite number'),
  tolerance: z.number().min(0).max(1).optional(),
  unit: text.optional(),
  explanation: text,
});

const recall = z.strictObject({
  kind: z.literal('recall'),
  prompt: text,
  answer: text,
  explanation: text.optional(),
});

const mcq = z
  .strictObject({
    kind: z.literal('mcq'),
    prompt: text,
    choices: z.array(text).length(4, 'mcq needs exactly 4 choices'),
    correct: z.number().int().min(0).max(3, 'correct must be an index between 0 and 3'),
    explanation: text,
  })
  .refine((q) => new Set(q.choices.map((c) => c.trim())).size === q.choices.length, {
    message: 'mcq choices must all be distinct',
    path: ['choices'],
  });

const truefalse = z.strictObject({
  kind: z.literal('truefalse'),
  prompt: text,
  answer: z.boolean(),
  explanation: text,
});

export const QuestionSchema = z.discriminatedUnion('kind', [numeric, recall, mcq, truefalse]);

export const ConceptSchema = z.strictObject({
  id: z.string().regex(CONCEPT_ID_RE, 'id must match ^[a-z0-9]+(\\.[a-z0-9-]+)+$'),
  section: text,
  variants: z.array(QuestionSchema).min(1, 'at least 1 variant').max(3, 'at most 3 variants'),
  retired: z.literal(true).optional(),
});

export const ChapterHeaderSchema = z.object({ chapter: text, concepts: z.array(z.unknown()) });
