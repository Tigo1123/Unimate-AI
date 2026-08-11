import { describe, expect, it } from 'vitest';
import { semanticChunk } from './chunking.service.js';

describe('semanticChunk', () => {
  it('preserves page and heading metadata', () => {
    const chunks = semanticChunk(
      [
        {
          locatorType: 'page',
          pageNumber: 4,
          text: 'NORMALIZATION\n\nThird normal form removes transitive dependencies. '.repeat(60),
        },
      ],
      100,
      180,
    );
    expect(chunks.length).toBeGreaterThan(1);
    expect(chunks[0]?.pageStart).toBe(4);
    expect(chunks[0]?.metadata.sectionHeading).toBe('NORMALIZATION');
  });
  it('does not emit meaningless tiny chunks', () => {
    expect(
      semanticChunk([
        {
          locatorType: 'document',
          text: 'A meaningful definition with enough explanatory content to remain together in one semantic unit.',
        },
      ]),
    ).toHaveLength(1);
  });
  it('retains short sections and consecutive headings without dropping their text', () => {
    const chunks = semanticChunk([
      {
        locatorType: 'document',
        text: '# Course\n\n## Topic\n\nA short definition.\n\n## Next\n\nOne useful fact.',
      },
    ]);
    expect(chunks.map((chunk) => chunk.content).join('\n\n')).toContain('# Course\n\n## Topic');
    expect(chunks.map((chunk) => chunk.content).join('\n\n')).toContain('A short definition.');
    expect(chunks.map((chunk) => chunk.content).join('\n\n')).toContain('One useful fact.');
  });
  it('does not mistake a multiline numbered list for one heading', () => {
    const text = '1. Faculty: Business\n2. Department: Finance\n3. Hours: 30';
    const chunks = semanticChunk([{ locatorType: 'document', text }]);
    expect(chunks.map((chunk) => chunk.content).join('\n\n')).toBe(text);
  });
  it('keeps adjacent lecture sections separate and preserves heading paths', () => {
    const chunks = semanticChunk(
      [
        {
          locatorType: 'document',
          text: [
            '## 5 MARKET RESEARCH METHODS',
            'Market research identifies customer needs and competitors. '.repeat(20),
            '## BUSINESS PITCH',
            'A business pitch persuades stakeholders to support an idea. '.repeat(20),
            '## GLOBAL TRENDS IN ENTREPRENEURSHIP',
            '### 2.2 Artificial Intelligence and Automation',
            'AI can automate entrepreneurial work and support decisions. '.repeat(20),
          ].join('\n\n'),
        },
      ],
      80,
      120,
    );
    const pitch = chunks.find((chunk) => chunk.content.includes('business pitch persuades'));
    expect(pitch?.metadata.sectionTitle).toBe('BUSINESS PITCH');
    expect(pitch?.metadata.sectionHeading).not.toBe('5 MARKET RESEARCH METHODS');
    const ai = chunks.find((chunk) => chunk.content.includes('AI can automate'));
    expect(ai?.metadata.headingPath).toEqual([
      'GLOBAL TRENDS IN ENTREPRENEURSHIP',
      '2.2 Artificial Intelligence and Automation',
    ]);
    expect(chunks.every((chunk, index) => chunk.metadata.chunkIndex === index)).toBe(true);
  });
});
