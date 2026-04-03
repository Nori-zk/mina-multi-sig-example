import 'dotenv/config';
import { existsSync } from 'fs';
import { dirname } from 'path';
import { Logger, LogPrinter } from 'esm-iso-logger';
import { runFrostClient, frostGuestConfigPath } from '../frostDockerClient.js';
import { checkDirectory, ensureDirectory, getAbsolutePath } from '../utils.js';
import { askYesNo } from '../preflight.js';

const logger = new Logger('FrostInit');
new LogPrinter('FrostInit');

const possibleName = process.argv[2];
const possibleConfigPath = process.env.FROST_CONFIG_PATH;

const issues: string[] = [];
if (!possibleName) issues.push('Missing required first argument: <name> — your committee member name (e.g. "alice"). This identifies you to other participants during contact exchange.');
if (!possibleConfigPath) issues.push('Missing required env: FROST_CONFIG_PATH — path to your FROST config file (e.g. ~/.config/frost/config)');

const possibleAbsoluteConfigPath = possibleConfigPath ? getAbsolutePath(possibleConfigPath) : undefined;

if (possibleAbsoluteConfigPath) {
    const baseDir = dirname(possibleAbsoluteConfigPath);
    if (!checkDirectory(baseDir)) {
        logger.warn(`Parent directory does not exist: ${baseDir}`);
        if (!await askYesNo('Do you want to create it?')) {
            issues.push(`Directory missing: Docker cannot mount the file without its parent directory: ${baseDir}`);
        } else {
            ensureDirectory(baseDir);
            logger.log(`Created directory: ${baseDir}`);
        }
    }

    if (existsSync(possibleAbsoluteConfigPath)) {
        issues.push(
            `FROST config already exists at ${possibleAbsoluteConfigPath}. ` +
            'Re-initializing would overwrite your communication keypair and key shares. ' +
            'This could permanently destroy access to contracts managed by this key. ' +
            'If you need to re-initialize, manually back up and remove the existing config first.'
        );
    }
}

if (issues.length) {
    logger.warn('Could not continue due to the following issues:');
    issues.forEach((issue) => logger.error(`  - ${issue}`));
    logger.fatal('Encountered a fatal error and cannot continue.');
    process.exit(1);
}

const name = possibleName!;
const hostConfigPath = possibleAbsoluteConfigPath!;

logger.log('Initializing FROST config...');
let initOutput: string;
try {
    initOutput = await runFrostClient({
        frostConfigHostPath: hostConfigPath,
        args: ['init', '-c', frostGuestConfigPath(hostConfigPath)],
    });
} catch (e) {
    logger.error(`${(e as Error).message}`);
    logger.fatal('Encountered a fatal error and cannot continue.');
    process.exit(1);
}

for (const line of initOutput.trim().split('\n')) {
    if (line.trim()) logger.info(line);
}

logger.log('Exporting contact string...');
let exportOutput: string;
try {
    exportOutput = await runFrostClient({
        frostConfigHostPath: hostConfigPath,
        args: ['export', '-n', name, '-c', frostGuestConfigPath(hostConfigPath)],
    });
} catch (e) {
    logger.error(`${(e as Error).message}`);
    logger.fatal('Encountered a fatal error and cannot continue.');
    process.exit(1);
}

for (const line of exportOutput.trim().split('\n')) {
    if (line.trim()) logger.info(line);
}

const contactStringMatch = exportOutput.match(/minafrost1[a-z0-9]+/);
const contactString = contactStringMatch ? contactStringMatch[0] : null;

if (!contactString) {
    logger.error('Could not extract contact string from FROST export output.');
    logger.fatal('Encountered a fatal error and cannot continue.');
    process.exit(1);
}

logger.log('');
logger.log('=== Next Steps ===');
logger.log('Paste the following line in the Telegram group chat for other committee members:');
logger.log('');
logger.log(`Hi, I'm ${name}. To add me to your FROST contacts run: "npm run frost-import -- ${contactString}"`);
logger.log('');
logger.log('Each committee member copies that line and runs it to import your contact.');
