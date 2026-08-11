ALTER TYPE "AttemptStatus" ADD VALUE IF NOT EXISTS 'GRADING';
ALTER TABLE "QuizAnswer" ADD COLUMN "gradingKey" VARCHAR(64);
ALTER TABLE "QuizAnswer" ADD COLUMN "gradingMissed" JSONB;
CREATE INDEX "QuizAnswer_gradingKey_idx" ON "QuizAnswer"("gradingKey");
