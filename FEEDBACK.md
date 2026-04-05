# mina-frost-client feedback (line numebrs written against main branch)

## 1. `init` has no guards — can silently wipe key material

If `communication_key` already exists it skips keypair generation, but it still calls `config.write()` at line 32 which overwrites the config file. If the config has groups with key shares, those are preserved only because it reads and re-writes the whole config. But there's no confirmation prompt, no backup, and no warning that groups/shares exist. A user running `init` on a config with active key shares gets no warning.

- `src/cli/init.rs:20-26` — skips keypair but still writes
- `src/cli/init.rs:32` — unconditional `config.write()`

## 2. All progress output goes to stderr via `eprintln!`

Consumers cannot distinguish progress messages from actual errors. Every status message ("Logging in...", "Creating DKG session...", "Waiting for participants...") is written to stderr.

- `src/dkg/comms/http.rs:94,125,136,156`
- `src/coordinator/comms/http.rs:70,92,157,186`
- `src/participant/comms/http.rs:144,170,209,237,255`
- `src/cli/init.rs:21,23,28,33`
- `src/cli/session.rs:69,81,82,88,91,97`
- `src/cli/contact.rs:98,99,125,126,127,131,145,146,147`

## 3. Stale sessions from failed runs block new sessions with no DKG escape hatch

When a DKG or signing session fails, the session remains active on the server. A subsequent DKG attempt fails with:

> user has more than one FROST session active; use `mina-frost-client sessions` to list them and specify the session ID with `-S`

But the `dkg` subcommand does not accept a `-S` session ID flag — only `participant` does. The error message is misleading. The only recovery is `sessions --close-all`.

- `src/dkg/comms/http.rs:143-144` — error thrown, suggests `-S` which doesn't exist on `dkg`
- `src/participant/comms/http.rs:176-177` — same error
- `src/cli/args.rs:102-123` — `dkg` subcommand args, no session flag
- `src/cli/args.rs:209-210` — `participant` subcommand, has `-S` session flag

## 4. No passphrase protection on config file

The config file contains private FROST key shares in cleartext. The code acknowledges this with a warning: "the config file will contain your private FROST shares in clear. Keep it safe and never share it with anyone. Future versions of this tool might encrypt the config file." No passphrase, no encryption, no file permissions enforcement.

- `src/cli/init.rs:33-36` — cleartext warning
- `src/cli/args.rs:15-17` — same acknowledgement in CLI help text

## 5. `server_url` silently prepends `https://` — passing a full URL breaks with no useful error

If a user passes `https://frost.example.com`, it becomes `https://https://frost.example.com` and fails with a confusing parse error. Should either strip the scheme if present or document the expectation clearly.

- `src/cli/coordinator.rs:198`
- `src/cli/participant.rs:101`
- `src/cli/dkg.rs:79`
- `src/cli/session.rs:49`

## 6. Cannot parse o1js ZkApp transaction JSON

The coordinator's `-m` flag reads a transaction JSON file and attempts to parse it via `Transaction::from_str_network()` which tries `serde_json::from_str::<ZKAppCommand>()`. This fails on transactions produced by o1js `txn.toJSON()` with:

> Error: Failed to parse transaction from JSON: Unknown transaction type: Unable to parse transaction. Expected a valid legacy transaction or ZkApp transaction JSON.

The o1js JSON has the correct top-level structure (`feePayer`, `accountUpdates`, `memo`) but deserialization fails on a field-level mismatch between the o1js representation and the Rust `ZKAppCommand` serde model.

- `mina-tx/src/transactions.rs:88-105` — `from_str_network()` tries ZkApp then Legacy, both fail
- `mina-tx/src/transactions/zkapp_tx.rs:73-83` — `ZKAppCommand` struct definition

## 7. Noise protocol 65535-byte message limit breaks ZkApp deploy signing

The coordinator's `SendSigningPackage` fails with `SnowError(Input)` for ZkApp deploy transactions that include verification keys. The raw transaction envelope (~46KB) fits within Noise limits, but `frost-core` hex-encodes the message bytes inside `SigningPackage`, roughly doubling the payload size. After JSON serialization in `SendSigningPackageArgs`, the payload hits ~92KB which exceeds the Noise protocol's hard 65535-byte message cap.

