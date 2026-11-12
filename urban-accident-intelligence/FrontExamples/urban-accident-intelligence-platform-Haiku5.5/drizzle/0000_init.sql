CREATE TYPE "public"."accident_status" AS ENUM('reported', 'verified', 'rejected', 'duplicate');--> statement-breakpoint
CREATE TYPE "public"."dataset_kind" AS ENUM('synthetic', 'citizen', 'real_import');--> statement-breakpoint
CREATE TYPE "public"."job_status" AS ENUM('queued', 'running', 'completed', 'failed');--> statement-breakpoint
CREATE TYPE "public"."user_role" AS ENUM('admin', 'user');--> statement-breakpoint
CREATE TABLE "accident_categories" (
	"id" serial PRIMARY KEY NOT NULL,
	"code" text NOT NULL,
	"label" text NOT NULL,
	"description" text DEFAULT '' NOT NULL,
	"color_hex" text NOT NULL,
	"sort_order" integer DEFAULT 0 NOT NULL,
	CONSTRAINT "accident_categories_code_unique" UNIQUE("code")
);
--> statement-breakpoint
CREATE TABLE "accidents" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"public_id" uuid DEFAULT gen_random_uuid() NOT NULL,
	"dataset_source_id" integer NOT NULL,
	"category_id" integer NOT NULL,
	"severity_id" smallint NOT NULL,
	"status" "accident_status" DEFAULT 'reported' NOT NULL,
	"occurred_at" timestamp with time zone NOT NULL,
	"reported_at" timestamp with time zone NOT NULL,
	"reporting_delay_min" integer NOT NULL,
	"vehicles_involved" smallint NOT NULL,
	"emergency_services" boolean DEFAULT false NOT NULL,
	"description" text DEFAULT '' NOT NULL,
	"reported_lon" double precision NOT NULL,
	"reported_lat" double precision NOT NULL,
	"reported_accuracy_m" real,
	"lon" double precision NOT NULL,
	"lat" double precision NOT NULL,
	"x_m" double precision NOT NULL,
	"y_m" double precision NOT NULL,
	"location_source" text DEFAULT 'reported' NOT NULL,
	"nearest_segment_id" integer,
	"snap_distance_m" real,
	"year_local" smallint NOT NULL,
	"month_local" smallint NOT NULL,
	"dow_local" smallint NOT NULL,
	"hour_local" smallint NOT NULL,
	"reporter_hash" text,
	"tracking_code" text,
	"duplicate_of_id" bigint,
	"duplicate_candidate_id" bigint,
	"duplicate_score" real,
	"quality_flags" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "accidents_public_id_unique" UNIQUE("public_id"),
	CONSTRAINT "accidents_tracking_code_unique" UNIQUE("tracking_code"),
	CONSTRAINT "accident_reported_lon_range" CHECK ("accidents"."reported_lon" between -180 and 180),
	CONSTRAINT "accident_reported_lat_range" CHECK ("accidents"."reported_lat" between -90 and 90),
	CONSTRAINT "accident_lon_range" CHECK ("accidents"."lon" between -180 and 180),
	CONSTRAINT "accident_lat_range" CHECK ("accidents"."lat" between -90 and 90),
	CONSTRAINT "accident_vehicles_range" CHECK ("accidents"."vehicles_involved" between 0 and 50),
	CONSTRAINT "accident_hour_range" CHECK ("accidents"."hour_local" between 0 and 23),
	CONSTRAINT "accident_dow_range" CHECK ("accidents"."dow_local" between 0 and 6),
	CONSTRAINT "accident_month_range" CHECK ("accidents"."month_local" between 1 and 12),
	CONSTRAINT "accident_delay_nonneg" CHECK ("accidents"."reporting_delay_min" >= 0),
	CONSTRAINT "accident_location_source" CHECK ("accidents"."location_source" in ('reported','validated','synthetic'))
);
--> statement-breakpoint
CREATE TABLE "audit_logs" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"actor_user_id" integer,
	"actor_email" text,
	"action" text NOT NULL,
	"entity_type" text NOT NULL,
	"entity_id" text,
	"changes" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"ip_hash" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "dataset_sources" (
	"id" serial PRIMARY KEY NOT NULL,
	"code" text NOT NULL,
	"name" text NOT NULL,
	"kind" "dataset_kind" NOT NULL,
	"is_synthetic" boolean NOT NULL,
	"scenario" text,
	"seed" integer,
	"description" text DEFAULT '' NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL,
	"record_count" integer DEFAULT 0 NOT NULL,
	"metadata" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "dataset_sources_code_unique" UNIQUE("code")
);
--> statement-breakpoint
CREATE TABLE "environmental_observations" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"station_code" text NOT NULL,
	"station_name" text NOT NULL,
	"lon" double precision NOT NULL,
	"lat" double precision NOT NULL,
	"observed_at" timestamp with time zone NOT NULL,
	"precipitation_mm" real NOT NULL,
	"temperature_c" real NOT NULL,
	"visibility_m" real NOT NULL,
	"wind_speed_ms" real NOT NULL,
	"dataset_source_id" integer NOT NULL,
	CONSTRAINT "env_precip_nonneg" CHECK ("environmental_observations"."precipitation_mm" >= 0)
);
--> statement-breakpoint
CREATE TABLE "report_attachments" (
	"id" serial PRIMARY KEY NOT NULL,
	"accident_id" bigint NOT NULL,
	"storage_key" text NOT NULL,
	"original_filename" text NOT NULL,
	"mime_type" text NOT NULL,
	"byte_size" integer NOT NULL,
	"sha256" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "report_attachments_storage_key_unique" UNIQUE("storage_key"),
	CONSTRAINT "attachment_size_positive" CHECK ("report_attachments"."byte_size" > 0)
);
--> statement-breakpoint
CREATE TABLE "report_verifications" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"accident_id" bigint NOT NULL,
	"reviewer_user_id" integer,
	"action" text NOT NULL,
	"previous_status" "accident_status",
	"new_status" "accident_status",
	"note" text DEFAULT '' NOT NULL,
	"changes" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "verification_action_valid" CHECK ("report_verifications"."action" in ('verify','reject','mark_duplicate','reopen','edit'))
);
--> statement-breakpoint
CREATE TABLE "road_intersections" (
	"id" serial PRIMARY KEY NOT NULL,
	"node_code" text NOT NULL,
	"lon" double precision NOT NULL,
	"lat" double precision NOT NULL,
	"x_m" double precision NOT NULL,
	"y_m" double precision NOT NULL,
	"degree" smallint NOT NULL,
	"dataset_source_id" integer NOT NULL,
	CONSTRAINT "road_intersections_node_code_unique" UNIQUE("node_code"),
	CONSTRAINT "intersection_degree_nonneg" CHECK ("road_intersections"."degree" >= 0)
);
--> statement-breakpoint
CREATE TABLE "road_segments" (
	"id" serial PRIMARY KEY NOT NULL,
	"segment_code" text NOT NULL,
	"name" text NOT NULL,
	"road_class" text NOT NULL,
	"speed_limit_kmh" smallint NOT NULL,
	"lanes" smallint NOT NULL,
	"lighting_score" real NOT NULL,
	"length_m" real NOT NULL,
	"start_node_id" integer NOT NULL,
	"end_node_id" integer NOT NULL,
	"mid_lon" double precision NOT NULL,
	"mid_lat" double precision NOT NULL,
	"coordinates" jsonb NOT NULL,
	"utm_coordinates" jsonb NOT NULL,
	"dataset_source_id" integer NOT NULL,
	CONSTRAINT "road_segments_segment_code_unique" UNIQUE("segment_code"),
	CONSTRAINT "segment_class_valid" CHECK (road_class in ('arterial','collector','local')),
	CONSTRAINT "segment_lighting_range" CHECK ("road_segments"."lighting_score" between 0 and 1),
	CONSTRAINT "segment_length_positive" CHECK ("road_segments"."length_m" > 0)
);
--> statement-breakpoint
CREATE TABLE "sessions" (
	"token_hash" text PRIMARY KEY NOT NULL,
	"user_id" integer NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "severity_levels" (
	"id" smallint PRIMARY KEY NOT NULL,
	"code" text NOT NULL,
	"label" text NOT NULL,
	"description" text DEFAULT '' NOT NULL,
	"weight" real NOT NULL,
	"color_hex" text NOT NULL,
	CONSTRAINT "severity_levels_code_unique" UNIQUE("code"),
	CONSTRAINT "severity_weight_positive" CHECK ("severity_levels"."weight" > 0)
);
--> statement-breakpoint
CREATE TABLE "spatial_analysis_jobs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"analysis_type" text NOT NULL,
	"status" "job_status" DEFAULT 'queued' NOT NULL,
	"cache_key" text NOT NULL,
	"params" jsonb NOT NULL,
	"filters" jsonb NOT NULL,
	"progress" real DEFAULT 0 NOT NULL,
	"progress_message" text DEFAULT 'Queued' NOT NULL,
	"error_message" text,
	"requested_by_user_id" integer,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"started_at" timestamp with time zone,
	"finished_at" timestamp with time zone,
	CONSTRAINT "job_type_valid" CHECK (analysis_type in ('kde','gistar','dbscan','segment_aggregation','spatial_comparison','risk')),
	CONSTRAINT "job_progress_range" CHECK ("spatial_analysis_jobs"."progress" between 0 and 1)
);
--> statement-breakpoint
CREATE TABLE "spatial_analysis_results" (
	"id" serial PRIMARY KEY NOT NULL,
	"job_id" uuid NOT NULL,
	"result_kind" text NOT NULL,
	"feature_collection" jsonb,
	"payload" jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "spatial_analysis_results_job_id_unique" UNIQUE("job_id")
);
--> statement-breakpoint
CREATE TABLE "traffic_observations" (
	"id" serial PRIMARY KEY NOT NULL,
	"segment_id" integer NOT NULL,
	"year" smallint NOT NULL,
	"period_start" timestamp with time zone NOT NULL,
	"avg_daily_vehicles" integer NOT NULL,
	"peak_hour_share" real NOT NULL,
	"heavy_vehicle_share" real NOT NULL,
	"dataset_source_id" integer NOT NULL,
	CONSTRAINT "traffic_nonneg" CHECK ("traffic_observations"."avg_daily_vehicles" >= 0)
);
--> statement-breakpoint
CREATE TABLE "users" (
	"id" serial PRIMARY KEY NOT NULL,
	"email" text NOT NULL,
	"display_name" text NOT NULL,
	"password_hash" text NOT NULL,
	"role" "user_role" DEFAULT 'user' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "users_email_unique" UNIQUE("email")
);
--> statement-breakpoint
ALTER TABLE "accidents" ADD CONSTRAINT "accidents_dataset_source_id_dataset_sources_id_fk" FOREIGN KEY ("dataset_source_id") REFERENCES "public"."dataset_sources"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "accidents" ADD CONSTRAINT "accidents_category_id_accident_categories_id_fk" FOREIGN KEY ("category_id") REFERENCES "public"."accident_categories"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "accidents" ADD CONSTRAINT "accidents_severity_id_severity_levels_id_fk" FOREIGN KEY ("severity_id") REFERENCES "public"."severity_levels"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "accidents" ADD CONSTRAINT "accidents_nearest_segment_id_road_segments_id_fk" FOREIGN KEY ("nearest_segment_id") REFERENCES "public"."road_segments"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "accidents" ADD CONSTRAINT "accidents_duplicate_of_id_accidents_id_fk" FOREIGN KEY ("duplicate_of_id") REFERENCES "public"."accidents"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "audit_logs" ADD CONSTRAINT "audit_logs_actor_user_id_users_id_fk" FOREIGN KEY ("actor_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "environmental_observations" ADD CONSTRAINT "environmental_observations_dataset_source_id_dataset_sources_id_fk" FOREIGN KEY ("dataset_source_id") REFERENCES "public"."dataset_sources"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "report_attachments" ADD CONSTRAINT "report_attachments_accident_id_accidents_id_fk" FOREIGN KEY ("accident_id") REFERENCES "public"."accidents"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "report_verifications" ADD CONSTRAINT "report_verifications_accident_id_accidents_id_fk" FOREIGN KEY ("accident_id") REFERENCES "public"."accidents"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "report_verifications" ADD CONSTRAINT "report_verifications_reviewer_user_id_users_id_fk" FOREIGN KEY ("reviewer_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "road_intersections" ADD CONSTRAINT "road_intersections_dataset_source_id_dataset_sources_id_fk" FOREIGN KEY ("dataset_source_id") REFERENCES "public"."dataset_sources"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "road_segments" ADD CONSTRAINT "road_segments_dataset_source_id_dataset_sources_id_fk" FOREIGN KEY ("dataset_source_id") REFERENCES "public"."dataset_sources"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sessions" ADD CONSTRAINT "sessions_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "spatial_analysis_jobs" ADD CONSTRAINT "spatial_analysis_jobs_requested_by_user_id_users_id_fk" FOREIGN KEY ("requested_by_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "spatial_analysis_results" ADD CONSTRAINT "spatial_analysis_results_job_id_spatial_analysis_jobs_id_fk" FOREIGN KEY ("job_id") REFERENCES "public"."spatial_analysis_jobs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "traffic_observations" ADD CONSTRAINT "traffic_observations_segment_id_road_segments_id_fk" FOREIGN KEY ("segment_id") REFERENCES "public"."road_segments"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "traffic_observations" ADD CONSTRAINT "traffic_observations_dataset_source_id_dataset_sources_id_fk" FOREIGN KEY ("dataset_source_id") REFERENCES "public"."dataset_sources"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "accidents_occurred_idx" ON "accidents" USING btree ("occurred_at");--> statement-breakpoint
CREATE INDEX "accidents_status_idx" ON "accidents" USING btree ("status");--> statement-breakpoint
CREATE INDEX "accidents_dataset_idx" ON "accidents" USING btree ("dataset_source_id");--> statement-breakpoint
CREATE INDEX "accidents_category_idx" ON "accidents" USING btree ("category_id");--> statement-breakpoint
CREATE INDEX "accidents_severity_idx" ON "accidents" USING btree ("severity_id");--> statement-breakpoint
CREATE INDEX "accidents_segment_idx" ON "accidents" USING btree ("nearest_segment_id");--> statement-breakpoint
CREATE INDEX "accidents_local_time_idx" ON "accidents" USING btree ("year_local","month_local","hour_local");--> statement-breakpoint
CREATE INDEX "accidents_lonlat_idx" ON "accidents" USING btree ("lon","lat");--> statement-breakpoint
CREATE INDEX "accidents_reporter_idx" ON "accidents" USING btree ("reporter_hash","reported_at");--> statement-breakpoint
CREATE INDEX "audit_created_idx" ON "audit_logs" USING btree ("created_at");--> statement-breakpoint
CREATE INDEX "audit_entity_idx" ON "audit_logs" USING btree ("entity_type","entity_id");--> statement-breakpoint
CREATE INDEX "dataset_sources_kind_idx" ON "dataset_sources" USING btree ("kind");--> statement-breakpoint
CREATE UNIQUE INDEX "env_station_time_uq" ON "environmental_observations" USING btree ("station_code","observed_at");--> statement-breakpoint
CREATE INDEX "env_observed_idx" ON "environmental_observations" USING btree ("observed_at");--> statement-breakpoint
CREATE INDEX "report_attachments_accident_idx" ON "report_attachments" USING btree ("accident_id");--> statement-breakpoint
CREATE INDEX "report_verifications_accident_idx" ON "report_verifications" USING btree ("accident_id");--> statement-breakpoint
CREATE INDEX "road_intersections_lonlat_idx" ON "road_intersections" USING btree ("lon","lat");--> statement-breakpoint
CREATE INDEX "road_segments_mid_idx" ON "road_segments" USING btree ("mid_lon","mid_lat");--> statement-breakpoint
CREATE INDEX "sessions_user_idx" ON "sessions" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "sessions_expiry_idx" ON "sessions" USING btree ("expires_at");--> statement-breakpoint
CREATE INDEX "jobs_cache_idx" ON "spatial_analysis_jobs" USING btree ("cache_key","created_at");--> statement-breakpoint
CREATE INDEX "jobs_created_idx" ON "spatial_analysis_jobs" USING btree ("created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "traffic_segment_year_uq" ON "traffic_observations" USING btree ("segment_id","year");