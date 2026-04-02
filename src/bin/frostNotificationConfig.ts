import 'dotenv/config';
import { readFileSync } from 'fs';
import { Logger, LogPrinter } from 'esm-iso-logger';

const logger = new Logger('FrostNotificationConfig');
new LogPrinter('FrostNotificationConfig');

const possibleConfigPath = process.env.FROST_CONFIG_PATH;

if (!possibleConfigPath) {
    logger.fatal('Missing required env: FROST_CONFIG_PATH');
    process.exit(1);
}

const configPath = possibleConfigPath;

const content = readFileSync(configPath, 'utf8');

// Extract own communication public key
const ownPubkeyMatch = content.match(/\[communication_key\][\s\S]*?pubkey\s*=\s*"([^"]+)"/);
if (!ownPubkeyMatch) {
    logger.fatal('No communication key found in FROST config. Run frost-init first.');
    process.exit(1);
}

const pubkeys: string[] = [ownPubkeyMatch[1]];

// Extract all contact public keys
const contactPubkeyMatches = content.matchAll(/\[contact\.[^\]]+\][\s\S]*?pubkey\s*=\s*"([^"]+)"/g);
for (const match of contactPubkeyMatches) {
    pubkeys.push(match[1]);
}

if (pubkeys.length < 2) {
    logger.fatal('No contacts found in FROST config. Import contacts with frost-import first.');
    process.exit(1);
}

console.log('# Notification service configuration');
console.log('# Copy this into the notification service environment');
console.log('');
console.log('NOTIFICATION_NAMESPACE=nori-multisig');
console.log(`NOTIFICATION_ALLOWED_KEYS=${pubkeys.join(',')}`);
console.log('TELEGRAM_BOT_TOKEN=<set this>');
console.log('TELEGRAM_CHAT_ID=<set this>');
