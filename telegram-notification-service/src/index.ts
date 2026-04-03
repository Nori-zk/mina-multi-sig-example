import express from 'express';
import { getSodium, verifyJwt } from './dhHmacJwt.js';

const app = express();
app.use(express.json());

// --- Validate environment ---

const possiblePort = process.env.PORT;
const possibleNamespace = process.env.NOTIFICATION_NAMESPACE;
const possibleAllowedKeys = process.env.NOTIFICATION_ALLOWED_KEYS;
const possibleBotToken = process.env.TELEGRAM_BOT_TOKEN;
const possibleChatId = process.env.TELEGRAM_CHAT_ID;
const possibleServerPrivkey = process.env.NOTIFICATION_SERVER_PRIVKEY;

const issues: string[] = [];
if (!possibleNamespace) issues.push('Missing required env: NOTIFICATION_NAMESPACE');
if (!possibleAllowedKeys) issues.push('Missing required env: NOTIFICATION_ALLOWED_KEYS (comma-separated hex X25519 public keys)');
if (!possibleBotToken) issues.push('Missing required env: TELEGRAM_BOT_TOKEN');
if (!possibleChatId) issues.push('Missing required env: TELEGRAM_CHAT_ID');
if (!possibleServerPrivkey) issues.push('Missing required env: NOTIFICATION_SERVER_PRIVKEY (hex X25519 private key — generate with npm run frost-notification-config)');

if (issues.length) {
    issues.forEach((issue) => console.error(`  - ${issue}`));
    console.error('Cannot start notification service.');
    process.exit(1);
}

const port = Number(possiblePort || 3000);
const namespace = possibleNamespace!;
const allowedKeys = possibleAllowedKeys!.split(',').filter(Boolean).map(k => k.toLowerCase());
const botToken = possibleBotToken!;
const chatId = possibleChatId!;
const serverPrivkeyHex = possibleServerPrivkey!;

if (allowedKeys.length === 0) {
    console.error('NOTIFICATION_ALLOWED_KEYS is set but contains no valid keys.');
    process.exit(1);
}

// --- Derive server public key ---

const sodium = await getSodium();
const serverPubkeyHex = Buffer.from(
    sodium.crypto_scalarmult_base(Buffer.from(serverPrivkeyHex, 'hex'))
).toString('hex');

// --- Telegram ---

async function sendTelegram(message: string): Promise<void> {
    const url = `https://api.telegram.org/bot${botToken}/sendMessage`;
    const response = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
            chat_id: chatId,
            text: message,
            parse_mode: 'HTML',
        }),
    });

    if (!response.ok) {
        const body = await response.text();
        throw new Error(`Telegram API error ${response.status}: ${body}`);
    }
}

// --- Routes ---

app.get('/pubkey', (_req, res) => {
    res.status(200).json({ pubkey: serverPubkeyHex });
});

app.post('/', async (req, res) => {
    const authHeader = req.headers.authorization;
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
        res.status(401).json({ error: 'Missing or invalid Authorization header' });
        return;
    }

    const token = authHeader.slice(7);
    const auth = await verifyJwt(token, serverPrivkeyHex, allowedKeys, namespace);
    if (!auth.valid) {
        res.status(401).json({ error: auth.error });
        return;
    }

    const { message } = req.body as { message?: string };
    if (!message) {
        res.status(400).json({ error: 'Missing message field in request body' });
        return;
    }

    try {
        await sendTelegram(message);
        res.status(200).json({ ok: true });
    } catch (e) {
        console.error('Failed to send to Telegram:', (e as Error).message);
        res.status(502).json({ error: 'Failed to send to Telegram' });
    }
});

app.get('/health', (_req, res) => {
    res.status(200).json({ ok: true });
});

// --- Start ---

app.listen(port, () => {
    console.log(`Notification service listening on port ${port}`);
    console.log(`Namespace: ${namespace}`);
    console.log(`Allowed keys: ${allowedKeys.length}`);
    console.log(`Server public key: ${serverPubkeyHex}`);
});
