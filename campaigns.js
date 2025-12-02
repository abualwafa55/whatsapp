const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { parse } = require('csv-parse/sync');
const sanitizeHtml = require('sanitize-html');
const { CampaignStatus, CampaignRecipientStatus } = require('@prisma/client');
const prisma = require('./prismaClient');

const STATUS_MAP = {
    draft: CampaignStatus.DRAFT,
    ready: CampaignStatus.READY,
    scheduled: CampaignStatus.SCHEDULED,
    running: CampaignStatus.RUNNING,
    sending: CampaignStatus.SENDING,
    paused: CampaignStatus.PAUSED,
    completed: CampaignStatus.COMPLETED,
    cancelled: CampaignStatus.CANCELLED,
    failed: CampaignStatus.FAILED
};

const STATUS_REVERSE_MAP = Object.entries(STATUS_MAP).reduce((acc, [key, value]) => {
    acc[value] = key;
    return acc;
}, {});

const RECIPIENT_STATUS_MAP = {
    pending: CampaignRecipientStatus.PENDING,
    sent: CampaignRecipientStatus.SENT,
    failed: CampaignRecipientStatus.FAILED
};

const RECIPIENT_STATUS_REVERSE_MAP = Object.entries(RECIPIENT_STATUS_MAP).reduce((acc, [key, value]) => {
    acc[value] = key;
    return acc;
}, {});

class CampaignManager {
    constructor(encryptionKey) {
        this.encryptionKey = encryptionKey;
        this.legacyCampaignDir = path.join(__dirname, 'campaigns');
        this.campaignMediaDir = path.join(__dirname, 'campaign_media');
        this.ensureDirectories();
        this.migrationPromise = this.migrateLegacyCampaigns();
    }

    ensureDirectories() {
        if (!fs.existsSync(this.campaignMediaDir)) {
            fs.mkdirSync(this.campaignMediaDir, { recursive: true });
        }
    }

    async ensureReady() {
        if (this.migrationPromise) {
            await this.migrationPromise;
            this.migrationPromise = null;
        }
    }

    sanitizeText(value) {
        return sanitizeHtml(value || '', { allowedTags: [] }).trim();
    }

    sanitizeMessage(content) {
        return sanitizeHtml(content || '', {
            allowedTags: ['p', 'br', 'strong', 'em', 'u', 'a'],
            allowedAttributes: { a: ['href', 'target'] }
        }).trim();
    }

    normalizeEmail(email) {
        return email ? email.toLowerCase() : null;
    }

    normalizeCampaignId(id) {
        if (id && id.length <= 191) {
            return id;
        }
        return `campaign_${Date.now()}_${crypto.randomBytes(4).toString('hex')}`;
    }

    mapStatusForDb(status = 'draft') {
        const normalized = status.toString().toLowerCase();
        return STATUS_MAP[normalized] || CampaignStatus.DRAFT;
    }

    mapStatusFromDb(statusEnum) {
        return STATUS_REVERSE_MAP[statusEnum] || 'draft';
    }

    mapRecipientStatusForDb(status = 'pending') {
        const normalized = status.toString().toLowerCase();
        return RECIPIENT_STATUS_MAP[normalized] || CampaignRecipientStatus.PENDING;
    }

    mapRecipientStatusFromDb(statusEnum) {
        return RECIPIENT_STATUS_REVERSE_MAP[statusEnum] || 'pending';
    }

    encrypt(payload) {
        if (!this.encryptionKey) {
            throw new Error('Encryption key not configured for campaign migration');
        }
        const algorithm = 'aes-256-cbc';
        const key = Buffer.from(this.encryptionKey.slice(0, 64), 'hex');
        const iv = crypto.randomBytes(16);
        const cipher = crypto.createCipheriv(algorithm, key, iv);
        let encrypted = cipher.update(JSON.stringify(payload), 'utf8', 'hex');
        encrypted += cipher.final('hex');
        return `${iv.toString('hex')}:${encrypted}`;
    }

    decrypt(payload) {
        if (!this.encryptionKey) {
            throw new Error('Encryption key not configured for campaign migration');
        }
        const algorithm = 'aes-256-cbc';
        const key = Buffer.from(this.encryptionKey.slice(0, 64), 'hex');
        const [ivHex, encryptedText] = payload.split(':');
        const decipher = crypto.createDecipheriv(algorithm, key, Buffer.from(ivHex, 'hex'));
        let decrypted = decipher.update(encryptedText, 'hex', 'utf8');
        decrypted += decipher.final('utf8');
        return JSON.parse(decrypted);
    }

