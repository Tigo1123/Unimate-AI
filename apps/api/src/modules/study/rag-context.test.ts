import { describe, expect, it } from 'vitest';
import type { RetrievedChunk } from './retrieval.service.js';
import {
  boundedConversationHistory,
  conversationAwareRetrievalQuery,
  deduplicateChunks,
  detectRagIntent,
  ensureSourceReferences,
  expandedQueryTerms,
  filterQuestionCoherence,
  hasSufficientQuestionEvidence,
  hybridRerank,
  normalizeCitationMarkers,
  restrictCitationMarkers,
  selectQuestionContext,
  selectDocumentCoverage,
  selectDocumentContextByTokenBudget,
  sortDocumentChunks,
} from './rag-context.js';

const chunk = (
  id: string,
  chunkIndex: number,
  sectionTitle: string,
  content: string,
): RetrievedChunk => ({
  id,
  chunkIndex,
  sourceId: 'doc-1',
  sourceName: 'Entrepreneurship.docx',
  content,
  pageStart: null,
  pageEnd: null,
  similarity: 0.8,
  metadata: { sectionTitle, headingConfidence: 'high' },
});

describe('RAG intent and context preparation', () => {
  it('normalizes decorative citation brackets to ASCII markers', () => {
    expect(normalizeCitationMarkers('Supported by 【S1】, ［s2］, and \\[s3\\].')).toBe(
      'Supported by [S1], [S2], and [S3].',
    );
  });
  it('recognizes document-level learning requests and narrow questions', () => {
    expect(detectRagIntent('Explain this lecture', 'EXPLAIN')).toBe('EXPLAIN_DOCUMENT');
    expect(detectRagIntent('Summarize the whole file', 'EXPLAIN')).toBe('SUMMARIZE_DOCUMENT');
    expect(detectRagIntent('Teach me this document', 'EXPLAIN')).toBe('EXPLAIN_DOCUMENT');
    expect(detectRagIntent('What is a business pitch?', 'EXPLAIN')).toBe('QUESTION');
    expect(detectRagIntent('Prepare me for the exam', 'EXPLAIN')).toBe('EXAM_PREP');
    expect(detectRagIntent('What should I study first?', 'STUDY')).toBe('STUDY_PLAN');
    expect(detectRagIntent('Summarize key points', 'EXPLAIN')).toBe('SUMMARIZE_DOCUMENT');
    expect(detectRagIntent('Explain in simple words', 'EXPLAIN')).toBe('SIMPLIFY_DOCUMENT');
  });

  it('restores document order and removes duplicate overlapping chunks', () => {
    const chunks = [
      chunk(
        'ai',
        27,
        'Artificial Intelligence and Automation',
        'AI automates repetitive business work.',
      ),
      chunk(
        'market',
        3,
        'MARKET RESEARCH METHODS',
        'Market research studies customers and competitors.',
      ),
      chunk(
        'pitch-copy',
        15,
        'BUSINESS PITCH',
        'A business pitch persuades investors and partners to support a venture.',
      ),
      chunk(
        'pitch',
        14,
        'BUSINESS PITCH',
        'A business pitch persuades investors and partners to support a venture.',
      ),
    ];
    expect(sortDocumentChunks(deduplicateChunks(chunks)).map((item) => item.id)).toEqual([
      'market',
      'pitch-copy',
      'ai',
    ]);
  });

  it('keeps representative sections and returns them in document order', () => {
    const chunks = [
      chunk('m2', 2, 'MARKET RESEARCH METHODS', 'Market details two.'),
      chunk('m1', 1, 'MARKET RESEARCH METHODS', 'Market details one.'),
      chunk('p1', 4, 'BUSINESS PITCH', 'Pitch details.'),
      chunk('a1', 8, 'Artificial Intelligence and Automation', 'AI details.'),
    ];
    expect(selectDocumentCoverage(chunks, 3).map((item) => item.id)).toEqual(['m1', 'p1', 'a1']);
  });

  it('bounds default chat coverage for very large documents', () => {
    const chunks = Array.from({ length: 100 }, (_, index) =>
      chunk(`c${index}`, index, `Section ${index}`, `Distinct material ${index}.`),
    );
    const selected = selectDocumentCoverage(chunks);
    expect(selected).toHaveLength(8);
    expect(selected[0]?.chunkIndex).toBe(0);
    expect(selected.at(-1)?.chunkIndex).toBe(99);
  });

  it('enforces the document-level chunk ceiling even when many small chunks fit the token budget', () => {
    const chunks = Array.from({ length: 426 }, (_, index) =>
      chunk(`c${index}`, index, `Section ${index}`, `Distinct material ${index}.`),
    );
    const selected = selectDocumentContextByTokenBudget(chunks, 80_000);
    expect(selected).toHaveLength(8);
    expect(selected[0]?.chunkIndex).toBe(0);
    expect(selected.at(-1)?.chunkIndex).toBe(425);
  });

  it('also enforces the document-level token budget within the chunk ceiling', () => {
    const chunks = Array.from({ length: 20 }, (_, index) =>
      chunk(`c${index}`, index, `Section ${index}`, 'x'.repeat(4_000)),
    );
    const tokenBudget = 2_100;
    const selected = selectDocumentContextByTokenBudget(chunks, tokenBudget);
    const estimatedTokens = selected.reduce(
      (sum, item) => sum + Math.ceil(item.content.length / 4) + 45,
      0,
    );
    expect(selected.length).toBeLessThanOrEqual(8);
    expect(estimatedTokens).toBeLessThanOrEqual(tokenBudget);
  });

  it('keeps Business Pitch dominant for a narrow question', () => {
    const chunks = [
      chunk(
        'pitch',
        14,
        'BUSINESS PITCH',
        'A business pitch persuades investors to support a venture.',
      ),
      chunk(
        'ai',
        27,
        'Artificial Intelligence and Automation',
        'Artificial intelligence automates business processes.',
      ),
    ];
    expect(
      filterQuestionCoherence('What is a business pitch?', chunks).map((item) => item.id),
    ).toEqual(['pitch']);
  });

  it('excludes unrelated chunks and rejects questions absent from the material', () => {
    const ranked = hybridRerank('Explain quantum entanglement', [
      chunk('market', 3, 'MARKET RESEARCH', 'Research identifies customer needs.'),
      chunk('pitch', 14, 'BUSINESS PITCH', 'A pitch communicates a venture idea.'),
    ]);
    expect(hasSufficientQuestionEvidence(ranked)).toBe(false);
  });

  it('retrieves useful neighboring chunks without losing the strongest anchor', () => {
    const anchor = chunk('definition', 10, 'MARKET RESEARCH', 'Market research is systematic.');
    const neighbor = chunk('methods', 11, 'MARKET RESEARCH', 'Primary and secondary are methods.');
    expect(selectQuestionContext([anchor], [neighbor], 3).map((item) => item.id)).toEqual([
      'definition',
      'methods',
    ]);
  });

  it('uses recent student context to resolve an ambiguous follow-up', () => {
    expect(
      conversationAwareRetrievalQuery('How are they different?', [
        { role: 'ASSISTANT', content: 'Let us compare them.' },
        { role: 'USER', content: 'What are primary and secondary market research?' },
      ]),
    ).toContain('primary and secondary market research');
  });

  it('adds English retrieval concepts for an Arabic market-research question', () => {
    const terms = expandedQueryTerms('قارن بين البحث الأولي والبحث الثانوي');
    expect(terms).toEqual(expect.arrayContaining(['primary', 'secondary', 'research']));
  });

  it('keeps visible citation IDs restricted to the supplied sources', () => {
    const restricted = restrictCitationMarkers('Supported by [S1], [S3], and [S99].', 3);
    expect(restricted).toBe('Supported by [S1], [S3], and .');
    expect(ensureSourceReferences('No inline marker.', 2)).toContain('[S1]');
    expect(ensureSourceReferences(restricted, 3)).not.toContain('[S99]');
  });

  it('bounds conversation history before it reaches the provider prompt', () => {
    const history = Array.from({ length: 12 }, (_, index) => ({
      role: index % 2 === 0 ? 'USER' : 'ASSISTANT',
      content: 'x'.repeat(2_000),
    }));
    const bounded = boundedConversationHistory(history);
    expect(bounded.length).toBeLessThanOrEqual(6);
    expect(bounded.reduce((sum, message) => sum + message.content.length, 0)).toBeLessThanOrEqual(
      6_000,
    );
  });
});
