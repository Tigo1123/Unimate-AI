CREATE TABLE "AiTelemetryEvent" (
    "id" UUID NOT NULL,
    "observedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "level" VARCHAR(10) NOT NULL,
    "event" VARCHAR(100) NOT NULL,
    "pid" INTEGER,
    "feature" VARCHAR(80),
    "provider" VARCHAR(40),
    "model" VARCHAR(120),
    "outcome" VARCHAR(30),
    "status" INTEGER,
    "providerRequests" INTEGER,
    "estimatedInputTokens" INTEGER,
    "promptTokens" INTEGER,
    "outputTokens" INTEGER,
    "thinkingTokens" INTEGER,
    "batchCount" INTEGER,
    "synthesisRequestCount" INTEGER,
    "cacheStatus" VARCHAR(30),
    "cacheHits" INTEGER,
    "cacheMisses" INTEGER,
    "sharedBatches" INTEGER,
    "openAnswerCount" INTEGER,
    "totalLatencyMs" INTEGER,
    "metadata" JSONB NOT NULL,
    "fingerprint" VARCHAR(64),
    CONSTRAINT "AiTelemetryEvent_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "AiQuotaObservation" (
    "id" UUID NOT NULL,
    "provider" VARCHAR(40) NOT NULL,
    "model" VARCHAR(120) NOT NULL,
    "quotaId" VARCHAR(240) NOT NULL,
    "quotaMetric" VARCHAR(300),
    "quotaValue" DOUBLE PRECISION,
    "quotaDimensions" JSONB NOT NULL,
    "rateLimitScope" VARCHAR(20) NOT NULL,
    "observedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "resetAt" TIMESTAMP(3),
    "eventId" UUID,
    CONSTRAINT "AiQuotaObservation_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "AiTelemetryEvent_fingerprint_key" ON "AiTelemetryEvent"("fingerprint");
CREATE INDEX "AiTelemetryEvent_observedAt_idx" ON "AiTelemetryEvent"("observedAt");
CREATE INDEX "AiTelemetryEvent_event_observedAt_idx" ON "AiTelemetryEvent"("event", "observedAt");
CREATE INDEX "AiTelemetryEvent_provider_model_observedAt_idx" ON "AiTelemetryEvent"("provider", "model", "observedAt");
CREATE INDEX "AiTelemetryEvent_feature_observedAt_idx" ON "AiTelemetryEvent"("feature", "observedAt");
CREATE UNIQUE INDEX "AiQuotaObservation_eventId_key" ON "AiQuotaObservation"("eventId");
CREATE INDEX "AiQuotaObservation_provider_model_observedAt_idx" ON "AiQuotaObservation"("provider", "model", "observedAt");
CREATE INDEX "AiQuotaObservation_quotaId_observedAt_idx" ON "AiQuotaObservation"("quotaId", "observedAt");
