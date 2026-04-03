import 'dotenv/config';
import { existsSync } from 'fs';
import { Logger, LogPrinter } from 'esm-iso-logger';
import { runFrostClient, frostGuestConfigPath } from '../frostDockerClient.js';
import { getAbsolutePath } from '../utils.js';

const logger = new Logger('FrostSessions');
new LogPrinter('FrostSessions');

const possibleConfigPath = process.env.FROST_CONFIG_PATH;
const possibleServerUrl = process.env.FROST_SERVER_URL;

const issues: string[] = [];
if (!possibleConfigPath) issues.push('Missing required env: FROST_CONFIG_PATH — path to your FROST config file (e.g. ~/.config/frost/config)');
if (!possibleServerUrl) issues.push('Missing required env: FROST_SERVER_URL — the URL of the frostd coordination server');

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

const hostConfigPath = possibleAbsoluteConfigPath!;
const serverUrl = possibleServerUrl!;

try {
    await runFrostClient({
        frostConfigHostPath: hostConfigPath,
        args: [
            'sessions',
            '-c', frostGuestConfigPath(hostConfigPath),
            '-s', serverUrl,
        ],
    });
} catch (e) {
    logger.error((e as Error).message);
    logger.fatal('Encountered a fatal error and cannot continue.');
    process.exit(1);
}
