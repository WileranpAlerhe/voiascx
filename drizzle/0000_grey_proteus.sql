CREATE TABLE `orders` (
	`id` text PRIMARY KEY NOT NULL,
	`service_id` text NOT NULL,
	`service_name` text NOT NULL,
	`amount_cents` integer NOT NULL,
	`status` text DEFAULT 'created' NOT NULL,
	`provider_charge_id` text,
	`customer_email` text NOT NULL,
	`payload_ciphertext` text NOT NULL,
	`payload_iv` text NOT NULL,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL
);
