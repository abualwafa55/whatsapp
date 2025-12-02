-- CreateTable
CREATE TABLE `User` (
    `id` CHAR(36) NOT NULL,
    `email` VARCHAR(191) NOT NULL,
    `password_hash` VARCHAR(255) NOT NULL,
    `role` ENUM('ADMIN', 'USER') NOT NULL DEFAULT 'USER',
    `created_by` VARCHAR(191) NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `last_login` DATETIME(3) NULL,
    `is_active` BOOLEAN NOT NULL DEFAULT true,

    UNIQUE INDEX `User_email_key`(`email`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `Session` (
    `id` CHAR(36) NOT NULL,
    `name` VARCHAR(191) NULL,
    `status` ENUM('CREATING', 'CONNECTING', 'CONNECTED', 'DISCONNECTED', 'GENERATING_QR') NOT NULL DEFAULT 'CREATING',
    `detail` VARCHAR(512) NULL,
    `qr` TEXT NULL,
    `reason` VARCHAR(512) NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updated_at` DATETIME(3) NOT NULL,
    `owner_id` CHAR(36) NULL,

    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `SessionToken` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `session_id` CHAR(36) NOT NULL,
    `token_data` LONGBLOB NOT NULL,
    `expires_at` DATETIME(3) NULL,
    `last_used_at` DATETIME(3) NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `SessionToken_session_id_idx`(`session_id`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `RecipientList` (
    `id` CHAR(36) NOT NULL,
    `name` VARCHAR(191) NOT NULL,
    `description` TEXT NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updated_at` DATETIME(3) NULL,
    `last_used` DATETIME(3) NULL,
    `usage_count` INTEGER NOT NULL DEFAULT 0,
    `created_by_id` CHAR(36) NULL,

    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `Recipient` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `list_id` CHAR(36) NOT NULL,
    `number` VARCHAR(20) NOT NULL,
    `name` VARCHAR(191) NULL,
    `job_title` VARCHAR(191) NULL,
    `company_name` VARCHAR(191) NULL,
    `custom_fields` JSON NOT NULL,
    `added_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `Recipient_list_id_idx`(`list_id`),
    INDEX `Recipient_number_idx`(`number`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `Campaign` (
    `id` CHAR(36) NOT NULL,
    `name` VARCHAR(191) NOT NULL,
    `status` ENUM('DRAFT', 'SCHEDULED', 'RUNNING', 'PAUSED', 'COMPLETED', 'CANCELLED', 'FAILED') NOT NULL DEFAULT 'DRAFT',
    `scheduled_at` DATETIME(3) NULL,
    `started_at` DATETIME(3) NULL,
    `completed_at` DATETIME(3) NULL,
    `message_payload` JSON NOT NULL,
    `settings_payload` JSON NOT NULL,
    `statistics_payload` JSON NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updated_at` DATETIME(3) NULL,
    `created_by_id` CHAR(36) NULL,
    `session_id` CHAR(36) NULL,

    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `CampaignRecipient` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `campaign_id` CHAR(36) NOT NULL,
    `recipient_number` VARCHAR(20) NOT NULL,
    `payload` JSON NOT NULL,
    `status` ENUM('PENDING', 'SENT', 'FAILED') NOT NULL DEFAULT 'PENDING',
    `sent_at` DATETIME(3) NULL,
    `error` TEXT NULL,
    `retry_count` INTEGER NOT NULL DEFAULT 0,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updated_at` DATETIME(3) NULL,

    INDEX `CampaignRecipient_campaign_id_idx`(`campaign_id`),
    INDEX `CampaignRecipient_recipient_number_idx`(`recipient_number`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `ActivityLog` (
    `id` BIGINT NOT NULL AUTO_INCREMENT,
    `timestamp` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `action` VARCHAR(100) NOT NULL,
    `resource_type` VARCHAR(64) NULL,
    `resource_id` VARCHAR(128) NULL,
    `details` JSON NULL,
    `ip` VARCHAR(45) NULL,
    `user_agent` VARCHAR(255) NULL,
    `success` BOOLEAN NOT NULL DEFAULT true,
    `user_id` CHAR(36) NULL,

    INDEX `ActivityLog_user_id_idx`(`user_id`),
    INDEX `ActivityLog_resource_type_resource_id_idx`(`resource_type`, `resource_id`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- AddForeignKey
ALTER TABLE `Session` ADD CONSTRAINT `Session_owner_id_fkey` FOREIGN KEY (`owner_id`) REFERENCES `User`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `SessionToken` ADD CONSTRAINT `SessionToken_session_id_fkey` FOREIGN KEY (`session_id`) REFERENCES `Session`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `RecipientList` ADD CONSTRAINT `RecipientList_created_by_id_fkey` FOREIGN KEY (`created_by_id`) REFERENCES `User`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `Recipient` ADD CONSTRAINT `Recipient_list_id_fkey` FOREIGN KEY (`list_id`) REFERENCES `RecipientList`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `Campaign` ADD CONSTRAINT `Campaign_created_by_id_fkey` FOREIGN KEY (`created_by_id`) REFERENCES `User`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `Campaign` ADD CONSTRAINT `Campaign_session_id_fkey` FOREIGN KEY (`session_id`) REFERENCES `Session`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `CampaignRecipient` ADD CONSTRAINT `CampaignRecipient_campaign_id_fkey` FOREIGN KEY (`campaign_id`) REFERENCES `Campaign`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `ActivityLog` ADD CONSTRAINT `ActivityLog_user_id_fkey` FOREIGN KEY (`user_id`) REFERENCES `User`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;
