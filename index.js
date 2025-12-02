// Memory optimization for production environments
if (process.env.NODE_ENV === 'production') {
    // Limit V8 heap if not already set
    if (!process.env.NODE_OPTIONS) {
        process.env.NODE_OPTIONS = '--max-old-space-size=1024';
    }
    // Optimize garbage collection
    if (global.gc) {
        setInterval(() => {
            global.gc();
        }, 60000); // Run GC every minute
    }
}

let makeWASocket;
let useMultiFileAuthState;
let fetchLatestBaileysVersion;
let makeCacheableSignalKeyStore;
let isJidBroadcast;
let Browsers;

const baileysModuleReady = import('@whiskeysockets/baileys')
    .then(module => {
        ({
            default: makeWASocket,
            useMultiFileAuthState,
            fetchLatestBaileysVersion,
            makeCacheableSignalKeyStore,
            isJidBroadcast,
            Browsers
        } = module);
    })
    .catch(error => {
        console.error('Failed to load @whiskeysockets/baileys. Make sure you are using a compatible Node.js version.', error);
        process.exit(1);
    });
const pino = require('pino');
const { Boom } = require('@hapi/boom');
const express = require('express');
const bodyParser = require('body-parser');
const http = require('http');
const { WebSocketServer } = require('ws');
const path = require('path');
const fs = require('fs');
const axios = require('axios');
const { initializeApi, apiToken, getWebhookUrl } = require('./api_v1');
const { initializeLegacyApi } = require('./legacy_api');
const { randomUUID } = require('crypto');
const crypto = require('crypto');
const prisma = require('./prismaClient');
const helmet = require('helmet');
const rateLimit = require('express-rate-limit');
require('dotenv').config();
const session = require('express-session');
const FileStore = require('session-file-store')(session);
const UserManager = require('./users');
const ActivityLogger = require('./activity-logger');

const sessions = new Map();
const retries = new Map();
const app = express();

// Increase max header size to prevent 431 errors
const server = http.createServer({
    maxHeaderSize: 1048576 // 1MB (Increased from 64KB)
}, app);

const wss = new WebSocketServer({ noServer: true });

// Track WebSocket connections with their associated users
const wsClients = new Map(); // Maps WebSocket client to user info

const logger = pino({ level: 'debug' });

let sessionTokens = new Map();

// Encryption key - MUST be stored in .env file
const ENCRYPTION_KEY = process.env.TOKEN_ENCRYPTION_KEY || crypto.randomBytes(32).toString('hex');
if (!process.env.TOKEN_ENCRYPTION_KEY) {
    console.warn('⚠️  WARNING: Using random encryption key. Set TOKEN_ENCRYPTION_KEY in .env file!');
    console.warn(`Add this to your .env file: TOKEN_ENCRYPTION_KEY=${ENCRYPTION_KEY}`);
}

function normalizeTrustProxy(value) {
    if (!value || value.trim() === '') {
        return 'loopback';
    }

    const normalized = value.trim().toLowerCase();
    if (normalized === 'false') {
        return false;
    }

    if (/^\d+$/.test(normalized)) {
        return parseInt(normalized, 10);
    }

    return value;
}

const TRUST_PROXY_SETTING = normalizeTrustProxy(process.env.TRUST_PROXY);

// Initialize user management and activity logging
const userManager = new UserManager(ENCRYPTION_KEY);
const activityLogger = new ActivityLogger(ENCRYPTION_KEY);

function mapSessionRecord(record) {
    if (!record) {
        return null;
    }

    return {
        sessionId: record.id,
        status: record.status,
        detail: record.detail,
        qr: record.qr,
        reason: record.reason,
        owner: record.owner?.email || null,
        createdAt: record.createdAt,
        updatedAt: record.updatedAt
    };
}

async function loadSessionTokensFromDb() {
    try {
        const records = await prisma.sessionToken.findMany();
        sessionTokens.clear();
        for (const record of records) {
            sessionTokens.set(record.sessionId, record.tokenValue);
        }
        console.log(`🔐 Loaded ${records.length} session token(s) from MySQL.`);
    } catch (error) {
        console.error('Error loading session tokens from database:', error);
    }
}

async function loadSessionsFromDb() {
    try {
        const records = await prisma.session.findMany({
            include: {
                owner: {
                    select: { email: true }
                }
            },
            orderBy: { createdAt: 'asc' }
        });
        sessions.clear();
        for (const record of records) {
            const snapshot = mapSessionRecord(record);
            if (snapshot) {
                sessions.set(record.id, snapshot);
            }
        }
        console.log(`📦 Loaded ${records.length} session record(s) from MySQL.`);
    } catch (error) {
        console.error('Error loading sessions from database:', error);
    }
}

