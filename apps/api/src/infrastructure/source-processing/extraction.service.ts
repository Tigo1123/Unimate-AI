import JSZip from 'jszip';
import mammoth from 'mammoth';
import * as pdfjs from 'pdfjs-dist/legacy/build/pdf.mjs';

export type DocumentUnit = {
  text: string;
  pageNumber?: number;
  slideNumber?: number;
  locatorType: 'page' | 'slide' | 'document';
};

type MammothNode = {
  type?: string;
  styleId?: string | null;
  styleName?: string | null;
  numbering?: unknown;
  children?: MammothNode[];
  value?: string;
  isBold?: boolean;
  fontSize?: number | null;
};

const entities: Record<string, string> = {
  amp: '&',
  lt: '<',
  gt: '>',
  quot: '"',
  apos: "'",
  nbsp: ' ',
};
function decodeXml(value: string) {
  return value.replace(/&(#x?[0-9a-f]+|\w+);/gi, (_match, entity: string) => {
    if (entity.startsWith('#x')) return String.fromCodePoint(Number.parseInt(entity.slice(2), 16));
    if (entity.startsWith('#')) return String.fromCodePoint(Number.parseInt(entity.slice(1), 10));
    return entities[entity] ?? '';
  });
}

export function cleanText(value: string, preserveMarkdown = false) {
  let inFence = false;
  return value
    .replace(/\r\n?/g, '\n')
    .replace(/\u00ad/g, '')
    .replace(/([\p{L}])-\s*\n\s*([\p{Ll}])/gu, '$1$2')
    .split('\n')
    .map((line) => {
      if (preserveMarkdown && /^\s*```/.test(line)) {
        inFence = !inFence;
        return line.trimEnd();
      }
      if (preserveMarkdown && (inFence || /^( {4}|\t)/.test(line))) return line.trimEnd();
      return line.replace(/[ \t]+/g, ' ').trim();
    })
    .join('\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

const listLine = /^\s*(?:[-*•]\s+|\d+[.)]\s+)/;
const headingLine = /^(?:#{1,6}\s+|[A-Z][A-Z\d\s:&/()'-]{3,80}$|\d+(?:\.\d+)*\s+[A-Z])/;
function structureVisualLines(lines: string[]) {
  const paragraphs: string[] = [];
  let current = '';
  const flush = () => {
    if (current.trim()) paragraphs.push(current.trim());
    current = '';
  };
  for (const rawLine of lines) {
    const line = rawLine.trim();
    if (!line) {
      flush();
      continue;
    }
    if (listLine.test(line) || headingLine.test(line)) {
      flush();
      paragraphs.push(line);
      continue;
    }
    if (!current) current = line;
    else if (/[.!?:;)]$/.test(current) || /^[A-Z\d]/.test(line)) {
      flush();
      current = line;
    } else current += ` ${line}`;
  }
  flush();
  return paragraphs.join('\n\n');
}

function removeRepeatedMargins(units: DocumentUnit[]) {
  if (units.length < 4) return units;
  const counts = new Map<string, number>();
  for (const unit of units) {
    const lines = unit.text
      .split('\n')
      .map((line) => line.trim())
      .filter(Boolean);
    for (const line of [lines[0], lines.at(-1)])
      if (line && line.length < 140) counts.set(line, (counts.get(line) ?? 0) + 1);
  }
  const repeated = new Set(
    [...counts].filter(([, count]) => count / units.length >= 0.6).map(([line]) => line),
  );
  return units.map((unit) => ({
    ...unit,
    text: cleanText(
      unit.text
        .split('\n')
        .filter((line) => !repeated.has(line.trim()))
        .join('\n'),
    ),
  }));
}

async function extractPdf(buffer: Buffer): Promise<DocumentUnit[]> {
  const document = await pdfjs.getDocument({ data: new Uint8Array(buffer) }).promise;
  const pages: DocumentUnit[] = [];
  for (let pageNumber = 1; pageNumber <= document.numPages; pageNumber++) {
    const page = await document.getPage(pageNumber);
    const content = await page.getTextContent();
    const lines: string[] = [];
    let current = '';
    for (const item of content.items) {
      if (!('str' in item)) continue;
      current += `${current ? ' ' : ''}${item.str}`;
      if (item.hasEOL) {
        lines.push(current);
        current = '';
      }
    }
    if (current) lines.push(current);
    pages.push({
      pageNumber,
      locatorType: 'page',
      text: cleanText(structureVisualLines(lines)),
    });
  }
  return removeRepeatedMargins(pages);
}

function nodeText(node: MammothNode): string {
  return node.value ?? node.children?.map(nodeText).join('') ?? '';
}

function inferredHeadingLevel(text: string, runs: MammothNode[]) {
  const largestFont = Math.max(0, ...runs.map((run) => run.fontSize ?? 0));
  if (largestFont >= 18 || text === text.toUpperCase()) return 1;
  const numbered = text.match(/^(?:part\s+)?(\d+(?:\.\d+)*)[.)]?\s+\S/i);
  if (numbered) return Math.min(6, numbered[1]!.split('.').length + 1);
  return 2;
}

function inferDocxHeadings(node: MammothNode, insideTable = false): MammothNode {
  const childInsideTable = insideTable || node.type === 'table' || node.type === 'tableCell';
  for (const child of node.children ?? []) inferDocxHeadings(child, childInsideTable);
  if (node.type !== 'paragraph' || node.styleId?.startsWith('Heading')) return node;
  const text = nodeText(node).trim();
  const runs = (node.children ?? []).filter((child) => child.type === 'run');
  const meaningfulRuns = runs.filter((run) => nodeText(run).trim());
  if (node.numbering) {
    const level = (node.numbering as { level?: string }).level;
    const isCourseUnit =
      node.styleId === 'ListParagraph' &&
      level === '1' &&
      text.length <= 100 &&
      !/[.!?:]$/.test(text);
    if (isCourseUnit) {
      node.styleId = 'Heading1';
      node.styleName = 'heading 1';
    }
    return node;
  }
  const whollyBold = meaningfulRuns.length > 0 && meaningfulRuns.every((run) => run.isBold);
  const largestFont = Math.max(0, ...meaningfulRuns.map((run) => run.fontSize ?? 0));
  const numbered = /^(?:part\s+)?\d+(?:\.\d+)*[.)]?\s+\S/i.test(text);
  const upper = text.length >= 4 && text === text.toUpperCase() && /\p{L}/u.test(text);
  const shortBoldLabel = whollyBold && text.length <= 100 && !/[.!?:]$/.test(text);
  if (
    !insideTable &&
    text.length <= 140 &&
    !/[.!?]$/.test(text) &&
    (numbered || upper || shortBoldLabel || largestFont >= 18)
  ) {
    const level =
      node.styleId === 'ListParagraph' && whollyBold
        ? 1
        : inferredHeadingLevel(text, meaningfulRuns);
    node.styleId = `Heading${level}`;
    node.styleName = `heading ${level}`;
  }
  return node;
}

function htmlToMarkdown(html: string) {
  const lists: { ordered: boolean; index: number }[] = [];
  return decodeXml(html)
    .replace(
      /<h([1-6])[^>]*>([\s\S]*?)<\/h\1>/gi,
      (_match, level, body) =>
        `\n\n${'#'.repeat(Number(level))} ${String(body)
          .replace(/<[^>]+>/g, '')
          .trim()}\n\n`,
    )
    .replace(/<(\/)?(ol|ul|li)\b[^>]*>/gi, (_match, closing, tag: string) => {
      const name = tag.toLowerCase();
      if (name === 'ol' || name === 'ul') {
        if (closing) lists.pop();
        else lists.push({ ordered: name === 'ol', index: 0 });
        return '\n';
      }
      if (closing) return '';
      const list = lists.at(-1);
      const marker = list?.ordered ? `${++list.index}.` : '-';
      return `\n${'  '.repeat(Math.max(0, lists.length - 1))}${marker} `;
    })
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<t[dh][^>]*>/gi, ' | ')
    .replace(/<\/t[dh]>/gi, '')
    .replace(/<\/tr>/gi, ' |\n')
    .replace(/<\/?(?:table|thead|tbody)[^>]*>/gi, '\n')
    .replace(/<\/?(?:p|div|blockquote)[^>]*>/gi, '\n\n')
    .replace(/<[^>]+>/g, '');
}

export async function extractDocx(buffer: Buffer): Promise<DocumentUnit[]> {
  const result = await mammoth.convertToHtml(
    { buffer },
    { transformDocument: (document) => inferDocxHeadings(document as MammothNode) },
  );
  const text = cleanText(htmlToMarkdown(result.value), true)
    .split('\n')
    .filter((line) => !/^\s*(?:-|\d+\.)\s*$/.test(line))
    .join('\n');
  return [{ locatorType: 'document', text }];
}

async function extractPptx(buffer: Buffer): Promise<DocumentUnit[]> {
  const archive = await JSZip.loadAsync(buffer);
  const slideNames = Object.keys(archive.files)
    .filter((name) => /^ppt\/slides\/slide\d+\.xml$/.test(name))
    .sort((left, right) => Number(left.match(/\d+/)?.[0]) - Number(right.match(/\d+/)?.[0]));
  const slides: DocumentUnit[] = [];
  for (const [index, name] of slideNames.entries()) {
    const xml = await archive.file(name)!.async('string');
    const paragraphs = [...xml.matchAll(/<a:p[\s\S]*?<\/a:p>/g)]
      .map((match) => {
        const value = decodeXml(
          [...match[0].matchAll(/<a:t>([\s\S]*?)<\/a:t>/g)].map((text) => text[1]).join(' '),
        );
        return /<a:bu(?:Char|AutoNum)\b/.test(match[0]) ? `- ${value}` : value;
      })
      .filter(Boolean);
    slides.push({
      locatorType: 'slide',
      slideNumber: index + 1,
      text: cleanText(paragraphs.join('\n\n')),
    });
  }
  return slides;
}

export async function extractDocument(
  buffer: Buffer,
  mimeType: string,
  extension: string,
): Promise<DocumentUnit[]> {
  if (mimeType === 'application/pdf' || extension === '.pdf') return extractPdf(buffer);
  if (extension === '.docx') return extractDocx(buffer);
  if (extension === '.pptx') return extractPptx(buffer);
  if (['.txt', '.md', '.markdown'].includes(extension))
    return [
      {
        locatorType: 'document',
        text: cleanText(buffer.toString('utf8').replace(/\0/g, ''), extension !== '.txt'),
      },
    ];
  throw new Error('Unsupported document format');
}
