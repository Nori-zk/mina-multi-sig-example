# Ceremony Guide: Participant (Committee Multisig Signer)

As a participant, you independently verify the code being deployed or migrated, then co-sign the transaction via FROST threshold signatures. You never hold the full private key — only your key share from DKG.

## Prerequisites

- [Node.js](https://nodejs.org/) >= 18.14.0 and npm >= 9 ([installation guide](https://nodejs.org/en/download/))
- [Docker](https://www.docker.com/) installed and running ([installation guide](https://docs.docker.com/get-docker/))

## Getting started

```bash
git clone <this-repo>
cd mina-multi-sig-example
npm ci
npm run build
cp .env.example.participant .env
```

Open `.env` in your editor. You will fill in values progressively as you work through this guide.

---

## Part 1: Setup (one-time)

### 1.1 Initialize your FROST identity

`FROST_CONFIG_PATH` is already set to `~/.config/frost/config` in the example `.env` — this is the path to the FROST config file. Change it if you want a different location. Then run:

```bash
npm run frost-init -- <your-name>
```

Replace `<your-name>` with your committee member name (e.g. "bob"). This name identifies you to other participants.

**What happens:** The script generates your FROST communication keypair and exports a contact string. It will display the exact command for other members to import your contact.

**What to do next:** Paste the contact string command in the Telegram group chat. Every committee member needs to do this step.

### 1.2 Import other members' contacts

For each other committee member's contact string (posted in the Telegram group chat):

```bash
npm run frost-import -- <their-contact-string>
```

**What happens:** The contact is added to your FROST config. Repeat for every other member.

**What to do next:** Wait until all members have shared and imported each other's contacts. For a 3-member committee, you should have 2 contacts imported (everyone except yourself). The coordinator will deploy the services next.

### 1.3 Configure service URLs

Once the coordinator has deployed the frostd and notification services, they will paste the service URLs in the Telegram group chat. Add them to your `.env`:

```
FROST_SERVER_URL=frost.yourdomain.com
NOTIFICATION_SERVICE_URL=https://notify.yourdomain.com
```

### 1.4 Distributed Key Generation (DKG)

The coordinator will run DKG twice — once for the admin group and once for the token group. You will receive a notification in the Telegram group with the exact command to run for each.

**Admin group** — when the coordinator sends the `JoinDkg` notification:

```bash
npm run frost-dkg-participate -- "admin group" <threshold>
```

**What happens:** The script connects to the frostd server and participates in the DKG protocol. It will block — polling the server every 2 seconds — until the coordinator and all other participants have contributed. This may take several minutes.

**What to do next:** Once DKG completes, the script displays your group public key. Verify it matches what the coordinator reports. The coordinator will also send the env var line to Telegram. Add it to your `.env`:

```
NORI_MINA_TOKEN_BRIDGE_ADDRESS=<the key from the notification>
```

If your group public key doesn't match the coordinator's, something went wrong — contact the coordinator.

**Token group** — when the coordinator sends the next notification:

```bash
npm run frost-dkg-participate -- "token group" <threshold>
```

Same process. Verify the group public key matches, then add it to your `.env`:

```
NORI_MINA_TOKEN_BASE_ADDRESS=<the key from the notification>
```

---

## Part 2: Ceremonies

When the coordinator starts a ceremony, you will receive a notification in the Telegram group. The notification tells you:
- What type of ceremony it is (deploy or updateVk)
- The tag(s) involved
- The o1js version info and VK hashes the coordinator built with
- The exact command to copy-paste and run

You do not need to figure out which command to run — the notification contains it.

Before running any ceremony command, ensure your `.env` has `NORI_MINA_TOKEN_BRIDGE_ADDRESS` and `NORI_MINA_TOKEN_BASE_ADDRESS` set — these were added during DKG (section 1.4). The verify scripts read the contract addresses from these env vars.

### Deploy ceremony

The notification will contain a command like:
```
npm run verify-deploy-tx -- <tag>
```

Before running it, pull and check out the tag. You must be on the same code as the coordinator — the script hard fails if your checkout doesn't match the tag:

```bash
git pull
git checkout <tag>
npm ci && npm run build
```

Then run the command from the notification.

**What happens, step by step:**

1. **Pre-flight validation** — checks your git checkout matches the tag. Hard fails if they don't match.
2. **Clone and build** — clones the tag fresh into `ceremony/verify/<tag>/`, installs dependencies, and bakes VK hashes. This typically takes 5-15 minutes.
3. **Integrity check** — verifies the baked VK hashes match what's committed at the tag. Hard fails if they don't match — this means the committed integrity files are stale or wrong.
4. **Version and VK display** — shows you the o1js version info (dependency spec, locked resolution, integrity hash, installed version) and VK hashes for each contract. Compare these against the values in the notification from the coordinator. If anything doesn't match, abort and investigate.
5. **Code inspection prompt** — asks you to confirm you've reviewed the code at `ceremony/verify/<tag>/`. Take your time — browse the contract source, check what changed, verify the logic is what you expect. Type `y` when satisfied.
6. **Admin group signing** — joins the FROST signing session for the admin group. The script blocks here, polling frostd every 2 seconds, until the coordinator's session is ready and signing completes. This may take 10-30 minutes depending on other participants. You must stay online — if you disconnect, the entire ceremony fails and the coordinator must restart it.
7. **Token group signing** — after the admin group signing finishes, the script automatically joins the token group signing session. Blocks again until complete. You do not need to run a separate command — both signing sessions happen sequentially within this single script.
8. **Cleanup** — removes the cloned verification directories.

### UpdateVK ceremony

The notification will contain a command like:
```
npm run verify-update-vk-tx -- <from-tag> <to-tag>
```

Before running it, pull and check out the from-tag. You must be on the currently deployed version — the script hard fails if your checkout doesn't match:

```bash
git pull
git checkout <from-tag>
npm ci && npm run build
```

Then run the command from the notification.

**What happens, step by step:**

1. **Pre-flight validation** — checks your checkout matches `<from-tag>` (hard fail) and `<to-tag>` exists (hard fail).
2. **Clone and build both tags** — clones both the from-tag and to-tag fresh, builds both, bakes VK hashes for both. This typically takes 5-15 minutes per tag.
3. **Integrity check** — verifies integrity for both tags. Hard fails if either doesn't match.
4. **Version and VK display** — shows o1js version info and VK hashes for both tags. Compare against the notification values.
5. **Code inspection prompt** — asks you to confirm you've reviewed both codebases. The from-tag is the currently deployed version, the to-tag is what's being migrated to. Verify both.
6. **Admin group signing** — joins the FROST signing session. Blocks until signing completes. You must stay online — if you disconnect, the entire ceremony fails and the coordinator must restart it.
7. **Cleanup** — removes the cloned verification directories.

### What you're verifying

Every time you run a verify script, you're confirming:

- **Code integrity** — the VK hashes baked from the cloned code match what's committed at the tag. If someone tampered with the committed integrity files, this check fails.
- **Code intent** — by inspecting the contract source at `ceremony/verify/<tag>/`, you confirm the logic is what you agreed to.
- **o1js version** — all four values (dependency spec, locked resolution, locked integrity, installed version) should match what the coordinator reported in the notification. Any mismatch means different builds.

If any value doesn't match, do not proceed — type `n` at the prompt and investigate with the coordinator.
