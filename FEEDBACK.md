# mina-frost-client feedback

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
