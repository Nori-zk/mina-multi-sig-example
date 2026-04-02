import { ed25519 } from '@noble/curves/ed25519.js';

// Self signed JWT scheme does rely on TLS to prevent replay attacks 
// Key holders in the allowedKeys can spam we have to trust them not to.

interface JwtPayload {
    pub?: string;
    ns?: string;
    iat?: number;
}

export function createJwt(pubkeyHex: string, privkeyHex: string, namespace: string): string {
    const header = Buffer.from(JSON.stringify({ alg: 'EdDSA', typ: 'JWT' })).toString('base64url');
    const payload = Buffer.from(JSON.stringify({
        pub: pubkeyHex,
        ns: namespace,
        iat: Math.floor(Date.now() / 1000),
    })).toString('base64url');

    const message = `${header}.${payload}`;
    const signature = ed25519.sign(Buffer.from(message), Buffer.from(privkeyHex, 'hex'));
    const signatureB64 = Buffer.from(signature).toString('base64url');

    return `${message}.${signatureB64}`;
}

export function verifyJwt(
    token: string,
    allowedKeys: string[],
    expectedNamespace: string,
    maxAgeSecs: number = 300,
): { valid: boolean; error?: string } {
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
    
    // Note: iat is client-controlled since they self-sign. 
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

    let sigBytes: Buffer;
    try {
        sigBytes = Buffer.from(sigB64, 'base64url');
    } catch {
        return { valid: false, error: 'Invalid signature encoding' };
    }

    // CRITICAL: Verify signature BEFORE trusting any claims in the payload
    const message = `${headerB64}.${payloadB64}`;
    try {
        const isValid = ed25519.verify(
            sigBytes,
            Buffer.from(message),
            Buffer.from(decoded.pub, 'hex')
        );
        if (!isValid) {
            return { valid: false, error: 'Invalid signature' };
        }
    } catch {
        return { valid: false, error: 'Signature verification failed' };
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