CREATE TABLE "channels" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"tenant_id" uuid DEFAULT nullif(current_setting('app.tenant_id', true), '')::uuid NOT NULL,
	"brand_id" uuid NOT NULL,
	"platform" text NOT NULL,
	"mode" text DEFAULT 'manual' NOT NULL,
	"connector" text DEFAULT 'manual' NOT NULL,
	"account_name" text NOT NULL,
	"account_url" text,
	"status" text DEFAULT 'connected' NOT NULL,
	"last_verified_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "channels" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "publish_jobs" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"tenant_id" uuid DEFAULT nullif(current_setting('app.tenant_id', true), '')::uuid NOT NULL,
	"brand_id" uuid NOT NULL,
	"draft_id" uuid NOT NULL,
	"draft_version" integer NOT NULL,
	"payload_hash" text NOT NULL,
	"channel_id" uuid NOT NULL,
	"scheduled_at" timestamp with time zone NOT NULL,
	"state" text DEFAULT 'scheduled' NOT NULL,
	"attempts" integer DEFAULT 0 NOT NULL,
	"next_attempt_at" timestamp with time zone,
	"idempotency_key" text NOT NULL,
	"external_id" text,
	"external_url" text,
	"error" text,
	"retryable" boolean DEFAULT false NOT NULL,
	"published_at" timestamp with time zone,
	"manual" boolean DEFAULT false NOT NULL,
	"workflow_id" text,
	"claimed_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "publish_jobs" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "publish_settings" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"tenant_id" uuid DEFAULT nullif(current_setting('app.tenant_id', true), '')::uuid NOT NULL,
	"brand_id" uuid NOT NULL,
	"window_start" integer DEFAULT 7 NOT NULL,
	"window_end" integer DEFAULT 21 NOT NULL,
	"max_attempts" integer DEFAULT 3 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "publish_settings" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "channels" ADD CONSTRAINT "channels_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "channels" ADD CONSTRAINT "channels_brand_id_brands_id_fk" FOREIGN KEY ("brand_id") REFERENCES "public"."brands"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "publish_jobs" ADD CONSTRAINT "publish_jobs_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "publish_jobs" ADD CONSTRAINT "publish_jobs_brand_id_brands_id_fk" FOREIGN KEY ("brand_id") REFERENCES "public"."brands"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "publish_settings" ADD CONSTRAINT "publish_settings_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "publish_settings" ADD CONSTRAINT "publish_settings_brand_id_brands_id_fk" FOREIGN KEY ("brand_id") REFERENCES "public"."brands"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "channels_account" ON "channels" USING btree ("brand_id","platform","account_name");--> statement-breakpoint
CREATE UNIQUE INDEX "publish_jobs_idempotency_key" ON "publish_jobs" USING btree ("idempotency_key");--> statement-breakpoint
CREATE UNIQUE INDEX "publish_jobs_one_active" ON "publish_jobs" USING btree ("brand_id","draft_id","channel_id") WHERE state not in ('published', 'cancelled', 'failed');--> statement-breakpoint
CREATE INDEX "publish_jobs_due" ON "publish_jobs" USING btree ("brand_id","state","scheduled_at");--> statement-breakpoint
CREATE UNIQUE INDEX "publish_settings_brand" ON "publish_settings" USING btree ("brand_id");--> statement-breakpoint
CREATE POLICY "channels_brand_isolation" ON "channels" AS PERMISSIVE FOR ALL TO "marketing_app" USING (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid and brand_id = any(coalesce(nullif(current_setting('app.brand_ids', true), ''), '{}')::uuid[])) WITH CHECK (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid and brand_id = any(coalesce(nullif(current_setting('app.brand_ids', true), ''), '{}')::uuid[]));--> statement-breakpoint
CREATE POLICY "publish_jobs_brand_isolation" ON "publish_jobs" AS PERMISSIVE FOR ALL TO "marketing_app" USING (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid and brand_id = any(coalesce(nullif(current_setting('app.brand_ids', true), ''), '{}')::uuid[])) WITH CHECK (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid and brand_id = any(coalesce(nullif(current_setting('app.brand_ids', true), ''), '{}')::uuid[]));--> statement-breakpoint
CREATE POLICY "publish_settings_brand_isolation" ON "publish_settings" AS PERMISSIVE FOR ALL TO "marketing_app" USING (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid and brand_id = any(coalesce(nullif(current_setting('app.brand_ids', true), ''), '{}')::uuid[])) WITH CHECK (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid and brand_id = any(coalesce(nullif(current_setting('app.brand_ids', true), ''), '{}')::uuid[]));