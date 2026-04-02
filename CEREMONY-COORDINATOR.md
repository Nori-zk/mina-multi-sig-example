# Ceremony Guide: Coordinator

The coordinator is responsible for setting up the ceremony infrastructure, building and proving transactions, coordinating the FROST signing sessions, and submitting transactions to the Mina network. This is a significant responsibility — read this entire guide before starting.

## Prerequisites

- [Node.js](https://nodejs.org/) >= 18.14.0 and npm >= 9 ([installation guide](https://nodejs.org/en/download/))
- [Docker](https://www.docker.com/) installed and running ([installation guide](https://docs.docker.com/get-docker/))
- Access to a server/VPS for hosting the frostd and notification services
- A domain name with DNS control (for hosting the frostd and notification services with TLS)

## Getting started

```bash
git clone <this-repo>
cd mina-multi-sig-example
npm ci
npm run build
cp .env.example.coordinator .env
```

Open `.env` in your editor. You will fill in values progressively as you work through this guide.

---

## Part 1: Setup (one-time)

### 1.1 Create a Telegram group

Create a Telegram group for your signing committee. All committee members should join this group — it will be used for sharing contact strings during initial setup, and later the notification bot will post ceremony instructions here.

Create a Telegram bot via [@BotFather](https://t.me/botfather):
1. Message @BotFather with `/newbot`
2. Choose a name and username
3. Save the **bot token** — you'll need it when deploying the notification service
4. Add the bot to your committee's Telegram group
5. Get the **chat ID** — send a message in the group, then visit `https://api.telegram.org/bot<YOUR_BOT_TOKEN>/getUpdates` and look for the `chat.id` field

### 1.2 Initialize your FROST identity

`FROST_CONFIG_PATH` is already set to `~/.config/frost` in the example `.env` — change it if you want a different location. Then run:

```bash
npm run frost-init -- <your-name>
```

Replace `<your-name>` with your committee member name (e.g. "alice"). This name identifies you to other participants.

**What happens:** The script generates your FROST communication keypair and exports a contact string. It will display the exact command for other members to import your contact.

**What to do next:** Paste the contact string command in the Telegram group chat. Every committee member needs to do this step.

### 1.3 Import other members' contacts

For each other committee member's contact string (posted in the Telegram group chat):

```bash
npm run frost-import -- <their-contact-string>
```

**What happens:** The contact is added to your FROST config. Repeat for every other member.

**What to do next:** Wait until all members have shared and imported each other's contacts before proceeding. For a 3-member committee, you should have 2 contacts imported (everyone except yourself).

### 1.4 Deploy the coordination services

The committee needs two services running:
- **frostd** — the FROST coordination server that relays signing messages between participants
- **Telegram notification service** — posts ceremony instructions to the Telegram group

Both are deployed via Docker Swarm with automatic TLS. See [docker/README.md](docker/README.md) for the full deployment guide.

First, generate the notification service config:

```bash
npm run frost-notification-config
```

This reads all contacts from your FROST config and outputs the environment variables needed by the notification service. Follow the [docker/README.md](docker/README.md) instructions to:
1. Provision domain names
2. Set up the Docker Swarm cluster
3. Configure and deploy the load balancer and services

Once deployed, update your own `.env` with the service URLs:
```
FROST_SERVER_URL=frost.yourdomain.com
NOTIFICATION_SERVICE_URL=https://notify.yourdomain.com
```

Paste these values in the Telegram group chat so all committee members can add them to their `.env` files too.

### 1.5 Distributed Key Generation (DKG)

Your contracts need two FROST signing groups — one for the admin contract (`NoriTokenBridge`) and one for the token contract (`FungibleToken`). Each group has its own public key which becomes the contract address on Mina.

DKG is the process where all committee members jointly generate the group key without anyone knowing the full private key. You need to run DKG twice — once per group.

**Admin group:**

```bash
npm run frost-dkg-coordinate -- "admin group" <threshold>
```

Replace `<threshold>` with the minimum number of signers needed (e.g. `2` for a 2-of-3 scheme).

**What happens:** The script notifies participants via Telegram to join, then starts a DKG session on the frostd server. It will block — polling the server every 2 seconds — until all participants have connected and contributed their key shares. This may take several minutes depending on how quickly participants respond.

**What to do next:** Once DKG completes, the script displays the admin group public key and the exact env var line to add to your `.env`. Add it now:

```
NORI_MINA_TOKEN_BRIDGE_ADDRESS=<the key the script printed>
```

The script also sends this to Telegram so all participants can add it to their `.env` too.

**Token group:**

```bash
npm run frost-dkg-coordinate -- "token group" <threshold>
```

Same process. Once complete, add the token group public key to your `.env`:

```
NORI_MINA_TOKEN_BASE_ADDRESS=<the key the script printed>
```

Again, this is sent to Telegram for all participants.

---

## Part 2: Ceremonies

### Preparing for a ceremony

Before any ceremony, ensure:
1. Your `.env` has `MINA_RPC_NETWORK_URL`, `MINA_NETWORK`, `MINA_SENDER_PRIVATE_KEY`, `NORI_MINA_TOKEN_BRIDGE_ADDRESS`, and `NORI_MINA_TOKEN_BASE_ADDRESS` set
2. `MINA_SENDER_PRIVATE_KEY` is the fee payer account — it must have enough MINA to cover transaction fees and new account creation fees (3 accounts for deploy, 0.1 MINA per account + tx fee)
3. You are checked out to the correct git tag
4. You have run `npm ci && npm run build`

The deploy and updateVk scripts read the contract addresses from `NORI_MINA_TOKEN_BRIDGE_ADDRESS` and `NORI_MINA_TOKEN_BASE_ADDRESS` in your `.env` — these were set during DKG (section 1.5).

If you have modified the contracts, run `npm run bake-vk-hashes` first and commit the updated integrity files. The ceremony scripts will hard fail if the compiled verification key doesn't match the stored integrity hash.

### Deploy ceremony

Deploys both contracts (`NoriTokenBridge` and `FungibleToken`) to the Mina network using the FROST group public keys as contract addresses.

```bash
git pull
git checkout <tag>
npm ci && npm run build
npm run build-deploy-tx -- <tag>
```

**What happens, step by step:**

1. **Pre-flight validation** — the script checks your git checkout matches the tag. Hard fails if they don't match.
2. **Compilation and proving** — compiles both contracts and proves the deploy + initialize transaction. This typically takes 5-15 minutes due to ZK proof generation.
3. **Audit files** — writes the unsigned transaction, metadata, and version info to `ceremony/audit/` with a datetime prefix.
4. **Notification** — sends a message to the Telegram group telling participants to run the verify command. The exact command is included in the notification.
5. **Admin group signing** — starts a FROST coordinator session for the admin group. The script blocks here, polling frostd every 2 seconds, waiting for participants to verify and sign. This may take 10-30 minutes — participants need to clone the code, build it, inspect it, and join. If the script is killed or loses connection during this step, the ceremony must be restarted from the beginning.
6. **Token group signing** — same process for the token group. Blocks again until all participants sign.
7. **Submission** — re-signs the transaction with the fee payer key and submits to the Mina network. Waits for inclusion in a block (typically 3-5 minutes).
8. **History** — records the ceremony in `ceremony/history.jsonl`, commits and pushes.

Once the script completes, the contracts are deployed. The admin contract address is `NORI_MINA_TOKEN_BRIDGE_ADDRESS` and the token contract address is `NORI_MINA_TOKEN_BASE_ADDRESS` from your `.env`.

### UpdateVK ceremony

Migrates the on-chain verification key from one contract version to another. The proof is generated using the currently deployed circuit, and the new verification key data comes from the target version.

```bash
git pull
git checkout <from-tag>
npm ci && npm run build
npm run build-update-vk-tx -- <from-tag> <to-tag>
```

**What happens, step by step:**

1. **Pre-flight validation** — checks your checkout matches `<from-tag>` (hard fail if mismatch) and that `<to-tag>` exists (hard fail if not).
2. **Compilation and integrity check** — compiles from the current checkout (the deployed version) and verifies against stored integrity hashes.
3. **Clone target** — clones `<to-tag>`, builds it, bakes VK hashes, and verifies its integrity. This gets the new verification key data.
4. **Proving** — builds and proves the `updateVerificationKey` transaction using the current circuit with the target VK data. Typically 5-15 minutes.
5. **Audit files** — writes unsigned transaction + metadata to `ceremony/audit/`.
6. **Notification** — sends a Telegram message telling participants to run the verify command.
7. **Admin group signing** — blocks polling frostd until all participants verify and sign. If the script is killed or loses connection, the ceremony must be restarted from the beginning.
8. **Submission** — re-signs with fee payer and submits. Waits for block inclusion (typically 3-5 minutes).
9. **History** — records in `ceremony/history.jsonl`, commits and pushes.
10. **Cleanup** — removes the cloned verification directories.

Once the script completes, the on-chain verification key has been updated.
