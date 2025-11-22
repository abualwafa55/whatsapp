import express from 'express';
import makeWASocket, { DisconnectReason, useMultiFileAuthState, fetchLatestBaileysVersion } from '@whiskeysockets/baileys';
import qrcodeLib from 'qrcode';
import P from 'pino';

const app = express();
app.use(express.json());

// Store active sessions
const sessions = new Map();
const qrCodes = new Map();
const qrCodeImages = new Map(); // Store QR as base64 images
const reconnectAttempts = new Map();

// Logger
const logger = P({ level: 'silent' });

// Maximum reconnection attempts
const MAX_RECONNECT_ATTEMPTS = 3;

/**
 * Create a new WhatsApp session
 */
async function createSession(sessionId) {
    try {
        // Initialize attempt counter
        if (!reconnectAttempts.has(sessionId)) {
            reconnectAttempts.set(sessionId, 0);
        }

        const { state, saveCreds } = await useMultiFileAuthState(`./sessions/${sessionId}`);
        
        // Get latest Baileys version
        const { version } = await fetchLatestBaileysVersion();
        
        const sock = makeWASocket({
            version,
            auth: state,
            logger: logger,
            browser: ['WhatsApp Desktop', 'Chrome', '3.0'],
            connectTimeoutMs: 60000,
            defaultQueryTimeoutMs: undefined,
            keepAliveIntervalMs: 30000,
            emitOwnEvents: true,
            markOnlineOnConnect: true,
        });

        // Save credentials on update
        sock.ev.on('creds.update', saveCreds);

        // Handle connection updates
        sock.ev.on('connection.update', async (update) => {
            const { connection, lastDisconnect, qr } = update;

            // Display QR Code
            if (qr) {
                console.log(`📱 QR Code generated for session ${sessionId}`);
                
                // Store QR text
                qrCodes.set(sessionId, qr);
                
                // Generate QR Code as base64 image
                try {
                    const qrImage = await qrcodeLib.toDataURL(qr, { 
                        width: 200,
                        margin: 5,
                        color: {
                            dark: '#000000',
                            light: '#FFFFFF'
                        }
                    });
                    qrCodeImages.set(sessionId, qrImage);
                    console.log(`✅ QR Code image generated for ${sessionId}`);
                } catch (err) {
                    console.error('Error generating QR image:', err);
                }
            }

            // Check connection status
            if (connection === 'close') {
                const statusCode = lastDisconnect?.error?.output?.statusCode;
                const shouldReconnect = statusCode !== DisconnectReason.loggedOut;
                
                console.log(`❌ Connection closed for ${sessionId}. Status: ${statusCode}, Reconnect: ${shouldReconnect}`);
                
                // Check reconnection attempts
                const attempts = reconnectAttempts.get(sessionId) || 0;
                
                if (shouldReconnect && attempts < MAX_RECONNECT_ATTEMPTS) {
                    reconnectAttempts.set(sessionId, attempts + 1);
                    console.log(`⏳ Reconnect attempt ${attempts + 1}/${MAX_RECONNECT_ATTEMPTS} for ${sessionId}...`);
                    
                    setTimeout(() => {
                        if (sessions.has(sessionId)) {
                            console.log(`🔄 Reconnecting ${sessionId}...`);
                            createSession(sessionId);
                        }
                    }, 5000);
                } else {
                    if (attempts >= MAX_RECONNECT_ATTEMPTS) {
                        console.log(`⚠️ Max reconnect attempts reached for ${sessionId}. Cleaning up...`);
                    } else {
                        console.log(`🚫 Session ${sessionId} logged out. Removing...`);
                    }
                    sessions.delete(sessionId);
                    qrCodes.delete(sessionId);
                    qrCodeImages.delete(sessionId);
                    reconnectAttempts.delete(sessionId);
                }
            } else if (connection === 'open') {
                console.log(`✅ Session ${sessionId} connected successfully!`);
                qrCodes.delete(sessionId);
                qrCodeImages.delete(sessionId);
                reconnectAttempts.set(sessionId, 0);
            }
        });

        // Save session
        sessions.set(sessionId, sock);
        return sock;

    } catch (error) {
        console.error(`❌ Error creating session ${sessionId}:`, error);
        throw error;
    }
}

