import 'dotenv/config';
import { Mina, PrivateKey, PublicKey, Bool, type NetworkId } from 'o1js';
import { execSync } from 'child_process';
import { basename, join, resolve } from 'path';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'fs';
import { Logger, LogPrinter } from 'esm-iso-logger';
import { NoriTokenBridge } from '../NoriTokenBridge.mock.js';
import { FungibleToken } from '../TokenBase.mock.js';
import { validateTagForCeremony } from '../preflight.js';
import { readO1jsVersionInfo } from '../versionInfo.js';
import { vkSafeToVk, getAbsolutePath } from '../utils.js';
import { verifyTag, cleanupAllVerifyDirs } from '../verifyTag.js';
import { getNotifier } from '../notifications/notifier.js';
import { type UpdateVkOperation } from '../notifications/events.js';
import { runFrostClient, mapMinaNetworkToFrost, frostGuestConfigPath, frostGuestAuditDir } from '../frostDockerClient.js';
import { appendHistoryEntry, getHistoryFilePath } from '../ceremonyHistory.js';
import { rootDir } from '../path.js';

import { noriTokenBridgeVkHash } from '../integrity/NoriTokenBridge.VkHash.js';
import { fungibleTokenVkHash } from '../integrity/FungibleToken.VkHash.js';
import {
    compileAndVerifyContracts,
    type VerificationKeySafe,
} from '@nori-zk/o1js-zk-utils';

const logger = new Logger('BuildUpdateVkTx');
new LogPrinter('NoriTokenBridge');

// --- Collect and validate inputs ---

const possibleFromTag = process.argv[2];
const possibleToTag = process.argv[3];
const possibleAdminGroupPubKey58 = process.env.NORI_MINA_TOKEN_BRIDGE_ADDRESS;
const possibleNetworkUrl = process.env.MINA_RPC_NETWORK_URL;
const possibleNetwork = process.env.MINA_NETWORK;
const possibleSenderKey58 = process.env.MINA_SENDER_PRIVATE_KEY;
const possibleFrostServerUrl = process.env.FROST_SERVER_URL;
const possibleFrostConfigPath = process.env.FROST_CONFIG_PATH;
const fee = Number(process.env.MINA_TX_FEE || 0.1) * 1e9;

const issues: string[] = [];
if (!possibleFromTag) issues.push('Missing required first argument: <from-tag>');
if (!possibleToTag) issues.push('Missing required second argument: <to-tag>');
if (!possibleAdminGroupPubKey58) issues.push('Missing required env: NORI_MINA_TOKEN_BRIDGE_ADDRESS — the admin contract address (from DKG)');
if (!possibleNetworkUrl) issues.push('Missing required env: MINA_RPC_NETWORK_URL');
if (!possibleNetwork) issues.push('Missing required env: MINA_NETWORK');
if (!possibleSenderKey58) issues.push('Missing required env: MINA_SENDER_PRIVATE_KEY');
if (!possibleFrostServerUrl) issues.push('Missing required env: FROST_SERVER_URL');
if (!possibleFrostConfigPath) issues.push('Missing required env: FROST_CONFIG_PATH — path to your FROST config file (e.g. ~/.config/frost/config)');

const possibleAbsoluteConfigPath = possibleFrostConfigPath ? getAbsolutePath(possibleFrostConfigPath) : undefined;

if (possibleAbsoluteConfigPath && !existsSync(possibleAbsoluteConfigPath)) {
    issues.push(`FROST config file does not exist: ${possibleAbsoluteConfigPath}. Run npm run frost-init first.`);
}

