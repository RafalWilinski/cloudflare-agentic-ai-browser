CREATE TABLE `jobs` (
	`id` integer PRIMARY KEY NOT NULL,
	`goal` text NOT NULL,
	`starting_url` text NOT NULL,
	`log` text,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	`completed_at` text,
	`updated_at` text,
	`failed_at` text,
	`output` text,
	`status` text DEFAULT 'pending' NOT NULL,
	`messages` text
);