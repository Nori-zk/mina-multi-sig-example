# mina-multi-sig-example

FROST multi-signature ceremony tooling for deploying and managing Mina smart contracts. Uses mock contracts (`NoriTokenBridge` and `FungibleToken`) as deployment targets to exercise the full ceremony workflow — DKG, independent code verification, threshold signing, and transaction submission.

Built on [mina-multi-sig](https://github.com/Nori-zk/mina-multi-sig) for the FROST client and coordination server.

## How it works

The admin and token contract private keys are never held by a single party. They are split across multiple participants using FROST Distributed Key Generation (DKG). Deploying or updating a contract requires a threshold of participants to independently verify the code and co-sign the transaction.

| Key | Role | Managed by |
|-----|------|------------|
| Admin (NoriTokenBridge) | Controls contract permissions, VK updates | FROST group (threshold signature) |
| Token (FungibleToken) | Contract account key | FROST group (threshold signature) |
| Fee payer | Pays transaction fees | Single party (regular private key) |

## Roles

**Coordinator** — responsible for setting up the ceremony infrastructure (frostd server, notification service, Telegram group), performing DKG, building and proving transactions, coordinating FROST signing sessions, re-signing with the fee payer, submitting to the Mina network, and recording the audit trail. See [CEREMONY-COORDINATOR.md](CEREMONY-COORDINATOR.md).

**Participant (committee multisig signer)** — independently verifies the code being deployed, inspects the contracts, and co-signs via FROST threshold signatures. Each ceremony is one command that handles verification and signing. See [CEREMONY-PARTICIPANT.md](CEREMONY-PARTICIPANT.md).

## Prerequisites

- Node.js >= 18.14.0 and npm >= 9
- Docker installed and running

## Getting started

Depending on your role, copy the appropriate env example and follow the corresponding guide:

**Coordinator:**
```bash
cp .env.example.coordinator .env
```
Then follow [CEREMONY-COORDINATOR.md](CEREMONY-COORDINATOR.md).

**Participant:**
```bash
cp .env.example.participant .env
```
Then follow [CEREMONY-PARTICIPANT.md](CEREMONY-PARTICIPANT.md).

## Ceremony types

**Deploy** — deploys both contracts using FROST group public keys as contract addresses. Requires two DKG groups (admin + token) and two sequential signing sessions.

**Update Verification Key** — migrates from one contract version to another. The proof is generated using the currently deployed circuit, and the new VK comes from the target version. Requires one signing session (admin group).

## Scripts

| Script | Role | Description |
|--------|------|-------------|
| `frost-init` | Everyone | Generate FROST communication keypair and export contact string |
| `frost-import` | Everyone | Import another participant's contact string |
| `frost-notification-config` | Coordinator | Generate notification service env config from FROST contacts |
| `frost-dkg-coordinate` | Coordinator | Start a DKG session, notify participants |
| `frost-dkg-participate` | Participant | Join a DKG session |
| `build-deploy-tx` | Coordinator | Full deploy ceremony — prove, sign, submit |
| `build-update-vk-tx` | Coordinator | Full updateVk ceremony — prove, sign, submit |
| `verify-deploy-tx` | Participant | Verify code and co-sign deploy transaction |
| `verify-update-vk-tx` | Participant | Verify code and co-sign updateVk transaction |
| `bake-vk-hashes` | Coordinator | Recompile and update VK integrity files after contract changes |
| `build` | Everyone | Compile TypeScript |

## Infrastructure

The coordinator deploys two services via Docker Swarm:
- **frostd** — FROST coordination server (message relay for signing sessions)
- **Telegram notification service** — posts ceremony instructions to the committee's Telegram group

See [docker/README.md](docker/README.md) for the full deployment guide.

## Audit trail

Ceremony artifacts are stored in `ceremony/audit/` with datetime-prefixed filenames for lexical sorting. Successful ceremonies are recorded in `ceremony/history.jsonl`. Both are committed to the repo.

## Baking integrity hashes

When `NoriTokenBridge` or `FungibleToken` are modified, run `npm run bake-vk-hashes` and commit the updated integrity files before any ceremony. The ceremony scripts will hard fail if the compiled VK doesn't match the stored integrity hash.