    async migrateLegacyCampaigns() {
        if (!this.encryptionKey || !fs.existsSync(this.legacyCampaignDir)) {
            return;
        }

        const files = fs
            .readdirSync(this.legacyCampaignDir)
            .filter((file) => file.endsWith('.json'));

        if (files.length === 0) {
            return;
        }

        let migrated = 0;
        for (const file of files) {
            const filePath = path.join(this.legacyCampaignDir, file);
            try {
                const encrypted = fs.readFileSync(filePath, 'utf8');
                if (!encrypted) {
                    continue;
                }
                const legacyCampaign = this.decrypt(encrypted);
                await this.persistLegacyCampaign(legacyCampaign);
                fs.renameSync(filePath, `${filePath}.bak`);
                migrated += 1;
            } catch (error) {
                console.error(`Failed to migrate campaign file ${file}:`, error.message);
            }
        }

        if (migrated > 0) {
            console.log(`Migrated ${migrated} legacy campaign(s) into the database. Backups saved with .bak extension.`);
        }
    }

    async resolveUserIdByEmail(email) {
        const normalized = this.normalizeEmail(email);
        if (!normalized) {
            return null;
        }
        const user = await prisma.user.findUnique({ where: { email: normalized }, select: { id: true } });
        return user ? user.id : null;
    }

    normalizeRecipients(recipients) {
        if (!Array.isArray(recipients)) {
            return [];
        }
        return recipients
            .map((recipient) => {
                if (!recipient || !recipient.number) {
                    return null;
                }
                const number = recipient.number.toString().replace(/[^\d]/g, '');
                if (!/^\d{10,15}$/.test(number)) {
                    return null;
                }
                return {
                    number,
                    name: this.sanitizeText(recipient.name),
                    jobTitle: this.sanitizeText(recipient.jobTitle),
                    companyName: this.sanitizeText(recipient.companyName),
                    customFields: recipient.customFields && typeof recipient.customFields === 'object' ? recipient.customFields : {},
                    status: this.mapRecipientStatusForDb(recipient.status || 'pending'),
                    sentAt: recipient.sentAt ? new Date(recipient.sentAt) : null,
                    error: recipient.error || null,
                    retryCount: recipient.retryCount || 0
                };
            })
            .filter(Boolean);
    }

    calculateStatistics(recipients) {
        const stats = { total: recipients.length, sent: 0, failed: 0, pending: 0 };
        for (const recipient of recipients) {
            switch (recipient.status) {
                case CampaignRecipientStatus.SENT:
                    stats.sent += 1;
                    break;
                case CampaignRecipientStatus.FAILED:
                    stats.failed += 1;
                    break;
                default:
                    stats.pending += 1;
                    break;
            }
        }
        return stats;
    }

    buildMessagePayload(message = {}) {
        return {
            type: message.type || 'text',
            content: this.sanitizeMessage(message.content || ''),
            mediaUrl: message.mediaUrl || null,
            mediaCaption: message.mediaCaption ? this.sanitizeMessage(message.mediaCaption) : null,
            fileName: message.fileName || null
        };
    }

    buildSettingsPayload(settings = {}) {
        return {
            delayBetweenMessages: settings.delayBetweenMessages || 3000,
            retryFailedMessages: settings.retryFailedMessages !== false,
            maxRetries: settings.maxRetries || 3
        };
    }

