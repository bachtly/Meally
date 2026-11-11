CREATE TABLE "webhook_retries" (
	"id" text PRIMARY KEY NOT NULL,
	"webhook_id" text NOT NULL,
	"event" text NOT NULL,
	"payload" text NOT NULL,
	"attempt" integer NOT NULL,
	"next_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
ALTER TABLE "webhook_retries" ADD CONSTRAINT "webhook_retries_webhook_id_webhooks_id_fk" FOREIGN KEY ("webhook_id") REFERENCES "public"."webhooks"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "webhook_retries_due_idx" ON "webhook_retries" USING btree ("next_at");