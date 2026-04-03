import { createHmac } from 'crypto';
import _sodium from 'libsodium-wrappers-sumo';

// DH-HMAC JWT scheme using X25519 key material from the FROST config.
//
// Each participant derives a unique shared secret with the notification server
// via X25519 Diffie-Hellman: DH(participantPriv, serverPub) = DH(serverPriv, participantPub).
// The JWT is HMAC-SHA256'd with that shared secret.
// The participant's X25519 public key is in the JWT payload so the server knows which DH to compute.
// The server exposes its public key via a /pubkey endpoint.
// Participants fetch it at notification time — no pre-configuration needed.
//
// This scheme does rely on TLS to prevent replay attacks.
// Key holders in the allowedKeys can spam we have to trust them not to.

export async function getSodium() {
    await _sodium.ready;
    return _sodium;
}

export async function deriveSharedSecret(myPrivkeyHex: string, theirPubkeyHex: string): Promise<Buffer> {
    const sodium = await getSodium();
    const shared = sodium.crypto_scalarmult(
        Buffer.from(myPrivkeyHex, 'hex'),
        Buffer.from(theirPubkeyHex, 'hex'),
    );
    return Buffer.from(shared);
}

interface JwtPayload {
    pub?: string;
    ns?: string;
    iat?: number;
}

export async function createJwt(pubkeyHex: string, privkeyHex: string, serverPubkeyHex: string, namespace: string): Promise<string> {
    const shared = await deriveSharedSecret(privkeyHex, serverPubkeyHex);

    const header = Buffer.from(JSON.stringify({ alg: 'HS256', typ: 'JWT' })).toString('base64url');
    const payload = Buffer.from(JSON.stringify({
        pub: pubkeyHex,
        ns: namespace,
        iat: Math.floor(Date.now() / 1000),
    })).toString('base64url');

    const message = `${header}.${payload}`;
    const signature = createHmac('sha256', shared)
        .update(message)
        .digest('base64url');

    return `${message}.${signature}`;
}

export async function verifyJwt(
    token: string,
    serverPrivkeyHex: string,
    allowedKeys: string[],
    expectedNamespace: string,
    maxAgeSecs: number = 300,
): Promise<{ valid: boolean; error?: string }> {
    const parts = token.split('.');
    if (parts.length !== 3) {
        return { valid: false, error: 'Invalid JWT format' };
    }

    const [headerB64, payloadB64, sigB64] = parts;

    let decoded: JwtPayload;
    try {
        decoded = JSON.parse(Buffer.from(payloadB64, 'base64url').toString()) as JwtPayload;
    } catch {
        return { valid: false, error: 'Invalid JWT payload' };
    }

    // Structural validation before signature check
    if (typeof decoded.pub !== 'string' || !/^[0-9a-fA-F]{64}$/.test(decoded.pub)) {
        return { valid: false, error: 'Invalid public key format' };
    }

    if (typeof decoded.ns !== 'string' || decoded.ns.length === 0) {
        return { valid: false, error: 'Invalid namespace' };
    }

    const now = Math.floor(Date.now() / 1000);

    // Note: iat is client-controlled since participants create the JWT.
    // This validation rejects obviously broken values (future timestamps, non-integers)
    // but a key holders can always mint fresh tokens with iat: now()
    // we only trust the holders within allowedKeys to not tamper!
    if (
        typeof decoded.iat !== 'number' ||
        !Number.isInteger(decoded.iat) ||
        decoded.iat > now + 60  // Reject future timestamps (allowing 60s clock skew)
    ) {
        return { valid: false, error: 'Invalid issued-at time' };
    }

    // CRITICAL: Verify HMAC BEFORE trusting any claims in the payload.
    // Derive the DH shared secret using server's private key and participant's public key from the JWT.
    // If the public key is forged, the DH produces a different shared secret and HMAC fails.
    const shared = await deriveSharedSecret(serverPrivkeyHex, decoded.pub);

    const message = `${headerB64}.${payloadB64}`;
    const expectedSig = createHmac('sha256', shared)
        .update(message)
        .digest('base64url');

    if (sigB64 !== expectedSig) {
        return { valid: false, error: 'Invalid signature' };
    }

    // Only after signature verification succeeds, validate authorization claims
    if (decoded.ns !== expectedNamespace) {
        return { valid: false, error: 'Namespace mismatch' };
    }

    if (!allowedKeys.includes(decoded.pub.toLowerCase())) {
        return { valid: false, error: 'Public key not authorized' };
    }

    // maxAgeSecs only prevents accidental reuse of old tokens.
    // A compromised key bypasses this by generating fresh tokens.
    const age = now - decoded.iat;
    if (age > maxAgeSecs) {
        return { valid: false, error: 'Token expired' };
    }

    return { valid: true };
}