    async persistLegacyCampaign(legacyCampaign) {
        if (!legacyCampaign || !legacyCampaign.name) {
            return;
        }
        const recipients = this.normalizeRecipients(legacyCampaign.recipients);
        const stats = this.calculateStatistics(recipients);
        const normalizedEmail = this.normalizeEmail(legacyCampaign.createdBy);
        const userId = await this.resolveUserIdByEmail(normalizedEmail);
        const campaignId = this.normalizeCampaignId(legacyCampaign.id);

        await prisma.$transaction(async (tx) => {
            await tx.campaign.upsert({
                where: { id: campaignId },
                update: {
                    name: this.sanitizeText(legacyCampaign.name),
                    status: this.mapStatusForDb(legacyCampaign.status || 'draft'),
                    scheduledAt: legacyCampaign.scheduledAt ? new Date(legacyCampaign.scheduledAt) : null,
                    startedAt: legacyCampaign.startedAt ? new Date(legacyCampaign.startedAt) : null,
                    completedAt: legacyCampaign.completedAt ? new Date(legacyCampaign.completedAt) : null,
                    message: this.buildMessagePayload(legacyCampaign.message || {}),
                    settings: this.buildSettingsPayload(legacyCampaign.settings || {}),
                    statistics: stats,
                    sessionId: legacyCampaign.sessionId || null,
                    createdById: userId,
                    createdByEmail: normalizedEmail,
                    updatedAt: new Date()
                },
                create: {
                    id: campaignId,
                    name: this.sanitizeText(legacyCampaign.name),
                    status: this.mapStatusForDb(legacyCampaign.status || 'draft'),
                    scheduledAt: legacyCampaign.scheduledAt ? new Date(legacyCampaign.scheduledAt) : null,
                    startedAt: legacyCampaign.startedAt ? new Date(legacyCampaign.startedAt) : null,
                    completedAt: legacyCampaign.completedAt ? new Date(legacyCampaign.completedAt) : null,
                    message: this.buildMessagePayload(legacyCampaign.message || {}),
                    settings: this.buildSettingsPayload(legacyCampaign.settings || {}),
                    statistics: stats,
                    sessionId: legacyCampaign.sessionId || null,
                    createdById: userId,
                    createdByEmail: normalizedEmail,
                    createdAt: legacyCampaign.createdAt ? new Date(legacyCampaign.createdAt) : new Date(),
                    updatedAt: new Date()
                }
            });

            await tx.campaignRecipient.deleteMany({ where: { campaignId } });
            if (recipients.length > 0) {
                await tx.campaignRecipient.createMany({
                    data: recipients.map((recipient) => ({
                        campaignId,
                        recipientNumber: recipient.number,
                        payload: {
                            name: recipient.name,
                            jobTitle: recipient.jobTitle,
                            companyName: recipient.companyName,
                            customFields: recipient.customFields
                        },
                        status: recipient.status,
                        sentAt: recipient.sentAt,
                        error: recipient.error,
                        retryCount: recipient.retryCount
                    }))
                });
            }
        });
    }

    presentRecipient(record) {
        return {
            number: record.recipientNumber,
            name: record.payload?.name || '',
            jobTitle: record.payload?.jobTitle || '',
            companyName: record.payload?.companyName || '',
            customFields: record.payload?.customFields || {},
            status: this.mapRecipientStatusFromDb(record.status),
            sentAt: record.sentAt,
            error: record.error || null,
            retryCount: record.retryCount || 0
        };
    }

    presentCampaign(record, includeRecipients = true) {
        if (!record) {
            return null;
        }
        const base = {
            id: record.id,
            name: record.name,
            createdBy: record.createdBy?.email || record.createdByEmail || null,
            createdAt: record.createdAt,
            updatedAt: record.updatedAt,
            scheduledAt: record.scheduledAt,
            startedAt: record.startedAt,
            completedAt: record.completedAt,
            status: this.mapStatusFromDb(record.status),
            sessionId: record.sessionId,
            message: record.message || {},
            settings: record.settings || {},
            statistics: record.statistics || { total: 0, sent: 0, failed: 0, pending: 0 },
            recipientCount: record._count ? record._count.recipients : record.recipients?.length || 0
        };
        if (includeRecipients) {
            return {
                ...base,
                recipients: (record.recipients || []).map((recipient) => this.presentRecipient(recipient))
            };
        }
        return base;
    }

    async getAllCampaigns(userEmail = null, isAdmin = false) {
        await this.ensureReady();
        const where = isAdmin || !userEmail
            ? {}
            : {
                  OR: [
                      { createdBy: { is: { email: this.normalizeEmail(userEmail) } } },
                      { createdByEmail: this.normalizeEmail(userEmail) }
                  ]
              };

        const campaigns = await prisma.campaign.findMany({
            where,
            orderBy: { createdAt: 'desc' },
            include: {
                createdBy: { select: { email: true } },
                _count: { select: { recipients: true } }
            }
        });
        return campaigns.map((campaign) => this.presentCampaign(campaign, false));
    }