async function ensureTokensForSessions() {
    const missing = [];
    for (const sessionId of sessions.keys()) {
        if (!sessionTokens.has(sessionId)) {
            const fallbackToken = randomUUID();
            await persistSessionToken(sessionId, fallbackToken);
            missing.push(sessionId);
        }
    }

    if (missing.length > 0) {
        console.log(`🔑 Generated API tokens for ${missing.length} session(s) that were missing credentials.`);
    }
}

async function persistSessionToken(sessionId, token) {
    sessionTokens.set(sessionId, token);
    try {
        await prisma.sessionToken.upsert({
            where: { sessionId },
            update: {
                tokenValue: token,
                lastUsedAt: new Date()
            },
            create: {
                sessionId,
                tokenValue: token
            }
        });
    } catch (error) {
        console.error(`Error saving token for session ${sessionId}:`, error);
    }
}

async function removeSessionToken(sessionId) {
    sessionTokens.delete(sessionId);
    try {
        await prisma.sessionToken.delete({ where: { sessionId } });
    } catch (error) {
        if (error.code !== 'P2025') {
            console.error(`Error deleting token for session ${sessionId}:`, error);
        }
    }
}

// Ensure media directory exists
const mediaDir = path.join(__dirname, 'media');
if (!fs.existsSync(mediaDir)) {
    fs.mkdirSync(mediaDir);
}

app.use(express.json());
// Trust proxy for cPanel and other reverse proxy environments
app.set('trust proxy', TRUST_PROXY_SETTING);

app.use(bodyParser.json());
app.use('/admin', express.static(path.join(__dirname, 'admin')));
app.use('/media', express.static(mediaDir)); // Serve uploaded media
app.use(express.urlencoded({ extended: true }));
app.use(
  helmet({
    contentSecurityPolicy: {
      directives: {
        ...helmet.contentSecurityPolicy.getDefaultDirectives(),
        "script-src": ["'self'", "'unsafe-inline'"],
        "script-src-attr": ["'unsafe-inline'"]
      }
    }
  })
);
app.use(rateLimit({
    windowMs: 1 * 60 * 1000,
    max: 100,
    message: { status: 'error', message: 'Too many requests, please try again later.' },
    // Trust proxy headers for proper IP detection
    trustProxy: TRUST_PROXY_SETTING,
    standardHeaders: true,
    legacyHeaders: false
}));

const ADMIN_PASSWORD = process.env.ADMIN_DASHBOARD_PASSWORD;

// Session limits configuration
const MAX_SESSIONS = parseInt(process.env.MAX_SESSIONS) || 10;
const SESSION_TIMEOUT_HOURS = parseInt(process.env.SESSION_TIMEOUT_HOURS) || 24;

// Handle WebSocket upgrade requests on /ws path
server.on('upgrade', (request, socket, head) => {
    const pathname = new URL(request.url, `http://${request.headers.host}`).pathname;
    
    // Only handle /ws path for WebSocket connections
    // We also allow '/' in case the proxy rewrites the path
    if (pathname === '/ws' || pathname === '/ws/' || pathname === '/') {
        wss.handleUpgrade(request, socket, head, (ws) => {
            wss.emit('connection', ws, request);
        });
    } else {
        console.log(`[WebSocket] Rejected upgrade for path: ${pathname}`);
        socket.destroy();
    }
});

// WebSocket connection handler
wss.on('connection', (ws, req) => {
    // Try to authenticate the WebSocket connection
    const url = new URL(req.url, `http://${req.headers.host}`);
    const wsToken = url.searchParams.get('token');
    
    let userInfo = null;
    
    if (wsToken && global.wsAuthTokens) {
        const tokenData = global.wsAuthTokens.get(wsToken);
        if (tokenData && tokenData.expires > Date.now()) {
            userInfo = {
                email: tokenData.email,
                role: tokenData.role
            };
            // Delete the token after use (one-time use)
            global.wsAuthTokens.delete(wsToken);
        }
    }
    
    // Store the user info for this WebSocket client
    wsClients.set(ws, userInfo);
    
    // Send initial session data based on user permissions
    if (userInfo) {
        ws.send(JSON.stringify({
            type: 'session-update',
            data: getSessionsDetails(userInfo.email, userInfo.role === 'admin')
        }));
    }
    
    ws.on('close', () => {
        // Clean up when client disconnects
        wsClients.delete(ws);
    });
});

// Use file-based session store for production
const sessionStore = new FileStore({
    path: './sessions',
    ttl: 86400, // 1 day
    retries: 3,
    secret: process.env.SESSION_SECRET || 'change_this_secret'
});

app.use(session({
    store: sessionStore,
    secret: process.env.SESSION_SECRET || 'change_this_secret',
    resave: false,
    saveUninitialized: false,
    cookie: { 
        httpOnly: true, 
        secure: false, // Set secure: true if using HTTPS
        maxAge: 86400000 // 1 day
    }
}));

