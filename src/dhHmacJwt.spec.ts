import { createJwt, verifyJwt, getSodium } from './dhHmacJwt.js';
import { bytesToHex } from './utils.js';

let sodium: Awaited<ReturnType<typeof getSodium>>;

beforeAll(async () => {
    sodium = await getSodium();
});

function generateX25519Keypair() {
    const privBytes = sodium.randombytes_buf(32);
    const pubBytes = sodium.crypto_scalarmult_base(privBytes);
    return {
        privkeyHex: bytesToHex(privBytes),
        pubkeyHex: bytesToHex(pubBytes),
    };
}

describe('dhHmacJwt', () => {
    const namespace = 'nori-multisig';

    let participant: { privkeyHex: string; pubkeyHex: string };
    let server: { privkeyHex: string; pubkeyHex: string };

    beforeAll(() => {
        participant = generateX25519Keypair();
        server = generateX25519Keypair();
    });

    describe('createJwt + verifyJwt', () => {
        it('should create a valid JWT that verifies with DH shared secret', async () => {
            const token = await createJwt(participant.pubkeyHex, participant.privkeyHex, server.pubkeyHex, namespace);
            const result = await verifyJwt(token, server.privkeyHex, [participant.pubkeyHex], namespace);
            expect(result.valid).toBe(true);
        });

        it('should include the public key, namespace, and timestamp in the payload', async () => {
            const token = await createJwt(participant.pubkeyHex, participant.privkeyHex, server.pubkeyHex, namespace);
            const payload = JSON.parse(Buffer.from(token.split('.')[1], 'base64url').toString());
            expect(payload.pub).toBe(participant.pubkeyHex);
            expect(payload.ns).toBe(namespace);
            expect(typeof payload.iat).toBe('number');
        });
    });

    describe('verifyJwt rejection cases', () => {
        it('should reject when public key is not in the allowed set', async () => {
            const other = generateX25519Keypair();
            const token = await createJwt(participant.pubkeyHex, participant.privkeyHex, server.pubkeyHex, namespace);
            const result = await verifyJwt(token, server.privkeyHex, [other.pubkeyHex], namespace);
            expect(result.valid).toBe(false);
            expect(result.error).toBe('Public key not authorized');
        });

        it('should reject when the payload has been tampered with', async () => {
            const token = await createJwt(participant.pubkeyHex, participant.privkeyHex, server.pubkeyHex, namespace);
            const parts = token.split('.');
            const tamperedPayload = Buffer.from(JSON.stringify({
                pub: participant.pubkeyHex,
                ns: namespace,
                iat: 0,
            })).toString('base64url');
            const tamperedToken = `${parts[0]}.${tamperedPayload}.${parts[2]}`;
            const result = await verifyJwt(tamperedToken, server.privkeyHex, [participant.pubkeyHex], namespace);
            expect(result.valid).toBe(false);
            expect(result.error).toBe('Invalid signature');
        });

        it('should reject when the payload has been tampered with (extra field)', async () => {
            const token = await createJwt(participant.pubkeyHex, participant.privkeyHex, server.pubkeyHex, namespace);
            const parts = token.split('.');
            const tamperedPayload = Buffer.from(JSON.stringify({
                pub: participant.pubkeyHex,
                ns: namespace,
                iat: Math.floor(Date.now() / 1000),
                extra: 'tampered',
            })).toString('base64url');
            const tamperedToken = `${parts[0]}.${tamperedPayload}.${parts[2]}`;
            const result = await verifyJwt(tamperedToken, server.privkeyHex, [participant.pubkeyHex], namespace);
            expect(result.valid).toBe(false);
            expect(result.error).toBe('Invalid signature');
        });

        it('should reject when namespace does not match', async () => {
            const token = await createJwt(participant.pubkeyHex, participant.privkeyHex, server.pubkeyHex, namespace);
            const result = await verifyJwt(token, server.privkeyHex, [participant.pubkeyHex], 'wrong-namespace');
            expect(result.valid).toBe(false);
            expect(result.error).toBe('Namespace mismatch');
        });

        it('should reject when token is expired', async () => {
            const token = await createJwt(participant.pubkeyHex, participant.privkeyHex, server.pubkeyHex, namespace);
            const result = await verifyJwt(token, server.privkeyHex, [participant.pubkeyHex], namespace, -1);
            expect(result.valid).toBe(false);
            expect(result.error).toBe('Token expired');
        });

        it('should reject malformed tokens', async () => {
            expect((await verifyJwt('garbage', server.privkeyHex, [participant.pubkeyHex], namespace)).valid).toBe(false);
            expect((await verifyJwt('a.b.c.d', server.privkeyHex, [participant.pubkeyHex], namespace)).valid).toBe(false);
            expect((await verifyJwt('a.b', server.privkeyHex, [participant.pubkeyHex], namespace)).valid).toBe(false);
        });

        it('should reject when a different participant tries to impersonate', async () => {
            const attacker = generateX25519Keypair();
            const token = await createJwt(participant.pubkeyHex, attacker.privkeyHex, server.pubkeyHex, namespace);
            const result = await verifyJwt(token, server.privkeyHex, [participant.pubkeyHex], namespace);
            expect(result.valid).toBe(false);
            expect(result.error).toBe('Invalid signature');
        });

        it('should reject when using the wrong server keypair', async () => {
            const wrongServer = generateX25519Keypair();
            const token = await createJwt(participant.pubkeyHex, participant.privkeyHex, server.pubkeyHex, namespace);
            const result = await verifyJwt(token, wrongServer.privkeyHex, [participant.pubkeyHex], namespace);
            expect(result.valid).toBe(false);
            expect(result.error).toBe('Invalid signature');
        });
    });
});
