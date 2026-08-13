CREATE TABLE "run_tool_hashes" (
	"workflow_id" uuid NOT NULL,
	"tool_slug" text NOT NULL,
	"args_hash" text NOT NULL,
	"result_hash" text NOT NULL,
	"seen_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "run_tool_hashes_workflow_id_tool_slug_args_hash_pk" PRIMARY KEY("workflow_id","tool_slug","args_hash")
);
--> statement-breakpoint
ALTER TABLE "run_tool_hashes" ADD CONSTRAINT "run_tool_hashes_workflow_id_workflows_id_fk" FOREIGN KEY ("workflow_id") REFERENCES "public"."workflows"("id") ON DELETE cascade ON UPDATE no action;