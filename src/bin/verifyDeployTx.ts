import 'dotenv/config';
import { PublicKey } from 'o1js';
import { Logger, LogPrinter } from 'esm-iso-logger';
import { validateTagForCeremony, askYesNo } from '../preflight.js';
import { formatO1jsVersionInfo } from '../versionInfo.js';
import { verifyTag, cleanupAllVerifyDirs } from '../verifyTag.js';
import { runFrostClient, frostGuestConfigPath } from '../frostDockerClient.js';
import { existsSync, readFileSync } from 'fs';
import { getAbsolutePath, resolveHexGroupKey } from '../utils.js';

const logger = new Logger('VerifyDeployTx');
new LogPrinter('VerifyDeployTx');

// --- Collect and validate inputs ---

const possibleTag = process.argv[2];
const possibleAdminGroupPubKey58 = process.env.NORI_MINA_TOKEN_BRIDGE_ADDRESS;
const possibleTokenGroupPubKey58 = process.env.NORI_MINA_TOKEN_BASE_ADDRESS;
const possibleFrostServerUrl = process.env.FROST_SERVER_URL;
const possibleFrostConfigPath = process.env.FROST_CONFIG_PATH;

const issues: string[] = [];
if (!possibleTag) issues.push('Missing required first argument: <tag> — the git tag to verify');
if (!possibleAdminGroupPubKey58) issues.push('Missing required env: NORI_MINA_TOKEN_BRIDGE_ADDRESS — the admin contract address (from DKG)');
if (!possibleTokenGroupPubKey58) issues.push('Missing required env: NORI_MINA_TOKEN_BASE_ADDRESS — the token contract address (from DKG)');
if (!possibleFrostServerUrl) issues.push('Missing required env: FROST_SERVER_URL — the URL of the frostd coordination server');
if (!possibleFrostConfigPath) issues.push('Missing required env: FROST_CONFIG_PATH — path to your FROST config file (e.g. ~/.config/frost/config)');

const possibleAbsoluteConfigPath = possibleFrostConfigPath ? getAbsolutePath(possibleFrostConfigPath) : undefined;

if (possibleAbsoluteConfigPath && !existsSync(possibleAbsoluteConfigPath)) {
    issues.push(`FROST config file does not exist: ${possibleAbsoluteConfigPath}. Run npm run frost-init first.`);
}

let possibleAdminGroupPubKey: PublicKey | undefined;
if (possibleAdminGroupPubKey58) {
    try { possibleAdminGroupPubKey = PublicKey.fromBase58(possibleAdminGroupPubKey58); }
    catch (e) { issues.push(`NORI_MINA_TOKEN_BRIDGE_ADDRESS invalid: ${(e as Error).message}`); }
}
let possibleTokenGroupPubKey: PublicKey | undefined;
if (possibleTokenGroupPubKey58) {
    try { possibleTokenGroupPubKey = PublicKey.fromBase58(possibleTokenGroupPubKey58); }
    catch (e) { issues.push(`NORI_MINA_TOKEN_BASE_ADDRESS invalid: ${(e as Error).message}`); }
}

if (issues.length) {
    logger.warn('Could not continue due to the following issues:');
    issues.forEach((issue) => logger.error(`  - ${issue}`));
    logger.fatal('Encountered a fatal error and cannot continue.');
    process.exit(1);
}

const tag = possibleTag!;
const adminGroupPubKey = possibleAdminGroupPubKey!;
const tokenGroupPubKey = possibleTokenGroupPubKey!;
const frostServerUrl = possibleFrostServerUrl!;
const frostConfigPath = possibleAbsoluteConfigPath!;

// --- Resolve hex group keys for FROST client ---

const frostContent = readFileSync(frostConfigPath, 'utf8');

let adminHexGroupKey: string | undefined;
try { adminHexGroupKey = resolveHexGroupKey(frostContent, adminGroupPubKey.toBase58()); }
catch (e) { issues.push(`NORI_MINA_TOKEN_BRIDGE_ADDRESS: ${(e as Error).message}`); }

let tokenHexGroupKey: string | undefined;
try { tokenHexGroupKey = resolveHexGroupKey(frostContent, tokenGroupPubKey.toBase58()); }
catch (e) { issues.push(`NORI_MINA_TOKEN_BASE_ADDRESS: ${(e as Error).message}`); }

if (issues.length) {
    logger.warn('Could not continue due to the following issues:');
    issues.forEach((issue) => logger.error(`  - ${issue}`));
    logger.fatal('Encountered a fatal error and cannot continue.');
    process.exit(1);
}

// --- Pre-flight ---

await validateTagForCeremony(tag, 'Tag', logger);

// --- Verify tag ---

const verification = verifyTag(tag, logger);

// --- Display version info + VK hashes ---

logger.log('');
logger.log(`=== ${tag} ===`);
logger.log(formatO1jsVersionInfo(verification.o1jsVersionInfo));
for (const contract of verification.contracts) {
    logger.log(`${contract.name} VK hash: ${contract.vkHash}`);
}
logger.log('');

// --- Prompt for inspection ---

if (!await askYesNo(`Code is at '${verification.verifyDir}'. Have you reviewed the code and are satisfied?`)) {
    logger.log('Aborted by user.');
    process.exit(0);
}

// --- Join FROST signing: admin group ---

logger.log('Joining admin group FROST signing session...');
logger.log('This will block until the coordinator starts the session and signing completes.');
try {
    await runFrostClient({
        frostConfigHostPath: frostConfigPath,
        args: [
            'participant',
            '-c', frostGuestConfigPath(frostConfigPath),
            '-s', frostServerUrl,
            '-g', adminHexGroupKey!,
            '-y',
        ],
    });
} catch (e) {
    logger.error(`${(e as Error).message}`);
    logger.fatal('Encountered a fatal error and cannot continue.');
    process.exit(1);
}

// --- Join FROST signing: token group ---
// Race condition: the coordinator must finish the first signing session and create the
// second before participants can join. If the participant completes the first session
// faster than the coordinator can start the second, frostd returns SessionNotFound.
// Retry with a delay to give the coordinator time to create the session.

logger.log('Joining token group FROST signing session...');
logger.log('This will block until the coordinator starts the session and signing completes.');

const maxAttempts = 5;
const retryDelaySecs = 10;

for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
        await runFrostClient({
            frostConfigHostPath: frostConfigPath,
            args: [
                'participant',
                '-c', frostGuestConfigPath(frostConfigPath),
                '-s', frostServerUrl,
                '-g', tokenHexGroupKey!,
                '-y',
            ],
        });
        break;
    } catch (e) {
        const msg = (e as Error).message;
        if (msg.includes('SessionNotFound') && attempt < maxAttempts) {
            logger.warn(`Token group session not available yet — waiting for coordinator to start it (${attempt}/${maxAttempts})...`);
            await new Promise((r) => setTimeout(r, retryDelaySecs * 1000));
        } else if (msg.includes('SessionNotFound')) {
            logger.error(`Token group session was not created after ${maxAttempts} attempts. The first signing session likely failed on the coordinator side — verify the ceremony is still running.`);
            logger.fatal('Encountered a fatal error and cannot continue.');
            process.exit(1);
        } else {
            logger.error(`Failed to participate in the token group signing session. This may be a connection issue with the FROST server or a problem with your FROST configuration.`);
            logger.error(msg);
            logger.fatal('Encountered a fatal error and cannot continue.');
            process.exit(1);
        }
    }
}

// --- Cleanup ---

cleanupAllVerifyDirs();

logger.log('Verification and signing complete.');
