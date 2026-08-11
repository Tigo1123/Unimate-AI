import type { RetrievedChunk } from './retrieval.service.js';

export type RagIntent =
  | 'QUESTION'
  | 'EXPLAIN_DOCUMENT'
  | 'SUMMARIZE_DOCUMENT'
  | 'SIMPLIFY_DOCUMENT'
  | 'STUDY_PLAN'
  | 'EXAM_PREP';

export function normalizeCitationMarkers(content: string) {
  return content
    .replace(/[【［]\s*(S\d+)\s*[】］]/gi, (_match, marker: string) => `[${marker.toUpperCase()}]`)
    .replace(/\\?\[\s*(S\d+)\s*\\?\]/gi, (_match, marker: string) => `[${marker.toUpperCase()}]`);
}

export function restrictCitationMarkers(content: string, suppliedSourceCount: number) {
  return normalizeCitationMarkers(content).replace(/\[S(\d+)\]/g, (marker, value: string) => {
    const index = Number(value);
    return Number.isInteger(index) && index >= 1 && index <= suppliedSourceCount ? marker : '';
  });
}

export function ensureSourceReferences(content: string, suppliedSourceCount: number) {
  const restricted = restrictCitationMarkers(content, suppliedSourceCount).trim();
  if (!suppliedSourceCount || /\[S\d+\]/.test(restricted)) return restricted;
  const markers = Array.from(
    { length: Math.min(3, suppliedSourceCount) },
    (_, index) => `[S${index + 1}]`,
  ).join(' ');
  return `${restricted}\n\n**Sources used:** ${markers}`;
}

export function detectRagIntent(question: string, mode: string): RagIntent {
  const normalized = question
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s]/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  const documentWords = /\b(?:this|the|whole|entire)\s+(?:lecture|document|file|course|material)\b/;
  if (mode === 'STUDY' || /\b(?:study first|study plan|where should i start)\b/.test(normalized))
    return 'STUDY_PLAN';
  if (
    mode === 'EXAM_PREP' ||
    /\b(?:exam prep|prepare me for|revision|create exam questions)\b/.test(normalized)
  )
    return 'EXAM_PREP';
  if (
    mode === 'SUMMARIZE' ||
    /^(?:summari[sz]e|summary|key points)\b/.test(normalized) ||
    (/\b(?:summari[sz]e|summary|key points)\b/.test(normalized) && documentWords.test(normalized))
  )
    return 'SUMMARIZE_DOCUMENT';
  if (
    (mode === 'SIMPLIFY' && documentWords.test(normalized)) ||
    /^explain in simple words$/.test(normalized)
  )
    return 'SIMPLIFY_DOCUMENT';
  if (/\b(?:explain|teach)\b/.test(normalized) && documentWords.test(normalized))
    return 'EXPLAIN_DOCUMENT';
  return 'QUESTION';
}

function words(text: string) {
  return new Set(text.toLowerCase().match(/[\p{L}\p{N}]{3,}/gu) ?? []);
}

const QUERY_STOP_WORDS = new Set([
  'what',
  'why',
  'how',
  'are',
  'is',
  'when',
  'where',
  'which',
  'that',
  'this',
  'with',
  'from',
  'about',
  'explain',
  'define',
  'compare',
  'difference',
  'different',
  'does',
  'help',
  'could',
  'would',
  'they',
  'them',
  'their',
  'into',
  'course',
  'material',
  'lecture',
]);

function canonicalSearchTerm(term: string) {
  if (term === 'important') return 'importance';
  if (term.length > 5 && term.endsWith('s') && !term.endsWith('ss')) return term.slice(0, -1);
  return term;
}

const ARABIC_QUERY_EXPANSIONS: Array<[RegExp, string[]]> = [
  [/البحث\s+الأولي|البحث\s+الاولى|البحث\s+الاولي/u, ['primary', 'research']],
  [/البحث\s+الثانوي/u, ['secondary', 'research']],
  [/بحث\s+السوق|أبحاث\s+السوق|ابحاث\s+السوق/u, ['market', 'research']],
  [/ريادة\s+الأعمال|ريادة\s+الاعمال/u, ['entrepreneurship']],
  [/رائد\s+الأعمال|رائد\s+الاعمال/u, ['entrepreneur']],
  [/خطة\s+العمل/u, ['business', 'plan']],
  [/عرض\s+المشروع|عرض\s+الأعمال|عرض\s+الاعمال/u, ['business', 'pitch']],
  [/الذكاء\s+الاصطناعي/u, ['artificial', 'intelligence', 'ai']],
];

export function expandedQueryTerms(query: string) {
  const normalized = query.toLowerCase();
  const terms = [...words(normalized)]
    .filter(
      (term) =>
        !QUERY_STOP_WORDS.has(term) && !/^(?:ال)?(?:ذي|تي|فرق|بين|كيف|ما|ماذا|هل)$/.test(term),
    )
    .map(canonicalSearchTerm);
  const expanded: string[] = [];
  for (const [pattern, additions] of ARABIC_QUERY_EXPANSIONS)
    if (pattern.test(normalized)) expanded.push(...additions);
  const selected =
    expanded.length && /\p{Script=Arabic}/u.test(normalized) ? expanded : [...terms, ...expanded];
  return [...new Set(selected.map(canonicalSearchTerm))]
    .filter((term) => term.length >= 2)
    .slice(0, 16);
}

