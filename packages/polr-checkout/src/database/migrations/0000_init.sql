CREATE TABLE "polr_order" (
	"id" text PRIMARY KEY NOT NULL,
	"status" text DEFAULT 'pending' NOT NULL,
	"amount" integer NOT NULL,
	"subtotal" integer NOT NULL,
	"currency" text NOT NULL,
	"description" text NOT NULL,
	"items" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"shipping" jsonb,
	"customer" jsonb NOT NULL,
	"provider_id" text NOT NULL,
	"provider_transaction_id" text,
	"provider_data" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"metadata" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"return_url" text,
	"error" text,
	"paid_at" timestamp,
	"expires_at" timestamp,
	"created_at" timestamp NOT NULL,
	"updated_at" timestamp NOT NULL
);
--> statement-breakpoint
CREATE TABLE "polr_webhook_event" (
	"id" text PRIMARY KEY NOT NULL,
	"provider_id" text NOT NULL,
	"provider_event_id" text NOT NULL,
	"type" text NOT NULL,
	"payload" jsonb NOT NULL,
	"status" text NOT NULL,
	"error" text,
	"trace_id" text,
	"received_at" timestamp NOT NULL,
	"processed_at" timestamp
);
--> statement-breakpoint
CREATE INDEX "polr_order_status_created_idx" ON "polr_order" USING btree ("status","created_at");--> statement-breakpoint
CREATE INDEX "polr_order_provider_idx" ON "polr_order" USING btree ("provider_id","provider_transaction_id");--> statement-breakpoint
CREATE UNIQUE INDEX "polr_webhook_event_provider_unique" ON "polr_webhook_event" USING btree ("provider_id","provider_event_id");--> statement-breakpoint
CREATE INDEX "polr_webhook_event_status_idx" ON "polr_webhook_event" USING btree ("provider_id","status");