- Small transactions (e.g. payments, ~3KB) sign fine
- Deploy transactions with verification keys (~46KB raw, ~92KB hex-encoded) fail
- The hex encoding happens inside `frost-core`'s `SigningPackage` serialization (`serdect` hex), not in our code or `mina-tx`
- `src/cipher.rs` — `encrypt()` calls `snow`'s `write_message()` which enforces the 65535 limit
- `api::MAX_MSG_SIZE` — the buffer size constant

The 65535 limit is enforced at two layers: Noise (`snow`'s `write_message()`) and the frostd server (`api::MAX_MSG_SIZE`). Since frostd is upstream (`frost-tools`) and also enforces the same limit, the client comms layer needs to chunk messages into multiple frostd sends/receives. Coordinator splits before encrypt/send, participant collects multiple messages and reassembles after receive/decrypt. The Cipher stays single-frame and doesn't need to change.

## 8. Inconsistent coordinator role between DKG and signing

In DKG, the coordinator **automatically participates** — the `dkg` command contributes key material and `-S`/`--participants` lists only the *other* participants. The coordinator ends up in the group as a full participant with their own key share.

In signing, the coordinator **does not participate** — the `coordinator` command is purely an orchestrator. It creates the session, waits for commitments from everyone in `-S`/`--signers`, builds the signing package, and aggregates signatures. It does not contribute its own commitment or signature share. `-S` must list *all* signers, including the coordinator if they are a signer.

This means that when the coordinator is also a group member (which is always the case after DKG), they must run `participant` in parallel with `coordinator` to contribute their own signature share. This is undocumented and surprising given the DKG behaviour.

- `src/cli/dkg.rs` — DKG coordinator automatically participates, `-S` = others only
- `src/cli/coordinator.rs:200` — `num_signers = signers.len()`, waits for exactly this many commitments
- `src/coordinator/coordinate_signing.rs:33-40` — collects commitments only from signers in `-S`, does not self-sign
- `src/cli/args.rs:176-178` — `--signers` on `coordinator` = all signers to wait for

## 9. Participant status message is misleading when coordinator is still waiting for commitments

The participant logs "Waiting for coordinator to send signing package..." while the coordinator is actually still waiting for commitments from other signers. This makes it look like the coordinator is the bottleneck when it's actually another participant that hasn't joined yet.

- `src/participant/comms/http.rs:237` — "Signing package received" only after all commitments are in

## 10. Participant session discovery is unsafe — coordinator does not output session ID

The coordinator in `mina-frost-client/src/coordinator/comms/http.rs:92-99` creates a session on frostd and receives a session UUID back. It only prints this UUID to stderr when `self.config.signers.is_empty()` (`http.rs:101-106`). When signers are specified via `-S` (the normal usage), the session ID is never output.

The participant in `mina-frost-client/src/participant/comms/http.rs:171-183` can accept a session ID via `self.session_id` (set by the `--session_id` CLI flag in `src/cli/args.rs`). When no session ID is provided, it falls back to calling `list_sessions` on frostd, which returns all session UUIDs where the participant's pubkey appears. If exactly one exists, it joins it. If more than one exists, it errors. It takes `r.session_ids[0]` without any validation of which session it belongs to.

Since the coordinator never outputs the session ID and the participant blindly picks the first session from a pubkey lookup, there is no mechanism to ensure the participant joins the intended session. Multiple sessions for the same pubkeys can exist simultaneously — from failed ceremonies that weren't cleaned up, from concurrent runs, or during the gap between closing one session and creating the next in a multi-group ceremony. A participant that joins the wrong session establishes a Noise channel against a different coordinator's handshake state, and all subsequent encrypted communication fails with `SnowError(Decrypt)`. This also applies when two group members independently coordinate ceremonies on the same server.

In practice we have not been able to achieve reliable multi-group signing ceremonies despite extensive testing with aggressive session cleanup, polling for session closure confirmation, and delays between sessions. The client's blind session discovery means that any failed ceremony leaves state that can cause subsequent ceremonies to fail with `SnowError(Decrypt)`. Multi-group ceremonies that require sequential sessions are especially fragile — a failed first session poisons the second. Without explicit session ID passing from coordinator to participant, the client has no way to distinguish a valid session from a stale or unrelated one on the same server.

The coordinator should always output the session ID to stdout so orchestration tooling can capture it and pass it to participants via `--session_id`.

Worse, this blind discovery is also a DoS vector if any FROST config file is compromised or if participant pubkeys are discovered by any other out-of-band communication mechanism. Each config file contains the communication pubkeys of all group members and the frostd server URL. An attacker with this information can:

1. Authenticate with frostd using a freshly generated keypair — no pre-registration or allowlist required (`frostd/src/functions.rs:56-84`)
2. Create a session listing some subset of legitimate participants' pubkeys (`frostd/src/functions.rs:101-142`) — frostd does not validate that the caller has any relationship to the pubkeys listed
3. The legitimate coordinator cannot close the attacker's session because `close_session` only allows the session's coordinator to close it (`frostd/src/functions.rs:307-309`) [it will timeout after 24 hours but they can add as many as they want]

When the legitimate ceremony starts, the coordinator clears its own stale sessions via `--close-all`, but the attacker's session survives. The participant calls `list_sessions`, which returns all sessions where their pubkey appears — both the legitimate session and the attacker's. The participant either errors with "user has more than one FROST session active" (`http.rs:176-177`) or, if the attacker's session is the only one visible at query time, joins it and fails with `SnowError(Decrypt)` due to mismatched Noise state.

The attacker cannot forge signatures or read encrypted messages. But they can permanently block all signing ceremonies for the group by maintaining a single session on the server. The attack requires no private key material — only a subset of the legitimate committee's pubkeys and the frostd URL.

## 11. Coordinator without `-S` is broken — hangs forever or rejects all participants

When the coordinator is run without `-S` (no signers specified), the following occurs:

1. `parse_signers` in `src/cli/coordinator.rs:154-163` iterates an empty list, returning an empty `HashMap<PublicKey, Identifier>`
2. `setup_coordinator_config` in `src/cli/coordinator.rs:200` sets `num_signers = signers.len() = 0`
3. `HTTPComms::new` in `src/coordinator/comms/http.rs:47-50` creates `CoordinatorSessionState::new(1, 0, empty_map)` — state is `WaitingForCommitments` with `num_signers=0`, empty `commitments`, empty `pubkeys`
4. `create_new_session` in `src/coordinator/comms/http.rs:95-98` sends `pubkeys: self.config.signers.keys().cloned().collect()` — an empty vec. frostd creates a session with no participants, only the coordinator's pubkey in `sessions_by_pubkey`
5. `self.config.signers.is_empty()` is true (`src/coordinator/comms/http.rs:101-106`), so the session ID is printed to stderr — this is the "open invitation" mode
6. `Cipher::new` in `src/coordinator/comms/http.rs:115-118` is created with an empty peers list
7. The polling loop at `src/coordinator/comms/http.rs:122-139` calls `receive` on frostd. No participants are in the frostd session (the participant list was empty), so no one can send messages to the Coordinator queue. `r.msgs` is always empty. `recv` is never called. The state never transitions from `WaitingForCommitments`. `has_commitments()` at `src/session.rs:142-146` checks for `WaitingForSignatureShares` which is never reached. The coordinator hangs forever

If a participant manages to join manually via `--session_id` and sends a commitment, the coordinator receives it and calls `handle_commitments` at `src/session.rs:103-138`. Line 117 calls `pubkeys.get(&pubkey)` but `pubkeys` is the empty map from step 3. It returns `Err("unknown participant")` and the coordinator exits with an error.

The transition at `src/session.rs:126` (`commitments_map.len() == args.num_signers`) would evaluate to `0 == 0` and advance the state — but this line is only reached inside `handle_commitments`, which is only called when a commitment is successfully processed. Since every commitment is rejected at line 117, this transition never fires.

The without-`-S` mode prints the session ID as if it expects participants to join manually, but the coordinator has no mechanism to accept them.

Ideally `-S` should not be required at all. The group's participant pubkeys are already in the FROST config under `[group.*.participant.*]` and the threshold is embedded in `public_key_package` (`min_signers`). The coordinator should use these directly — creating a session open to all group members and accepting commitments from whichever members happen to be available, proceeding once the threshold is met. Requiring the caller to manually list signers via `-S` somewhat defeats the point of threshold signatures, where any `t` of `n` members should be able to sign without the coordinator needing to predict or knowing before hand who will be online.
