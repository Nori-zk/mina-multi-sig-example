import 'dotenv/config';
import { existsSync } from 'fs';
import { Logger, LogPrinter } from 'esm-iso-logger';
import { ensureCleanSessions } from '../frostDockerClient.js';
import { getAbsolutePath } from '../utils.js';

const logger = new Logger('FrostCleanSessions');
new LogPrinter('FrostCleanSessions');

const possibleConfigPath = process.env.FROST_CONFIG_PATH;
const possibleServerUrl = process.env.FROST_SERVER_URL;

const issues: string[] = [];
if (!possibleConfigPath) issues.push('Missing required env: FROST_CONFIG_PATH');
if (!possibleServerUrl) issues.push('Missing required env: FROST_SERVER_URL');

const possibleAbsoluteConfigPath = possibleConfigPath ? getAbsolutePath(possibleConfigPath) : undefined;

if (possibleAbsoluteConfigPath && !existsSync(possibleAbsoluteConfigPath)) {
    issues.push(`FROST config file does not exist: ${possibleAbsoluteConfigPath}`);
}

if (issues.length) {
    issues.forEach((issue) => logger.error(`  - ${issue}`));
    logger.fatal('Encountered a fatal error and cannot continue.');
    process.exit(1);
}

await ensureCleanSessions(possibleAbsoluteConfigPath!, possibleServerUrl!, logger);
logger.log('All sessions cleaned.');