// Serve homepage
app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, 'index.html'));
});

// Serve API documentation
app.get('/api-documentation', (req, res) => {
    res.sendFile(path.join(__dirname, 'api_documentation.html'));
});

// Redirect old URL to new one
app.get('/api_documentation.md', (req, res) => {
    res.redirect('/api-documentation');
});

// Serve WebSocket test page
app.get('/test-websocket.html', (req, res) => {
    res.sendFile(path.join(__dirname, 'test-websocket.html'));
});

// Admin login endpoint - supports both legacy password and new email/password
app.post('/admin/login', express.json(), async (req, res) => {
    const { email, password } = req.body;
    const ip = req.ip;
    const userAgent = req.headers['user-agent'];
    
    // Legacy support: if only password is provided, try admin password
    if (!email && password === ADMIN_PASSWORD) {
        req.session.adminAuthed = true;
        req.session.userEmail = 'admin@localhost';
        req.session.userRole = 'admin';
        await activityLogger.logLogin('admin@localhost', ip, userAgent, true);
        return res.json({ success: true, role: 'admin' });
    }
    
    // New email/password authentication
    if (email && password) {
        const user = await userManager.authenticateUser(email, password);
        if (user) {
            req.session.adminAuthed = true;
            req.session.userEmail = user.email;
            req.session.userRole = user.role;
            req.session.userId = user.id;
            await activityLogger.logLogin(user.email, ip, userAgent, true);
            return res.json({ 
                success: true, 
                role: user.role,
                email: user.email 
            });
        }
    }
    
    await activityLogger.logLogin(email || 'unknown', ip, userAgent, false);
    res.status(401).json({ success: false, message: 'Invalid credentials' });
});

// Middleware to protect admin dashboard
function requireAdminAuth(req, res, next) {
    if (req.session && req.session.adminAuthed) {
        return next();
    }
    res.status(401).sendFile(path.join(__dirname, 'admin', 'login.html'));
}

// Middleware to check if user is admin role
function requireAdminRole(req, res, next) {
    if (req.session && req.session.adminAuthed && req.session.userRole === 'admin') {
        return next();
    }
    res.status(403).json({ success: false, message: 'Admin access required' });
}

// Helper to get current user info
function getCurrentUser(req) {
    if (!req.session || !req.session.adminAuthed) return null;
    return {
        email: req.session.userEmail,
        role: req.session.userRole,
        id: req.session.userId
    };
}

// Serve login page only if not authenticated
app.get('/admin/login.html', (req, res) => {
    if (req.session && req.session.adminAuthed) {
        return res.redirect('/admin/dashboard.html');
    }
    res.sendFile(path.join(__dirname, 'admin', 'login.html'));
});

// Protect dashboard and /admin route
app.get('/admin/dashboard.html', requireAdminAuth, (req, res) => {
    res.sendFile(path.join(__dirname, 'admin', 'dashboard.html'));
});
app.get('/admin', requireAdminAuth, (req, res) => {
    res.sendFile(path.join(__dirname, 'admin', 'dashboard.html'));
});

// Protect user management page (admin only)
app.get('/admin/users.html', requireAdminAuth, (req, res) => {
    res.sendFile(path.join(__dirname, 'admin', 'users.html'));
});

// Protect activities page
app.get('/admin/activities.html', requireAdminAuth, (req, res) => {
    res.sendFile(path.join(__dirname, 'admin', 'activities.html'));
});

// Protect campaigns page
app.get('/admin/campaigns.html', requireAdminAuth, (req, res) => {
    res.sendFile(path.join(__dirname, 'admin', 'campaigns.html'));
});

// Admin logout endpoint
app.post('/admin/logout', requireAdminAuth, (req, res) => {
    req.session.destroy(() => {
        res.clearCookie('connect.sid');
        res.json({ success: true, redirect: '/admin/login.html' });
    });
});

// User management endpoints
app.get('/api/v1/users', requireAdminAuth, async (req, res) => {
    const currentUser = getCurrentUser(req);
    if (currentUser.role === 'admin') {
        // Admin can see all users
        const users = await userManager.getAllUsers();
        res.json(users);
    } else {
        // Regular users can only see themselves
        const user = await userManager.getUser(currentUser.email);
        res.json([user]);
    }
});

app.post('/api/v1/users', requireAdminRole, async (req, res) => {
    const { email, password, role = 'user' } = req.body;
    const currentUser = getCurrentUser(req);
    const ip = req.ip;
    const userAgent = req.headers['user-agent'];
    
    try {
        const newUser = await userManager.createUser({
            email,
            password,
            role,
            createdBy: currentUser.email
        });
        
        await activityLogger.logUserCreate(currentUser.email, email, role, ip, userAgent);
        res.status(201).json(newUser);
    } catch (error) {
        res.status(400).json({ error: error.message });
    }
});

