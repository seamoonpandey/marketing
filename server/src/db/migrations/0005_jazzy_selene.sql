CREATE TABLE "discovery_candidates" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"tenant_id" uuid DEFAULT nullif(current_setting('app.tenant_id', true), '')::uuid NOT NULL,
	"brand_id" uuid NOT NULL,
	"match_key" text NOT NULL,
	"name" text NOT NULL,
	"site" text,
	"channels" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"place_cid" text,
	"place" jsonb,
	"cells" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"source_ids" uuid[] DEFAULT '{}'::uuid[] NOT NULL,
	"rank" integer NOT NULL,
	"status" text DEFAULT 'new' NOT NULL,
	"competitor_id" uuid,
	"first_run_id" uuid NOT NULL,
	"last_run_id" uuid NOT NULL,
	"last_found_at" timestamp with time zone DEFAULT now() NOT NULL,
	"dismissed_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "discovery_candidates" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "discovery_runs" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"tenant_id" uuid DEFAULT nullif(current_setting('app.tenant_id', true), '')::uuid NOT NULL,
	"brand_id" uuid NOT NULL,
	"keywords" text[] NOT NULL,
	"results" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"own_row" jsonb,
	"counts" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"workflow_id" text,
	"state" "run_state" DEFAULT 'running' NOT NULL,
	"error" text,
	"started_at" timestamp with time zone,
	"finished_at" timestamp with time zone,
	"estimate" jsonb,
	"actual" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "discovery_runs" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "opportunities" ADD COLUMN "kind" text DEFAULT 'change' NOT NULL;--> statement-breakpoint
ALTER TABLE "opportunities" ADD COLUMN "impact" text DEFAULT 'medium' NOT NULL;--> statement-breakpoint
ALTER TABLE "opportunities" ADD COLUMN "effort" text DEFAULT 'medium' NOT NULL;--> statement-breakpoint
ALTER TABLE "opportunities" ADD COLUMN "evidence" jsonb DEFAULT '[]'::jsonb NOT NULL;--> statement-breakpoint
ALTER TABLE "discovery_candidates" ADD CONSTRAINT "discovery_candidates_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "discovery_candidates" ADD CONSTRAINT "discovery_candidates_brand_id_brands_id_fk" FOREIGN KEY ("brand_id") REFERENCES "public"."brands"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "discovery_runs" ADD CONSTRAINT "discovery_runs_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "discovery_runs" ADD CONSTRAINT "discovery_runs_brand_id_brands_id_fk" FOREIGN KEY ("brand_id") REFERENCES "public"."brands"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "discovery_candidates_key" ON "discovery_candidates" USING btree ("brand_id","match_key");--> statement-breakpoint
CREATE UNIQUE INDEX "discovery_runs_one_active" ON "discovery_runs" USING btree ("brand_id") WHERE state in ('running', 'awaiting_approval');--> statement-breakpoint
CREATE POLICY "discovery_candidates_brand_isolation" ON "discovery_candidates" AS PERMISSIVE FOR ALL TO "marketing_app" USING (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid and brand_id = any(coalesce(nullif(current_setting('app.brand_ids', true), ''), '{}')::uuid[])) WITH CHECK (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid and brand_id = any(coalesce(nullif(current_setting('app.brand_ids', true), ''), '{}')::uuid[]));--> statement-breakpoint
CREATE POLICY "discovery_runs_brand_isolation" ON "discovery_runs" AS PERMISSIVE FOR ALL TO "marketing_app" USING (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid and brand_id = any(coalesce(nullif(current_setting('app.brand_ids', true), ''), '{}')::uuid[])) WITH CHECK (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid and brand_id = any(coalesce(nullif(current_setting('app.brand_ids', true), ''), '{}')::uuid[]));