import { Logger } from 'esm-iso-logger';
import { type CeremonyEventPayload } from './events.js';
import { formatEvent } from './formatters.js';
import { type Notifier } from './notifier.js';
import { createJwt } from '../dhHmacJwt.js';

const logger = new Logger('TelegramNotifier');

export class TelegramNotifier implements Notifier {
    private serviceUrl: string;
    private namespace: string;
    private pubkeyHex: string;
    private privkeyHex: string;

    constructor(serviceUrl: string, namespace: string, pubkeyHex: string, privkeyHex: string) {
        this.serviceUrl = serviceUrl;
        this.namespace = namespace;
        this.pubkeyHex = pubkeyHex;
        this.privkeyHex = privkeyHex;
    }

    private async fetchServerPubkey(): Promise<string> {
        const response = await fetch(`${this.serviceUrl}/pubkey`);
        if (!response.ok) {
            throw new Error(`Failed to fetch server public key: ${response.status}`);
        }
        const { pubkey } = await response.json() as { pubkey: string };
        return pubkey;
    }

    async notify(event: CeremonyEventPayload): Promise<void> {
        const message = formatEvent(event);

        try {
            const serverPubkey = await this.fetchServerPubkey();
            const token = await createJwt(this.pubkeyHex, this.privkeyHex, serverPubkey, this.namespace);

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