app.put('/api/v1/users/:email', requireAdminRole, async (req, res) => {
    const { email } = req.params;
    const updates = req.body;
    const currentUser = getCurrentUser(req);
    const ip = req.ip;
    const userAgent = req.headers['user-agent'];
    
    try {
        const updatedUser = await userManager.updateUser(email, updates);
        await activityLogger.logUserUpdate(currentUser.email, email, updates, ip, userAgent);
        res.json(updatedUser);
    } catch (error) {
        res.status(400).json({ error: error.message });
    }
});

app.delete('/api/v1/users/:email', requireAdminRole, async (req, res) => {
    const { email } = req.params;
    const currentUser = getCurrentUser(req);
    const ip = req.ip;
    const userAgent = req.headers['user-agent'];
    
    try {
        await userManager.deleteUser(email);
        await activityLogger.logUserDelete(currentUser.email, email, ip, userAgent);
        res.json({ success: true });
    } catch (error) {
        res.status(400).json({ error: error.message });
    }
});

// Get current user info
app.get('/api/v1/me', async (req, res) => {
    if (!req.session || !req.session.adminAuthed) {
        return res.status(401).json({ error: 'Authentication required' });
    }
    
    const currentUser = getCurrentUser(req);
    const user = await userManager.getUser(currentUser.email);
    res.json(user);
});

// Generate WebSocket authentication token
app.get('/api/v1/ws-auth', requireAdminAuth, (req, res) => {
    const currentUser = getCurrentUser(req);
    // Create a temporary token for WebSocket authentication
    const wsToken = crypto.randomBytes(32).toString('hex');
    
    // Store the token temporarily (expires in 30 seconds)
    const tokenData = {
        email: currentUser.email,
        role: currentUser.role,
        expires: Date.now() + 31000 // 30 seconds
    };
    
    // Store in a temporary map (you might want to use Redis in production)
    if (!global.wsAuthTokens) {
        global.wsAuthTokens = new Map();
    }
    global.wsAuthTokens.set(wsToken, tokenData);
    
    // Clean up expired tokens
    setTimeout(() => {
        global.wsAuthTokens.delete(wsToken);
    }, 31000);
    
    res.json({ wsToken });
});

// Activity endpoints
app.get('/api/v1/activities', requireAdminAuth, async (req, res) => {
    const currentUser = getCurrentUser(req);
    const { limit = 100, startDate, endDate } = req.query;
    
    if (currentUser.role === 'admin') {
        // Admin can see all activities
        const activities = await activityLogger.getActivities({
            limit: parseInt(limit),
            startDate,
            endDate
        });
        res.json(activities);
    } else {
        // Regular users see only their activities
        const activities = await activityLogger.getUserActivities(currentUser.email, parseInt(limit));
        res.json(activities);
    }
});

app.get('/api/v1/activities/summary', requireAdminRole, async (req, res) => {
    const { days = 7 } = req.query;
    const summary = await activityLogger.getActivitySummary(null, parseInt(days));
    res.json(summary);
});

// Test endpoint to verify log injection
app.get('/admin/test-logs', requireAdminAuth, (req, res) => {
    let logData = [];
    try {
        if (fs.existsSync(SYSTEM_LOG_FILE)) {
            const lines = fs.readFileSync(SYSTEM_LOG_FILE, 'utf-8').split('\n').filter(Boolean);
            const entries = lines.map(line => {
                try { return JSON.parse(line); } catch { return null; }
            }).filter(Boolean);
            logData = entries;
        }
    } catch (error) {
        console.error('Test endpoint error:', error);
    }
    res.json({ 
        logFileExists: fs.existsSync(SYSTEM_LOG_FILE),
        logCount: logData.length,
        logs: logData
    });
});

// Update logs endpoint
app.post('/admin/update-logs', requireAdminAuth, express.json(), (req, res) => {
    const { logs } = req.body;
    
    if (!Array.isArray(logs)) {
        return res.status(400).json({ error: 'Invalid logs data' });
    }
    
    try {
        // Clear the in-memory log
        systemLog.length = 0;
        
        // Update in-memory log with new data
        logs.forEach(log => {
            if (log.details && log.details.event === 'messages-sent') {
                systemLog.push(log);
            }
        });
        
        // Rewrite the system.log file
        const logLines = logs.map(log => JSON.stringify(log)).join('\n');
        fs.writeFileSync(SYSTEM_LOG_FILE, logLines + '\n');
        
        log('System log updated', 'SYSTEM', { event: 'log-updated', count: logs.length });
        res.json({ success: true, message: 'Logs updated successfully' });
    } catch (error) {
        console.error('Error updating logs:', error);
        res.status(500).json({ error: 'Failed to update logs' });
    }
});

