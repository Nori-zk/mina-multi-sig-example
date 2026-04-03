import 'dotenv/config';
import { PublicKey } from 'o1js';
import { Logger, LogPrinter } from 'esm-iso-logger';
import { validateTagForCeremony, askYesNo } from '../preflight.js';
import { formatO1jsVersionInfo } from '../versionInfo.js';
import { verifyTag, cleanupAllVerifyDirs } from '../verifyTag.js';
import { runFrostClient, frostGuestConfigPath } from '../frostDockerClient.js';
import { existsSync } from 'fs';
import { getAbsolutePath } from '../utils.js';

const logger = new Logger('VerifyUpdateVkTx');
new LogPrinter('VerifyUpdateVkTx');

// --- Collect and validate inputs ---

const possibleFromTag = process.argv[2];
const possibleToTag = process.argv[3];
const possibleAdminGroupPubKey58 = process.env.NORI_MINA_TOKEN_BRIDGE_ADDRESS;
const possibleFrostServerUrl = process.env.FROST_SERVER_URL;
const possibleFrostConfigPath = process.env.FROST_CONFIG_PATH;

const issues: string[] = [];
if (!possibleFromTag) issues.push('Missing required first argument: <from-tag> — the currently deployed version (git tag)');
if (!possibleToTag) issues.push('Missing required second argument: <to-tag> — the target version to migrate to (git tag)');
if (!possibleAdminGroupPubKey58) issues.push('Missing required env: NORI_MINA_TOKEN_BRIDGE_ADDRESS — the admin contract address (from DKG)');
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

if (issues.length) {
    logger.warn('Could not continue due to the following issues:');
    issues.forEach((issue) => logger.error(`  - ${issue}`));
    logger.fatal('Encountered a fatal error and cannot continue.');
    process.exit(1);
}

const fromTag = possibleFromTag!;
const toTag = possibleToTag!;
const adminGroupPubKey = possibleAdminGroupPubKey!;
const frostServerUrl = possibleFrostServerUrl!;
const frostConfigPath = possibleAbsoluteConfigPath!;

// --- Pre-flight ---

await validateTagForCeremony(fromTag, 'From-tag', logger, { checkCheckoutMatch: true });
await validateTagForCeremony(toTag, 'To-tag', logger, { checkCheckoutMatch: false });

// --- Verify both tags ---

logger.log(`\nVerifying FROM tag: '${fromTag}'...`);
const fromVerification = verifyTag(fromTag, logger);

logger.log(`\nVerifying TO tag: '${toTag}'...`);
const toVerification = verifyTag(toTag, logger);

// --- Display version info + VK hashes ---

logger.log('');
logger.log(`=== FROM: ${fromTag} ===`);
logger.log(formatO1jsVersionInfo(fromVerification.o1jsVersionInfo));
for (const contract of fromVerification.contracts) {
    logger.log(`  ${contract.name} VK hash: ${contract.vkHash}`);
}

logger.log('');
logger.log(`=== TO: ${toTag} ===`);
logger.log(formatO1jsVersionInfo(toVerification.o1jsVersionInfo));
for (const contract of toVerification.contracts) {
    logger.log(`  ${contract.name} VK hash: ${contract.vkHash}`);
}
logger.log('');

// --- Prompt for inspection ---

if (!await askYesNo(`Code is at '${fromVerification.verifyDir}' and '${toVerification.verifyDir}'. Have you reviewed both codebases and are satisfied?`)) {
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

// --- Cleanup ---

cleanupAllVerifyDirs();

logger.log('Verification and signing complete.');
