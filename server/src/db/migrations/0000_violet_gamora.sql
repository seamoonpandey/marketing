CREATE TYPE "public"."run_state" AS ENUM('running', 'awaiting_approval', 'completed', 'failed_retryable', 'failed_final', 'cancelled');--> statement-breakpoint
CREATE TABLE "audit_events" (
	"id" uuid PRIMARY KEY NOT NULL,
	"seq" bigint GENERATED ALWAYS AS IDENTITY (sequence name "audit_events_seq_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 9223372036854775807 START WITH 1 CACHE 1),
	"tenant_id" uuid DEFAULT nullif(current_setting('app.tenant_id', true), '')::uuid NOT NULL,
	"brand_id" uuid,
	"actor" text NOT NULL,
	"action" text NOT NULL,
	"object_type" text NOT NULL,
	"object_id" text NOT NULL,
	"object_version" integer,
	"result" text NOT NULL,
	"reason" text,
	"trace_id" text,
	"prev_hash" text,
	"hash" text NOT NULL,
	"created_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
ALTER TABLE "audit_events" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "brands" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"tenant_id" uuid DEFAULT nullif(current_setting('app.tenant_id', true), '')::uuid NOT NULL,
	"name" text NOT NULL,
	"slug" text NOT NULL,
	"website" text,
	"country" text DEFAULT 'NP' NOT NULL,
	"timezone" text DEFAULT 'Asia/Kathmandu' NOT NULL,
	"currency" text DEFAULT 'NPR' NOT NULL,
	"default_language" text DEFAULT 'en' NOT NULL,
	"languages" text[] DEFAULT '{en}'::text[] NOT NULL,
	"status" text DEFAULT 'active' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "brands" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "competitors" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"tenant_id" uuid DEFAULT nullif(current_setting('app.tenant_id', true), '')::uuid NOT NULL,
	"brand_id" uuid NOT NULL,
	"name" text NOT NULL,
	"kind" text DEFAULT 'direct' NOT NULL,
	"site" text,
	"handles" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"ad_library_url" text,
	"priority" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "competitors" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "cost_events" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"tenant_id" uuid DEFAULT nullif(current_setting('app.tenant_id', true), '')::uuid NOT NULL,
	"brand_id" uuid NOT NULL,
	"run_type" text NOT NULL,
	"run_id" text NOT NULL,
	"provider" text NOT NULL,
	"model" text NOT NULL,
	"input_tokens" integer NOT NULL,
	"output_tokens" integer NOT NULL,
	"ok" boolean NOT NULL,
	"rate_in_usd" numeric(12, 6) NOT NULL,
	"rate_out_usd" numeric(12, 6) NOT NULL,
	"usd_npr" numeric(12, 4) NOT NULL,
	"cost_usd" numeric(12, 6) NOT NULL,
	"cost_npr" numeric(12, 2) NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "cost_events" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "sources" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"tenant_id" uuid DEFAULT nullif(current_setting('app.tenant_id', true), '')::uuid NOT NULL,
	"brand_id" uuid NOT NULL,
	"kind" text NOT NULL,
	"uri" text NOT NULL,
	"mime" text NOT NULL,
	"checksum" text NOT NULL,
	"captured_at" timestamp with time zone DEFAULT now() NOT NULL,
	"object_key" text NOT NULL,
	"text" text,
	"trust" text NOT NULL,
	"meta" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "sources" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "tenants" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"name" text NOT NULL,
	"slug" text NOT NULL,
	"timezone" text DEFAULT 'Asia/Kathmandu' NOT NULL,
	"currency" text DEFAULT 'NPR' NOT NULL,
	"status" text DEFAULT 'active' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "tenants_slug_unique" UNIQUE("slug")
);
--> statement-breakpoint
CREATE TABLE "assets" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"tenant_id" uuid DEFAULT nullif(current_setting('app.tenant_id', true), '')::uuid NOT NULL,
	"brand_id" uuid NOT NULL,
	"source_id" uuid NOT NULL,
	"kind" text NOT NULL,
	"variant" text,
	"rights" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "assets" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "facts" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"tenant_id" uuid DEFAULT nullif(current_setting('app.tenant_id', true), '')::uuid NOT NULL,
	"brand_id" uuid NOT NULL,
	"section" text NOT NULL,
	"subject_id" uuid,
	"field" text NOT NULL,
	"value" jsonb NOT NULL,
	"unit" text,
	"language" text NOT NULL,
	"status" text NOT NULL,
	"origin" text NOT NULL,
	"confidence" numeric(3, 2),
	"source_id" uuid,
	"locator" jsonb,
	"warning" text,
	"version" integer DEFAULT 1 NOT NULL,
	"supersedes_id" uuid,
	"is_current" boolean DEFAULT true NOT NULL,
	"verified_by" text,
	"verified_at" timestamp with time zone,
	"expires_at" timestamp with time zone,
	"import_run_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "facts" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "import_runs" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"tenant_id" uuid DEFAULT nullif(current_setting('app.tenant_id', true), '')::uuid NOT NULL,
	"brand_id" uuid NOT NULL,
	"website_url" text,
	"source_ids" uuid[] DEFAULT '{}'::uuid[] NOT NULL,
	"stage" text DEFAULT 'fetch' NOT NULL,
	"counts" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"state" "run_state" DEFAULT 'running' NOT NULL,
	"error" text,
	"started_at" timestamp with time zone,
	"finished_at" timestamp with time zone,
	"estimate" jsonb,
	"actual" jsonb,
	"blocked" text,
	"workflow_id" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "import_runs" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "palette_colours" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"tenant_id" uuid DEFAULT nullif(current_setting('app.tenant_id', true), '')::uuid NOT NULL,
	"brand_id" uuid NOT NULL,
	"hex" text NOT NULL,
	"role" text,
	"origin" text NOT NULL,
	"share" numeric(5, 4),
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "palette_colours" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "subjects" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"tenant_id" uuid DEFAULT nullif(current_setting('app.tenant_id', true), '')::uuid NOT NULL,
	"brand_id" uuid NOT NULL,
	"type" text NOT NULL,
	"name" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "subjects" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "battlecards" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"tenant_id" uuid DEFAULT nullif(current_setting('app.tenant_id', true), '')::uuid NOT NULL,
	"brand_id" uuid NOT NULL,
	"competitor_id" uuid NOT NULL,
	"version" integer NOT NULL,
	"status" text DEFAULT 'draft' NOT NULL,
	"body" jsonb NOT NULL,
	"left_out" jsonb NOT NULL,
	"approved_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "battlecards" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "competitor_profiles" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"tenant_id" uuid DEFAULT nullif(current_setting('app.tenant_id', true), '')::uuid NOT NULL,
	"brand_id" uuid NOT NULL,
	"competitor_id" uuid NOT NULL,
	"profile" jsonb NOT NULL,
	"source_ids" uuid[] DEFAULT '{}'::uuid[] NOT NULL,
	"run_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "competitor_profiles" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "observations" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"tenant_id" uuid DEFAULT nullif(current_setting('app.tenant_id', true), '')::uuid NOT NULL,
	"brand_id" uuid NOT NULL,
	"competitor_id" uuid NOT NULL,
	"run_id" uuid NOT NULL,
	"type" text NOT NULL,
	"summary" text NOT NULL,
	"before" jsonb,
	"after" jsonb NOT NULL,
	"url" text NOT NULL,
	"observed_at" timestamp with time zone DEFAULT now() NOT NULL,
	"confidence" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "observations" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "opportunities" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"tenant_id" uuid DEFAULT nullif(current_setting('app.tenant_id', true), '')::uuid NOT NULL,
	"brand_id" uuid NOT NULL,
	"run_id" uuid,
	"title" text NOT NULL,
	"hypothesis" text NOT NULL,
	"suggested_action" text NOT NULL,
	"why_it_matters" text NOT NULL,
	"observation_ids" uuid[] NOT NULL,
	"confidence" text NOT NULL,
	"status" text DEFAULT 'new' NOT NULL,
	"decided_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "opportunities" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "watch_runs" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"tenant_id" uuid DEFAULT nullif(current_setting('app.tenant_id', true), '')::uuid NOT NULL,
	"brand_id" uuid NOT NULL,
	"trigger" text NOT NULL,
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
ALTER TABLE "watch_runs" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "watch_schedules" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"tenant_id" uuid DEFAULT nullif(current_setting('app.tenant_id', true), '')::uuid NOT NULL,
	"brand_id" uuid NOT NULL,
	"enabled" boolean DEFAULT false NOT NULL,
	"weekday" integer DEFAULT 1 NOT NULL,
	"hour" integer DEFAULT 6 NOT NULL,
	"last_run_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "watch_schedules" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "watch_targets" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"tenant_id" uuid DEFAULT nullif(current_setting('app.tenant_id', true), '')::uuid NOT NULL,
	"brand_id" uuid NOT NULL,
	"competitor_id" uuid NOT NULL,
	"url" text NOT NULL,
	"label" text,
	"status" text DEFAULT 'active' NOT NULL,
	"fail_count" integer DEFAULT 0 NOT NULL,
	"last_error" text,
	"last_source_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "watch_targets" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "audit_events" ADD CONSTRAINT "audit_events_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "brands" ADD CONSTRAINT "brands_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "competitors" ADD CONSTRAINT "competitors_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "competitors" ADD CONSTRAINT "competitors_brand_id_brands_id_fk" FOREIGN KEY ("brand_id") REFERENCES "public"."brands"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "cost_events" ADD CONSTRAINT "cost_events_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "cost_events" ADD CONSTRAINT "cost_events_brand_id_brands_id_fk" FOREIGN KEY ("brand_id") REFERENCES "public"."brands"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sources" ADD CONSTRAINT "sources_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sources" ADD CONSTRAINT "sources_brand_id_brands_id_fk" FOREIGN KEY ("brand_id") REFERENCES "public"."brands"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "assets" ADD CONSTRAINT "assets_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "assets" ADD CONSTRAINT "assets_brand_id_brands_id_fk" FOREIGN KEY ("brand_id") REFERENCES "public"."brands"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "assets" ADD CONSTRAINT "assets_source_id_sources_id_fk" FOREIGN KEY ("source_id") REFERENCES "public"."sources"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "facts" ADD CONSTRAINT "facts_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "facts" ADD CONSTRAINT "facts_brand_id_brands_id_fk" FOREIGN KEY ("brand_id") REFERENCES "public"."brands"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "facts" ADD CONSTRAINT "facts_subject_id_subjects_id_fk" FOREIGN KEY ("subject_id") REFERENCES "public"."subjects"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "facts" ADD CONSTRAINT "facts_source_id_sources_id_fk" FOREIGN KEY ("source_id") REFERENCES "public"."sources"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "import_runs" ADD CONSTRAINT "import_runs_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "import_runs" ADD CONSTRAINT "import_runs_brand_id_brands_id_fk" FOREIGN KEY ("brand_id") REFERENCES "public"."brands"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "palette_colours" ADD CONSTRAINT "palette_colours_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "palette_colours" ADD CONSTRAINT "palette_colours_brand_id_brands_id_fk" FOREIGN KEY ("brand_id") REFERENCES "public"."brands"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "subjects" ADD CONSTRAINT "subjects_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "subjects" ADD CONSTRAINT "subjects_brand_id_brands_id_fk" FOREIGN KEY ("brand_id") REFERENCES "public"."brands"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "battlecards" ADD CONSTRAINT "battlecards_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "battlecards" ADD CONSTRAINT "battlecards_brand_id_brands_id_fk" FOREIGN KEY ("brand_id") REFERENCES "public"."brands"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "competitor_profiles" ADD CONSTRAINT "competitor_profiles_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "competitor_profiles" ADD CONSTRAINT "competitor_profiles_brand_id_brands_id_fk" FOREIGN KEY ("brand_id") REFERENCES "public"."brands"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "observations" ADD CONSTRAINT "observations_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "observations" ADD CONSTRAINT "observations_brand_id_brands_id_fk" FOREIGN KEY ("brand_id") REFERENCES "public"."brands"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "opportunities" ADD CONSTRAINT "opportunities_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "opportunities" ADD CONSTRAINT "opportunities_brand_id_brands_id_fk" FOREIGN KEY ("brand_id") REFERENCES "public"."brands"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "watch_runs" ADD CONSTRAINT "watch_runs_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "watch_runs" ADD CONSTRAINT "watch_runs_brand_id_brands_id_fk" FOREIGN KEY ("brand_id") REFERENCES "public"."brands"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "watch_schedules" ADD CONSTRAINT "watch_schedules_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "watch_schedules" ADD CONSTRAINT "watch_schedules_brand_id_brands_id_fk" FOREIGN KEY ("brand_id") REFERENCES "public"."brands"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "watch_targets" ADD CONSTRAINT "watch_targets_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "watch_targets" ADD CONSTRAINT "watch_targets_brand_id_brands_id_fk" FOREIGN KEY ("brand_id") REFERENCES "public"."brands"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "audit_events_chain" ON "audit_events" USING btree ("tenant_id","brand_id","seq");--> statement-breakpoint
CREATE UNIQUE INDEX "brands_tenant_slug" ON "brands" USING btree ("tenant_id","slug");--> statement-breakpoint
CREATE INDEX "cost_events_tenant_time" ON "cost_events" USING btree ("tenant_id","created_at");--> statement-breakpoint
CREATE INDEX "sources_brand" ON "sources" USING btree ("brand_id");--> statement-breakpoint
CREATE INDEX "assets_brand" ON "assets" USING btree ("brand_id");--> statement-breakpoint
CREATE INDEX "facts_current_key" ON "facts" USING btree ("brand_id","section","field","subject_id") WHERE is_current;--> statement-breakpoint
CREATE UNIQUE INDEX "facts_supersedes" ON "facts" USING btree ("supersedes_id");--> statement-breakpoint
CREATE INDEX "import_runs_brand" ON "import_runs" USING btree ("brand_id","created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "palette_colours_brand_hex" ON "palette_colours" USING btree ("brand_id","hex");--> statement-breakpoint
CREATE INDEX "subjects_brand" ON "subjects" USING btree ("brand_id","type");--> statement-breakpoint
CREATE UNIQUE INDEX "battlecards_version" ON "battlecards" USING btree ("competitor_id","version");--> statement-breakpoint
CREATE INDEX "competitor_profiles_competitor" ON "competitor_profiles" USING btree ("competitor_id","created_at");--> statement-breakpoint
CREATE INDEX "observations_brand_time" ON "observations" USING btree ("brand_id","observed_at");--> statement-breakpoint
CREATE UNIQUE INDEX "watch_runs_one_active" ON "watch_runs" USING btree ("brand_id") WHERE state in ('running', 'awaiting_approval');--> statement-breakpoint
CREATE UNIQUE INDEX "watch_schedules_brand" ON "watch_schedules" USING btree ("brand_id");--> statement-breakpoint
CREATE UNIQUE INDEX "watch_targets_brand_url" ON "watch_targets" USING btree ("brand_id","url");--> statement-breakpoint
CREATE POLICY "audit_events_isolation" ON "audit_events" AS PERMISSIVE FOR ALL TO "marketing_app" USING (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid and (brand_id is null or brand_id = any(coalesce(nullif(current_setting('app.brand_ids', true), ''), '{}')::uuid[]))) WITH CHECK (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid and (brand_id is null or brand_id = any(coalesce(nullif(current_setting('app.brand_ids', true), ''), '{}')::uuid[])));--> statement-breakpoint
CREATE POLICY "brands_tenant_isolation" ON "brands" AS PERMISSIVE FOR ALL TO "marketing_app" USING (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid) WITH CHECK (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid);--> statement-breakpoint
CREATE POLICY "competitors_brand_isolation" ON "competitors" AS PERMISSIVE FOR ALL TO "marketing_app" USING (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid and brand_id = any(coalesce(nullif(current_setting('app.brand_ids', true), ''), '{}')::uuid[])) WITH CHECK (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid and brand_id = any(coalesce(nullif(current_setting('app.brand_ids', true), ''), '{}')::uuid[]));--> statement-breakpoint
CREATE POLICY "cost_events_brand_isolation" ON "cost_events" AS PERMISSIVE FOR ALL TO "marketing_app" USING (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid and brand_id = any(coalesce(nullif(current_setting('app.brand_ids', true), ''), '{}')::uuid[])) WITH CHECK (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid and brand_id = any(coalesce(nullif(current_setting('app.brand_ids', true), ''), '{}')::uuid[]));--> statement-breakpoint
CREATE POLICY "sources_brand_isolation" ON "sources" AS PERMISSIVE FOR ALL TO "marketing_app" USING (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid and brand_id = any(coalesce(nullif(current_setting('app.brand_ids', true), ''), '{}')::uuid[])) WITH CHECK (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid and brand_id = any(coalesce(nullif(current_setting('app.brand_ids', true), ''), '{}')::uuid[]));--> statement-breakpoint
CREATE POLICY "assets_brand_isolation" ON "assets" AS PERMISSIVE FOR ALL TO "marketing_app" USING (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid and brand_id = any(coalesce(nullif(current_setting('app.brand_ids', true), ''), '{}')::uuid[])) WITH CHECK (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid and brand_id = any(coalesce(nullif(current_setting('app.brand_ids', true), ''), '{}')::uuid[]));--> statement-breakpoint
CREATE POLICY "facts_brand_isolation" ON "facts" AS PERMISSIVE FOR ALL TO "marketing_app" USING (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid and brand_id = any(coalesce(nullif(current_setting('app.brand_ids', true), ''), '{}')::uuid[])) WITH CHECK (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid and brand_id = any(coalesce(nullif(current_setting('app.brand_ids', true), ''), '{}')::uuid[]));--> statement-breakpoint
CREATE POLICY "import_runs_brand_isolation" ON "import_runs" AS PERMISSIVE FOR ALL TO "marketing_app" USING (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid and brand_id = any(coalesce(nullif(current_setting('app.brand_ids', true), ''), '{}')::uuid[])) WITH CHECK (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid and brand_id = any(coalesce(nullif(current_setting('app.brand_ids', true), ''), '{}')::uuid[]));--> statement-breakpoint
CREATE POLICY "palette_colours_brand_isolation" ON "palette_colours" AS PERMISSIVE FOR ALL TO "marketing_app" USING (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid and brand_id = any(coalesce(nullif(current_setting('app.brand_ids', true), ''), '{}')::uuid[])) WITH CHECK (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid and brand_id = any(coalesce(nullif(current_setting('app.brand_ids', true), ''), '{}')::uuid[]));--> statement-breakpoint
CREATE POLICY "subjects_brand_isolation" ON "subjects" AS PERMISSIVE FOR ALL TO "marketing_app" USING (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid and brand_id = any(coalesce(nullif(current_setting('app.brand_ids', true), ''), '{}')::uuid[])) WITH CHECK (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid and brand_id = any(coalesce(nullif(current_setting('app.brand_ids', true), ''), '{}')::uuid[]));--> statement-breakpoint
CREATE POLICY "battlecards_brand_isolation" ON "battlecards" AS PERMISSIVE FOR ALL TO "marketing_app" USING (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid and brand_id = any(coalesce(nullif(current_setting('app.brand_ids', true), ''), '{}')::uuid[])) WITH CHECK (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid and brand_id = any(coalesce(nullif(current_setting('app.brand_ids', true), ''), '{}')::uuid[]));--> statement-breakpoint
CREATE POLICY "competitor_profiles_brand_isolation" ON "competitor_profiles" AS PERMISSIVE FOR ALL TO "marketing_app" USING (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid and brand_id = any(coalesce(nullif(current_setting('app.brand_ids', true), ''), '{}')::uuid[])) WITH CHECK (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid and brand_id = any(coalesce(nullif(current_setting('app.brand_ids', true), ''), '{}')::uuid[]));--> statement-breakpoint
CREATE POLICY "observations_brand_isolation" ON "observations" AS PERMISSIVE FOR ALL TO "marketing_app" USING (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid and brand_id = any(coalesce(nullif(current_setting('app.brand_ids', true), ''), '{}')::uuid[])) WITH CHECK (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid and brand_id = any(coalesce(nullif(current_setting('app.brand_ids', true), ''), '{}')::uuid[]));--> statement-breakpoint
CREATE POLICY "opportunities_brand_isolation" ON "opportunities" AS PERMISSIVE FOR ALL TO "marketing_app" USING (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid and brand_id = any(coalesce(nullif(current_setting('app.brand_ids', true), ''), '{}')::uuid[])) WITH CHECK (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid and brand_id = any(coalesce(nullif(current_setting('app.brand_ids', true), ''), '{}')::uuid[]));--> statement-breakpoint
CREATE POLICY "watch_runs_brand_isolation" ON "watch_runs" AS PERMISSIVE FOR ALL TO "marketing_app" USING (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid and brand_id = any(coalesce(nullif(current_setting('app.brand_ids', true), ''), '{}')::uuid[])) WITH CHECK (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid and brand_id = any(coalesce(nullif(current_setting('app.brand_ids', true), ''), '{}')::uuid[]));--> statement-breakpoint
CREATE POLICY "watch_schedules_brand_isolation" ON "watch_schedules" AS PERMISSIVE FOR ALL TO "marketing_app" USING (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid and brand_id = any(coalesce(nullif(current_setting('app.brand_ids', true), ''), '{}')::uuid[])) WITH CHECK (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid and brand_id = any(coalesce(nullif(current_setting('app.brand_ids', true), ''), '{}')::uuid[]));--> statement-breakpoint
CREATE POLICY "watch_targets_brand_isolation" ON "watch_targets" AS PERMISSIVE FOR ALL TO "marketing_app" USING (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid and brand_id = any(coalesce(nullif(current_setting('app.brand_ids', true), ''), '{}')::uuid[])) WITH CHECK (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid and brand_id = any(coalesce(nullif(current_setting('app.brand_ids', true), ''), '{}')::uuid[]));