const v1ApiRouter = initializeApi(sessions, sessionTokens, createSession, getSessionsDetails, deleteSession, log, userManager, activityLogger);
const legacyApiRouter = initializeLegacyApi(sessions, sessionTokens);
app.use('/api/v1', v1ApiRouter);
app.use('/api', legacyApiRouter); // Mount legacy routes at /api

// Set up campaign sender event listeners for WebSocket updates
if (v1ApiRouter.campaignSender) {
    v1ApiRouter.campaignSender.on('progress', (data) => {
        // Broadcast campaign progress to authenticated WebSocket clients
        wss.clients.forEach(client => {
            if (client.readyState === client.OPEN) {
                const userInfo = wsClients.get(client);
                if (userInfo) {
                    client.send(JSON.stringify({
                        type: 'campaign-progress',
                        ...data
                    }));
                }
            }
        });
    });
    
    v1ApiRouter.campaignSender.on('status', (data) => {
        // Broadcast campaign status updates
        wss.clients.forEach(client => {
            if (client.readyState === client.OPEN) {
                const userInfo = wsClients.get(client);
                if (userInfo) {
                    client.send(JSON.stringify({
                        type: 'campaign-status',
                        ...data
                    }));
                }
            }
        });
    });
}
// Prevent serving sensitive files
app.use((req, res, next) => {
    if (req.path.includes('session_tokens.json') || req.path.endsWith('.bak')) {
        return res.status(403).send('Forbidden');
    }
    next();
});

function broadcast(data) {
    wss.clients.forEach(client => {
        if (client.readyState === client.OPEN) {
            const userInfo = wsClients.get(client);
            
            // If it's a session update, filter based on user permissions
            if (data.type === 'session-update') {
                let filteredData = { ...data };
                
                if (userInfo && userInfo.email) {
                    // Send filtered sessions based on user permissions
                    filteredData.data = getSessionsDetails(userInfo.email, userInfo.role === 'admin');
                } else {
                    // Unauthenticated connections get no session data
                    filteredData.data = [];
                }
                
                client.send(JSON.stringify(filteredData));
            } else {
                // For other message types (logs), send as-is
                client.send(JSON.stringify(data));
            }
        }
    });
}

// System log history (in-memory)
const systemLog = [];
const MAX_LOG_ENTRIES = 1000;
const SYSTEM_LOG_FILE = path.join(__dirname, 'system.log');

// Load last N log entries from disk on startup
function loadSystemLogFromDisk() {
    if (!fs.existsSync(SYSTEM_LOG_FILE)) return;
    const lines = fs.readFileSync(SYSTEM_LOG_FILE, 'utf-8').split('\n').filter(Boolean);
    const lastLines = lines.slice(-MAX_LOG_ENTRIES);
    for (const line of lastLines) {
        try {
            const entry = JSON.parse(line);
            systemLog.push(entry);
        } catch {}
    }
}

function rotateSystemLogIfNeeded() {
    try {
        if (fs.existsSync(SYSTEM_LOG_FILE)) {
            const stats = fs.statSync(SYSTEM_LOG_FILE);
            if (stats.size > 5 * 1024 * 1024) { // 5MB
                if (fs.existsSync(SYSTEM_LOG_FILE + '.bak')) {
                    fs.unlinkSync(SYSTEM_LOG_FILE + '.bak');
                }
                fs.renameSync(SYSTEM_LOG_FILE, SYSTEM_LOG_FILE + '.bak');
            }
        }
    } catch (e) {
        console.error('Failed to rotate system.log:', e.message);
    }
}

function log(message, sessionId = 'SYSTEM', details = {}) {
    const logEntry = {
        type: 'log',
        sessionId,
        message,
        details,
        timestamp: new Date().toISOString()
    };
    // Only persist and show in dashboard if this is a sent message log (event: 'messages-sent')
    if (details && details.event === 'messages-sent') {
        systemLog.push(logEntry);
        if (systemLog.length > MAX_LOG_ENTRIES) {
            systemLog.shift(); // Remove oldest
        }
        try {
            rotateSystemLogIfNeeded();
            fs.appendFileSync(SYSTEM_LOG_FILE, JSON.stringify(logEntry) + '\n');
        } catch (e) {
            console.error('Failed to write to system.log:', e.message);
        }
    }
    console.log(`[${sessionId}] ${message}`);
    broadcast(logEntry);
}

// Export system log as JSON
app.get('/api/v1/logs/export', requireAdminAuth, (req, res) => {
    res.setHeader('Content-Disposition', 'attachment; filename="system-log.json"');
    res.setHeader('Content-Type', 'application/json');
    res.send(JSON.stringify(systemLog, null, 2));
});

