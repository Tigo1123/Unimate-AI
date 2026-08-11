import { describe, expect, it } from 'vitest';
import { readFile } from 'node:fs/promises';
import { readdirSync } from 'node:fs';
import path from 'node:path';
import { cleanText, extractDocx } from './extraction.service.js';
import { semanticChunk } from './chunking.service.js';

describe('document text cleaning', () => {
  it('normalizes whitespace without removing paragraph and list boundaries', () => {
    const cleaned = cleanText(
      'Introduction\r\n\r\nAn operating system   manages resources.\r\n\r\n- Memory management\r\n- Process management',
    );
    expect(cleaned).toBe(
      'Introduction\n\nAn operating system manages resources.\n\n- Memory management\n- Process management',
    );
  });

  it('preserves indentation inside Markdown code blocks', () => {
    const cleaned = cleanText('```js\nfunction test() {\n  return true;\n}\n```', true);
    expect(cleaned).toContain('  return true;');
  });

  it('preserves lists and heading ownership in the uploaded Entrepreneurship DOCX', async () => {
    const uploads = path.resolve(process.cwd(), '../../uploads');
    const relative = readdirSync(uploads, { recursive: true })
      .map(String)
      .find((name) => name.endsWith('.docx'));
    if (!relative) return;
    const units = await extractDocx(await readFile(path.join(uploads, relative)));
    expect(units[0]?.text).toMatch(/\n[-*]\s+/);
    const chunks = semanticChunk(units);
    expect(chunks.length).toBeLessThan(500);
    const pitch = chunks.find((chunk) => /business pitch/i.test(chunk.content));
    expect(pitch).toBeDefined();
    expect(pitch?.metadata.sectionTitle).not.toMatch(/MARKET RESEARCH METHODS/i);
    expect(pitch?.metadata.headingPath).not.toContain('CASE STUDY DISCUSSION QUESTIONS');
    const ai = chunks.find((chunk) =>
      /2\.2 Artificial Intelligence and Automation/i.test(chunk.content),
    );
    expect(ai?.metadata.sectionTitle).toMatch(/Artificial Intelligence and Automation/i);
    expect(ai?.content).toContain('- Customer service');
    expect(ai?.content).toContain('- Process automation');
    expect(ai?.metadata.headingPath).not.toContain('Entrepreneurs use AI for:');
    expect(chunks.every((chunk, index) => chunk.metadata.chunkIndex === index)).toBe(true);
  }, 20_000);
});
