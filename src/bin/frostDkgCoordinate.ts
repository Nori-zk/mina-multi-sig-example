import 'dotenv/config';
import { readFileSync } from 'fs';
import { Logger, LogPrinter } from 'esm-iso-logger';
import { runFrostClient, frostGuestConfigPath } from '../frostDockerClient.js';
import { existsSync } from 'fs';
import { getAbsolutePath } from '../utils.js';
import { notifier } from '../notifications/notifier.js';

const logger = new Logger('FrostDkgCoordinate');
new LogPrinter('FrostDkgCoordinate');

const possibleDescription = process.argv[2];
const possibleThreshold = process.argv[3];
const possibleConfigPath = process.env.FROST_CONFIG_PATH;
const possibleServerUrl = process.env.FROST_SERVER_URL;

const issues: string[] = [];
if (!possibleDescription) issues.push('Missing required first argument: <description> — a human-readable name for this FROST signing group (e.g. "admin group" or "token group"). All participants must use the exact same description.');
if (!possibleThreshold) issues.push('Missing required second argument: <threshold> — the minimum number of signers required to produce a valid signature (e.g. 2 for a 2-of-3 scheme).');
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

// Read all contact public keys from FROST config
const configContent = readFileSync(hostConfigPath, 'utf8');
const contactPubkeys: string[] = [];
const contactPubkeyMatches = configContent.matchAll(/\[contact\.[^\]]+\][\s\S]*?pubkey\s*=\s*"([^"]+)"/g);
for (const match of contactPubkeyMatches) {
    contactPubkeys.push(match[1]);
}

if (contactPubkeys.length === 0) {
    issues.push('No contacts found in FROST config. Import contacts with npm run frost-import first.');
}
if (issues.length) {
    logger.warn('Could not continue due to the following issues:');
    issues.forEach((issue) => logger.error(`  - ${issue}`));
    logger.fatal('Encountered a fatal error and cannot continue.');
    process.exit(1);
}

// Record existing groups before DKG so we can detect the new one after
const existingGroupKeys = new Set<string>();
const existingGroupMatches = configContent.matchAll(/\[group\.([a-f0-9]+)\]/g);
for (const match of existingGroupMatches) {
    existingGroupKeys.add(match[1]);
}

// Send notification to participants
await notifier.notify({
    event: 'JoinDkg',
    description,
    threshold: Number(threshold),
    command: `npm run frost-dkg-participate -- "${description}" ${threshold}`,
});

// Start DKG coordinator session — blocks polling frostd every 2s until all participants contribute
logger.log(`Starting DKG session for "${description}" with threshold ${threshold}...`);
logger.log(`Committee members: ${contactPubkeys.length}`);
logger.log('Waiting for all participants to join. They need to run the command from the notification.');

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
            '-S', contactPubkeys.join(','),
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

// DKG writes the group to the config after all rounds complete — grep the new group key
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
    logger.log(`Group public key (hex): ${newGroupKey}`);
    logger.log('');

    const isAdmin = description.toLowerCase().includes('admin');
    const envVarName = isAdmin ? 'NORI_MINA_TOKEN_BRIDGE_ADDRESS' : 'NORI_MINA_TOKEN_BASE_ADDRESS';
    const envVarLine = `${envVarName}=${newGroupKey}`;

    logger.log('Add this to your .env:');
    logger.log(`  ${envVarLine}`);

    // Notify participants with the group public key and env var they need to add
    await notifier.notify({
        event: 'DkgComplete',
        description,
        groupPublicKey: newGroupKey,
        envVarLine,
    });
} else {
    logger.warn('Could not detect the new group key from the config. Check the FROST config manually.');
}
