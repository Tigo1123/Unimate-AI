ALTER TABLE "Summary" ADD COLUMN "generationKey" VARCHAR(64);
ALTER TABLE "FlashcardSet" ADD COLUMN "generationKey" VARCHAR(64);
ALTER TABLE "Quiz" ADD COLUMN "generationKey" VARCHAR(64);

CREATE UNIQUE INDEX "Summary_generationKey_key" ON "Summary"("generationKey");
CREATE UNIQUE INDEX "FlashcardSet_generationKey_key" ON "FlashcardSet"("generationKey");
CREATE UNIQUE INDEX "Quiz_generationKey_key" ON "Quiz"("generationKey");