// Update postToWebhook to accept sessionId and use getWebhookUrl(sessionId)
async function postToWebhook(data) {
    const sessionId = data.sessionId || 'SYSTEM';
    const webhookUrl = getWebhookUrl(sessionId);
    if (!webhookUrl) return;

    try {
        await axios.post(webhookUrl, data, {
            headers: { 'Content-Type': 'application/json' }
        });
        log(`Successfully posted to webhook: ${webhookUrl}`);
    } catch (error) {
        log(`Failed to post to webhook: ${error.message}`);
    }
}

async function updateSessionState(sessionId, status, detail, qr, reason) {
    const oldSession = sessions.get(sessionId) || {};
    const newSession = {
        ...oldSession,
        sessionId: sessionId, // Explicitly ensure sessionId is preserved
        status,
        detail,
        qr,
        reason
    };
    sessions.set(sessionId, newSession);

    try {
        await prisma.session.upsert({
            where: { id: sessionId },
            update: { status, detail, qr, reason },
            create: {
                id: sessionId,
                name: sessionId,
                status,
                detail,
                qr,
                reason
            }
        });
    } catch (error) {
        console.error(`Failed to persist session ${sessionId} state:`, error);
    }

    broadcast({ type: 'session-update', data: getSessionsDetails() });

    postToWebhook({
        event: 'session-status',
        sessionId,
        status,
        detail,
        reason
    });
}

async function connectToWhatsApp(sessionId) {
    await baileysModuleReady;
    await updateSessionState(sessionId, 'CONNECTING', 'Initializing session...', '', '');
    log('Starting session...', sessionId);

    const sessionDir = path.join(__dirname, 'auth_info_baileys', sessionId);
    if (!fs.existsSync(sessionDir)) {
        fs.mkdirSync(sessionDir, { recursive: true });
    }
    
    const { state, saveCreds } = await useMultiFileAuthState(sessionDir);
    const { version, isLatest } = await fetchLatestBaileysVersion();
    log(`Using WA version: ${version.join('.')}, isLatest: ${isLatest}`, sessionId);

    const sock = makeWASocket({
        version,
        auth: {
            creds: state.creds,
            keys: makeCacheableSignalKeyStore(state.keys, logger),
        },
        printQRInTerminal: false,
        logger,
        browser: Browsers.macOS('Desktop'),
        generateHighQualityLinkPreview: false, // Disable to save memory
        shouldIgnoreJid: (jid) => isJidBroadcast(jid),
        qrTimeout: 31000,
        // Memory optimization settings
        markOnlineOnConnect: false,
        syncFullHistory: false,
        // Reduce message retry count
        retryRequestDelayMs: 2000,
        maxMsgRetryCount: 3,
        // Connection options for stability
        connectTimeoutMs: 31000,
        keepAliveIntervalMs: 31000,
        // Disable unnecessary features
        fireInitQueries: false,
        emitOwnEvents: false
    });
    
    sock.ev.on('creds.update', saveCreds);

    sock.ev.on('messages.upsert', async (m) => {
        const msg = m.messages[0];
        if (!msg.key.fromMe) {
            log(`Received new message from ${msg.key.remoteJid}`, sessionId);
            
            const messageData = {
                event: 'new-message',
                sessionId,
                from: msg.key.remoteJid,
                messageId: msg.key.id,
                timestamp: msg.messageTimestamp,
                data: msg
            };
            await postToWebhook(messageData);
        }
    });

        sock.ev.on('connection.update', async (update) => {
      const { connection, lastDisconnect, qr } = update;
        const statusCode = (lastDisconnect?.error instanceof Boom) ? lastDisconnect.error.output.statusCode : 0;

        log(`Connection update: ${connection}, status code: ${statusCode}`, sessionId);

      if (qr) {
            log('QR code generated.', sessionId);
                        await updateSessionState(sessionId, 'GENERATING_QR', 'QR code available.', qr, '');
        }

        if (connection === 'close') {
            const reason = new Boom(lastDisconnect?.error)?.output?.payload?.error || 'Unknown';

            // Allow reconnection on a 515 error, which is a "stream error" often seen after pairing.
            const shouldReconnect = statusCode !== 401 && statusCode !== 403;
            
            log(`Connection closed. Reason: ${reason}, statusCode: ${statusCode}. Reconnecting: ${shouldReconnect}`, sessionId);
            await updateSessionState(sessionId, 'DISCONNECTED', 'Connection closed.', '', reason);

            if (shouldReconnect) {
                setTimeout(() => connectToWhatsApp(sessionId), 5000);
            } else {
                 log(`Not reconnecting for session ${sessionId} due to fatal error. Please delete and recreate the session.`, sessionId);
                 const sessionDir = path.join(__dirname, 'auth_info_baileys', sessionId);
                 if (fs.existsSync(sessionDir)) {
                    fs.rmSync(sessionDir, { recursive: true, force: true });
                    log(`Cleared session data for ${sessionId}`, sessionId);
                 }
            }
        } else if (connection === 'open') {
            log('Connection opened.', sessionId);
            await updateSessionState(sessionId, 'CONNECTED', `Connected as ${sock.user?.name || 'Unknown'}`, '', '');
        }
    });

    // Ensure session exists before setting sock property
    const session = sessions.get(sessionId);
    if (session) {
        session.sock = sock;
        sessions.set(sessionId, session);
    } else {
        log(`Warning: Session ${sessionId} not found when trying to set socket`, sessionId);
    }
}

