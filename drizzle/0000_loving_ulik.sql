CREATE TABLE `attendance` (
	`id` text PRIMARY KEY NOT NULL,
	`person_type` text NOT NULL,
	`person_id` text NOT NULL,
	`attendance_date` text NOT NULL,
	`status` text NOT NULL,
	`note` text
);
--> statement-breakpoint
CREATE TABLE `audit_log` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` integer,
	`action` text NOT NULL,
	`entity` text NOT NULL,
	`entity_id` text,
	`details` text,
	`created_at` text NOT NULL
);
--> statement-breakpoint
CREATE TABLE `curriculum` (
	`class_name` text PRIMARY KEY NOT NULL,
	`focus` text NOT NULL,
	`subjects` text NOT NULL
);
--> statement-breakpoint
CREATE TABLE `fee_installments` (
	`id` text PRIMARY KEY NOT NULL,
	`student_id` text NOT NULL,
	`amount` real NOT NULL,
	`paid_on` text NOT NULL,
	`mode` text NOT NULL,
	`reference` text,
	`note` text,
	`recorded_by` integer,
	`created_at` text NOT NULL
);
--> statement-breakpoint
CREATE TABLE `gallery` (
	`id` text PRIMARY KEY NOT NULL,
	`title` text NOT NULL,
	`event_date` text NOT NULL,
	`image_url` text,
	`created_at` text NOT NULL
);
--> statement-breakpoint
CREATE TABLE `homework` (
	`id` text PRIMARY KEY NOT NULL,
	`class_name` text NOT NULL,
	`subject` text NOT NULL,
	`teacher_id` text NOT NULL,
	`title` text NOT NULL,
	`instructions` text NOT NULL,
	`due_date` text NOT NULL,
	`created_at` text NOT NULL
);
--> statement-breakpoint
CREATE TABLE `marks` (
	`id` text PRIMARY KEY NOT NULL,
	`student_id` text NOT NULL,
	`term` text NOT NULL,
	`subject` text NOT NULL,
	`marks` real NOT NULL,
	`max_marks` real NOT NULL
);
--> statement-breakpoint
CREATE TABLE `notices` (
	`id` text PRIMARY KEY NOT NULL,
	`title` text NOT NULL,
	`notice_date` text NOT NULL,
	`body` text NOT NULL,
	`audience` text DEFAULT 'all' NOT NULL,
	`created_at` text NOT NULL
);
--> statement-breakpoint
CREATE TABLE `sessions` (
	`token_hash` text PRIMARY KEY NOT NULL,
	`user_id` integer NOT NULL,
	`expires_at` integer NOT NULL,
	`created_at` text NOT NULL
);
--> statement-breakpoint
CREATE TABLE `settings` (
	`key` text PRIMARY KEY NOT NULL,
	`value` text NOT NULL
);
--> statement-breakpoint
CREATE TABLE `students` (
	`id` text PRIMARY KEY NOT NULL,
	`admission_no` text NOT NULL,
	`name` text NOT NULL,
	`class_name` text NOT NULL,
	`section` text NOT NULL,
	`roll_no` text NOT NULL,
	`parent_name` text NOT NULL,
	`phone` text NOT NULL,
	`email` text,
	`address` text NOT NULL,
	`annual_fee` real DEFAULT 0 NOT NULL,
	`fee_paid` real DEFAULT 0 NOT NULL,
	`due_date` text,
	`attendance_percent` real DEFAULT 0 NOT NULL,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `students_admission_no_unique` ON `students` (`admission_no`);--> statement-breakpoint
CREATE TABLE `teachers` (
	`id` text PRIMARY KEY NOT NULL,
	`employee_no` text NOT NULL,
	`name` text NOT NULL,
	`subject` text NOT NULL,
	`classes` text DEFAULT '[]' NOT NULL,
	`phone` text NOT NULL,
	`email` text,
	`monthly_salary` real DEFAULT 0 NOT NULL,
	`salary_paid` real DEFAULT 0 NOT NULL,
	`attendance_percent` real DEFAULT 0 NOT NULL,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `teachers_employee_no_unique` ON `teachers` (`employee_no`);--> statement-breakpoint
CREATE TABLE `users` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`username` text NOT NULL,
	`display_name` text NOT NULL,
	`role` text NOT NULL,
	`password_hash` text NOT NULL,
	`password_salt` text NOT NULL,
	`password_iterations` integer DEFAULT 210000 NOT NULL,
	`student_id` text,
	`teacher_id` text,
	`must_change_password` integer DEFAULT true NOT NULL,
	`active` integer DEFAULT true NOT NULL,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `users_username_unique` ON `users` (`username`);