CREATE TABLE "auvora_sponsorship" (
    "digest" TEXT NOT NULL,
    "scope" TEXT NOT NULL,
    "sender" TEXT NOT NULL,
    "public_key" TEXT NOT NULL,
    "nonce" DECIMAL(20,0) NOT NULL,
    "workflow" BIGINT NOT NULL,
    "method" TEXT NOT NULL,
    "hash" TEXT NOT NULL,
    "signed" TEXT NOT NULL,
    "reserved" DECIMAL(39,0) NOT NULL,
    "state" TEXT NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "auvora_sponsorship_pkey" PRIMARY KEY ("digest"),
    CONSTRAINT "auvora_sponsorship_reserved_check" CHECK ("reserved" > 0),
    CONSTRAINT "auvora_sponsorship_state_check" CHECK ("state" IN ('Pending','Succeeded','Failed'))
);

CREATE UNIQUE INDEX "auvora_sponsorship_scope_sender_public_key_nonce_key"
ON "auvora_sponsorship"("scope", "sender", "public_key", "nonce");

CREATE INDEX "auvora_sponsorship_scope_date"
ON "auvora_sponsorship"("scope", "created_at");