function getSessionsDetails(userEmail = null, isAdmin = false) {
    return Array.from(sessions.values())
        .filter(s => {
            // Admin can see all sessions
            if (isAdmin) return true;
            // Regular users can only see their own sessions
            return s.owner === userEmail;
        })
        .map(s => ({
            sessionId: s.sessionId,
            status: s.status,
            detail: s.detail,
            qr: s.qr,
            token: sessionTokens.get(s.sessionId) || null,
            owner: s.owner || 'system' // Include owner info
        }));
}

// API Endpoints
app.get('/sessions', (req, res) => {
    const currentUser = getCurrentUser(req);
    if (currentUser) {
        res.json(getSessionsDetails(currentUser.email, currentUser.role === 'admin'));
    } else {
        // For backwards compatibility, show all sessions if not authenticated
        res.json(getSessionsDetails());
    }
});

async function createSession(sessionId, createdBy = null) {
    if (sessions.has(sessionId)) {
        throw new Error('Session already exists');
    }
    
    // Check session limit
    if (sessions.size >= MAX_SESSIONS) {
        throw new Error(`Maximum session limit (${MAX_SESSIONS}) reached. Please delete unused sessions.`);
    }
    
    const token = randomUUID();
    await persistSessionToken(sessionId, token);
    
    await prisma.session.upsert({
        where: { id: sessionId },
        update: {
            status: 'CREATING',
            detail: 'Session is being created.'
        },
        create: {
            id: sessionId,
            name: sessionId,
            status: 'CREATING',
            detail: 'Session is being created.'
        }
    });

    // Set a placeholder before async connection with owner info
    sessions.set(sessionId, { 
        sessionId: sessionId, 
        status: 'CREATING', 
        detail: 'Session is being created.',
        owner: createdBy // Track who created this session
    });
    
    // Track session ownership in user manager
    if (createdBy) {
        await userManager.addSessionToUser(createdBy, sessionId);
    }
    
    // Auto-cleanup inactive sessions after timeout
    // Fix for timeout overflow on 32-bit systems - cap at 24 hours max
    const timeoutMs = Math.min(SESSION_TIMEOUT_HOURS * 60 * 60 * 1000, 24 * 60 * 60 * 1000);
    setTimeout(async () => {
        const session = sessions.get(sessionId);
        if (session && session.status !== 'CONNECTED') {
            await deleteSession(sessionId);
            log(`Auto-deleted inactive session after ${SESSION_TIMEOUT_HOURS} hours: ${sessionId}`, 'SYSTEM');
        }
    }, timeoutMs);
    
    connectToWhatsApp(sessionId);
    return { status: 'success', message: `Session ${sessionId} created.`, token };
}

app.get('/api/v1/sessions/:sessionId/qr', async (req, res) => {
    const { sessionId } = req.params;
    const session = sessions.get(sessionId);
    if (!session) {
        return res.status(404).json({ error: 'Session not found' });
    }
    log(`QR code requested for ${sessionId}`, sessionId);
    await updateSessionState(sessionId, 'GENERATING_QR', 'QR code requested by user.', '', '');
    // The connection logic will handle the actual QR generation and broadcast.
    res.status(200).json({ message: 'QR generation triggered.' });
});

async function deleteSession(sessionId) {
    const session = sessions.get(sessionId);
    if (session && session.sock) {
        try {
            await session.sock.logout();
        } catch (err) {
            log(`Error during logout for session ${sessionId}: ${err.message}`, sessionId);
        }
    }
    
    // Remove session ownership
    if (session && session.owner) {
        await userManager.removeSessionFromUser(session.owner, sessionId);
    }
    
    sessions.delete(sessionId);
    await removeSessionToken(sessionId);
    const sessionDir = path.join(__dirname, 'auth_info_baileys', sessionId);
    if (fs.existsSync(sessionDir)) {
        fs.rmSync(sessionDir, { recursive: true, force: true });
    }
    try {
        await prisma.session.delete({ where: { id: sessionId } });
    } catch (error) {
        if (error.code !== 'P2025') {
            console.error(`Failed to remove session ${sessionId} from database:`, error.message);
        }
    }
    log(`Session ${sessionId} deleted and data cleared.`, 'SYSTEM');
    broadcast({ type: 'session-update', data: getSessionsDetails() });
}

