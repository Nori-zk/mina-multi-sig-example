import 'dotenv/config';
import {
    AccountUpdate,
    Bool,
    Mina,
    PrivateKey,
    PublicKey,
    type NetworkId,
    UInt8,
} from 'o1js';
import { execSync } from 'child_process';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'fs';
import { basename, resolve } from 'path';
import { Logger, LogPrinter } from 'esm-iso-logger';
import { NoriTokenBridge } from '../NoriTokenBridge.mock.js';
import { FungibleToken } from '../TokenBase.mock.js';
import { validateTagForCeremony } from '../preflight.js';
import { readO1jsVersionInfo } from '../versionInfo.js';
import { getAbsolutePath } from '../utils.js';
import { getNotifier } from '../notifications/notifier.js';
import { type DeployOperation } from '../notifications/events.js';
import { runFrostClient, mapMinaNetworkToFrost, frostGuestConfigPath, frostGuestAuditDir } from '../frostDockerClient.js';
import { appendHistoryEntry, getHistoryFilePath } from '../ceremonyHistory.js';
import { rootDir } from '../path.js';

const logger = new Logger('BuildDeployTx');
new LogPrinter('NoriTokenBridge');

// --- Collect and validate inputs ---

const possibleTag = process.argv[2];
const possibleAdminGroupPubKey58 = process.env.NORI_MINA_TOKEN_BRIDGE_ADDRESS;
const possibleTokenGroupPubKey58 = process.env.NORI_MINA_TOKEN_BASE_ADDRESS;
const possibleNetworkUrl = process.env.MINA_RPC_NETWORK_URL;
const possibleNetwork = process.env.MINA_NETWORK;
const possibleSenderKey58 = process.env.MINA_SENDER_PRIVATE_KEY;
const possibleFrostServerUrl = process.env.FROST_SERVER_URL;
const possibleFrostConfigPath = process.env.FROST_CONFIG_PATH;
const fee = Number(process.env.MINA_TX_FEE || 0.1) * 1e9;

const issues: string[] = [];
if (!possibleTag) issues.push('Missing required first argument: <tag>');
if (!possibleAdminGroupPubKey58) issues.push('Missing required env: NORI_MINA_TOKEN_BRIDGE_ADDRESS — the admin contract address (from DKG)');
if (!possibleTokenGroupPubKey58) issues.push('Missing required env: NORI_MINA_TOKEN_BASE_ADDRESS — the token contract address (from DKG)');
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
const senderKey = possibleSenderKey!;
const adminGroupPubKey = possibleAdminGroupPubKey!;
const tokenGroupPubKey = possibleTokenGroupPubKey!;
const networkUrl = possibleNetworkUrl!;
const network = possibleNetwork!;
const networkId: NetworkId = network === 'mainnet' ? 'mainnet' : 'testnet';
const frostServerUrl = possibleFrostServerUrl!;
const frostConfigPath = possibleAbsoluteConfigPath!;

const operation: DeployOperation = {
    kind: 'deploy',
    tag,
    adminGroupPublicKey: adminGroupPubKey.toBase58(),
    tokenGroupPublicKey: tokenGroupPubKey.toBase58(),
};

// --- Pre-flight ---

await validateTagForCeremony(tag, 'Tag', logger);

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

// --- Compile and prove ---

const senderAccount = senderKey.toPublicKey();

logger.log(`Fee payer: ${senderAccount.toBase58()}`);
logger.log(`Admin contract: ${adminGroupPubKey.toBase58()}`);
logger.log(`Token contract: ${tokenGroupPubKey.toBase58()}`);

const Network = Mina.Network({ networkId, mina: networkUrl });
Mina.setActiveInstance(Network);

logger.log('Compiling NoriTokenBridge...');
await NoriTokenBridge.compile();
logger.log('Compiling FungibleToken...');
await FungibleToken.compile();

const adminContract = new NoriTokenBridge(adminGroupPubKey);
const tokenContract = new FungibleToken(tokenGroupPubKey);

logger.log('Building deploy + initialize transaction...');
const txn = await Mina.transaction(
    { fee, sender: senderAccount },
    async () => {
        AccountUpdate.fundNewAccount(senderAccount, 3);
        await adminContract.deploy({ adminPublicKey: adminGroupPubKey });
        await tokenContract.deploy({
            symbol: 'MOCKnE',
            src: 'https://github.com/nori-zk/mock-nori-bridge',
            allowUpdates: true,
        });
        await tokenContract.initialize(adminGroupPubKey, UInt8.from(6), Bool(false));
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

const unsignedPath = resolve(auditDir, `${datetime}-deploy-${tag}-unsigned.json`);
writeFileSync(unsignedPath, txn.toJSON(), 'utf8');
logger.log(`Unsigned tx: ${unsignedPath}`);

const o1jsVersionInfo = readO1jsVersionInfo(resolve(rootDir, '..'));

const integrityDir = resolve(rootDir, '..', 'src', 'integrity');
const vkHashes = ['NoriTokenBridge', 'FungibleToken'].map((name) => ({
    name,
    vkHash: JSON.parse(readFileSync(resolve(integrityDir, `${name}.VkHash.json`), 'utf8')) as string,
}));

const metaPath = resolve(auditDir, `${datetime}-deploy-${tag}.meta.json`);
writeFileSync(metaPath, JSON.stringify({ operation, tag, vkHashes, o1jsVersionInfo }, null, 2), 'utf8');
logger.log(`Metadata: ${metaPath}`);

// --- Notify participants ---

await getNotifier().notify({
    event: 'VerifyAndSign',
    operation,
    txJsonPath: unsignedPath,
    tags: [{ tag, o1jsVersionInfo, contracts: vkHashes }],
    signingGroups: [
        { groupName: 'admin', groupPublicKey: adminGroupPubKey.toBase58() },
        { groupName: 'token', groupPublicKey: tokenGroupPubKey.toBase58() },
    ],
    command: `npm run verify-deploy-tx -- ${tag}`,
});

// --- FROST signing: admin group ---

const unsignedFilename = basename(unsignedPath);
const adminSignedFilename = `${datetime}-deploy-${tag}-admin-signed.json`;
const signedFilename = `${datetime}-deploy-${tag}-signed.json`;
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
            '-o', `${frostGuestAuditDir}/${adminSignedFilename}`,
            '-n', frostNetwork,
        ],
    });
} catch (e) {
    logger.error(`${(e as Error).message}`);
    logger.fatal('Encountered a fatal error and cannot continue.');
    process.exit(1);
}

// --- FROST signing: token group ---

logger.log('Starting FROST coordinator session for token group...');
logger.log('Waiting for all participants to join. This will block until signing completes.');
try {
    await runFrostClient({
        frostConfigHostPath: frostConfigPath,
        auditHostPath: auditDir,
        args: [
            'coordinator',
            '-c', frostGuestConfigPath(frostConfigPath),
            '-s', frostServerUrl,
            '-g', tokenGroupPubKey.toBase58(),
            '-S', signerPubkeys.join(','),
            '-m', `${frostGuestAuditDir}/${adminSignedFilename}`,
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
    vkHashes,
    o1jsVersionInfo,
});

logger.log(`History recorded in ${getHistoryFilePath()}`);

// --- Commit and push history ---

try {
    execSync('git add ceremony/history.jsonl && git commit -m "ceremony: deploy at ' + tag + '" && git push', {
        stdio: 'inherit',
    });
} catch (e) {
    logger.warn(`Failed to commit/push history: ${(e as Error).message}`);
}

logger.log('Deploy ceremony complete.');
