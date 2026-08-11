import { Prisma } from '@prisma/client';
import type { PrismaClient } from '@prisma/client';
import type { AIProvider } from '@unimate/ai';
import { writeAiTelemetry } from '../../infrastructure/observability/ai-telemetry.js';
import { expandedQueryTerms, hybridRerank } from './rag-context.js';

export type RetrievedChunk = {
  id: string;
  sourceId: string;
  sourceName: string;
  content: string;
  chunkIndex: number;
  pageStart: number | null;
  pageEnd: number | null;
  metadata: Record<string, unknown> | null;
  similarity: number;
  retrieval?: {
    vectorSimilarity: number;
    lexicalCoverage: number;
    headingCoverage: number;
    hybridScore: number;
  };
};

function vectorLiteral(vector: number[]) {
  if (!vector.length || vector.some((value) => !Number.isFinite(value)))
    throw new Error('Invalid query embedding');
  return `[${vector.join(',')}]`;
}

export class RetrievalService {
  constructor(
    private readonly prisma: PrismaClient,
    private readonly ai: AIProvider,
  ) {}
  async retrieve(input: {
    userId: string;
    courseId: string;
    sourceIds?: string[];
    query: string;
    limit: number;
  }) {
    const startedAt = performance.now();
    const embeddingStartedAt = performance.now();
    const embedding = await this.ai.embed(input.query);
    const embeddingMs = performance.now() - embeddingStartedAt;
    const queryStartedAt = performance.now();
    const sourceFilter = input.sourceIds?.length
      ? Prisma.sql`AND dc."sourceId" IN (${Prisma.join(
          input.sourceIds.map((sourceId) => Prisma.sql`${sourceId}::uuid`),
        )})`
      : Prisma.empty;
    const vectorRows = await this.prisma.$queryRaw<RetrievedChunk[]>(Prisma.sql`
      SELECT dc.id, dc."sourceId", s."displayName" AS "sourceName", dc.content, dc."chunkIndex",
             dc."pageStart", dc."pageEnd", dc.metadata,
             1 - (dc.embedding <=> ${vectorLiteral(embedding)}::vector) AS similarity
      FROM "DocumentChunk" dc
      JOIN "Source" s ON s.id = dc."sourceId"
      WHERE dc."userId" = ${input.userId}::uuid
        AND dc."courseId" = ${input.courseId}::uuid
        AND s."processingStatus" = 'READY'
        AND dc.embedding IS NOT NULL
        AND dc."embeddingModel" = ${this.ai.embeddingModel}
        ${sourceFilter}
      ORDER BY dc.embedding <=> ${vectorLiteral(embedding)}::vector
      LIMIT ${input.limit * 3}
    `);
    const terms = expandedQueryTerms(input.query);
    const lexicalRows = terms.length
      ? await this.prisma.$queryRaw<RetrievedChunk[]>(Prisma.sql`
          SELECT dc.id, dc."sourceId", s."displayName" AS "sourceName", dc.content,
                 dc."chunkIndex", dc."pageStart", dc."pageEnd", dc.metadata,
                 0::double precision AS similarity
          FROM "DocumentChunk" dc
          JOIN "Source" s ON s.id = dc."sourceId"
          WHERE dc."userId" = ${input.userId}::uuid
            AND dc."courseId" = ${input.courseId}::uuid
            AND s."processingStatus" = 'READY'
            ${sourceFilter}
            AND (${Prisma.join(
              terms.map(
                (term) => Prisma.sql`LOWER(dc.content) LIKE ${`%${term.toLocaleLowerCase()}%`}`,
              ),
              ' OR ',
            )})
          ORDER BY (${Prisma.join(
            terms.map(
              (term) =>
                Prisma.sql`CASE WHEN LOWER(dc.content) LIKE ${`%${term.toLocaleLowerCase()}%`} THEN 1 ELSE 0 END`,
            ),
            ' + ',
          )}) DESC, dc."chunkIndex" ASC
          LIMIT ${Math.max(80, input.limit * 10)}
        `)
      : [];
    const merged = new Map<string, RetrievedChunk>();
    for (const row of [...vectorRows, ...lexicalRows]) {
      const existing = merged.get(row.id);
      if (!existing || Number(row.similarity) > Number(existing.similarity))
        merged.set(row.id, row);
    }
    const rows = hybridRerank(input.query, [...merged.values()]).slice(0, input.limit);
    const timing = {
      kind: 'semantic',
      embeddingMs: Math.round(embeddingMs),
      databaseMs: Math.round(performance.now() - queryStartedAt),
      totalMs: Math.round(performance.now() - startedAt),
      rowsLoaded: rows.length,
    };
    writeAiTelemetry('info', 'RAG retrieval timing', timing);
    console.info('[RAG retrieval timing]', timing);
    return rows;
  }

