const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const sanitizeHtml = require('sanitize-html');
const prisma = require('./prismaClient');

class RecipientListManager {
    constructor(encryptionKey) {
        this.encryptionKey = encryptionKey;
        this.legacyDir = path.join(__dirname, 'recipient_lists');
        this.migrationPromise = this.migrateLegacyLists();
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

    normalizeEmail(email) {
        return email ? email.toLowerCase() : null;
    }

    normalizeListId(id) {
        if (id && id.length <= 191) {
            return id;
        }
        return crypto.randomUUID();
    }

    async resolveUserIdByEmail(email) {
        const normalized = this.normalizeEmail(email);
        if (!normalized) {
            return null;
        }

        const user = await prisma.user.findUnique({
            where: { email: normalized },
            select: { id: true }
        });
        return user ? user.id : null;
    }

    encrypt(payload) {
        if (!this.encryptionKey) {
            throw new Error('Encryption key not configured');
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
            throw new Error('Encryption key not configured');
        }
        const algorithm = 'aes-256-cbc';
        const key = Buffer.from(this.encryptionKey.slice(0, 64), 'hex');
        const [ivHex, encryptedText] = payload.split(':');
        const decipher = crypto.createDecipheriv(algorithm, key, Buffer.from(ivHex, 'hex'));
        let decrypted = decipher.update(encryptedText, 'hex', 'utf8');
        decrypted += decipher.final('utf8');
        return JSON.parse(decrypted);
    }

    async migrateLegacyLists() {
        if (!this.encryptionKey || !fs.existsSync(this.legacyDir)) {
            return;
        }

        const files = fs
            .readdirSync(this.legacyDir)
            .filter((file) => file.endsWith('.json'));

        if (files.length === 0) {
            return;
        }

        let migratedCount = 0;

        for (const file of files) {
            const filePath = path.join(this.legacyDir, file);
            try {
                const encrypted = fs.readFileSync(filePath, 'utf8');
                if (!encrypted) {
                    continue;
                }

                const legacyList = this.decrypt(encrypted);
                await this.persistLegacyList(legacyList);
                fs.renameSync(filePath, `${filePath}.bak`);
                migratedCount += 1;
            } catch (error) {
                console.error(`Failed to migrate recipient list ${file}:`, error.message);
            }
        }

        if (migratedCount > 0) {
            console.log(`Migrated ${migratedCount} recipient list(s) into the database. Backups saved with .bak extension.`);
        }
    }

    normalizeTags(tags) {
        if (!Array.isArray(tags)) {
            return [];
        }
        return tags
            .map((tag) => this.sanitizeText(tag))
            .filter((tag) => tag.length > 0);
    }

    validateRecipient(data) {
        if (!data || !data.number) {
            return null;
        }

        const cleanedNumber = data.number.toString().replace(/[^\d]/g, '');
        if (!/^\d{10,15}$/.test(cleanedNumber)) {
            return null;
        }

        return {
            number: cleanedNumber,
            name: this.sanitizeText(data.name),
            jobTitle: this.sanitizeText(data.jobTitle),
            companyName: this.sanitizeText(data.companyName),
            customFields: this.normalizeCustomFields(data.customFields),
            addedAt: data.addedAt ? new Date(data.addedAt) : new Date()
        };
    }

    normalizeCustomFields(customFields) {
        if (!customFields || typeof customFields !== 'object') {
            return {};
        }
        return customFields;
    }

    mapRecipientForDb(recipient, listId) {
        return {
            listId,
            number: recipient.number,
            name: recipient.name || null,
            jobTitle: recipient.jobTitle || null,
            companyName: recipient.companyName || null,
            customFields: recipient.customFields || {},
            addedAt: recipient.addedAt || new Date()
        };
    }

    async persistLegacyList(legacyList) {
        if (!legacyList || !legacyList.name) {
            return;
        }

        const recipients = Array.isArray(legacyList.recipients)
            ? legacyList.recipients.map((recipient) => this.validateRecipient(recipient)).filter(Boolean)
            : [];

        const normalizedEmail = this.normalizeEmail(legacyList.createdBy);
        const listId = this.normalizeListId(legacyList.id);
        const userId = await this.resolveUserIdByEmail(normalizedEmail);

        await prisma.$transaction(async (tx) => {
            await tx.recipientList.upsert({
                where: { id: listId },
                update: {
                    name: this.sanitizeText(legacyList.name),
                    description: this.sanitizeText(legacyList.description),
                    createdById: userId,
                    createdByEmail: normalizedEmail,
                    lastUsed: legacyList.lastUsed ? new Date(legacyList.lastUsed) : null,
                    usageCount: legacyList.usageCount || 0,
                    tags: this.normalizeTags(legacyList.tags),
                    updatedAt: legacyList.updatedAt ? new Date(legacyList.updatedAt) : new Date()
                },
                create: {
                    id: listId,
                    name: this.sanitizeText(legacyList.name),
                    description: this.sanitizeText(legacyList.description),
                    createdById: userId,
                    createdByEmail: normalizedEmail,
                    createdAt: legacyList.createdAt ? new Date(legacyList.createdAt) : new Date(),
                    updatedAt: legacyList.updatedAt ? new Date(legacyList.updatedAt) : new Date(),
                    lastUsed: legacyList.lastUsed ? new Date(legacyList.lastUsed) : null,
                    usageCount: legacyList.usageCount || 0,
                    tags: this.normalizeTags(legacyList.tags)
                }
            });

            await tx.recipient.deleteMany({ where: { listId } });
            if (recipients.length > 0) {
                await tx.recipient.createMany({
                    data: recipients.map((recipient) => this.mapRecipientForDb(recipient, listId))
                });
            }
        });
    }

    getListOwnershipFilter(userEmail, isAdmin) {
        if (isAdmin || !userEmail) {
            return {};
        }
        const normalized = this.normalizeEmail(userEmail);
        return {
            OR: [
                { createdBy: { is: { email: normalized } } },
                { createdByEmail: normalized }
            ]
        };
    }

    getRecipientOwnershipFilter(userEmail, isAdmin) {
        const listFilter = this.getListOwnershipFilter(userEmail, isAdmin);
        if (!listFilter || Object.keys(listFilter).length === 0) {
            return {};
        }
        return { list: listFilter };
    }

    presentRecipient(recipient) {
        return {
            number: recipient.number,
            name: recipient.name || '',
            jobTitle: recipient.jobTitle || '',
            companyName: recipient.companyName || '',
            customFields: recipient.customFields || {},
            addedAt: recipient.addedAt,
            listId: recipient.listId,
            listName: recipient.list?.name
        };
    }

    presentList(record, includeRecipients = true) {
        if (!record) {
            return null;
        }

        const base = {
            id: record.id,
            name: record.name,
            description: record.description,
            createdBy: record.createdBy?.email || record.createdByEmail || null,
            createdAt: record.createdAt,
            updatedAt: record.updatedAt,
            lastUsed: record.lastUsed,
            usageCount: record.usageCount,
            tags: record.tags || [],
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

    async getAllLists(userEmail = null, isAdmin = false) {
        await this.ensureReady();
        const lists = await prisma.recipientList.findMany({
            where: this.getListOwnershipFilter(userEmail, isAdmin),
            orderBy: [
                { lastUsed: 'desc' },
                { createdAt: 'desc' }
            ],
            include: {
                createdBy: { select: { email: true } },
                _count: { select: { recipients: true } }
            }
        });
        return lists.map((list) => this.presentList(list, false));
    }

    async loadList(listId) {
        await this.ensureReady();
        const list = await prisma.recipientList.findUnique({
            where: { id: listId },
            include: {
                recipients: { orderBy: { addedAt: 'asc' } },
                createdBy: { select: { email: true } }
            }
        });
        return this.presentList(list, true);
    }

    async createList(data) {
        await this.ensureReady();
        if (!data || !data.name) {
            throw new Error('List name is required');
        }

        const recipients = Array.isArray(data.recipients)
            ? data.recipients.map((recipient) => this.validateRecipient(recipient)).filter(Boolean)
            : [];

        const normalizedEmail = this.normalizeEmail(data.createdBy);
        const userId = await this.resolveUserIdByEmail(normalizedEmail);
        const list = await prisma.recipientList.create({
            data: {
                id: this.normalizeListId(data.id),
                name: this.sanitizeText(data.name),
                description: this.sanitizeText(data.description),
                createdById: userId,
                createdByEmail: normalizedEmail,
                tags: this.normalizeTags(data.tags),
                recipients: {
                    create: recipients.map((recipient) => ({
                        number: recipient.number,
                        name: recipient.name,
                        jobTitle: recipient.jobTitle,
                        companyName: recipient.companyName,
                        customFields: recipient.customFields,
                        addedAt: recipient.addedAt
                    }))
                }
            },
            include: {
                recipients: { orderBy: { addedAt: 'asc' } },
                createdBy: { select: { email: true } },
                _count: { select: { recipients: true } }
            }
        });

        return this.presentList(list, true);
    }

    async updateList(listId, updates) {
        await this.ensureReady();
        if (!updates) {
            return this.loadList(listId);
        }

        const data = {};
        if (updates.name !== undefined) {
            data.name = this.sanitizeText(updates.name);
        }
        if (updates.description !== undefined) {
            data.description = this.sanitizeText(updates.description);
        }
        if (updates.tags !== undefined) {
            data.tags = this.normalizeTags(updates.tags);
        }
        data.updatedAt = new Date();

        const result = await prisma.$transaction(async (tx) => {
            if (Array.isArray(updates.recipients)) {
                const newRecipients = updates.recipients
                    .map((recipient) => this.validateRecipient(recipient))
                    .filter(Boolean);

                await tx.recipient.deleteMany({ where: { listId } });
                if (newRecipients.length > 0) {
                    await tx.recipient.createMany({
                        data: newRecipients.map((recipient) => this.mapRecipientForDb(recipient, listId))
                    });
                }
            }

            return tx.recipientList.update({
                where: { id: listId },
                data,
                include: {
                    recipients: { orderBy: { addedAt: 'asc' } },
                    createdBy: { select: { email: true } },
                    _count: { select: { recipients: true } }
                }
            });
        });

        return this.presentList(result, true);
    }

    async deleteList(listId) {
        await this.ensureReady();
        try {
            await prisma.$transaction([
                prisma.recipient.deleteMany({ where: { listId } }),
                prisma.recipientList.delete({ where: { id: listId } })
            ]);
            return true;
        } catch (error) {
            console.error('Error deleting recipient list:', error.message);
            return false;
        }
    }

    async cloneList(listId, newCreatedBy, newName = null) {
        await this.ensureReady();
        const original = await this.loadList(listId);
        if (!original) {
            throw new Error('Recipient list not found');
        }

        return this.createList({
            name: newName || `${original.name} (Copy)`,
            description: original.description,
            createdBy: newCreatedBy,
            tags: original.tags,
            recipients: original.recipients
        });
    }

    async addRecipient(listId, recipientData) {
        await this.ensureReady();
        const recipient = this.validateRecipient(recipientData);
        if (!recipient) {
            throw new Error('Invalid recipient data');
        }

        const existing = await prisma.recipient.findFirst({
            where: { listId, number: recipient.number }
        });
        if (existing) {
            throw new Error('Recipient with this number already exists in the list');
        }

        await prisma.recipient.create({
            data: this.mapRecipientForDb(recipient, listId)
        });

        await prisma.recipientList.update({
            where: { id: listId },
            data: { updatedAt: new Date() }
        });

        return this.loadList(listId);
    }

    async removeRecipient(listId, recipientNumber) {
        await this.ensureReady();
        const cleanedNumber = recipientNumber.toString().replace(/[^\d]/g, '');
        await prisma.recipient.deleteMany({
            where: { listId, number: cleanedNumber }
        });
        await prisma.recipientList.update({
            where: { id: listId },
            data: { updatedAt: new Date() }
        });
        return this.loadList(listId);
    }

    async updateRecipient(listId, recipientNumber, updates) {
        await this.ensureReady();
        const cleanedNumber = recipientNumber.toString().replace(/[^\d]/g, '');
        const recipient = await prisma.recipient.findFirst({
            where: { listId, number: cleanedNumber }
        });
        if (!recipient) {
            throw new Error('Recipient not found in list');
        }

        const data = {};
        if (updates.name !== undefined) data.name = this.sanitizeText(updates.name);
        if (updates.jobTitle !== undefined) data.jobTitle = this.sanitizeText(updates.jobTitle);
        if (updates.companyName !== undefined) data.companyName = this.sanitizeText(updates.companyName);
        if (updates.customFields !== undefined) data.customFields = this.normalizeCustomFields(updates.customFields);

        await prisma.recipient.update({
            where: { id: recipient.id },
            data
        });

        await prisma.recipientList.update({
            where: { id: listId },
            data: { updatedAt: new Date() }
        });

        return this.loadList(listId);
    }

    async markAsUsed(listId) {
        await this.ensureReady();
        await prisma.recipientList.update({
            where: { id: listId },
            data: {
                lastUsed: new Date(),
                usageCount: { increment: 1 },
                updatedAt: new Date()
            }
        });
    }

    async searchRecipients(query, userEmail = null, isAdmin = false) {
        await this.ensureReady();
        if (!query || query.length < 2) {
            return [];
        }

        const normalizedQuery = query.trim();
        const digitsOnly = normalizedQuery.replace(/[^\d]/g, '');
        const recipients = await prisma.recipient.findMany({
            where: {
                ...this.getRecipientOwnershipFilter(userEmail, isAdmin),
                OR: [
                    digitsOnly ? { number: { contains: digitsOnly } } : undefined,
                    { name: { contains: normalizedQuery, mode: 'insensitive' } },
                    { companyName: { contains: normalizedQuery, mode: 'insensitive' } },
                    { jobTitle: { contains: normalizedQuery, mode: 'insensitive' } }
                ].filter(Boolean)
            },
            take: 100,
            include: {
                list: {
                    select: {
                        id: true,
                        name: true,
                        createdBy: { select: { email: true } },
                        createdByEmail: true
                    }
                }
            }
        });

        return recipients.map((recipient) => ({
            number: recipient.number,
            name: recipient.name || '',
            jobTitle: recipient.jobTitle || '',
            companyName: recipient.companyName || '',
            customFields: recipient.customFields || {},
            addedAt: recipient.addedAt,
            listId: recipient.listId,
            listName: recipient.list?.name,
            createdBy: recipient.list?.createdBy?.email || recipient.list?.createdByEmail || null
        }));
    }

    async getStatistics(userEmail = null, isAdmin = false) {
        await this.ensureReady();
        const where = this.getListOwnershipFilter(userEmail, isAdmin);
        const [totalLists, totalRecipientsAggregation, usageAggregation] = await Promise.all([
            prisma.recipientList.count({ where }),
            prisma.recipient.aggregate({
                _count: { _all: true },
                where: Object.keys(where).length ? { list: where } : undefined
            }),
            prisma.recipientList.aggregate({
                _sum: { usageCount: true },
                where
            })
        ]);

        const totalRecipients = totalRecipientsAggregation._count._all || 0;
        const totalUsage = usageAggregation._sum.usageCount || 0;

        return {
            totalLists,
            totalRecipients,
            totalUsage,
            averageListSize: totalLists > 0 ? Math.round(totalRecipients / totalLists) : 0
        };
    }
}

module.exports = RecipientListManager;