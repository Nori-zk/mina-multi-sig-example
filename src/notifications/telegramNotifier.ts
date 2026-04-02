import { createHmac } from 'crypto';
import { Logger, LogPrinter } from 'esm-iso-logger';
import { type CeremonyEventPayload } from './events.js';
import { formatEvent } from './formatters.js';
import { type Notifier } from './notifier.js';

const logger = new Logger('TelegramNotifier');
new LogPrinter('TelegramNotifier');

function createJwt(pubkey: string, privkey: string, namespace: string): string {
    const header = Buffer.from(JSON.stringify({ alg: 'HS256', typ: 'JWT' })).toString('base64url');
    const payload = Buffer.from(JSON.stringify({
        pub: pubkey,
        ns: namespace,
        iat: Math.floor(Date.now() / 1000),
    })).toString('base64url');

    const signature = createHmac('sha256', Buffer.from(privkey, 'hex'))
        .update(`${header}.${payload}`)
        .digest('base64url');

    return `${header}.${payload}.${signature}`;
}

export class TelegramNotifier implements Notifier {
    private serviceUrl: string;
    private namespace: string;
    private pubkey: string;
    private privkey: string;

    constructor(serviceUrl: string, namespace: string, pubkey: string, privkey: string) {
        this.serviceUrl = serviceUrl;
        this.namespace = namespace;
        this.pubkey = pubkey;
        this.privkey = privkey;
    }

    async notify(event: CeremonyEventPayload): Promise<void> {
        const token = createJwt(this.pubkey, this.privkey, this.namespace);
        const message = formatEvent(event);

        try {
            const response = await fetch(this.serviceUrl, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'Authorization': `Bearer ${token}`,
                },
                body: JSON.stringify({ event, message }),
            });

            if (!response.ok) {
                const body = await response.text();
                throw new Error(`Notification service returned ${response.status}: ${body}`);
            }

            logger.log('Notification sent to Telegram successfully.');
        } catch (e) {
            logger.error(`Failed to send notification to Telegram: ${(e as Error).message}`);
            logger.warn('Please send the following message to the Telegram group manually:');
            logger.log('');
            logger.log(message);
        }
    }
}