let possibleSenderKey: PrivateKey | undefined;
if (possibleSenderKey58) {
    try { possibleSenderKey = PrivateKey.fromBase58(possibleSenderKey58); }
    catch (e) { issues.push(`MINA_SENDER_PRIVATE_KEY invalid: ${(e as Error).message}`); }
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
const senderKey = possibleSenderKey!;
const adminGroupPubKey = possibleAdminGroupPubKey!;
const networkUrl = possibleNetworkUrl!;
const network = possibleNetwork!;
const networkId: NetworkId = network === 'mainnet' ? 'mainnet' : 'testnet';
const frostServerUrl = possibleFrostServerUrl!;
const frostConfigPath = possibleAbsoluteConfigPath!;

const operation: UpdateVkOperation = {
    kind: 'updateVk',
    fromTag,
    toTag,
    adminGroupPublicKey: adminGroupPubKey.toBase58(),
};

// --- Pre-flight ---

await validateTagForCeremony(fromTag, 'From-tag', logger, { checkCheckoutMatch: true });
await validateTagForCeremony(toTag, 'To-tag', logger, { checkCheckoutMatch: false });

// --- Read signer pubkeys from FROST config ---

const frostContent = readFileSync(frostConfigPath, 'utf8');
const signerPubkeys: string[] = [];
const signerMatches = frostContent.matchAll(/\[contact\.[^\]]+\][\s\S]*?pubkey\s*=\s*"([^"]+)"/g);
for (const match of signerMatches) {
    signerPubkeys.push(match[1]);
}
if (signerPubkeys.length === 0) {
    issues.push('No contacts in FROST config. Import contacts with npm run frost-import first.');
}
if (issues.length) {
    logger.warn('Could not continue due to the following issues:');
    issues.forEach((issue) => logger.error(`  - ${issue}`));
    logger.fatal('Encountered a fatal error and cannot continue.');
    process.exit(1);
}

// --- Connect to Mina network ---

const Network = Mina.Network({ networkId, mina: networkUrl });
Mina.setActiveInstance(Network);

// --- Compile from current checkout, verify integrity ---

logger.log('Compiling contracts and verifying integrity...');
await compileAndVerifyContracts(logger, [
    { name: 'FungibleToken', program: FungibleToken, integrityHash: fungibleTokenVkHash },
    { name: 'NoriTokenBridge', program: NoriTokenBridge, integrityHash: noriTokenBridgeVkHash },
]);

// --- Clone to-tag to get target VK data ---

const toVerification = verifyTag(toTag, logger);

// --- Read new VK data ---

const toIntegrityDir = join(toVerification.verifyDir, 'src', 'integrity');
const newVkDataStr = JSON.parse(readFileSync(join(toIntegrityDir, 'NoriTokenBridge.VkData.json'), 'utf8')) as string;
const newVkHashStr = JSON.parse(readFileSync(join(toIntegrityDir, 'NoriTokenBridge.VkHash.json'), 'utf8')) as string;
const newVkSafe: VerificationKeySafe = { data: newVkDataStr, hashStr: newVkHashStr };
const newVerificationKey = vkSafeToVk(newVkSafe);

logger.log(`New VK hash: ${newVkHashStr}`);

// --- Build and prove ---

const senderAccount = senderKey.toPublicKey();
const tokenBridge = new NoriTokenBridge(adminGroupPubKey);

logger.log('Building updateVk transaction...');
const txn = await Mina.transaction(
    { fee, sender: senderAccount },
    async () => {
        await tokenBridge.updateVerificationKey(newVerificationKey);
    }
);

logger.log('Proving transaction...');
await txn.prove();

// UpdateFullCommitment — FROST skips partial commitments
txn.transaction.accountUpdates.forEach((au) => {
    au.body.useFullCommitment = Bool(true);
});

// --- Output files ---

const datetime = new Date().toISOString().replace(/[-:]/g, '').replace(/\.\d+Z$/, 'Z');
const auditDir = resolve(rootDir, '..', 'ceremony', 'audit');
mkdirSync(auditDir, { recursive: true });

const unsignedPath = resolve(auditDir, `${datetime}-updateVk-${fromTag}-to-${toTag}-unsigned.json`);
writeFileSync(unsignedPath, txn.toJSON(), 'utf8');
logger.log(`Unsigned tx: ${unsignedPath}`);

const fromO1jsVersionInfo = readO1jsVersionInfo(resolve(rootDir, '..'));
const toO1jsVersionInfo = readO1jsVersionInfo(toVerification.verifyDir);

