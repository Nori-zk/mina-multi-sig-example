import 'dotenv/config';
import { readFileSync } from 'fs';
import { Logger, LogPrinter } from 'esm-iso-logger';
import { runFrostClient, frostGuestConfigPath } from '../frostDockerClient.js';
import { existsSync } from 'fs';
import { getAbsolutePath } from '../utils.js';

const logger = new Logger('FrostDkgParticipate');
new LogPrinter('FrostDkgParticipate');

const possibleDescription = process.argv[2];
const possibleThreshold = process.argv[3];
const possibleConfigPath = process.env.FROST_CONFIG_PATH;
const possibleServerUrl = process.env.FROST_SERVER_URL;

const issues: string[] = [];
if (!possibleDescription) issues.push('Missing required first argument: <description> — the human-readable name for the FROST signing group you are joining (e.g. "admin group"). Must match exactly what the coordinator used.');
if (!possibleThreshold) issues.push('Missing required second argument: <threshold> — the signing threshold for this group (e.g. 2 for a 2-of-3 scheme). Must match what the coordinator used.');
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

const description = possibleDescription!;
const threshold = possibleThreshold!;
const hostConfigPath = possibleAbsoluteConfigPath!;
const serverUrl = possibleServerUrl!;

// Record existing groups before DKG so we can detect the new one after
const configContent = readFileSync(hostConfigPath, 'utf8');
const existingGroupKeys = new Set<string>();
const existingGroupMatches = configContent.matchAll(/\[group\.([a-f0-9]+)\]/g);
for (const match of existingGroupMatches) {
    existingGroupKeys.add(match[1]);
}

logger.log(`Joining DKG session for "${description}" with threshold ${threshold}...`);
logger.log('This will block until the coordinator and all other participants have contributed.');

let dkgOutput: string;
try {
    dkgOutput = runFrostClient({
        frostConfigHostPath: hostConfigPath,
        args: [
            'dkg',
            '-c', frostGuestConfigPath(hostConfigPath),
            '-d', description,
            '-s', serverUrl,
            '-t', threshold,
        ],
    });
} catch (e) {
    logger.error(`${(e as Error).message}`);
    logger.fatal('Encountered a fatal error and cannot continue.');
    process.exit(1);
}

for (const line of dkgOutput.trim().split('\n')) {
    if (line.trim()) logger.info(line);
}

// Grep the new group key from the updated config
const updatedConfigContent = readFileSync(hostConfigPath, 'utf8');
const updatedGroupMatches = updatedConfigContent.matchAll(/\[group\.([a-f0-9]+)\]/g);
let newGroupKey: string | null = null;
for (const match of updatedGroupMatches) {
    if (!existingGroupKeys.has(match[1])) {
        newGroupKey = match[1];
        break;
    }
}

logger.log('');
logger.log('=== DKG Complete ===');
if (newGroupKey) {
    logger.log(`Your group public key (hex): ${newGroupKey}`);
    logger.log('');
    logger.log('Confirm this matches the group public key the coordinator reports.');
    logger.log('If it does not match, something went wrong — contact the coordinator.');
} else {
    logger.warn('Could not detect the new group key from the config. Check the FROST config manually.');
}
