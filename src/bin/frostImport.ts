import 'dotenv/config';
import { existsSync } from 'fs';
import { Logger, LogPrinter } from 'esm-iso-logger';
import { runFrostClient, frostGuestConfigPath } from '../frostDockerClient.js';
import { getAbsolutePath } from '../utils.js';

const logger = new Logger('FrostImport');
new LogPrinter('FrostImport');

const possibleContactString = process.argv[2];
const possibleConfigPath = process.env.FROST_CONFIG_PATH;

const issues: string[] = [];
if (!possibleContactString) issues.push('Missing required first argument: <contact-string> — the bech32m contact string another committee member shared in the Telegram group chat (starts with "minafrost1...")');
if (!possibleConfigPath) issues.push('Missing required env: FROST_CONFIG_PATH — path to your FROST config file (e.g. ~/.config/frost/config). Run frost-init first.');

const possibleAbsoluteConfigPath = possibleConfigPath ? getAbsolutePath(possibleConfigPath) : undefined;

if (possibleAbsoluteConfigPath && !existsSync(possibleAbsoluteConfigPath)) {
    issues.push(`FROST config file does not exist: ${possibleAbsoluteConfigPath}. Run npm run frost-init first.`);
}

if (issues.length) {
    logger.warn('Could not continue due to the following issues:');
    issues.forEach((issue) => logger.error(`  - ${issue}`));
    logger.fatal('Encountered a fatal error and cannot continue.');
    process.exit(1);
}

const contactString = possibleContactString!;
const hostConfigPath = possibleAbsoluteConfigPath!;

logger.log('Importing contact...');
try {
    await runFrostClient({
        frostConfigHostPath: hostConfigPath,
        args: ['import', contactString, '-c', frostGuestConfigPath(hostConfigPath)],
    });
} catch (e) {
    logger.error(`${(e as Error).message}`);
    logger.fatal('Encountered a fatal error and cannot continue.');
    process.exit(1);
}

logger.log('Contact imported successfully.');