const fromIntegrityDir = resolve(rootDir, '..', 'src', 'integrity');
const fromVkHashes = ['NoriTokenBridge', 'FungibleToken'].map((name) => ({
    name,
    vkHash: JSON.parse(readFileSync(resolve(fromIntegrityDir, `${name}.VkHash.json`), 'utf8')) as string,
}));
const toVkHashes = toVerification.contracts;

const metaPath = resolve(auditDir, `${datetime}-updateVk-${fromTag}-to-${toTag}.meta.json`);
writeFileSync(metaPath, JSON.stringify({
    operation, fromVkHashes, toVkHashes, fromO1jsVersionInfo, toO1jsVersionInfo,
}, null, 2), 'utf8');
logger.log(`Metadata: ${metaPath}`);

// --- Notify participants ---

await getNotifier().notify({
    event: 'VerifyAndSign',
    operation,
    txJsonPath: unsignedPath,
    tags: [
        { tag: fromTag, o1jsVersionInfo: fromO1jsVersionInfo, contracts: fromVkHashes },
        { tag: toTag, o1jsVersionInfo: toO1jsVersionInfo, contracts: toVkHashes },
    ],
    signingGroups: [
        { groupName: 'admin', groupPublicKey: adminGroupPubKey.toBase58() },
    ],
    command: `npm run verify-update-vk-tx -- ${fromTag} ${toTag}`,
});

// --- FROST signing: admin group ---

const unsignedFilename = basename(unsignedPath);
const signedFilename = `${datetime}-updateVk-${fromTag}-to-${toTag}-signed.json`;
const signedPath = resolve(auditDir, signedFilename);
const frostNetwork = mapMinaNetworkToFrost(network);

logger.log('Starting FROST coordinator session for admin group...');
logger.log('Waiting for all participants to verify and join. This will block until signing completes.');
try {
    await runFrostClient({
        frostConfigHostPath: frostConfigPath,
        auditHostPath: auditDir,
        args: [
            'coordinator',
            '-c', frostGuestConfigPath(frostConfigPath),
            '-s', frostServerUrl,
            '-g', adminGroupPubKey.toBase58(),
            '-S', signerPubkeys.join(','),
            '-m', `${frostGuestAuditDir}/${unsignedFilename}`,
            '-o', `${frostGuestAuditDir}/${signedFilename}`,
            '-n', frostNetwork,
        ],
    });
} catch (e) {
    logger.error(`${(e as Error).message}`);
    logger.fatal('Encountered a fatal error and cannot continue.');
    process.exit(1);
}

// --- Signing complete ---

await getNotifier().notify({ event: 'SigningComplete', operation });

// --- Re-sign with fee payer and submit ---

logger.log('Re-signing with fee payer and submitting...');
const signedTxJson = readFileSync(signedPath, 'utf8');
const signedTx = Mina.Transaction.fromJSON(signedTxJson);
const reSignedTx = signedTx.sign([senderKey]);
const pendingTx = await reSignedTx.send();

await getNotifier().notify({ event: 'TransactionSubmitted', operation, txHash: pendingTx.hash });

logger.log('Waiting for inclusion in a block...');
await pendingTx.wait();

await getNotifier().notify({ event: 'TransactionConfirmed', operation, txHash: pendingTx.hash });

// --- Record history ---

appendHistoryEntry({
    operation,
    timestamp: new Date().toISOString(),
    txHash: pendingTx.hash,
    fromVkHashes,
    toVkHashes,
    fromO1jsVersionInfo,
    toO1jsVersionInfo,
});

logger.log(`History recorded in ${getHistoryFilePath()}`);

try {
    execSync(`git add ceremony/history.jsonl && git commit -m "ceremony: updateVk ${fromTag} to ${toTag}" && git push`, {
        stdio: 'inherit',
    });
} catch (e) {
    logger.warn(`Failed to commit/push history: ${(e as Error).message}`);
}

// --- Cleanup ---

cleanupAllVerifyDirs();

logger.log('UpdateVK ceremony complete.');
