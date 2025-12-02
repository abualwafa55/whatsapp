/*
  Warnings:

  - You are about to drop the column `token_data` on the `sessiontoken` table. All the data in the column will be lost.
  - A unique constraint covering the columns `[session_id]` on the table `SessionToken` will be added. If there are existing duplicate values, this will fail.
  - Added the required column `token_value` to the `SessionToken` table without a default value. This is not possible if the table is not empty.

*/
-- DropIndex
DROP INDEX `Campaign_created_by_id_fkey` ON `campaign`;

-- DropIndex
DROP INDEX `Campaign_session_id_fkey` ON `campaign`;

-- DropIndex
DROP INDEX `RecipientList_created_by_id_fkey` ON `recipientlist`;

-- DropIndex
DROP INDEX `Session_owner_id_fkey` ON `session`;

-- DropIndex
DROP INDEX `SessionToken_session_id_idx` ON `sessiontoken`;

-- AlterTable
ALTER TABLE `sessiontoken` DROP COLUMN `token_data`,
    ADD COLUMN `token_value` VARCHAR(191) NOT NULL;

-- CreateIndex
CREATE UNIQUE INDEX `SessionToken_session_id_key` ON `SessionToken`(`session_id`);

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
