/*
  Warnings:

  - The primary key for the `recipientlist` table will be changed. If it partially fails, the table could be left without primary key constraint.

*/
-- DropIndex
DROP INDEX `Campaign_created_by_id_fkey` ON `campaign`;

-- DropIndex
DROP INDEX `Campaign_session_id_fkey` ON `campaign`;

-- DropIndex
DROP INDEX `RecipientList_created_by_id_fkey` ON `recipientlist`;

-- DropIndex
DROP INDEX `Session_owner_id_fkey` ON `session`;

-- AlterTable
ALTER TABLE `recipient` MODIFY `list_id` VARCHAR(191) NOT NULL;

-- AlterTable
ALTER TABLE `recipientlist` DROP PRIMARY KEY,
    ADD COLUMN `created_by_email` VARCHAR(191) NULL,
    ADD COLUMN `tags` JSON NULL,
    MODIFY `id` VARCHAR(191) NOT NULL,
    ADD PRIMARY KEY (`id`);

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