    async getCampaignsByStatus(statuses = [], { includeRecipients = false } = {}) {
        await this.ensureReady();
        if (!Array.isArray(statuses) || statuses.length === 0) {
            return [];
        }

        const normalizedStatuses = statuses
            .map((status) => (typeof status === 'string' ? status.toLowerCase() : status))
            .map((status) => {
                if (!status) return null;
                return this.mapStatusForDb(status);
            })
            .filter(Boolean);

        if (normalizedStatuses.length === 0) {
            return [];
        }

        const include = {
            createdBy: { select: { email: true } }
        };

        if (includeRecipients) {
            include.recipients = { orderBy: { id: 'asc' } };
        } else {
            include._count = { select: { recipients: true } };
        }

        const campaigns = await prisma.campaign.findMany({
            where: {
                status: { in: normalizedStatuses }
            },
            orderBy: { updatedAt: 'desc' },
            include
        });

        return campaigns.map((campaign) => this.presentCampaign(campaign, includeRecipients));
    }

    async loadCampaign(campaignId) {
        await this.ensureReady();
        const campaign = await prisma.campaign.findUnique({
            where: { id: campaignId },
            include: {
                recipients: { orderBy: { id: 'asc' } },
                createdBy: { select: { email: true } }
            }
        });
        return this.presentCampaign(campaign, true);
    }

    async createCampaign(data) {
        await this.ensureReady();
        if (!data || !data.name) {
            throw new Error('Campaign name is required');
        }
        const recipients = this.normalizeRecipients(data.recipients || []);
        const stats = this.calculateStatistics(recipients);
        const messagePayload = this.buildMessagePayload(data.message || {});
        const settingsPayload = this.buildSettingsPayload(data.settings || {});
        const normalizedEmail = this.normalizeEmail(data.createdBy);
        const userId = await this.resolveUserIdByEmail(normalizedEmail);
        const campaignId = this.normalizeCampaignId(data.id);

        const record = await prisma.campaign.create({
            data: {
                id: campaignId,
                name: this.sanitizeText(data.name),
                status: this.mapStatusForDb(data.status || 'draft'),
                sessionId: data.sessionId || null,
                scheduledAt: data.scheduledAt ? new Date(data.scheduledAt) : null,
                message: messagePayload,
                settings: settingsPayload,
                statistics: stats,
                createdById: userId,
                createdByEmail: normalizedEmail,
                recipients: {
                    create: recipients.map((recipient) => ({
                        recipientNumber: recipient.number,
                        payload: {
                            name: recipient.name,
                            jobTitle: recipient.jobTitle,
                            companyName: recipient.companyName,
                            customFields: recipient.customFields
                        },
                        status: recipient.status,
                        sentAt: recipient.sentAt,
                        error: recipient.error,
                        retryCount: recipient.retryCount
                    }))
                }
            },
            include: {
                recipients: true,
                createdBy: { select: { email: true } },
                _count: { select: { recipients: true } }
            }
        });

        return this.presentCampaign(record, true);
    }

    async updateCampaign(campaignId, updates = {}) {
        await this.ensureReady();
        const data = {};
        if (updates.name !== undefined) {
            data.name = this.sanitizeText(updates.name);
        }
        if (updates.status !== undefined) {
            data.status = this.mapStatusForDb(updates.status);
        }
        if (updates.sessionId !== undefined) {
            data.sessionId = updates.sessionId;
        }
        if (updates.scheduledAt !== undefined) {
            data.scheduledAt = updates.scheduledAt ? new Date(updates.scheduledAt) : null;
        }
        if (updates.message !== undefined) {
            data.message = this.buildMessagePayload({ ...updates.message });
        }
        if (updates.settings !== undefined) {
            data.settings = this.buildSettingsPayload({ ...updates.settings });
        }
        data.updatedAt = new Date();

        const result = await prisma.$transaction(async (tx) => {
            if (Array.isArray(updates.recipients)) {
                const normalizedRecipients = this.normalizeRecipients(updates.recipients);
                const stats = this.calculateStatistics(normalizedRecipients);
                data.statistics = stats;
                await tx.campaignRecipient.deleteMany({ where: { campaignId } });
                if (normalizedRecipients.length > 0) {
                    await tx.campaignRecipient.createMany({
                        data: normalizedRecipients.map((recipient) => ({
                            campaignId,
                            recipientNumber: recipient.number,
                            payload: {
                                name: recipient.name,
                                jobTitle: recipient.jobTitle,
                                companyName: recipient.companyName,
                                customFields: recipient.customFields
                            },
                            status: recipient.status,
                            sentAt: recipient.sentAt,
                            error: recipient.error,
                            retryCount: recipient.retryCount
                        }))
                    });
                }
            }

            return tx.campaign.update({
                where: { id: campaignId },
                data,
                include: {
                    recipients: { orderBy: { id: 'asc' } },
                    createdBy: { select: { email: true } },
                    _count: { select: { recipients: true } }
                }
            });
        });

        return this.presentCampaign(result, true);
    }

