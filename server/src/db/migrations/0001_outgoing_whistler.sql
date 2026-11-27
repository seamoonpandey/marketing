CREATE TABLE "campaign_briefs" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"tenant_id" uuid DEFAULT nullif(current_setting('app.tenant_id', true), '')::uuid NOT NULL,
	"brand_id" uuid NOT NULL,
	"campaign_id" uuid NOT NULL,
	"version" integer NOT NULL,
	"status" text DEFAULT 'draft' NOT NULL,
	"body" jsonb NOT NULL,
	"left_out" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"approved_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "campaign_briefs" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "campaigns" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"tenant_id" uuid DEFAULT nullif(current_setting('app.tenant_id', true), '')::uuid NOT NULL,
	"brand_id" uuid NOT NULL,
	"name" text NOT NULL,
	"objective" text NOT NULL,
	"status" text DEFAULT 'draft' NOT NULL,
	"starts_on" date,
	"ends_on" date,
	"segment_id" uuid,
	"opportunity_id" uuid,
	"budget_npr" numeric(12, 2),
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "campaigns" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "plan_items" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"tenant_id" uuid DEFAULT nullif(current_setting('app.tenant_id', true), '')::uuid NOT NULL,
	"brand_id" uuid NOT NULL,
	"week_plan_id" uuid NOT NULL,
	"day" date NOT NULL,
	"channel" text NOT NULL,
	"format" text,
	"pillar" text,
	"funnel" text,
	"intent" text,
	"segment_id" uuid,
	"campaign_id" uuid,
	"idea" text DEFAULT '' NOT NULL,
	"cta" text DEFAULT '' NOT NULL,
	"fact_ids" uuid[] DEFAULT '{}'::uuid[] NOT NULL,
	"position" integer DEFAULT 0 NOT NULL,
	"origin" text DEFAULT 'owner' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "plan_items" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "plan_runs" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"tenant_id" uuid DEFAULT nullif(current_setting('app.tenant_id', true), '')::uuid NOT NULL,
	"brand_id" uuid NOT NULL,
	"kind" text NOT NULL,
	"target_id" text NOT NULL,
	"workflow_id" text,
	"counts" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"state" "run_state" DEFAULT 'running' NOT NULL,
	"error" text,
	"started_at" timestamp with time zone,
	"finished_at" timestamp with time zone,
	"estimate" jsonb,
	"actual" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "plan_runs" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "plan_settings" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"tenant_id" uuid DEFAULT nullif(current_setting('app.tenant_id', true), '')::uuid NOT NULL,
	"brand_id" uuid NOT NULL,
	"channels" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"pillars" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"week_starts" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "plan_settings" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "week_plans" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"tenant_id" uuid DEFAULT nullif(current_setting('app.tenant_id', true), '')::uuid NOT NULL,
	"brand_id" uuid NOT NULL,
	"week_start" date NOT NULL,
	"version" integer NOT NULL,
	"status" text DEFAULT 'draft' NOT NULL,
	"approved_at" timestamp with time zone,
	"run_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "week_plans" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "campaign_briefs" ADD CONSTRAINT "campaign_briefs_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "campaign_briefs" ADD CONSTRAINT "campaign_briefs_brand_id_brands_id_fk" FOREIGN KEY ("brand_id") REFERENCES "public"."brands"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "campaigns" ADD CONSTRAINT "campaigns_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "campaigns" ADD CONSTRAINT "campaigns_brand_id_brands_id_fk" FOREIGN KEY ("brand_id") REFERENCES "public"."brands"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "plan_items" ADD CONSTRAINT "plan_items_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "plan_items" ADD CONSTRAINT "plan_items_brand_id_brands_id_fk" FOREIGN KEY ("brand_id") REFERENCES "public"."brands"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "plan_runs" ADD CONSTRAINT "plan_runs_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "plan_runs" ADD CONSTRAINT "plan_runs_brand_id_brands_id_fk" FOREIGN KEY ("brand_id") REFERENCES "public"."brands"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "plan_settings" ADD CONSTRAINT "plan_settings_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "plan_settings" ADD CONSTRAINT "plan_settings_brand_id_brands_id_fk" FOREIGN KEY ("brand_id") REFERENCES "public"."brands"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "week_plans" ADD CONSTRAINT "week_plans_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "week_plans" ADD CONSTRAINT "week_plans_brand_id_brands_id_fk" FOREIGN KEY ("brand_id") REFERENCES "public"."brands"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "campaign_briefs_version" ON "campaign_briefs" USING btree ("campaign_id","version");--> statement-breakpoint
