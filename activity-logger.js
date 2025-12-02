const fs = require('fs');
const fsp = fs.promises;
const path = require('path');
const crypto = require('crypto');
const prisma = require('./prismaClient');

class ActivityLogger {
    constructor(encryptionKey) {
        this.logsDir = path.join(__dirname, 'activity_logs');
        this.encryptionKey = encryptionKey;
        this.userCache = new Map();
        this.migrationPromise = this.migrateLegacyLogs();
    }

    async ensureReady() {
        if (this.migrationPromise) {
            await this.migrationPromise;
            this.migrationPromise = null;
        }
    }

    async migrateLegacyLogs() {
        if (!this.encryptionKey) {
            return;
        }

        try {
            await fsp.mkdir(this.logsDir, { recursive: true });
            const files = await fsp.readdir(this.logsDir);
            const encFiles = files.filter((file) => file.startsWith('activities_') && file.endsWith('.enc'));

            for (const file of encFiles) {
                const filePath = path.join(this.logsDir, file);
                try {
                    const encryptedData = await fsp.readFile(filePath, 'utf8');
                    if (!encryptedData) continue;
                    const decryptedData = this.decrypt(encryptedData);
                    const logs = JSON.parse(decryptedData);

                    for (const log of logs) {
                        await this.persistActivity(log, { skipEnsure: true });
                    }

                    await fsp.rename(filePath, `${filePath}.bak`);
                } catch (error) {
                    console.error(`Failed to migrate legacy activity log ${file}:`, error.message);
                }
            }
        } catch (error) {
            console.error('Failed to migrate legacy activity logs:', error.message);
        }
    }

    encrypt(text) {
        const algorithm = 'aes-256-cbc';
        const key = Buffer.from(this.encryptionKey.slice(0, 64), 'hex');
        const iv = crypto.randomBytes(16);

        const cipher = crypto.createCipheriv(algorithm, key, iv);
        let encrypted = cipher.update(text, 'utf8', 'hex');
        encrypted += cipher.final('hex');

        return iv.toString('hex') + ':' + encrypted;
    }

    decrypt(text) {
        const algorithm = 'aes-256-cbc';
        const key = Buffer.from(this.encryptionKey.slice(0, 64), 'hex');

        const parts = text.split(':');
        const iv = Buffer.from(parts[0], 'hex');
        const encryptedText = parts[1];

        const decipher = crypto.createDecipheriv(algorithm, key, iv);
        let decrypted = decipher.update(encryptedText, 'hex', 'utf8');
        decrypted += decipher.final('utf8');

        return decrypted;
    }

    async resolveUserId(email) {
        if (!email) return null;
        const normalized = email.toLowerCase();
        if (this.userCache.has(normalized)) {
            return this.userCache.get(normalized);
        }
        const user = await prisma.user.findUnique({ where: { email: normalized } });
        const userId = user ? user.id : null;
        this.userCache.set(normalized, userId);
        return userId;
    }

    formatActivity(record) {
        if (!record) return null;
        return {
            id: record.id.toString(),
            timestamp: record.timestamp.toISOString(),
            userEmail: record.userEmail || null,
            action: record.action,
            resource: record.resourceType,
            resourceId: record.resourceId,
            details: record.details,
            ip: record.ip,
            userAgent: record.userAgent,
            success: record.success
        };
    }

    async persistActivity(activity, { skipEnsure = false } = {}) {
        if (!skipEnsure) {
            await this.ensureReady();
        }

        const userId = await this.resolveUserId(activity.userEmail);

        const record = await prisma.activityLog.create({
            data: {
                timestamp: activity.timestamp ? new Date(activity.timestamp) : undefined,
                userEmail: activity.userEmail || null,
                action: activity.action,
                resourceType: activity.resource,
                resourceId: activity.resourceId,
                details: activity.details || {},
                ip: activity.ip,
                userAgent: activity.userAgent,
                success: activity.success !== false,
                userId: userId || undefined
            }
        });

        return this.formatActivity(record);
    }

    async logActivity(entry) {
        const activity = {
            id: crypto.randomUUID(),
            timestamp: new Date().toISOString(),
            ...entry
        };
        return this.persistActivity(activity);
    }

    async getActivities({
        userEmail = null,
        startDate = null,
        endDate = null,
        action = null,
        resource = null,
        resourceId = null,
        limit = 100
    } = {}) {
        await this.ensureReady();

        const where = {};
        if (userEmail) {
            where.userEmail = userEmail;
        }
        if (action) {
            where.action = action;
        }
        if (resource) {
            where.resourceType = resource;
        }
        if (resourceId) {
            where.resourceId = resourceId;
        }
        if (startDate || endDate) {
            where.timestamp = {};
            if (startDate) where.timestamp.gte = new Date(startDate);
            if (endDate) where.timestamp.lte = new Date(endDate);
        }

        const records = await prisma.activityLog.findMany({
            where,
            orderBy: { timestamp: 'desc' },
            take: limit
        });

        return records.map((record) => this.formatActivity(record));
    }

    async getUserActivities(userEmail, limit = 50) {
        return this.getActivities({ userEmail, limit });
    }

    async getSessionActivities(sessionId, limit = 50) {
        return this.getActivities({
            resource: 'session',
            resourceId: sessionId,
            limit
        });
    }

