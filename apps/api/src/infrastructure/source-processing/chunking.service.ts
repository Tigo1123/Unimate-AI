import type { DocumentUnit } from './extraction.service.js';

export type SemanticChunk = {
  content: string;
  pageStart?: number;
  pageEnd?: number;
  tokenCount: number;
  metadata: {
    sectionTitle?: string;
    sectionHeading?: string;
    headingPath?: string[];
    headingConfidence?: 'high' | 'medium' | 'low';
    chunkIndex?: number;
    slideNumber?: number;
    locatorType: string;
  };
};

const estimateTokens = (text: string) => Math.ceil(text.length / 4);
const markdownHeading = /^(#{1,6})\s+(.+)$/;
const visualHeading =
  /^(?:[A-Z][A-Z\d\s:&/()'-]{3,100}|(?:part\s+)?\d+(?:\.\d+)*[.)]?\s+[A-Z].{1,120})$/;
function blocks(text: string) {
  return text
    .split(/\n{2,}|(?=^#{1,6}\s)|(?=^\d+(?:\.\d+)*\s+[A-Z])/gm)
    .map((block) => block.trim())
    .filter(Boolean);
}

function splitOversizedBlock(block: string, maxTokens: number) {
  const segments = block.includes('\n')
    ? block.split(/(?<=\n)/)
    : (block.match(/[^.!?]+[.!?]+(?:\s+|$)|[^.!?]+$/g) ?? [block]);
  const parts: string[] = [];
  let current = '';
  for (const segment of segments) {
    if (estimateTokens(segment) > maxTokens) {
      if (current.trim()) parts.push(current.trim());
      current = '';
      const characters = maxTokens * 4;
      for (let start = 0; start < segment.length; start += characters)
        parts.push(segment.slice(start, start + characters).trim());
      continue;
    }
    if (current && estimateTokens(current + segment) > maxTokens) {
      parts.push(current.trim());
      current = segment;
    } else current += segment;
  }
  if (current.trim()) parts.push(current.trim());
  return parts.filter(Boolean);
}

export function semanticChunk(
  units: DocumentUnit[],
  targetTokens = 700,
  maxTokens = 950,
): SemanticChunk[] {
  const result: SemanticChunk[] = [];
  for (const unit of units) {
    const headingPath: string[] = [];
    let pendingHeadings: string[] = [];
    let current: string[] = [];
    let currentTokens = 0;
    const flush = () => {
      if (!current.length) return;
      const content = current.join('\n\n').trim();
      const sectionTitle = headingPath.at(-1);
      if (content)
        result.push({
          content,
          ...(unit.pageNumber ? { pageStart: unit.pageNumber, pageEnd: unit.pageNumber } : {}),
          tokenCount: estimateTokens(content),
          metadata: {
            ...(sectionTitle
              ? {
                  sectionTitle,
                  sectionHeading: sectionTitle,
                  headingPath: headingPath.filter(Boolean),
                  headingConfidence: 'high' as const,
                }
              : {}),
            ...(unit.slideNumber ? { slideNumber: unit.slideNumber } : {}),
            locatorType: unit.locatorType,
          },
        });
      current = [];
      currentTokens = 0;
    };
    for (const block of blocks(unit.text)) {
      const firstLine = block.split('\n')[0]!.trim();
      const markdown = firstLine.match(markdownHeading);
      const isHeading =
        Boolean(markdown) ||
        (!block.includes('\n') && visualHeading.test(firstLine) && firstLine.length < 120);
      if (isHeading) {
        if (current.length) flush();
        const numbered = firstLine.match(/^(?:part\s+)?(\d+(?:\.\d+)*)[.)]?\s+\S/i);
        const level =
          markdown?.[1]?.length ??
          (firstLine === firstLine.toUpperCase() && /\p{L}/u.test(firstLine)
            ? 1
            : numbered
              ? Math.min(6, numbered[1]!.split('.').length + 1)
              : 2);
        headingPath.splice(level - 1);
        headingPath[level - 1] = (markdown?.[2] ?? firstLine).trim();
        pendingHeadings.push(markdown ? firstLine : `${'#'.repeat(level)} ${firstLine}`);
        continue;
      }
      if (estimateTokens(block) > maxTokens) {
        flush();
        for (const part of splitOversizedBlock(block, maxTokens)) {
          current = pendingHeadings.length ? [...pendingHeadings, part] : [part];
          pendingHeadings = [];
          currentTokens = estimateTokens(current.join('\n\n'));
          flush();
        }
      } else {
        if (currentTokens + estimateTokens(block) > maxTokens) flush();
        if (!current.length && pendingHeadings.length) {
          current.push(...pendingHeadings);
          currentTokens += estimateTokens(pendingHeadings.join('\n\n'));
          pendingHeadings = [];
        }
        current.push(block);
        currentTokens += estimateTokens(block);
        if (currentTokens >= targetTokens && /[.!?:]$/.test(block)) flush();
      }
    }
    flush();
  }
  return result.map((chunk, chunkIndex) => ({
    ...chunk,
    metadata: { ...chunk.metadata, chunkIndex },
  }));
}
