// Load environment variables from .env file
import 'dotenv/config';
// Other imports
import {
    AccountUpdate,
    Bool,
    Mina,
    PrivateKey,
    PublicKey,
    type NetworkId,
    UInt8,
} from 'o1js';
import { writeFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, resolve } from 'path';
import { NoriTokenBridge } from '../NoriTokenBridge.mock.js';
import { FungibleToken } from '../TokenBase.mock.js';

const rootDir = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');

// Collect all inputs upfront
const possibleNetworkUrl = process.env.MINA_RPC_NETWORK_URL;
const possibleNetwork = process.env.MINA_NETWORK;
const possibleDeployerKeyBase58 = process.env.MINA_SENDER_PRIVATE_KEY;
const fee = Number(process.env.MINA_TX_FEE || 0.1) * 1e9;
const possibleAdminPublicKeyBase58 = process.argv[2];

// Validate everything in one pass
const issues: string[] = [];

if (!possibleNetworkUrl)
    issues.push('Missing required env: MINA_RPC_NETWORK_URL');
if (!possibleNetwork)
    issues.push('Missing required env: MINA_NETWORK');
if (!possibleDeployerKeyBase58)
    issues.push('Missing required env: MINA_SENDER_PRIVATE_KEY (must be the deployer private key)');
if (process.env.NORI_MOCK_ADMIN_PRIVATE_KEY)
    issues.push(
        'NORI_MOCK_ADMIN_PRIVATE_KEY must not be set for initial deployment — this script generates a random key. Remove it.'
    );
if (process.env.NORI_MOCK_TOKEN_PRIVATE_KEY)
    issues.push(
        'NORI_MOCK_TOKEN_PRIVATE_KEY must not be set for initial deployment — this script generates a random key. Remove it.'
    );

let possibleDeployerKey: PrivateKey | undefined;
if (possibleDeployerKeyBase58) {
    try {
        possibleDeployerKey = PrivateKey.fromBase58(possibleDeployerKeyBase58);
    } catch (e) {
        issues.push(
            `MINA_SENDER_PRIVATE_KEY is not a valid private key: ${(e as Error).message}`
        );
    }
}

let possibleAdminPublicKey: PublicKey | undefined;
if (possibleAdminPublicKeyBase58) {
    try {
        possibleAdminPublicKey = PublicKey.fromBase58(possibleAdminPublicKeyBase58);
    } catch (e) {
        issues.push(
            `adminPublicKey argument '${possibleAdminPublicKeyBase58}' is not a valid public key: ${(e as Error).message}`
        );
    }
}

if (issues.length) {
    const formatted = [
        'Deploy encountered issues:',
        ...issues.flatMap((issue, idx) => {
            const lines = issue.split('\n');
            return lines.map((line, lineIdx) =>
                lineIdx === 0 ? `\t${idx + 1}: ${line}` : `\t   ${line}`
            );
        }),
    ].join('\n');
    console.error(formatted);
    process.exit(1);
}

// Type guards — all required values are guaranteed defined after the issues exit above
function isPrivateKey(val: PrivateKey | undefined): val is PrivateKey {
    return val !== undefined;
}
function isString(val: string | undefined): val is string {
    return val !== undefined;
}

if (
    !isPrivateKey(possibleDeployerKey) ||
    !isString(possibleNetworkUrl) ||
    !isString(possibleNetwork)
) {
    console.error('Internal error: required values undefined after validation.');
    process.exit(1);
}

const deployerKey = possibleDeployerKey;
const networkUrl = possibleNetworkUrl;
const networkId: NetworkId =
    possibleNetwork === 'mainnet' ? 'mainnet' : 'testnet';

// Generate fresh keys for both contracts
const adminPrivateKey = PrivateKey.random();
const adminPrivateKeyBase58 = adminPrivateKey.toBase58();
const tokenPrivateKey = PrivateKey.random();
const tokenPrivateKeyBase58 = tokenPrivateKey.toBase58();

const tokenAllowUpdates = true;

let adminPublicKey: PublicKey;
if (possibleAdminPublicKey !== undefined) {
    console.log(`adminPublicKey provided: '${possibleAdminPublicKeyBase58}'`);
    adminPublicKey = possibleAdminPublicKey;
} else {
    console.log(
        'No adminPublicKey provided as first argument. Defaulting to the public key derived from MINA_SENDER_PRIVATE_KEY.'
    );
    adminPublicKey = deployerKey.toPublicKey();
}