    async getUserActivities(userEmail, limit = 50) {
        return this.getActivities({ userEmail, limit });
    }

    async getSessionActivities(sessionId, limit = 50) {
        return this.getActivities({ 
            resource: 'session',
            resourceId: sessionId,
            limit 
        });
    }

    // Activity helper methods
    async logLogin(userEmail, ip, userAgent, success = true) {
        return this.logActivity({
            userEmail,
            action: 'login',
            resource: 'auth',
            resourceId: null,
            details: { success },
            ip,
            userAgent,
            success
        });
    }

    async logSessionCreate(userEmail, sessionId, ip, userAgent) {
        return this.logActivity({
            userEmail,
            action: 'create',
            resource: 'session',
            resourceId: sessionId,
            details: { sessionId },
            ip,
            userAgent
        });
    }

    async logSessionDelete(userEmail, sessionId, ip, userAgent) {
        return this.logActivity({
            userEmail,
            action: 'delete',
            resource: 'session',
            resourceId: sessionId,
            details: { sessionId },
            ip,
            userAgent
        });
    }

    async logMessageSend(userEmail, sessionId, recipient, messageType, ip, userAgent) {
        return this.logActivity({
            userEmail,
            action: 'send_message',
            resource: 'message',
            resourceId: sessionId,
            details: { recipient, messageType },
            ip,
            userAgent
        });
    }

    async logUserCreate(adminEmail, newUserEmail, role, ip, userAgent) {
        return this.logActivity({
            userEmail: adminEmail,
            action: 'create_user',
            resource: 'user',
            resourceId: newUserEmail,
            details: { newUserEmail, role },
            ip,
            userAgent
        });
    }

    async logUserUpdate(adminEmail, targetUserEmail, changes, ip, userAgent) {
        return this.logActivity({
            userEmail: adminEmail,
            action: 'update_user',
            resource: 'user',
            resourceId: targetUserEmail,
            details: { changes },
            ip,
            userAgent
        });
    }

    async logUserDelete(adminEmail, targetUserEmail, ip, userAgent) {
        return this.logActivity({
            userEmail: adminEmail,
            action: 'delete_user',
            resource: 'user',
            resourceId: targetUserEmail,
            details: { deletedUser: targetUserEmail },
            ip,
            userAgent
        });
    }

    // Get activity summary for dashboard
    async getActivitySummary(userEmail = null, days = 7) {
        const startDate = new Date();
        startDate.setDate(startDate.getDate() - days);

        const activities = await this.getActivities({
            userEmail,
            startDate: startDate.toISOString(),
            limit: 10000
        });

        const summary = {
            totalActivities: activities.length,
            byAction: {},
            byResource: {},
            byUser: {},
            recentActivities: activities.slice(0, 10)
        };

        activities.forEach(activity => {
            // Count by action
            summary.byAction[activity.action] = (summary.byAction[activity.action] || 0) + 1;
            
            // Count by resource
            summary.byResource[activity.resource] = (summary.byResource[activity.resource] || 0) + 1;
            
            // Count by user
            summary.byUser[activity.userEmail] = (summary.byUser[activity.userEmail] || 0) + 1;
        });

        return summary;
    }

    // Campaign logging methods
    async logCampaignCreate(userEmail, campaignId, campaignName, recipientCount) {
        return this.logActivity({
            userEmail,
            action: 'create_campaign',
            resource: 'campaign',
            resourceId: campaignId,
            details: { campaignName, recipientCount }
        });
    }
    
    async logCampaignStart(userEmail, campaignId, campaignName, recipientCount) {
        return this.logActivity({
            userEmail,
            action: 'start_campaign',
            resource: 'campaign',
            resourceId: campaignId,
            details: { campaignName, recipientCount }
        });
    }
    
    async logCampaignMessage(userEmail, campaignId, recipient, status, error = null) {
        return this.logActivity({
            userEmail,
            action: 'campaign_message',
            resource: 'campaign',
            resourceId: campaignId,
            details: { recipient, status, error }
        });
    }
    
    async logCampaignPause(userEmail, campaignId, campaignName) {
        return this.logActivity({
            userEmail,
            action: 'pause_campaign',
            resource: 'campaign',
            resourceId: campaignId,
            details: { campaignName }
        });
    }
    
    async logCampaignResume(userEmail, campaignId, campaignName) {
        return this.logActivity({
            userEmail,
            action: 'resume_campaign',
            resource: 'campaign',
            resourceId: campaignId,
            details: { campaignName }
        });
    }
    
    async logCampaignComplete(userEmail, campaignId, campaignName, statistics) {
        return this.logActivity({
            userEmail,
            action: 'complete_campaign',
            resource: 'campaign',
            resourceId: campaignId,
            details: { campaignName, statistics }
        });
    }
    
    async logCampaignDelete(userEmail, campaignId, campaignName) {
        return this.logActivity({
            userEmail,
            action: 'delete_campaign',
            resource: 'campaign',
            resourceId: campaignId,
            details: { campaignName }
        });
    }
    
    async logCampaignRetry(userEmail, campaignId, campaignName, retryCount) {
        return this.logActivity({
            userEmail,
            action: 'retry_campaign',
            resource: 'campaign',
            resourceId: campaignId,
            details: { campaignName, retryCount }
        });
    }
}

module.exports = ActivityLogger; 