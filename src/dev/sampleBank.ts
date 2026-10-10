// Dev-only fixture (SAMPLE-FIXTURE-MARKER): used when the real bank is empty. Not part of production builds.
import type { ChapterFile, Section } from '../bank/types.ts';

const S = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;

const sections: Section[] = [
  { id: S(1), chapter: 'Sample: Basics', title: 'Sample: Basics', level: 1, order: 1, hash: 'x' },
  { id: S(2), chapter: 'Sample: Basics', title: 'Attention', level: 2, order: 2, hash: 'x' },
  { id: S(3), chapter: 'Sample: Basics', title: 'Normalization', level: 2, order: 3, hash: 'x' },
  { id: S(4), chapter: 'Sample: Inference', title: 'Sample: Inference', level: 1, order: 4, hash: 'x' },
  { id: S(5), chapter: 'Sample: Inference', title: 'KV cache', level: 2, order: 5, hash: 'x' },
];

const basics: ChapterFile = {
  chapter: 'Sample: Basics',
  concepts: [
    {
      id: 'sample.attention.scale',
      section: S(2),
      variants: [
        {
          kind: 'mcq',
          prompt: 'Dot-product attention divides the scores $QK^\\top$ by $\\sqrt{d_k}$. What goes wrong without that division?',
          choices: [
            'The softmax saturates for large $d_k$, so gradients nearly vanish',
            'The output has the wrong shape',
            'The keys become orthogonal to the queries',
            'The attention mask stops working',
          ],
          correct: 0,
          explanation:
            'If entries of $q$ and $k$ have unit variance, $q\\cdot k$ has variance $d_k$. Large scores push the softmax toward one-hot, where gradients are tiny.',
        },
        {
          kind: 'truefalse',
          prompt: 'Scaling attention scores by $1/\\sqrt{d_k}$ keeps their variance near 1 when $q$ and $k$ have independent unit-variance entries.',
          answer: true,
          explanation: 'A sum of $d_k$ independent unit-variance products has variance $d_k$; dividing by $\\sqrt{d_k}$ brings it back to 1.',
        },
      ],
    },
    {
      id: 'sample.attention.score-matrix-size',
      section: S(2),
      variants: [
        {
          kind: 'numeric',
          prompt:
            'A sequence has $L = 1024$ tokens. How many entries does one attention head\'s score matrix hold? Number formats like `3k`, `2^10` or `1e6` are accepted.',
          answer: 1048576,
          tolerance: 0,
          explanation: 'The matrix is $L \\times L = 2^{10} \\cdot 2^{10} = 2^{20} = 1{,}048{,}576$.',
        },
      ],
    },
    {
      id: 'sample.norm.pre-vs-post',
      section: S(3),
      variants: [
        {
          kind: 'recall',
          prompt: 'Why do most modern transformers apply normalization *before* each sublayer instead of after the residual add?',
          answer: 'The residual path stays an identity path, so gradients flow to early layers unchanged and deep stacks train more stably.',
          explanation: 'Post-norm puts a normalization on the main path, which makes very deep models harder to train without careful warmup.',
        },
        {
          kind: 'truefalse',
          prompt: 'In a pre-norm block, the residual stream itself is passed through a LayerNorm at every layer.',
          answer: false,
          explanation: 'Only the sublayer input is normalized; the residual stream is left untouched and just accumulates updates.',
        },
      ],
    },
    {
      id: 'sample.softmax.sum',
      section: S(1),
      variants: [
        {
          kind: 'numeric',
          prompt: 'What does a softmax output vector sum to? (Exactly, as a plain number.)',
          answer: 1,
          tolerance: 0,
          explanation: 'Softmax exponentiates and divides by the total, so the entries form a probability distribution: $\\sum_i p_i = 1$.',
        },
      ],
    },
  ],
};

const inference: ChapterFile = {
  chapter: 'Sample: Inference',
  concepts: [
    {
      id: 'sample.kv.why',
      section: S(5),
      variants: [
        {
          kind: 'recall',
          prompt: 'What does the KV cache save during autoregressive decoding, and what does it cost?',
          answer: 'It avoids recomputing keys and values for all earlier tokens at each step, at the price of memory that grows linearly with context length.',
          explanation: 'Each new token only needs its own $q, k, v$; past $k, v$ are read from the cache.',
        },
      ],
    },
    {
      id: 'sample.kv.bytes',
      section: S(5),
      variants: [
        {
          kind: 'numeric',
          prompt:
            'A model has $n_\\text{layers} = 10$, $n_\\text{kv heads} = 4$, head dimension $64$, stored in 2-byte values. How many KV-cache bytes per token? (Count both $K$ and $V$.)',
          answer: 10240,
          unit: 'bytes',
          explanation: '$2 \\cdot 10 \\cdot 4 \\cdot 64 \\cdot 2 = 10{,}240$: the leading 2 is for $K$ and $V$, the last for bytes per value.',
        },
        {
          kind: 'mcq',
          prompt: 'Grouped-query attention shrinks the KV cache mainly by...',
          choices: [
            'sharing each key/value head across several query heads',
            'dropping the values and keeping only keys',
            'quantizing the queries',
            'caching only the most recent layer',
          ],
          correct: 0,
          explanation: 'Fewer KV heads means fewer cached tensors per token; the number of query heads is unchanged.',
        },
      ],
    },
    {
      id: 'sample.decode.bandwidth',
      section: S(4),
      variants: [
        {
          kind: 'truefalse',
          prompt: 'Single-sequence token generation is usually limited by compute rather than by memory bandwidth.',
          answer: false,
          explanation: 'Each token needs one pass over all the weights but very few FLOPs per byte read, so memory bandwidth is the bottleneck.',
        },
      ],
    },
  ],
};

export const sampleBank = { sections, files: [basics, inference] };
