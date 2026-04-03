import { readFileSync } from 'fs';
import { Logger, LogPrinter } from 'esm-iso-logger';
import { type CeremonyEventPayload } from './events.js';
import { TelegramNotifier } from './telegramNotifier.js';
import { getAbsolutePath } from '../utils.js';

const logger = new Logger('Notifier');
new LogPrinter('Notifier');

export interface Notifier {
    notify(event: CeremonyEventPayload): void | Promise<void>;
}

const possibleServiceUrl = process.env.NOTIFICATION_SERVICE_URL;
const possibleNamespace = process.env.NOTIFICATION_NAMESPACE;
const possibleFrostConfigPath = process.env.FROST_CONFIG_PATH;

const issues: string[] = [];
if (!possibleServiceUrl) issues.push('Missing required env: NOTIFICATION_SERVICE_URL — the URL of the notification service');
if (!possibleNamespace) issues.push('Missing required env: NOTIFICATION_NAMESPACE — the namespace for DH-HMAC JWT auth (e.g. "nori-multisig")');
if (!possibleFrostConfigPath) issues.push('Missing required env: FROST_CONFIG_PATH — path to your FROST config file (communication key used for DH-HMAC JWT auth)');

if (!possibleFrostConfigPath || !possibleServiceUrl || !possibleNamespace) {
    logger.warn('Could not continue due to the following issues:');
    issues.forEach((issue) => logger.error(`  - ${issue}`));
    logger.fatal('Encountered a fatal error and cannot continue.');
    process.exit(1);
}

const configFilePath = getAbsolutePath(possibleFrostConfigPath);
let configContent: string;
try {
    configContent = readFileSync(configFilePath, 'utf8');
} catch {
    logger.error(`Could not read FROST config file at ${configFilePath}. Run npm run frost-init first.`);
    logger.fatal('Encountered a fatal error and cannot continue.');
    process.exit(1);
}

const pubkeyMatch = configContent.match(/\[communication_key\][\s\S]*?pubkey\s*=\s*"([^"]+)"/);
const privkeyMatch = configContent.match(/\[communication_key\][\s\S]*?privkey\s*=\s*"([^"]+)"/);

if (!pubkeyMatch || !privkeyMatch) {
    if (!pubkeyMatch) issues.push('No communication public key found in FROST config.');
    if (!privkeyMatch) issues.push('No communication private key found in FROST config.');
    logger.warn('Could not continue due to the following issues:');
    issues.forEach((issue) => logger.error(`  - ${issue}`));
    logger.fatal('Encountered a fatal error and cannot continue.');
    process.exit(1);
}

export const notifier: Notifier = new TelegramNotifier(
    possibleServiceUrl,
    possibleNamespace,
    pubkeyMatch[1],
    privkeyMatch[1],
);