CREATE INDEX "campaigns_brand" ON "campaigns" USING btree ("brand_id","created_at");--> statement-breakpoint
CREATE INDEX "plan_items_week" ON "plan_items" USING btree ("week_plan_id");--> statement-breakpoint
CREATE UNIQUE INDEX "plan_runs_one_active" ON "plan_runs" USING btree ("brand_id","kind","target_id") WHERE state in ('running', 'awaiting_approval');--> statement-breakpoint
CREATE UNIQUE INDEX "plan_settings_brand" ON "plan_settings" USING btree ("brand_id");--> statement-breakpoint
CREATE UNIQUE INDEX "week_plans_version" ON "week_plans" USING btree ("brand_id","week_start","version");--> statement-breakpoint
CREATE POLICY "campaign_briefs_brand_isolation" ON "campaign_briefs" AS PERMISSIVE FOR ALL TO "marketing_app" USING (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid and brand_id = any(coalesce(nullif(current_setting('app.brand_ids', true), ''), '{}')::uuid[])) WITH CHECK (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid and brand_id = any(coalesce(nullif(current_setting('app.brand_ids', true), ''), '{}')::uuid[]));--> statement-breakpoint
CREATE POLICY "campaigns_brand_isolation" ON "campaigns" AS PERMISSIVE FOR ALL TO "marketing_app" USING (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid and brand_id = any(coalesce(nullif(current_setting('app.brand_ids', true), ''), '{}')::uuid[])) WITH CHECK (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid and brand_id = any(coalesce(nullif(current_setting('app.brand_ids', true), ''), '{}')::uuid[]));--> statement-breakpoint
CREATE POLICY "plan_items_brand_isolation" ON "plan_items" AS PERMISSIVE FOR ALL TO "marketing_app" USING (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid and brand_id = any(coalesce(nullif(current_setting('app.brand_ids', true), ''), '{}')::uuid[])) WITH CHECK (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid and brand_id = any(coalesce(nullif(current_setting('app.brand_ids', true), ''), '{}')::uuid[]));--> statement-breakpoint
CREATE POLICY "plan_runs_brand_isolation" ON "plan_runs" AS PERMISSIVE FOR ALL TO "marketing_app" USING (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid and brand_id = any(coalesce(nullif(current_setting('app.brand_ids', true), ''), '{}')::uuid[])) WITH CHECK (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid and brand_id = any(coalesce(nullif(current_setting('app.brand_ids', true), ''), '{}')::uuid[]));--> statement-breakpoint
CREATE POLICY "plan_settings_brand_isolation" ON "plan_settings" AS PERMISSIVE FOR ALL TO "marketing_app" USING (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid and brand_id = any(coalesce(nullif(current_setting('app.brand_ids', true), ''), '{}')::uuid[])) WITH CHECK (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid and brand_id = any(coalesce(nullif(current_setting('app.brand_ids', true), ''), '{}')::uuid[]));--> statement-breakpoint
CREATE POLICY "week_plans_brand_isolation" ON "week_plans" AS PERMISSIVE FOR ALL TO "marketing_app" USING (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid and brand_id = any(coalesce(nullif(current_setting('app.brand_ids', true), ''), '{}')::uuid[])) WITH CHECK (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid and brand_id = any(coalesce(nullif(current_setting('app.brand_ids', true), ''), '{}')::uuid[]));