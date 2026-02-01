CREATE TABLE IF NOT EXISTS `processed_events` (
	`event_id` text PRIMARY KEY NOT NULL,
	`processed_at` text NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS `tasks` (
	`id` text PRIMARY KEY NOT NULL,
	`chat_id` text NOT NULL,
	`thread_id` text NOT NULL,
	`creator_id` text NOT NULL,
	`status` text DEFAULT 'pending' NOT NULL,
	`prompt` text NOT NULL,
	`summary` text,
	`session_id` text,
	`process_port` integer,
	`working_dir` text NOT NULL,
	`doc_token` text,
	`card_message_id` text,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	`completed_at` text,
	`error_message` text
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `idx_tasks_chat_id` ON `tasks` (`chat_id`);--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `idx_tasks_thread_id` ON `tasks` (`thread_id`);--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `idx_tasks_status` ON `tasks` (`status`);