function writeSuccessDetailsToEnvFile(
    adminContractAddressBase58: string,
    tokenAddressBase58: string,
    tokenId: string
) {
    const env = {
        NORI_MOCK_ADMIN_PRIVATE_KEY: adminPrivateKeyBase58,
        NORI_MOCK_ADMIN_ADDRESS: adminContractAddressBase58,
        NORI_MOCK_TOKEN_PRIVATE_KEY: tokenPrivateKeyBase58,
        NORI_MOCK_TOKEN_ADDRESS: tokenAddressBase58,
        NORI_MOCK_ADMIN_PUBLIC_KEY: adminPublicKey.toBase58(),
        NORI_MOCK_TOKEN_ID: tokenId,
        NORI_MOCK_TOKEN_ALLOW_VK_UPDATE: tokenAllowUpdates.toString(),
    };
    const envFileStr =
        Object.entries(env)
            .map(([key, value]) => `${key}=${value}`)
            .join('\n') + '\n';
    const envFileOutputPath = resolve(rootDir, '.env.nori-mock-token');
    console.log(`Writing env file: '${envFileOutputPath}'`);
    writeFileSync(envFileOutputPath, envFileStr, 'utf8');
    console.log(`Wrote '${envFileOutputPath}' successfully.`);
}

async function deploy() {
    const deployerAccount = deployerKey.toPublicKey();
    const adminContractAddress = adminPrivateKey.toPublicKey();
    const tokenAddress = tokenPrivateKey.toPublicKey();
    console.log(`Deployer address: '${deployerAccount.toBase58()}'.`);
    console.log(`NoriTokenBridge (mock admin) address: '${adminContractAddress.toBase58()}'.`);
    console.log(`FungibleToken address: '${tokenAddress.toBase58()}'.`);

    const Network = Mina.Network({ networkId, mina: networkUrl });
    Mina.setActiveInstance(Network);

    console.log('Compiling NoriTokenBridge (mock admin)...');
    await NoriTokenBridge.compile();
    console.log('Compiling FungibleToken...');
    await FungibleToken.compile();

    const adminContract = new NoriTokenBridge(adminContractAddress);
    const tokenContract = new FungibleToken(tokenAddress);

    console.log('Creating deployment transaction...');
    const txn = await Mina.transaction(
        { fee, sender: deployerAccount },
        async () => {
            // 2 new accounts: mock admin contract + token contract
            // 1 more funded separately during initialize for the circulation account
            AccountUpdate.fundNewAccount(deployerAccount, 2);
            await adminContract.deploy({ adminPublicKey });
            await tokenContract.deploy({
                symbol: 'MOCKnE',
                src: 'https://github.com/nori-zk/mock-nori-bridge',
                allowUpdates: tokenAllowUpdates,
            });
        }
    );

    console.log('Proving deployment transaction...');
    await txn.prove();
    const signedDeployTx = txn.sign([deployerKey, adminPrivateKey, tokenPrivateKey]);
    console.log('Sending deployment transaction...');
    const pendingDeployTx = await signedDeployTx.send();
    console.log('Waiting for deployment transaction to be included in a block...');
    await pendingDeployTx.wait();
    console.log('Deployment done.');

    console.log('Creating initialize transaction...');
    const initTxn = await Mina.transaction(
        { fee, sender: deployerAccount },
        async () => {
            // 1 new account: circulation tracking account for the token
            AccountUpdate.fundNewAccount(deployerAccount, 1);
            await tokenContract.initialize(
                adminContractAddress,
                UInt8.from(6),
                Bool(false)
            );
        }
    );

    console.log('Proving initialize transaction...');
    await initTxn.prove();
    const signedInitTx = initTxn.sign([deployerKey, tokenPrivateKey]);
    console.log('Sending initialize transaction...');
    const pendingInitTx = await signedInitTx.send();
    console.log('Waiting for initialize transaction to be included in a block...');
    await pendingInitTx.wait();
    console.log('Initialization done.');

    const tokenId = tokenContract.deriveTokenId().toString();
    console.log(`Token ID: ${tokenId}`);
    console.log('Deployment successful!');
    writeSuccessDetailsToEnvFile(
        adminContractAddress.toBase58(),
        tokenAddress.toBase58(),
        tokenId
    );
}

deploy().catch((err) => {
    console.error(`Deploy encountered an error.\n${String(err)}`);
    process.exit(1);
});
