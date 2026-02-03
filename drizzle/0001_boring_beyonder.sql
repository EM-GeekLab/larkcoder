CREATE TABLE `projects` (
	`id` text PRIMARY KEY NOT NULL,
	`chat_id` text NOT NULL,
	`creator_id` text NOT NULL,
	`title` text NOT NULL,
	`description` text,
	`folder_name` text NOT NULL,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL
);
--> statement-breakpoint
CREATE INDEX `idx_projects_chat_id` ON `projects` (`chat_id`);--> statement-breakpoint
ALTER TABLE `sessions` ADD `project_id` text;--> statement-breakpoint
CREATE INDEX `idx_sessions_project_id` ON `sessions` (`project_id`);