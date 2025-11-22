import makeWASocket, { DisconnectReason, useMultiFileAuthState, fetchLatestBaileysVersion } from '@whiskeysockets/baileys';
import qrcode from 'qrcode-terminal';
import P from 'pino';

const logger = P({ level: 'silent' });

async function connectToWhatsApp() {
    const { state, saveCreds } = await useMultiFileAuthState('./test-session');
    
    // Get latest Baileys version
    const { version, isLatest } = await fetchLatestBaileysVersion();
    console.log(`Using WA v${version.join('.')}, isLatest: ${isLatest}`);
    
    const sock = makeWASocket({
        version,
        logger,
        auth: state,
        browser: ['Chrome (Linux)', '', ''],
    });

    sock.ev.on('creds.update', saveCreds);

    sock.ev.on('connection.update', (update) => {
        const { connection, lastDisconnect, qr } = update;
        
        // Display QR Code
        if (qr) {
            console.log('\n📱 Scan this QR Code with WhatsApp:\n');
            qrcode.generate(qr, { small: true });
            console.log('\n⏰ QR Code expires in 60 seconds\n');
        }
        
        if (connection === 'close') {
            const shouldReconnect = lastDisconnect?.error?.output?.statusCode !== DisconnectReason.loggedOut;
            console.log('Connection closed due to', lastDisconnect?.error, ', reconnecting', shouldReconnect);
            
            if (shouldReconnect) {
                connectToWhatsApp();
            }
        } else if (connection === 'open') {
            console.log('✅ Connected successfully!');
            console.log('Phone:', sock.user);
        }
    });

    sock.ev.on('messages.upsert', async (m) => {
        console.log('📨 New message:', JSON.stringify(m, null, 2));
    });
}

console.log('🚀 Starting simple Baileys test...');
connectToWhatsApp();
