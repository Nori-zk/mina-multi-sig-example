import 'dotenv/config';
import { Logger, LogPrinter } from 'esm-iso-logger';
import { runFrostClient, frostGuestConfigPath } from '../frostDockerClient.js';
import { checkDirectory, ensureDirectory, getAbsolutePath } from '../utils.js';
import { askYesNo } from '../preflight.js';

const logger = new Logger('FrostImport');
new LogPrinter('FrostImport');

const possibleContactString = process.argv[2];
const possibleConfigPath = process.env.FROST_CONFIG_PATH;

const issues: string[] = [];
if (!possibleContactString) issues.push('Missing required first argument: <contact-string> — the bech32m contact string another committee member shared in the Telegram group chat (starts with "minafrost1...")');
if (!possibleConfigPath) issues.push('Missing required env: FROST_CONFIG_PATH — the directory where your FROST config TOML is stored');

const possibleAbsoluteConfigPath = possibleConfigPath ? getAbsolutePath(possibleConfigPath) : undefined;

if (possibleAbsoluteConfigPath && !checkDirectory(possibleAbsoluteConfigPath)) {
    logger.warn(`FROST config directory does not exist: ${possibleAbsoluteConfigPath}`);
    if (!await askYesNo('Do you want to create this directory?')) {
        issues.push(`Directory missing: Docker cannot mount the non-existent path: ${possibleAbsoluteConfigPath}`);
    } else {
        ensureDirectory(possibleAbsoluteConfigPath);
        logger.log(`Created directory: ${possibleAbsoluteConfigPath}`);
    }
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
let importOutput: string;
try {
    importOutput = runFrostClient({
        frostConfigHostPath: hostConfigPath,
        args: ['import', contactString, '-c', frostGuestConfigPath],
    });
} catch (e) {
    logger.error(`${(e as Error).message}`);
    logger.fatal('Encountered a fatal error and cannot continue.');
    process.exit(1);
}

for (const line of importOutput.trim().split('\n')) {
    if (line.trim()) logger.info(line);
}

logger.log('Contact imported successfully.');
