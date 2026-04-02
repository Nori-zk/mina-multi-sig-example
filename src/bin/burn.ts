// Load environment variables from .env file
import 'dotenv/config';
// Other imports
import {
  AccountUpdate,
  fetchAccount,
  Mina,
  PrivateKey,
  PublicKey,
  UInt64,
  type NetworkId,
} from 'o1js';
import { NoriTokenBridge } from '../NoriTokenBridge.mock.js';
import { FungibleToken } from '../TokenBase.mock.js';

// Collect all inputs upfront
const possibleNetworkUrl = process.env.MINA_RPC_NETWORK_URL;
const possibleNetwork = process.env.MINA_NETWORK;
const possibleSenderKeyBase58 = process.env.MINA_SENDER_PRIVATE_KEY;
const possibleTokenAddressBase58 = process.env.NORI_MINA_TOKEN_BASE_ADDRESS;
const fee = Number(process.env.MINA_TX_FEE || 0.1) * 1e9;
const possibleAmountStr = process.argv[2];

// Validate everything in one pass
const issues: string[] = [];

if (!possibleNetworkUrl) issues.push('Missing required env: MINA_RPC_NETWORK_URL');
if (!possibleNetwork) issues.push('Missing required env: MINA_NETWORK');
if (!possibleSenderKeyBase58)
  issues.push(
    'Missing required env: MINA_SENDER_PRIVATE_KEY (must be the admin private key — the sender mints to themselves and burns)'
  );
if (!possibleTokenAddressBase58) issues.push('Missing required env: NORI_MINA_TOKEN_BASE_ADDRESS');
if (!possibleAmountStr)
  issues.push(
    'Missing required first argument: amount (in token base units, e.g. 1000000 for 1 nETH at 6 decimals)'
  );

let possibleSenderKey: PrivateKey | undefined;
if (possibleSenderKeyBase58) {
  try {
    possibleSenderKey = PrivateKey.fromBase58(possibleSenderKeyBase58);
  } catch (e) {
    issues.push(`MINA_SENDER_PRIVATE_KEY is not a valid private key: ${(e as Error).message}`);
  }
}

let possibleTokenAddress: PublicKey | undefined;
if (possibleTokenAddressBase58) {
  try {
    possibleTokenAddress = PublicKey.fromBase58(possibleTokenAddressBase58);
  } catch (e) {
    issues.push(
      `NORI_MINA_TOKEN_BASE_ADDRESS '${possibleTokenAddressBase58}' is not a valid public key: ${(e as Error).message}`
    );
  }
}

let possibleAmount: bigint | undefined;
if (possibleAmountStr) {
  try {
    possibleAmount = BigInt(possibleAmountStr);
    if (possibleAmount <= 0n)
      issues.push(`amount must be a positive integer, got: ${possibleAmountStr}`);
  } catch (e) {
    issues.push(`amount '${possibleAmountStr}' is not a valid integer: ${(e as Error).message}`);
  }
}

if (issues.length) {
  const formatted = [
    'Burn encountered issues:',
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
function isPublicKey(val: PublicKey | undefined): val is PublicKey {
  return val !== undefined;
}
function isString(val: string | undefined): val is string {
  return val !== undefined;
}
function isBigInt(val: bigint | undefined): val is bigint {
  return val !== undefined;
}

if (
  !isPrivateKey(possibleSenderKey) ||
  !isPublicKey(possibleTokenAddress) ||
  !isString(possibleNetworkUrl) ||
  !isString(possibleNetwork) ||
  !isBigInt(possibleAmount)
) {
  console.error('Internal error: required values undefined after validation.');
  process.exit(1);
}

const senderKey = possibleSenderKey;
const tokenAddress = possibleTokenAddress;
const networkUrl = possibleNetworkUrl;
const networkId: NetworkId = possibleNetwork === 'mainnet' ? 'mainnet' : 'testnet';
const amount = UInt64.from(possibleAmount);

console.log(`Amount: ${possibleAmount.toString()} base units`);

async function burn() {
  const senderAccount = senderKey.toPublicKey();
  console.log(`Sender address: '${senderAccount.toBase58()}'.`);
  console.log(`FungibleToken address: '${tokenAddress.toBase58()}'.`);

  const Network = Mina.Network({ networkId, mina: networkUrl });
  Mina.setActiveInstance(Network);

  console.log('Compiling NoriTokenBridge (mock admin)...');
  await NoriTokenBridge.compile();
  console.log('Compiling FungibleToken...');
  await FungibleToken.compile();

  const tokenContract = new FungibleToken(tokenAddress);

  // Check if the sender's token account already exists so we know whether to fund it
  const tokenId = tokenContract.deriveTokenId();
  const { account: existingTokenAccount } = await fetchAccount({
    publicKey: senderAccount,
    tokenId,
  });
  const needsFunding = existingTokenAccount === undefined;
  console.log(`Sender token account exists: ${!needsFunding}`);

  // Mint in a single transaction
  console.log(
    `Minting ${possibleAmount.toString()} tokens for '${senderAccount.toBase58()}'...`
  );
  const txnMint = await Mina.transaction({ fee, sender: senderAccount }, async () => {
    if (needsFunding) {
      AccountUpdate.fundNewAccount(senderAccount, 1);
    }
    await tokenContract.mint(senderAccount, amount);
  });

  console.log('Proving transaction...');
  await txnMint.prove();
  console.log('Sending transaction...');
  const pendingMintTx = await txnMint.sign([senderKey]).send();
  console.log('Waiting for mint transaction to be included in a block...');
  await pendingMintTx.wait();

  console.log('Mint successful!');
  console.log(
    `Minted from='${senderAccount.toBase58()}' amount=${possibleAmount.toString()}`
  );

  // Burn in a single transaction — the burn event is what the Rust worker detects
  console.log(
    `Burning ${possibleAmount.toString()} tokens for '${senderAccount.toBase58()}'...`
  );
  const txn = await Mina.transaction({ fee, sender: senderAccount }, async () => {
    await tokenContract.burn(senderAccount, amount);
  });

  console.log('Proving transaction...');
  await txn.prove();
  console.log('Sending transaction...');
  const pendingTx = await txn.sign([senderKey]).send();
  console.log('Waiting for transaction to be included in a block...');
  await pendingTx.wait();

  console.log('Burn successful!');
  console.log(
    `BurnEvent emitted: from='${senderAccount.toBase58()}' amount=${possibleAmount.toString()}`
  );
}

burn().catch((err) => {
  console.error(`Burn encountered an error.\n${String(err)}`);
  process.exit(1);
});
