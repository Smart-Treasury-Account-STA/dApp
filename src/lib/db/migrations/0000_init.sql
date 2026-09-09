CREATE TABLE "relayer_jobs" (
	"smart_account_id" text NOT NULL,
	"intent_id" text NOT NULL,
	"child_sequence" integer NOT NULL,
	"start_ledger" integer NOT NULL,
	"end_ledger" integer NOT NULL,
	"max_executions" integer NOT NULL,
	"execution_count" integer DEFAULT 0 NOT NULL,
	"status" text NOT NULL,
	"note" text NOT NULL,
	"tx_hash" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"version" integer DEFAULT 0 NOT NULL,
	CONSTRAINT "relayer_jobs_pkey" PRIMARY KEY("smart_account_id","intent_id"),
	CONSTRAINT "relayer_jobs_status_check" CHECK ("relayer_jobs"."status" = ANY (ARRAY['scheduled'::text, 'ready'::text, 'executing'::text, 'executed'::text, 'blocked'::text, 'failed'::text]))
);
--> statement-breakpoint
CREATE TABLE "treasuries" (
	"smart_account_id" text PRIMARY KEY NOT NULL,
	"policy_engine_id" text NOT NULL,
	"intent_registry_id" text NOT NULL,
	"recovery_manager_id" text NOT NULL,
	"transfer_adapter_id" text NOT NULL,
	"split_adapter_id" text NOT NULL,
	"owner_address" text NOT NULL,
	"executor_address" text NOT NULL,
	"deploy_tx_hash" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE INDEX "relayer_jobs_updated_at_idx" ON "relayer_jobs" USING btree ("updated_at" DESC NULLS FIRST);--> statement-breakpoint
CREATE INDEX "treasuries_owner_address_created_at_idx" ON "treasuries" USING btree ("owner_address","created_at" DESC NULLS FIRST);