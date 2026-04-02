import { readFileSync } from 'fs';
import { type CeremonyEventPayload } from './events.js';
import { TelegramNotifier } from './telegramNotifier.js';
import { getAbsolutePath } from '../utils.js';

export interface Notifier {
    notify(event: CeremonyEventPayload): void | Promise<void>;
}

const possibleServiceUrl = process.env.NOTIFICATION_SERVICE_URL;
const possibleNamespace = process.env.NOTIFICATION_NAMESPACE;
const possibleFrostConfigPath = process.env.FROST_CONFIG_PATH;

const issues: string[] = [];
if (!possibleServiceUrl) issues.push('Missing required env: NOTIFICATION_SERVICE_URL — the URL of the notification service');
if (!possibleNamespace) issues.push('Missing required env: NOTIFICATION_NAMESPACE — the namespace for JWT auth (e.g. "nori-multisig")');
if (!possibleFrostConfigPath) issues.push('Missing required env: FROST_CONFIG_PATH — the directory where your FROST config TOML is stored (communication key used for JWT signing)');

if (issues.length) {
    throw new Error(
        'Cannot create notifier due to missing configuration:\n' +
        issues.map((i) => `  - ${i}`).join('\n')
    );
}

const configDir = getAbsolutePath(possibleFrostConfigPath!);
const configContent = readFileSync(`${configDir}/credentials.toml`, 'utf8');

const pubkeyMatch = configContent.match(/\[communication_key\][\s\S]*?pubkey\s*=\s*"([^"]+)"/);
const privkeyMatch = configContent.match(/\[communication_key\][\s\S]*?privkey\s*=\s*"([^"]+)"/);

if (!pubkeyMatch || !privkeyMatch) {
    throw new Error(`No communication key found in FROST config at ${configDir}/credentials.toml. Run npm run frost-init first.`);
}

export const notifier: Notifier = new TelegramNotifier(
    possibleServiceUrl!,
    possibleNamespace!,
    pubkeyMatch[1],
    privkeyMatch[1],
);