function headingText(chunk: RetrievedChunk) {
  const metadata = chunk.metadata ?? {};
  const path = Array.isArray(metadata.headingPath)
    ? metadata.headingPath.filter((item): item is string => typeof item === 'string')
    : [];
  return `${path.join(' ')} ${typeof metadata.sectionTitle === 'string' ? metadata.sectionTitle : ''}`.toLowerCase();
}

export function hybridRerank(query: string, chunks: RetrievedChunk[]) {
  const terms = expandedQueryTerms(query);
  return chunks
    .map((chunk) => {
      const body = new Set([...words(chunk.content)].map(canonicalSearchTerm));
      const heading = new Set([...words(headingText(chunk))].map(canonicalSearchTerm));
      const bodyMatches = terms.filter((term) => body.has(term)).length;
      const headingMatches = terms.filter((term) => heading.has(term)).length;
      const lexicalCoverage = terms.length ? bodyMatches / terms.length : 0;
      const headingCoverage = terms.length ? headingMatches / terms.length : 0;
      const vectorSimilarity = Number(chunk.similarity) || 0;
      const hybridScore =
        lexicalCoverage * 0.58 + headingCoverage * 0.24 + Math.max(0, vectorSimilarity) * 0.18;
      return {
        ...chunk,
        similarity: hybridScore,
        retrieval: { vectorSimilarity, lexicalCoverage, headingCoverage, hybridScore },
      };
    })
    .filter(
      (chunk) =>
        chunk.retrieval.lexicalCoverage > 0 ||
        chunk.retrieval.headingCoverage > 0 ||
        chunk.retrieval.vectorSimilarity >= 0.45,
    )
    .sort(
      (a, b) =>
        b.retrieval.hybridScore - a.retrieval.hybridScore ||
        b.retrieval.lexicalCoverage - a.retrieval.lexicalCoverage ||
        a.chunkIndex - b.chunkIndex,
    );
}

export function hasSufficientQuestionEvidence(chunks: RetrievedChunk[]) {
  const best = chunks[0]?.retrieval;
  return Boolean(
    best &&
    (best.lexicalCoverage >= 0.34 ||
      best.headingCoverage >= 0.34 ||
      (best.vectorSimilarity >= 0.5 && best.hybridScore >= 0.22)),
  );
}

export function isAmbiguousFollowUp(question: string) {
  const normalized = question.toLowerCase().trim();
  const count = normalized.match(/[\p{L}\p{N}]+/gu)?.length ?? 0;
  return (
    count <= 10 &&
    /\b(?:it|they|them|that|those|these|former|latter|different|difference|compare|more|example)\b|^(?:and|but|so)\b|(?:ما الفرق|وضح أكثر|اشرح أكثر)/u.test(
      normalized,
    )
  );
}

export function conversationAwareRetrievalQuery(
  question: string,
  recentMessages: Array<{ role: string; content: string }>,
) {
  if (!isAmbiguousFollowUp(question)) return question;
  const previousUserQuestion = recentMessages.find((message) => message.role === 'USER')?.content;
  return previousUserQuestion ? `${previousUserQuestion}\nFollow-up: ${question}` : question;
}

export function boundedConversationHistory(
  recentMessages: Array<{ role: string; content: string }>,
  maximumMessages = 6,
  maximumCharacters = 6_000,
) {
  const selected: Array<{ role: 'user' | 'assistant'; content: string }> = [];
  let characters = 0;
  for (const message of recentMessages) {
    if (message.role === 'SYSTEM' || message.content.length + characters > maximumCharacters)
      continue;
    selected.push({
      role: message.role === 'USER' ? 'user' : 'assistant',
      content: message.content,
    });
    characters += message.content.length;
    if (selected.length >= maximumMessages) break;
  }
  return selected.reverse();
}

function overlap(left: string, right: string) {
  const a = words(left);
  const b = words(right);
  if (!a.size || !b.size) return 0;
  if (Math.min(a.size, b.size) < 8) return left.trim() === right.trim() ? 1 : 0;
  let common = 0;
  for (const word of a) if (b.has(word)) common += 1;
  return common / Math.min(a.size, b.size);
}

export function deduplicateChunks(chunks: RetrievedChunk[]) {
  const kept: RetrievedChunk[] = [];
  const ids = new Set<string>();
  for (const chunk of chunks) {
    if (ids.has(chunk.id)) continue;
    if (
      kept.some(
        (other) =>
          other.sourceId === chunk.sourceId && overlap(other.content, chunk.content) >= 0.82,
      )
    )
      continue;
    ids.add(chunk.id);
    kept.push(chunk);
  }
  return kept;
}