    async deleteCampaign(campaignId) {
        await this.ensureReady();
        try {
            await prisma.$transaction([
                prisma.campaignRecipient.deleteMany({ where: { campaignId } }),
                prisma.campaign.delete({ where: { id: campaignId } })
            ]);
            const mediaDir = path.join(this.campaignMediaDir, campaignId);
            if (fs.existsSync(mediaDir)) {
                fs.rmSync(mediaDir, { recursive: true, force: true });
            }
            return true;
        } catch (error) {
            console.error('Error deleting campaign:', error.message);
            return false;
        }
    }

    async cloneCampaign(campaignId, newCreatedBy) {
        const campaign = await this.loadCampaign(campaignId);
        if (!campaign) {
            throw new Error('Campaign not found');
        }
        return this.createCampaign({
            name: `${campaign.name} (Copy)`,
            createdBy: newCreatedBy,
            sessionId: campaign.sessionId,
            message: campaign.message,
            settings: campaign.settings,
            recipients: campaign.recipients.map((recipient) => ({
                ...recipient,
                status: 'pending',
                sentAt: null,
                error: null,
                retryCount: 0
            }))
        });
    }

    parseCSV(csvContent, columnMapping = null) {
        try {
            const firstLine = csvContent.split(/\r?\n/)[0];
            const commaCount = (firstLine.match(/,/g) || []).length;
            const semicolonCount = (firstLine.match(/;/g) || []).length;
            let delimiter = semicolonCount > commaCount ? ';' : ',';
            if (csvContent.charCodeAt(0) === 0xFEFF) {
                csvContent = csvContent.substring(1);
            }
            const records = parse(csvContent, {
                columns: true,
                skip_empty_lines: true,
                trim: true,
                delimiter,
                relax_column_count: true,
                skip_records_with_empty_values: true
            });

            const recipients = [];
            const errors = [];
            records.forEach((record, index) => {
                let number =
                    record['WhatsApp Number'] ||
                    record['WhatsApp number'] ||
                    record['Phone'] ||
                    record['Number'] ||
                    record['phone'] ||
                    record['number'] ||
                    record['Mobile'] ||
                    record['mobile'] ||
                    record['Contact'] ||
                    record['contact'];
                let name = record['Name'] || record['name'] || record['Full Name'] || record['full name'] || '';
                let jobTitle =
                    record['Job Title'] ||
                    record['job_title'] ||
                    record['Title'] ||
                    record['title'] ||
                    record['Position'] ||
                    record['position'] ||
                    '';
                let companyName =
                    record['Company Name'] ||
                    record['company_name'] ||
                    record['Company'] ||
                    record['company'] ||
                    record['Organization'] ||
                    record['organization'] ||
                    '';

                if (columnMapping) {
                    number = record[columnMapping.number] || number;
                    name = record[columnMapping.name] || name;
                    jobTitle = record[columnMapping.jobTitle] || jobTitle;
                    companyName = record[columnMapping.companyName] || companyName;
                }

                if (!number) {
                    errors.push(`Row ${index + 2}: Missing phone number.`);
                    return;
                }

                number = number.toString().replace(/[\s\-\+\(\)]/g, '');
                if (!/^\d{10,15}$/.test(number)) {
                    errors.push(`Row ${index + 2}: Invalid phone number format: ${number}`);
                    return;
                }

                const customFields = {};
                Object.keys(record).forEach((key) => {
                    const lower = key.toLowerCase();
                    if (
                        ![
                            'whatsapp number',
                            'phone',
                            'number',
                            'mobile',
                            'contact',
                            'name',
                            'full name',
                            'job title',
                            'title',
                            'position',
                            'company name',
                            'company',
                            'organization'
                        ].includes(lower)
                    ) {
                        customFields[key] = record[key];
                    }
                });

                recipients.push({
                    number,
                    name: this.sanitizeText(name),
                    jobTitle: this.sanitizeText(jobTitle),
                    companyName: this.sanitizeText(companyName),
                    customFields,
                    status: 'pending'
                });
            });

            return {
                success: errors.length === 0,
                recipients,
                errors,
                headers: records.length > 0 ? Object.keys(records[0]) : []
            };
        } catch (error) {
            return {
                success: false,
                recipients: [],
                errors: [`CSV parsing error: ${error.message}`],
                headers: []
            };
        }
    }

