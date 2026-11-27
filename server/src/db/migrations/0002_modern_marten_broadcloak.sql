CREATE TABLE "studio_drafts" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"tenant_id" uuid DEFAULT nullif(current_setting('app.tenant_id', true), '')::uuid NOT NULL,
	"brand_id" uuid NOT NULL,
	"plan_item_id" uuid NOT NULL,
	"kind" text NOT NULL,
	"status" text DEFAULT 'draft' NOT NULL,
	"current_version" integer DEFAULT 1 NOT NULL,
	"ready_version" integer,
	"ready_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "studio_drafts" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "studio_runs" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"tenant_id" uuid DEFAULT nullif(current_setting('app.tenant_id', true), '')::uuid NOT NULL,
	"brand_id" uuid NOT NULL,
	"kind" text NOT NULL,
	"targets" jsonb DEFAULT '[]'::jsonb NOT NULL,
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
ALTER TABLE "studio_runs" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "studio_versions" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"tenant_id" uuid DEFAULT nullif(current_setting('app.tenant_id', true), '')::uuid NOT NULL,
	"brand_id" uuid NOT NULL,
	"draft_id" uuid NOT NULL,
	"version" integer NOT NULL,
	"origin" text NOT NULL,
	"content" jsonb NOT NULL,
	"left_out" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"renders" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "studio_versions" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "studio_drafts" ADD CONSTRAINT "studio_drafts_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "studio_drafts" ADD CONSTRAINT "studio_drafts_brand_id_brands_id_fk" FOREIGN KEY ("brand_id") REFERENCES "public"."brands"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "studio_runs" ADD CONSTRAINT "studio_runs_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "studio_runs" ADD CONSTRAINT "studio_runs_brand_id_brands_id_fk" FOREIGN KEY ("brand_id") REFERENCES "public"."brands"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "studio_versions" ADD CONSTRAINT "studio_versions_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "studio_versions" ADD CONSTRAINT "studio_versions_brand_id_brands_id_fk" FOREIGN KEY ("brand_id") REFERENCES "public"."brands"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "studio_drafts_item" ON "studio_drafts" USING btree ("brand_id","plan_item_id");--> statement-breakpoint
CREATE INDEX "studio_runs_brand" ON "studio_runs" USING btree ("brand_id","created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "studio_versions_draft" ON "studio_versions" USING btree ("draft_id","version");--> statement-breakpoint
CREATE POLICY "studio_drafts_brand_isolation" ON "studio_drafts" AS PERMISSIVE FOR ALL TO "marketing_app" USING (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid and brand_id = any(coalesce(nullif(current_setting('app.brand_ids', true), ''), '{}')::uuid[])) WITH CHECK (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid and brand_id = any(coalesce(nullif(current_setting('app.brand_ids', true), ''), '{}')::uuid[]));--> statement-breakpoint
CREATE POLICY "studio_runs_brand_isolation" ON "studio_runs" AS PERMISSIVE FOR ALL TO "marketing_app" USING (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid and brand_id = any(coalesce(nullif(current_setting('app.brand_ids', true), ''), '{}')::uuid[])) WITH CHECK (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid and brand_id = any(coalesce(nullif(current_setting('app.brand_ids', true), ''), '{}')::uuid[]));--> statement-breakpoint
CREATE POLICY "studio_versions_brand_isolation" ON "studio_versions" AS PERMISSIVE FOR ALL TO "marketing_app" USING (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid and brand_id = any(coalesce(nullif(current_setting('app.brand_ids', true), ''), '{}')::uuid[])) WITH CHECK (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid and brand_id = any(coalesce(nullif(current_setting('app.brand_ids', true), ''), '{}')::uuid[]));