export function filterQuestionCoherence(query: string, chunks: RetrievedChunk[]) {
  const stop = new Set([
    'what',
    'when',
    'where',
    'which',
    'that',
    'this',
    'with',
    'from',
    'about',
    'explain',
    'define',
  ]);
  const terms = [...words(query)].filter((term) => !stop.has(term));
  if (!terms.length) return chunks;
  const ranked = chunks.map((chunk) => ({
    chunk,
    matches: terms.filter((term) => chunk.content.toLowerCase().includes(term)).length,
  }));
  const best = Math.max(...ranked.map((item) => item.matches));
  if (best < Math.min(2, terms.length)) return chunks;
  return ranked.filter((item) => item.matches === best).map((item) => item.chunk);
}

export function selectQuestionContext(
  anchors: RetrievedChunk[],
  neighbors: RetrievedChunk[],
  maximumChunks = 8,
) {
  if (!anchors.length) return [];
  const anchorIds = new Set(anchors.slice(0, Math.min(4, maximumChunks)).map((chunk) => chunk.id));
  const anchorSources = new Set(anchors.map((chunk) => chunk.sourceId));
  const candidates = deduplicateChunks([
    ...anchors,
    ...neighbors.filter((chunk) => anchorSources.has(chunk.sourceId)),
  ]);
  const ranked = candidates.sort((a, b) => {
    const aAnchor = anchorIds.has(a.id) ? 1 : 0;
    const bAnchor = anchorIds.has(b.id) ? 1 : 0;
    return bAnchor - aAnchor || Number(b.similarity) - Number(a.similarity);
  });
  return sortDocumentChunks(ranked.slice(0, maximumChunks));
}

export function sortDocumentChunks(chunks: RetrievedChunk[]) {
  return [...chunks].sort(
    (a, b) =>
      a.sourceId.localeCompare(b.sourceId) ||
      a.chunkIndex - b.chunkIndex ||
      (a.pageStart ?? 0) - (b.pageStart ?? 0),
  );
}

export function selectDocumentCoverage(chunks: RetrievedChunk[], maxChunks = 8) {
  const ordered = sortDocumentChunks(deduplicateChunks(chunks));
  if (ordered.length <= maxChunks) return ordered;
  // Even coverage prevents a large document from becoming "the first N chunks" while
  // retaining its beginning and end. Chat uses a deliberately bounded representative
  // window so remote-provider rate limits remain predictable. The dedicated generation
  // endpoint performs the exhaustive hierarchical, batch-by-batch path.
  return Array.from(
    { length: maxChunks },
    (_, index) => ordered[Math.round((index * (ordered.length - 1)) / (maxChunks - 1))]!,
  );
}

export function selectDocumentContextByTokenBudget(
  chunks: RetrievedChunk[],
  tokenBudget = 12_000,
  maxChunks = 8,
) {
  // Document-level chat must remain a representative sample. A token budget alone
  // is not a safe bound because hundreds of small chunks can fit under it while the
  // context wrapper and citation metadata make the final prompt substantially larger.
  const ordered = selectDocumentCoverage(chunks, maxChunks);
  const estimated = (chunk: RetrievedChunk) => Math.ceil(chunk.content.length / 4) + 45;
  if (ordered.reduce((sum, chunk) => sum + estimated(chunk), 0) <= tokenBudget) return ordered;
  const groups = new Map<string, RetrievedChunk[]>();
  for (const chunk of ordered) {
    const metadata = chunk.metadata ?? {};
    const path = Array.isArray(metadata.headingPath) ? metadata.headingPath : [];
    const key = `${chunk.sourceId}:${String(path[0] ?? metadata.sectionTitle ?? chunk.chunkIndex)}`;
    groups.set(key, [...(groups.get(key) ?? []), chunk]);
  }
  const selected: RetrievedChunk[] = [];
  let used = 0;
  let round = 0;
  while (true) {
    let added = false;
    for (const group of groups.values()) {
      const chunk = group[round];
      if (!chunk) continue;
      const tokens = estimated(chunk);
      if (used + tokens > tokenBudget) continue;
      selected.push(chunk);
      used += tokens;
      added = true;
    }
    if (!added) break;
    round++;
  }
  return sortDocumentChunks(selected);
}

export function buildTutorContext(chunks: RetrievedChunk[]) {
  return chunks.map((chunk, index) => {
    const metadata = chunk.metadata ?? {};
    const headingPath = Array.isArray(metadata.headingPath)
      ? metadata.headingPath.filter((item): item is string => typeof item === 'string')
      : [];
    const confidence = metadata.headingConfidence;
    const section =
      confidence === 'low'
        ? undefined
        : typeof metadata.sectionTitle === 'string'
          ? metadata.sectionTitle
          : typeof metadata.sectionHeading === 'string'
            ? metadata.sectionHeading
            : undefined;
    return {
      marker: `S${index + 1}`,
      chunkId: chunk.id,
      documentId: chunk.sourceId,
      chunkIndex: chunk.chunkIndex,
      sourceName: chunk.sourceName,
      content: chunk.content,
      ...(chunk.pageStart ? { pageNumber: chunk.pageStart } : {}),
      ...(typeof metadata.slideNumber === 'number' ? { slideNumber: metadata.slideNumber } : {}),
      ...(section ? { section } : {}),
      ...(headingPath.length ? { headingPath } : {}),
    };
  });
}
