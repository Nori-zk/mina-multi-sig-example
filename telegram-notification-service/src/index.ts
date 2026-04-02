import express from 'express';
import { createHmac } from 'crypto';

const app = express();
app.use(express.json());

const PORT = Number(process.env.PORT || 3000);
const NAMESPACE = process.env.NOTIFICATION_NAMESPACE;
const ALLOWED_KEYS = (process.env.NOTIFICATION_ALLOWED_KEYS || '').split(',').filter(Boolean);
const TELEGRAM_BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN;
const TELEGRAM_CHAT_ID = process.env.TELEGRAM_CHAT_ID;

if (!NAMESPACE) {
    console.error('Missing required env: NOTIFICATION_NAMESPACE');
    process.exit(1);
}
if (ALLOWED_KEYS.length === 0) {
    console.error('Missing required env: NOTIFICATION_ALLOWED_KEYS (comma-separated hex public keys)');
    process.exit(1);
}
if (!TELEGRAM_BOT_TOKEN) {
    console.error('Missing required env: TELEGRAM_BOT_TOKEN');
    process.exit(1);
}
if (!TELEGRAM_CHAT_ID) {
    console.error('Missing required env: TELEGRAM_CHAT_ID');
    process.exit(1);
}

function verifyJwt(authHeader: string | undefined): { valid: boolean; error?: string } {
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
        return { valid: false, error: 'Missing or invalid Authorization header' };
    }

    const token = authHeader.slice(7);
    const parts = token.split('.');
    if (parts.length !== 3) {
        return { valid: false, error: 'Invalid JWT format' };
    }

    const [header, payload, signature] = parts;

    let decoded: { pub?: string; ns?: string; iat?: number };
    try {
        decoded = JSON.parse(Buffer.from(payload, 'base64url').toString());
    } catch {
        return { valid: false, error: 'Invalid JWT payload' };
    }

    if (!decoded.pub || !decoded.ns || !decoded.iat) {
        return { valid: false, error: 'JWT payload missing required fields (pub, ns, iat)' };
    }

    if (decoded.ns !== NAMESPACE) {
        return { valid: false, error: `Namespace mismatch: expected '${NAMESPACE}', got '${decoded.ns}'` };
    }

    if (!ALLOWED_KEYS.includes(decoded.pub)) {
        return { valid: false, error: 'Public key not in allowed set' };
    }

    const expectedSignature = createHmac('sha256', Buffer.from(decoded.pub, 'hex'))
        .update(`${header}.${payload}`)
        .digest('base64url');

    if (signature !== expectedSignature) {
        return { valid: false, error: 'Invalid signature' };
    }

    // Check token age — reject if older than 5 minutes
    const age = Math.floor(Date.now() / 1000) - decoded.iat;
    if (age > 300) {
        return { valid: false, error: 'Token expired (older than 5 minutes)' };
    }

    return { valid: true };
}

async function sendTelegram(message: string): Promise<void> {
    const url = `https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/sendMessage`;
    const response = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
            chat_id: TELEGRAM_CHAT_ID,
            text: message,
            parse_mode: 'HTML',
        }),
    });

    if (!response.ok) {
        const body = await response.text();
        throw new Error(`Telegram API error ${response.status}: ${body}`);
    }
}

app.post('/', async (req, res) => {
    const auth = verifyJwt(req.headers.authorization);
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

app.listen(PORT, () => {
    console.log(`Notification service listening on port ${PORT}`);
    console.log(`Namespace: ${NAMESPACE}`);
    console.log(`Allowed keys: ${ALLOWED_KEYS.length}`);
});