    processTemplate(template, recipient) {
        if (!template) return '';
        let processed = template;
        processed = processed.replace(/\{\{Name\}\}/gi, recipient.name || '');
        processed = processed.replace(/\{\{JobTitle\}\}/gi, recipient.jobTitle || '');
        processed = processed.replace(/\{\{Company(Name)?\}\}/gi, recipient.companyName || '');
        if (recipient.customFields) {
            Object.entries(recipient.customFields).forEach(([key, value]) => {
                const regex = new RegExp(`\\{\\{${key}\\}\\}`, 'g');
                processed = processed.replace(regex, value || '');
            });
        }
        return processed;
    }

    async refreshStatistics(campaignId) {
        const counts = await prisma.campaignRecipient.groupBy({
            by: ['status'],
            where: { campaignId },
            _count: { status: true }
        });
        const stats = { total: 0, sent: 0, failed: 0, pending: 0 };
        counts.forEach((row) => {
            const value = row._count.status;
            stats.total += value;
            switch (row.status) {
                case CampaignRecipientStatus.SENT:
                    stats.sent += value;
                    break;
                case CampaignRecipientStatus.FAILED:
                    stats.failed += value;
                    break;
                default:
                    stats.pending += value;
                    break;
            }
        });
        await prisma.campaign.update({
            where: { id: campaignId },
            data: { statistics: stats }
        });
        return stats;
    }

    async updateRecipientStatus(campaignId, recipientNumber, status, error = null) {
        await prisma.campaignRecipient.updateMany({
            where: { campaignId, recipientNumber },
            data: {
                status: this.mapRecipientStatusForDb(status),
                error: error || null,
                sentAt: status === 'sent' ? new Date() : null
            }
        });
        await this.refreshStatistics(campaignId);
    }

    async updateCampaignStatus(campaignId, status) {
        return prisma.campaign.update({
            where: { id: campaignId },
            data: {
                status: this.mapStatusForDb(status),
                startedAt: status === 'sending' ? new Date() : undefined,
                completedAt: status === 'completed' ? new Date() : undefined
            }
        });
    }

    async getPendingRecipients(campaignId, limit = 100) {
        await this.ensureReady();
        const campaign = await prisma.campaign.findUnique({
            where: { id: campaignId },
            select: { settings: true }
        });
        if (!campaign) {
            return [];
        }
        const maxRetries = campaign.settings?.maxRetries || 3;
        const recipients = await prisma.campaignRecipient.findMany({
            where: {
                campaignId,
                OR: [
                    { status: CampaignRecipientStatus.PENDING },
                    {
                        status: CampaignRecipientStatus.FAILED,
                        retryCount: { lt: maxRetries }
                    }
                ]
            },
            orderBy: { id: 'asc' },
            take: limit
        });
        return recipients.map((recipient) => this.presentRecipient(recipient));
    }

    async markForRetry(campaignId, recipientNumber) {
        await prisma.campaignRecipient.updateMany({
            where: { campaignId, recipientNumber, status: CampaignRecipientStatus.FAILED },
            data: {
                status: CampaignRecipientStatus.PENDING,
                retryCount: { increment: 1 },
                error: null
            }
        });
        await this.refreshStatistics(campaignId);
    }

    async exportResults(campaignId) {
        const recipients = await prisma.campaignRecipient.findMany({
            where: { campaignId },
            orderBy: { id: 'asc' }
        });
        if (recipients.length === 0) {
            return null;
        }
        const headers = ['Number', 'Name', 'Job Title', 'Company', 'Status', 'Sent At', 'Error'];
        const rows = [headers];
        recipients.forEach((recipient) => {
            rows.push([
                recipient.recipientNumber,
                recipient.payload?.name || '',
                recipient.payload?.jobTitle || '',
                recipient.payload?.companyName || '',
                this.mapRecipientStatusFromDb(recipient.status),
                recipient.sentAt ? recipient.sentAt.toISOString() : '',
                recipient.error || ''
            ]);
        });
        return rows.map((row) => row.map((cell) => `"${cell}"`).join(',')).join('\n');
    }
}

module.exports = CampaignManager;
