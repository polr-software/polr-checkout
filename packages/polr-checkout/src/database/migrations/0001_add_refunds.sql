ALTER TABLE "polr_order" ADD COLUMN "refunded_amount" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
CREATE TABLE "polr_refund" (
	"id" text PRIMARY KEY NOT NULL,
	"order_id" text NOT NULL,
	"provider_id" text NOT NULL,
	"amount" integer NOT NULL,
	"currency" text NOT NULL,
	"status" text DEFAULT 'pending' NOT NULL,
	"reason" text,
	"provider_data" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_at" timestamp NOT NULL,
	"updated_at" timestamp NOT NULL
);
--> statement-breakpoint
CREATE INDEX "polr_refund_order_idx" ON "polr_refund" USING btree ("order_id");--> statement-breakpoint
CREATE INDEX "polr_refund_status_idx" ON "polr_refund" USING btree ("status");
