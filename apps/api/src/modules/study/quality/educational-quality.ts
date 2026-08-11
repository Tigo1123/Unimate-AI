export const educationalQualityRubric = {
  grounding:
    '0 invents or ignores evidence; 5 all material claims are supported by supplied sources.',
  correctness: '0 contradicts the course; 5 accurately represents every evaluated course concept.',
  coverage: '0 misses the answer; 5 includes all essential expected concepts without padding.',
  relevance: '0 is dominated by unrelated material; 5 stays focused on the student’s question.',
  clarity: '0 is difficult to follow; 5 is immediately understandable at the requested level.',
  pedagogy: '0 merely repeats text; 5 defines, connects, exemplifies, and checks understanding.',
  structure:
    '0 is a wall of text or fragmented; 5 uses an appropriate learning-oriented structure.',
  sourceTraceability: '0 has invented/no references; 5 references only supplied, valid source IDs.',
  languageQuality: '0 ignores or mishandles language; 5 is natural, precise English or Arabic.',
  hallucinationResistance:
    '0 answers absent material confidently; 5 detects absence and offers an explicit next step.',
} as const;

export type EducationalQualityDimension = keyof typeof educationalQualityRubric;

export function retrievalReadinessScore(input: {
  expectedChunkIndexes: readonly number[];
  selectedChunkIndexes: number[];
  missingExpected?: boolean;
  evidenceSufficient: boolean;
}) {
  const expected = new Set(input.expectedChunkIndexes);
  const selected = new Set(input.selectedChunkIndexes);
  const found = [...expected].filter((index) => selected.has(index)).length;
  const coverage = expected.size ? Math.round((found / expected.size) * 5) : 5;
  const correctAbsence = input.missingExpected
    ? !input.evidenceSufficient && selected.size === 0
    : input.evidenceSufficient;
  const irrelevant = [...selected].filter((index) => !expected.has(index)).length;
  const relevance = expected.size
    ? Math.max(0, 5 - Math.min(5, Math.floor(irrelevant / Math.max(1, expected.size))))
    : correctAbsence
      ? 5
      : 0;
  return {
    grounding: correctAbsence ? 5 : 0,
    correctness: correctAbsence && (input.missingExpected || found > 0) ? 5 : 0,
    coverage,
    relevance,
    hallucinationResistance: correctAbsence ? 5 : 0,
  };
}