  async retrieveNeighbors(input: {
    userId: string;
    courseId: string;
    sourceIds?: string[];
    anchors: RetrievedChunk[];
    radius?: number;
  }): Promise<RetrievedChunk[]> {
    const radius = input.radius ?? 1;
    if (!input.anchors.length) return [];
    const conditions = input.anchors.map((anchor) => ({
      sourceId: anchor.sourceId,
      chunkIndex: { gte: Math.max(0, anchor.chunkIndex - radius), lte: anchor.chunkIndex + radius },
    }));
    const rows = await this.prisma.documentChunk.findMany({
      where: {
        userId: input.userId,
        courseId: input.courseId,
        source: { processingStatus: 'READY' },
        ...(input.sourceIds?.length ? { sourceId: { in: input.sourceIds } } : {}),
        OR: conditions,
      },
      select: {
        id: true,
        sourceId: true,
        content: true,
        chunkIndex: true,
        pageStart: true,
        pageEnd: true,
        metadata: true,
        source: { select: { displayName: true } },
      },
    });
    const anchors = new Map(input.anchors.map((anchor) => [anchor.id, anchor]));
    return rows.map((row) => {
      const anchor = anchors.get(row.id);
      return {
        id: row.id,
        sourceId: row.sourceId,
        sourceName: row.source.displayName,
        content: row.content,
        chunkIndex: row.chunkIndex,
        pageStart: row.pageStart,
        pageEnd: row.pageEnd,
        metadata: row.metadata as Record<string, unknown> | null,
        similarity: anchor?.similarity ?? 0,
        ...(anchor?.retrieval ? { retrieval: anchor.retrieval } : {}),
      };
    });
  }

  async retrieveDocument(input: {
    userId: string;
    courseId: string;
    sourceIds?: string[];
  }): Promise<RetrievedChunk[]> {
    const startedAt = performance.now();
    const rows = await this.prisma.documentChunk.findMany({
      where: {
        userId: input.userId,
        courseId: input.courseId,
        source: { processingStatus: 'READY' },
        ...(input.sourceIds?.length ? { sourceId: { in: input.sourceIds } } : {}),
      },
      select: {
        id: true,
        sourceId: true,
        content: true,
        chunkIndex: true,
        pageStart: true,
        pageEnd: true,
        metadata: true,
        source: { select: { displayName: true } },
      },
      orderBy: [{ sourceId: 'asc' }, { chunkIndex: 'asc' }],
    });
    const timing = {
      kind: 'document',
      embeddingMs: 0,
      databaseMs: Math.round(performance.now() - startedAt),
      totalMs: Math.round(performance.now() - startedAt),
      rowsLoaded: rows.length,
    };
    writeAiTelemetry('info', 'RAG retrieval timing', timing);
    console.info('[RAG retrieval timing]', timing);
    return rows.map((row) => ({
      id: row.id,
      sourceId: row.sourceId,
      sourceName: row.source.displayName,
      content: row.content,
      chunkIndex: row.chunkIndex,
      pageStart: row.pageStart,
      pageEnd: row.pageEnd,
      metadata: row.metadata as Record<string, unknown> | null,
      similarity: 1,
    }));
  }
}
