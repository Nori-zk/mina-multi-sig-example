import { ed25519 } from '@noble/curves/ed25519.js';
import { bytesToHex } from './utils.js';
import { createJwt, verifyJwt } from './selfSignedJwt.js';

describe('selfSignedJwt', () => {
    const privkeyBytes = ed25519.utils.randomSecretKey();
    const pubkeyBytes = ed25519.getPublicKey(privkeyBytes);
    const privkeyHex = bytesToHex(privkeyBytes);
    const pubkeyHex = bytesToHex(pubkeyBytes);
    const namespace = 'nori-multisig';

    describe('createJwt + verifyJwt', () => {
        it('should create a valid JWT that verifies with the correct public key', () => {
            const token = createJwt(pubkeyHex, privkeyHex, namespace);
            const result = verifyJwt(token, [pubkeyHex], namespace);
            expect(result.valid).toBe(true);
        });

        it('should include the public key, namespace, and timestamp in the payload', () => {
            const token = createJwt(pubkeyHex, privkeyHex, namespace);
            const payload = JSON.parse(Buffer.from(token.split('.')[1], 'base64url').toString());
            expect(payload.pub).toBe(pubkeyHex);
            expect(payload.ns).toBe(namespace);
            expect(typeof payload.iat).toBe('number');
        });
    });

    describe('verifyJwt rejection cases', () => {
        it('should reject when public key is not in the allowed set', () => {
            const token = createJwt(pubkeyHex, privkeyHex, namespace);
            const wrongPriv = ed25519.utils.randomSecretKey();
            const wrongPub = bytesToHex(ed25519.getPublicKey(wrongPriv));
            const result = verifyJwt(token, [wrongPub], namespace);
            expect(result.valid).toBe(false);
            expect(result.error).toBe('Public key not authorized');
        });

        it('should reject when the payload has been tampered with', () => {
            const token = createJwt(pubkeyHex, privkeyHex, namespace);
            const parts = token.split('.');
            const tamperedPayload = Buffer.from(JSON.stringify({
                pub: pubkeyHex,
                ns: namespace,
                iat: 0,
            })).toString('base64url');
            const tamperedToken = `${parts[0]}.${tamperedPayload}.${parts[2]}`;
            const result = verifyJwt(tamperedToken, [pubkeyHex], namespace);
            expect(result.valid).toBe(false);
            expect(result.error).toBe('Invalid signature');
        });

        it('should reject when the payload has been tampered with 2', () => {
            const token = createJwt(pubkeyHex, privkeyHex, namespace);
            const parts = token.split('.');
            const tamperedPayload = Buffer.from(JSON.stringify({
                pub: pubkeyHex,
                ns: namespace,
                iat: Math.floor(Date.now() / 1000),
                extra: 'tampered',
            })).toString('base64url');
            const tamperedToken = `${parts[0]}.${tamperedPayload}.${parts[2]}`;
            const result = verifyJwt(tamperedToken, [pubkeyHex], namespace);
            expect(result.valid).toBe(false);
            expect(result.error).toBe('Invalid signature');
        });

        it('should reject when namespace does not match', () => {
            const token = createJwt(pubkeyHex, privkeyHex, namespace);
            const result = verifyJwt(token, [pubkeyHex], 'wrong-namespace');
            expect(result.valid).toBe(false);
            expect(result.error).toContain('Namespace mismatch');
        });

        it('should reject when token is expired', () => {
            const token = createJwt(pubkeyHex, privkeyHex, namespace);
            const result = verifyJwt(token, [pubkeyHex], namespace, -1);
            expect(result.valid).toBe(false);
            expect(result.error).toContain('Token expired');
        });

        it('should reject malformed tokens', () => {
            expect(verifyJwt('garbage', [pubkeyHex], namespace).valid).toBe(false);
            expect(verifyJwt('a.b.c.d', [pubkeyHex], namespace).valid).toBe(false);
            expect(verifyJwt('a.b', [pubkeyHex], namespace).valid).toBe(false);
        });

        it('should reject when a different private key signs for the same public key', () => {
            const attackerPriv = bytesToHex(ed25519.utils.randomSecretKey());
            // Attacker creates JWT claiming to be pubkeyHex but signs with their own key
            const header = Buffer.from(JSON.stringify({ alg: 'EdDSA', typ: 'JWT' })).toString('base64url');
            const payload = Buffer.from(JSON.stringify({
                pub: pubkeyHex,
                ns: namespace,
                iat: Math.floor(Date.now() / 1000),
            })).toString('base64url');
            const message = `${header}.${payload}`;
            const sig = ed25519.sign(Buffer.from(message), Buffer.from(attackerPriv, 'hex'));
            const forgedToken = `${message}.${Buffer.from(sig).toString('base64url')}`;

            const result = verifyJwt(forgedToken, [pubkeyHex], namespace);
            expect(result.valid).toBe(false);
            expect(result.error).toBe('Invalid signature');
        });
    });
});
