CREATE TABLE `processed_events` (
	`event_id` text PRIMARY KEY NOT NULL,
	`processed_at` text NOT NULL
);
--> statement-breakpoint
CREATE TABLE `sessions` (
	`id` text PRIMARY KEY NOT NULL,
	`chat_id` text NOT NULL,
	`thread_id` text NOT NULL,
	`creator_id` text NOT NULL,
	`status` text DEFAULT 'idle' NOT NULL,
	`initial_prompt` text NOT NULL,
	`acp_session_id` text,
	`working_dir` text NOT NULL,
	`doc_token` text,
	`working_message_id` text,
	`mode` text DEFAULT 'default' NOT NULL,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL
);
--> statement-breakpoint
CREATE INDEX `idx_sessions_chat_id` ON `sessions` (`chat_id`);--> statement-breakpoint
CREATE INDEX `idx_sessions_thread_id` ON `sessions` (`thread_id`);--> statement-breakpoint
CREATE INDEX `idx_sessions_status` ON `sessions` (`status`);