/**
 * API Endpoints
 */

// Home page
app.get('/', (req, res) => {
    res.json({
        status: 'running',
        message: 'WhatsApp Baileys API Server',
        version: '1.0.0',
        endpoints: {
            createSession: 'POST /api/create-session',
            sendMessage: 'POST /api/send-message',
            getQR: 'GET /api/qr/:sessionId',
            getStatus: 'GET /api/status/:sessionId',
            getSessions: 'GET /api/sessions'
        }
    });
});

// Create new session
app.post('/api/create-session', async (req, res) => {
    try {
        const { sessionId } = req.body;

        if (!sessionId) {
            return res.status(400).json({ error: 'Session ID is required' });
        }

        if (sessions.has(sessionId)) {
            return res.status(400).json({ error: 'Session already exists' });
        }

        await createSession(sessionId);
        res.json({ 
            success: true, 
            message: 'Session created. Please scan QR code.',
            sessionId 
        });

    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// Get QR Code
app.get('/api/qr/:sessionId', (req, res) => {
    const { sessionId } = req.params;
    const qr = qrCodes.get(sessionId);
    const qrImage = qrCodeImages.get(sessionId);

    if (!qr && !qrImage) {
        return res.status(404).json({ error: 'QR code not available' });
    }

    res.json({ 
        qr: qr || '',
        qrImage: qrImage || '',
        sessionId 
    });
});

// Check session status
app.get('/api/status/:sessionId', (req, res) => {
    const { sessionId } = req.params;
    const sock = sessions.get(sessionId);

    if (!sock) {
        return res.status(404).json({ error: 'Session not found' });
    }

    res.json({
        sessionId,
        connected: sock.user ? true : false,
        user: sock.user || null
    });
});

// Get all sessions
app.get('/api/sessions', (req, res) => {
    const sessionList = Array.from(sessions.keys()).map(sessionId => ({
        sessionId,
        connected: sessions.get(sessionId).user ? true : false,
        hasQR: qrCodes.has(sessionId)
    }));

    res.json({ sessions: sessionList });
});

// Send message
app.post('/api/send-message', async (req, res) => {
    try {
        const { sessionId, number, message } = req.body;

        if (!sessionId || !number || !message) {
            return res.status(400).json({ 
                error: 'sessionId, number, and message are required' 
            });
        }

        const sock = sessions.get(sessionId);

        if (!sock) {
            return res.status(404).json({ error: 'Session not found' });
        }

        if (!sock.user) {
            return res.status(400).json({ error: 'Session not connected' });
        }

        // Format phone number
        const jid = number.includes('@s.whatsapp.net') 
            ? number 
            : `${number}@s.whatsapp.net`;

        // Send message
        await sock.sendMessage(jid, { text: message });

        res.json({ 
            success: true, 
            message: 'Message sent successfully',
            to: jid 
        });

    } catch (error) {
        console.error('Error sending message:', error);
        res.status(500).json({ error: error.message });
    }
});

// Delete session
app.delete('/api/session/:sessionId', async (req, res) => {
    try {
        const { sessionId } = req.params;
        const sock = sessions.get(sessionId);

        if (sock) {
            await sock.logout();
            sessions.delete(sessionId);
            qrCodes.delete(sessionId);
            qrCodeImages.delete(sessionId);
            reconnectAttempts.delete(sessionId);
        }

        res.json({ success: true, message: 'Session deleted' });

    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// Start server
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
    console.log(`
    ╔════════════════════════════════════════╗
    ║   🚀 WhatsApp Baileys API Server      ║
    ║   📡 Running on: http://localhost:${PORT}  ║
    ║   ✅ Ready to accept connections       ║
    ╚════════════════════════════════════════╝
    `);
});

// Error handling
process.on('uncaughtException', (error) => {
    console.error('❌ Uncaught Exception:', error);
});

process.on('unhandledRejection', (error) => {
    console.error('❌ Unhandled Rejection:', error);
});
