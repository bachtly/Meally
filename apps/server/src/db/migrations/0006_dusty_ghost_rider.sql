CREATE TABLE "reactions" (
	"snap_id" text NOT NULL,
	"user_id" text NOT NULL,
	"emoji" text NOT NULL,
	"created_at" timestamp with time zone NOT NULL,
	"removed_at" timestamp with time zone,
	CONSTRAINT "reactions_snap_id_user_id_emoji_pk" PRIMARY KEY("snap_id","user_id","emoji")
);
--> statement-breakpoint
CREATE TABLE "snaps" (
	"id" text PRIMARY KEY NOT NULL,
	"user_id" text NOT NULL,
	"image_id" text NOT NULL,
	"client_id" text NOT NULL,
	"caption" text,
	"dish_name" text,
	"place" text,
	"recipe_id" text,
	"created_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
CREATE TABLE "friendship_invites" (
	"id" text PRIMARY KEY NOT NULL,
	"token_hash" text NOT NULL,
	"created_by" text NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"used_at" timestamp with time zone,
	"used_by" text,
	"created_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
CREATE TABLE "friendships" (
	"user_a_id" text NOT NULL,
	"user_b_id" text NOT NULL,
	"status" text DEFAULT 'pending' NOT NULL,
	"requested_by" text NOT NULL,
	"created_at" timestamp with time zone NOT NULL,
	"accepted_at" timestamp with time zone,
	CONSTRAINT "friendships_user_a_id_user_b_id_pk" PRIMARY KEY("user_a_id","user_b_id"),
	CONSTRAINT "friendships_order_ck" CHECK ("friendships"."user_a_id" < "friendships"."user_b_id"),
	CONSTRAINT "friendships_requester_ck" CHECK ("friendships"."requested_by" IN ("friendships"."user_a_id", "friendships"."user_b_id"))
);
--> statement-breakpoint
CREATE TABLE "push_deliveries" (
	"id" text PRIMARY KEY NOT NULL,
	"subscription_id" text NOT NULL,
	"payload" jsonb NOT NULL,
	"attempt" integer DEFAULT 0 NOT NULL,
	"next_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
CREATE TABLE "push_subscriptions" (
	"id" text PRIMARY KEY NOT NULL,
	"user_id" text NOT NULL,
	"endpoint" text NOT NULL,
	"p256dh" text NOT NULL,
	"auth" text NOT NULL,
	"created_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
ALTER TABLE "reactions" ADD CONSTRAINT "reactions_snap_id_snaps_id_fk" FOREIGN KEY ("snap_id") REFERENCES "public"."snaps"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "reactions" ADD CONSTRAINT "reactions_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "snaps" ADD CONSTRAINT "snaps_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "snaps" ADD CONSTRAINT "snaps_image_id_images_id_fk" FOREIGN KEY ("image_id") REFERENCES "public"."images"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "snaps" ADD CONSTRAINT "snaps_recipe_id_recipes_id_fk" FOREIGN KEY ("recipe_id") REFERENCES "public"."recipes"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "friendship_invites" ADD CONSTRAINT "friendship_invites_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "friendship_invites" ADD CONSTRAINT "friendship_invites_used_by_users_id_fk" FOREIGN KEY ("used_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "friendships" ADD CONSTRAINT "friendships_user_a_id_users_id_fk" FOREIGN KEY ("user_a_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "friendships" ADD CONSTRAINT "friendships_user_b_id_users_id_fk" FOREIGN KEY ("user_b_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "friendships" ADD CONSTRAINT "friendships_requested_by_users_id_fk" FOREIGN KEY ("requested_by") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "push_deliveries" ADD CONSTRAINT "push_deliveries_subscription_id_push_subscriptions_id_fk" FOREIGN KEY ("subscription_id") REFERENCES "public"."push_subscriptions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "push_subscriptions" ADD CONSTRAINT "push_subscriptions_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "reactions_user_idx" ON "reactions" USING btree ("user_id");--> statement-breakpoint
CREATE UNIQUE INDEX "snaps_user_client_uq" ON "snaps" USING btree ("user_id","client_id");--> statement-breakpoint
CREATE INDEX "snaps_feed_idx" ON "snaps" USING btree ("user_id","created_at" DESC NULLS LAST,"id");--> statement-breakpoint
CREATE INDEX "snaps_recipe_idx" ON "snaps" USING btree ("recipe_id");--> statement-breakpoint
CREATE INDEX "snaps_image_idx" ON "snaps" USING btree ("image_id");--> statement-breakpoint
CREATE UNIQUE INDEX "friendship_invites_token_hash_uq" ON "friendship_invites" USING btree ("token_hash");--> statement-breakpoint
CREATE INDEX "friendship_invites_creator_idx" ON "friendship_invites" USING btree ("created_by");--> statement-breakpoint
CREATE INDEX "friendships_user_b_idx" ON "friendships" USING btree ("user_b_id");--> statement-breakpoint
CREATE INDEX "push_deliveries_due_idx" ON "push_deliveries" USING btree ("next_at");--> statement-breakpoint
CREATE UNIQUE INDEX "push_subscriptions_endpoint_uq" ON "push_subscriptions" USING btree ("endpoint");--> statement-breakpoint
CREATE INDEX "push_subscriptions_user_idx" ON "push_subscriptions" USING btree ("user_id");