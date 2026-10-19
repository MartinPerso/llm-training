export function slugify(text: string): string {
  return text
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/\$[^$]*\$/g, ' ')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

/**
 * Chapter slugs are used as the first segment of concept ids, which must not contain hyphens
 * (see CONCEPT_ID_RE in check.ts). Known chapters have a hand-picked slug; unknown ones fall back
 * to the slugified title without hyphens.
 */
const CHAPTER_SLUGS: Record<string, string> = {
  'Neural net basics': 'basics',
  'Mathy things': 'math',
  'The modern transformer LM': 'transformer',
  'Inference': 'inference',
  'Scaling laws': 'scaling',
  'GPUs': 'gpus',
  'Other architectures': 'architectures',
  'Post-training': 'posttraining',
  'Precision': 'precision',
  'Parallelism': 'parallelism',
  'Multimodality': 'multimodality',
  // The Parts of the RL & agentic RL interview-notes post (external source, see AGENTS.md)
  'Foundations & problem setup': 'rlfoundations',
  'Rewards & preferences': 'rlrewards',
  'Policy optimization algorithms': 'rlpolicy',
  'Reasoning, test-time scaling & evaluation': 'rlreasoning',
  'Agentic RL': 'rlagentic',
  'RL infrastructure & systems': 'rlsystems',
};

export function chapterSlug(chapter: string): string {
  return CHAPTER_SLUGS[chapter] ?? slugify(chapter).replaceAll('-', '');
}
