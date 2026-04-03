import 'dotenv/config';
import { PublicKey } from 'o1js';
import { Logger, LogPrinter } from 'esm-iso-logger';
import { validateTagForCeremony, askYesNo } from '../preflight.js';
import { formatO1jsVersionInfo } from '../versionInfo.js';
import { verifyTag, cleanupAllVerifyDirs } from '../verifyTag.js';
import { runFrostClient, frostGuestConfigPath } from '../frostDockerClient.js';
import { existsSync } from 'fs';
import { getAbsolutePath } from '../utils.js';

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
    runFrostClient({
        frostConfigHostPath: frostConfigPath,
        args: [
            'participant',
            '-c', frostGuestConfigPath(frostConfigPath),
            '-s', frostServerUrl,
            '-g', adminGroupPubKey.toBase58(),
            '-y',
        ],
    });
} catch (e) {
    logger.error(`${(e as Error).message}`);
    logger.fatal('Encountered a fatal error and cannot continue.');
    process.exit(1);
}

// --- Join FROST signing: token group ---

logger.log('Joining token group FROST signing session...');
logger.log('This will block until the coordinator starts the session and signing completes.');
try {
    runFrostClient({
        frostConfigHostPath: frostConfigPath,
        args: [
            'participant',
            '-c', frostGuestConfigPath(frostConfigPath),
            '-s', frostServerUrl,
            '-g', tokenGroupPubKey.toBase58(),
            '-y',
        ],
    });
} catch (e) {
    logger.error(`${(e as Error).message}`);
    logger.fatal('Encountered a fatal error and cannot continue.');
    process.exit(1);
}

// --- Cleanup ---

cleanupAllVerifyDirs();

logger.log('Verification and signing complete.');
