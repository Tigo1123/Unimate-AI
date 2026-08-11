import { readFile } from 'node:fs/promises';
import path from 'node:path';
import type { PrismaClient } from '@prisma/client';
import type { AIProvider } from '@unimate/ai';
import { extractDocument } from './extraction.service.js';
import { semanticChunk } from './chunking.service.js';

export class SourceProcessorService {
  constructor(
    private readonly prisma: PrismaClient,
    private readonly ai: AIProvider,
    private readonly storageRoot: string,
  ) {}

  async process(sourceId: string) {
    const source = await this.prisma.source.findUnique({ where: { id: sourceId } });
    if (!source) throw new Error('Source no longer exists');
    await this.prisma.source.update({
      where: { id: source.id },
      data: { processingStatus: 'PROCESSING' },
    });
    const fullPath = path.resolve(this.storageRoot, source.storageKey);
    if (!fullPath.startsWith(`${this.storageRoot}${path.sep}`))
      throw new Error('Unsafe storage key');
    const units = await extractDocument(
      await readFile(fullPath),
      source.mimeType,
      source.extension,
    );
    const extractedText = units
      .map((unit) => unit.text)
      .filter(Boolean)
      .join('\n\n');
    if (!extractedText.trim()) throw new Error('No readable text was found in this document');
    const chunks = semanticChunk(units);
    if (!chunks.length) throw new Error('No useful study sections were found in this document');

    const vectors: number[][] = [];
    for (let start = 0; start < chunks.length; start += 64) {
      vectors.push(
        ...(await this.ai.embedBatch(
          chunks.slice(start, start + 64).map((chunk) => chunk.content),
        )),
      );
    }
    if (vectors.length !== chunks.length)
      throw new Error('Embedding provider returned an incomplete batch');

    await this.prisma.$transaction(
      async (tx) => {
        await tx.documentChunk.deleteMany({ where: { sourceId: source.id } });
        for (const [index, chunk] of chunks.entries()) {
          const created = await tx.documentChunk.create({
            data: {
              userId: source.userId,
              courseId: source.courseId,
              sourceId: source.id,
              chunkIndex: index,
              content: chunk.content,
              pageStart: chunk.pageStart ?? null,
              pageEnd: chunk.pageEnd ?? null,
              tokenCount: chunk.tokenCount,
              metadata: { ...chunk.metadata, documentId: source.id, chunkIndex: index },
              embeddingModel: this.ai.embeddingModel,
            },
          });
          const literal = `[${vectors[index]!.join(',')}]`;
          await tx.$executeRawUnsafe(
            'UPDATE "DocumentChunk" SET embedding = $1::vector WHERE id = $2::uuid',
            literal,
            created.id,
          );
        }
        await tx.source.update({
          where: { id: source.id },
          data: {
            processingStatus: 'READY',
            extractedText,
            pageCount: units.filter((unit) => unit.pageNumber).length || null,
            processedAt: new Date(),
            processingErrorCode: null,
            processingErrorMessage: null,
          },
        });
        await tx.activity.create({
          data: {
            userId: source.userId,
            courseId: source.courseId,
            type: 'SOURCE_READY',
            entityType: 'Source',
            entityId: source.id,
            metadata: {
              name: source.displayName,
              chunks: chunks.length,
              embeddingModel: this.ai.embeddingModel,
            },
          },
        });
      },
      { timeout: 120_000 },
    );
  }
}
