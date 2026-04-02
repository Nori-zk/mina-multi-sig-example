# Docker Infrastructure

Infrastructure for deploying the ceremony coordination services: the `frostd` signing server and the Telegram notification service, behind automatic TLS via [caddy-docker-proxy](https://github.com/lucaslorentz/caddy-docker-proxy).

## Architecture

Two Docker Swarm stacks:

| Stack | Compose file | What it runs |
|-------|-------------|-------------|
| `core` | `docker-compose.lb.swarm.yml` | Caddy load balancer with automatic Let's Encrypt TLS |
| `frost` | `docker-compose.services.swarm.yml` | frostd coordination server + Telegram notification service |

Both stacks share the `web` overlay network. Caddy auto-discovers services via Docker labels and provisions TLS certificates.

## Services

| Service | Image | Port | Description |
|---------|-------|------|-------------|
| `frost-server` | `0x6a6f6e6e79/frost-server:latest` | 2744 | frostd FROST coordination server (from [mina-multi-sig](https://github.com/Nori-zk/mina-multi-sig)) |
| `telegram-notification-service` | `0x6a6f6e6e79/telegram-multisig-ceremony-notification-service:latest` | 3000 | Receives JWT-authenticated ceremony notifications and forwards to Telegram |

## Prerequisites

Before deploying, the following must be complete:

1. All committee members have run `npm run frost-init` and shared their contact strings
2. All committee members have run `npm run frost-import` for each other member
3. The coordinator has run `npm run frost-notification-config` to generate the notification service environment configuration
4. A Telegram bot has been created via [@BotFather](https://t.me/botfather) and added to the committee's Telegram group
5. The bot token and chat ID have been obtained

No services can be deployed until all configuration is complete — the services stack deploys frostd and the notification service together, and both require their configuration to be in place.

## Setup

### 0. Provision domain names

You need two domain names — one for the frostd server and one for the notification service. These can be subdomains of the same domain. For example:
- `frost.yourdomain.com` — frostd coordination server
- `notify.yourdomain.com` — Telegram notification service

Register the domains and create A records pointing both to the public IP address of the machine that will be the swarm manager. Caddy handles TLS certificates automatically via Let's Encrypt once DNS resolves.

### 1. First-time cluster setup (once per machine)

Initialize the Docker Swarm and create the required overlay networks. This only needs to be done once:

```sh
./swarm/init-swarm.sh
./swarm/create-networks.sh
```

This creates two encrypted overlay networks:
- `web` — shared between the load balancer and services
- `caddy_controller` — internal to the caddy controller on subnet `10.200.200.0/24`

### 2. Configure the load balancer

Edit `docker-compose.lb.swarm.yml`:
- Replace `example@email.com` under `caddy.email` with a real email address — Let's Encrypt uses this for certificate expiry notifications

### 3. Configure the services

Edit `docker-compose.services.swarm.yml`:
- Replace `frost.example.com` with your frostd domain (e.g. `frost.yourdomain.com`)
- Replace `tgns.example.com` with your notification service domain (e.g. `notify.yourdomain.com`)
- Add the notification service environment variables (from the prerequisite steps above):

```yaml
telegram-notification-service:
    environment:
      - NOTIFICATION_NAMESPACE=nori-multisig
      - NOTIFICATION_ALLOWED_KEYS=<from frost-notification-config output>
      - TELEGRAM_BOT_TOKEN=<from @BotFather>
      - TELEGRAM_CHAT_ID=<from your Telegram group>
```

### 4. Build the notification service image

The notification service source and Dockerfile are at [`telegram-notification-service/`](../telegram-notification-service/) in the project root:

```sh
cd telegram-notification-service
./build.sh
```

This builds multi-arch images (amd64 + arm64) using `docker buildx`.

### 5. Deploy the load balancer

```sh
./swarm/lb-up.sh
```

### 6. Deploy the services

```sh
./swarm/frost-up.sh
```

Verify both services are running:

```sh
docker stack services frost
docker stack services core
```

Test the frostd server is reachable:

```sh
curl https://frost.yourdomain.com/
```

Test the notification service health endpoint:

```sh
curl https://notify.yourdomain.com/health
```

### 7. Update your .env

Set these in your project `.env` so the ceremony scripts can find the services:

```
FROST_SERVER_URL=frost.yourdomain.com
NOTIFICATION_SERVICE_URL=https://notify.yourdomain.com
```

Share `FROST_SERVER_URL` with all committee members — they need it in their `.env` too.

## Tear down

```sh
./swarm/frost-down.sh   # Stop the services
./swarm/lb-down.sh      # Stop the load balancer
```

## Updating

To update the services after pulling new images:

```sh
./swarm/frost-down.sh
./swarm/frost-up.sh
```

The load balancer rarely needs restarting — only if the caddy configuration or domains change.

## Registry

The default registry is `0x6a6f6e6e79`. Override with the `REGISTRY` environment variable:

```sh
REGISTRY=your-registry ./swarm/frost-up.sh
```
