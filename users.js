const bcrypt = require('./bcrypt-compat');
const prisma = require('./prismaClient');
const { UserRole, SessionStatus } = require('@prisma/client');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

class UserManager {
    constructor(encryptionKey) {
        this.encryptionKey = encryptionKey;
        this.legacyFile = path.join(__dirname, 'users.enc');
        this.migrationPromise = this.migrateFromLegacyFile();
    }

    async ensureReady() {
        if (this.migrationPromise) {
            await this.migrationPromise;
            this.migrationPromise = null;
        }
    }

    normalizeRole(role = 'user') {
        return role && role.toString().toLowerCase() === 'admin' ? UserRole.ADMIN : UserRole.USER;
    }

    presentRole(role) {
        return role === UserRole.ADMIN ? 'admin' : 'user';
    }

    async migrateFromLegacyFile() {
        if (!this.encryptionKey || !fs.existsSync(this.legacyFile)) {
            return;
        }

        try {
            const encryptedData = fs.readFileSync(this.legacyFile, 'utf8');
            if (!encryptedData) {
                return;
            }
            const decryptedData = this.decrypt(encryptedData);
            const legacyUsers = JSON.parse(decryptedData);

            for (const legacyUser of legacyUsers) {
                const email = (legacyUser.email || '').toLowerCase();
                if (!email) continue;

                await prisma.user.upsert({
                    where: { email },
                    update: {
                        passwordHash: legacyUser.password,
                        role: this.normalizeRole(legacyUser.role),
                        isActive: legacyUser.isActive !== false,
                        createdBy: legacyUser.createdBy || 'migration',
                        lastLogin: legacyUser.lastLogin ? new Date(legacyUser.lastLogin) : null
                    },
                    create: {
                        email,
                        passwordHash: legacyUser.password,
                        role: this.normalizeRole(legacyUser.role),
                        createdBy: legacyUser.createdBy || 'migration',
                        isActive: legacyUser.isActive !== false,
                        lastLogin: legacyUser.lastLogin ? new Date(legacyUser.lastLogin) : null
                    }
                });

                if (Array.isArray(legacyUser.sessions)) {
                    for (const sessionId of legacyUser.sessions) {
                        if (!sessionId) continue;
                        await prisma.session.upsert({
                            where: { id: sessionId },
                            update: {
                                owner: { connect: { email } }
                            },
                            create: {
                                id: sessionId,
                                name: sessionId,
                                status: SessionStatus.CREATING,
                                owner: { connect: { email } }
                            }
                        });
                    }
                }
            }

            fs.renameSync(this.legacyFile, `${this.legacyFile}.bak`);
            console.log('✅ Migrated legacy users.enc into the database. Backup saved as users.enc.bak');
        } catch (error) {
            console.error('⚠️  Failed to migrate legacy users.enc file:', error.message);
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

    toPublicUser(user) {
        if (!user) return null;
        const { passwordHash, ...safeUser } = user;
        let sessionIds = [];
        if (Array.isArray(user.sessions)) {
            sessionIds = user.sessions.map((session) =>
                typeof session === 'string' ? session : session.id
            );
        }
        return {
            ...safeUser,
            role: this.presentRole(user.role),
            sessions: sessionIds
        };
    }

    async createUser({ email, password, role = 'user', createdBy }) {
        await this.ensureReady();
        const normalizedEmail = email.toLowerCase();
        const existing = await prisma.user.findUnique({ where: { email: normalizedEmail } });
        if (existing) {
            throw new Error('User already exists');
        }

        const hashedPassword = await bcrypt.hash(password, 10);
        const user = await prisma.user.create({
            data: {
                email: normalizedEmail,
                passwordHash: hashedPassword,
                role: this.normalizeRole(role),
                createdBy,
                isActive: true
            },
            include: { sessions: { select: { id: true } } }
        });

        return this.toPublicUser(user);
    }

    async updateUser(email, updates) {
        await this.ensureReady();
        const normalizedEmail = email.toLowerCase();
        const data = {};

        if (updates.password) {
            data.passwordHash = await bcrypt.hash(updates.password, 10);
        }
        if (typeof updates.isActive === 'boolean') {
            data.isActive = updates.isActive;
        }
        if (updates.role) {
            data.role = this.normalizeRole(updates.role);
        }

        const user = await prisma.user.update({
            where: { email: normalizedEmail },
            data,
            include: { sessions: { select: { id: true } } }
        });

        return this.toPublicUser(user);
    }

    async deleteUser(email) {
        await this.ensureReady();
        const normalizedEmail = email.toLowerCase();
        await prisma.user.delete({ where: { email: normalizedEmail } });
        return { success: true };
    }

    async authenticateUser(email, password) {
        await this.ensureReady();
        const normalizedEmail = email.toLowerCase();
        const user = await prisma.user.findUnique({ where: { email: normalizedEmail } });
        if (!user || !user.isActive) {
            return null;
        }

        const isValid = await bcrypt.compare(password, user.passwordHash);
        if (!isValid) {
            return null;
        }

        const updated = await prisma.user.update({
            where: { email: normalizedEmail },
            data: { lastLogin: new Date() },
            include: { sessions: { select: { id: true } } }
        });

        return this.toPublicUser(updated);
    }

    async getUser(email) {
        await this.ensureReady();
        const normalizedEmail = email.toLowerCase();
        const user = await prisma.user.findUnique({
            where: { email: normalizedEmail },
            include: { sessions: { select: { id: true } } }
        });
        return this.toPublicUser(user);
    }

    async getAllUsers() {
        await this.ensureReady();
        const users = await prisma.user.findMany({
            orderBy: { createdAt: 'desc' },
            include: { sessions: { select: { id: true } } }
        });
        return users.map((user) => this.toPublicUser(user));
    }

    async addSessionToUser(email, sessionId) {
        await this.ensureReady();
        const user = await prisma.user.findUnique({ where: { email: email.toLowerCase() } });
        if (!user) {
            throw new Error('User not found');
        }

        await prisma.session.upsert({
            where: { id: sessionId },
            update: {
                ownerId: user.id
            },
            create: {
                id: sessionId,
                name: sessionId,
                status: SessionStatus.CREATING,
                ownerId: user.id
            }
        });
    }

    async removeSessionFromUser(email, sessionId) {
        await this.ensureReady();
        const session = await prisma.session.findUnique({ where: { id: sessionId } });
        if (!session) {
            return;
        }
        await prisma.session.update({
            where: { id: sessionId },
            data: { ownerId: null }
        });
    }

    async getUserSessions(email) {
        await this.ensureReady();
        const user = await prisma.user.findUnique({
            where: { email: email.toLowerCase() },
            include: { sessions: { select: { id: true } } }
        });
        return user && user.sessions ? user.sessions.map((session) => session.id) : [];
    }

    async getSessionOwner(sessionId) {
        await this.ensureReady();
        const session = await prisma.session.findUnique({
            where: { id: sessionId },
            include: { owner: true }
        });
        if (!session || !session.owner) {
            return null;
        }
        return this.toPublicUser({ ...session.owner, sessions: [] });
    }
}

module.exports = UserManager;