const PORT = process.env.PORT || 3100;

// Handle memory errors gracefully
process.on('uncaughtException', (error) => {
    if (error.message && error.message.includes('Out of memory')) {
        console.error('FATAL: Out of memory error. The application will exit.');
        console.error('Consider reducing MAX_SESSIONS or upgrading your hosting plan.');
        process.exit(1);
    }
    console.error('Uncaught Exception:', error);
});

process.on('unhandledRejection', (reason, promise) => {
    console.error('Unhandled Rejection at:', promise, 'reason:', reason);
});

async function initializeExistingSessions() {
    const sessionsDir = path.join(__dirname, 'auth_info_baileys');
    if (!fs.existsSync(sessionsDir)) {
        console.log('No Baileys auth_info directory found. Skipping session restore.');
        return;
    }

    const sessionFolders = fs
        .readdirSync(sessionsDir)
        .filter((folder) => {
            const sessionPath = path.join(sessionsDir, folder);
            try {
                return fs.statSync(sessionPath).isDirectory();
            } catch (error) {
                console.warn(`Skipping unreadable session folder ${folder}:`, error.message);
                return false;
            }
        });

    if (sessionFolders.length === 0) {
        console.log('No stored WhatsApp sessions to restore.');
        return;
    }

    log(`Found ${sessionFolders.length} stored session(s). Attempting reconnection...`);

    for (const sessionId of sessionFolders) {
        if (!sessions.has(sessionId)) {
            let dbSession = await prisma.session.findUnique({
                where: { id: sessionId },
                include: {
                    owner: {
                        select: { email: true }
                    }
                }
            });

            if (!dbSession) {
                dbSession = await prisma.session.create({
                    data: {
                        id: sessionId,
                        name: sessionId,
                        status: 'CREATING',
                        detail: 'Session restored from filesystem credentials.'
                    },
                    include: {
                        owner: {
                            select: { email: true }
                        }
                    }
                });
            }

            const snapshot = mapSessionRecord(dbSession);
            if (snapshot) {
                sessions.set(sessionId, snapshot);
            }
        }

        if (!sessionTokens.has(sessionId)) {
            const fallbackToken = randomUUID();
            await persistSessionToken(sessionId, fallbackToken);
            log(`Generated fallback API token for restored session ${sessionId}`, 'SYSTEM');
        }

        try {
            await connectToWhatsApp(sessionId);
        } catch (error) {
            console.error(`Failed to reconnect session ${sessionId}:`, error);
        }
    }
}

async function startServer() {
    loadSystemLogFromDisk();
    await loadSessionsFromDb();
    await loadSessionTokensFromDb();
    await ensureTokensForSessions();
    server.listen(PORT, () => {
        log(`Server is running on port ${PORT}`);
        log(`🔌 WebSocket endpoint: ws://localhost:${PORT}/ws`);
        log('Admin dashboard available at http://localhost:3100/admin/dashboard.html');
        initializeExistingSessions();
        startCampaignScheduler();
    });
}

startServer().catch((error) => {
    console.error('Failed to start server:', error);
    process.exit(1);
});

// Campaign scheduler to automatically start campaigns at their scheduled time
function startCampaignScheduler() {
    console.log('📅 Campaign scheduler started - checking every minute for scheduled campaigns');

    const runScheduler = async () => {
        try {
            const result = await checkAndStartScheduledCampaigns();
            if (result?.error) {
                console.warn('⚠️ Campaign scheduler reported an error:', result.error);
                return;
            }

            if (result?.campaignsToStart) {
                console.log(`🕒 Scheduler iteration processed ${result.campaignsToStart} pending campaign(s).`);
            }

            if (result?.recovery && (result.recovery.resumed || result.recovery.completed)) {
                console.log(
                    `♻️ Campaign recovery summary: resumed ${result.recovery.resumed} campaign(s), ` +
                    `completed ${result.recovery.completed} stalled campaign(s).`
                );
            }
        } catch (error) {
            console.error('❌ Campaign scheduler run failed:', error);
        }
    };

    runScheduler();
    setInterval(() => {
        runScheduler();
    }, 60000);
}

// Use the scheduler function from the API router
async function checkAndStartScheduledCampaigns() {
    if (v1ApiRouter && v1ApiRouter.checkAndStartScheduledCampaigns) {
        return await v1ApiRouter.checkAndStartScheduledCampaigns();
    } else {
        console.log('⏳ API router not initialized yet, skipping scheduler check');
        return { error: 'API router not initialized' };
    }
}


