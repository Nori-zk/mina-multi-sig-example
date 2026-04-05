import { spawn } from 'child_process';
import { basename, dirname } from 'path';
import { Logger } from 'esm-iso-logger';
import { getAbsolutePath } from './utils.js';

const logger = new Logger('FrostClient');

const possibleFrostClientImage = process.env.FROST_CLIENT_IMAGE;
const defaultFrostClientImage = '0x6a6f6e6e79/frost-mina-client:latest';
const frostClientImage = possibleFrostClientImage || defaultFrostClientImage;

export const frostGuestConfigDir = '/frost';
export const frostGuestAuditDir = '/ceremony/audit';

export function frostGuestConfigPath(hostConfigPath: string): string {
    return `${frostGuestConfigDir}/${basename(hostConfigPath)}`;
}

export type FrostDockerRunOptions = {
    frostConfigHostPath: string;
    args: string[];
    auditHostPath?: string;
};

export function runFrostClient(options: FrostDockerRunOptions): Promise<string> {
    const { frostConfigHostPath, args, auditHostPath } = options;

    const absoluteHostPath = getAbsolutePath(frostConfigHostPath);
    const hostDir = dirname(absoluteHostPath);

    const mounts = [
        '-v', `${hostDir}:${frostGuestConfigDir}`,
    ];

    if (auditHostPath) {
        mounts.push('-v', `${auditHostPath}:${frostGuestAuditDir}`);
    }

    const dockerArgs = [
        'run', '--rm',
        '--user', `${process.getuid()}:${process.getgid()}`,
        ...mounts,
        frostClientImage,
        ...args,
    ];

    logger.debug(`Running image: ${frostClientImage}`);
    logger.debug(`Command: ${args.join(' ')}`);

    return new Promise((resolve, reject) => {
        const child = spawn('docker', dockerArgs);
        const chunks: string[] = [];

        child.stdout.on('data', (data: Buffer) => {
            const text = data.toString();
            chunks.push(text);
            for (const line of text.trimEnd().split('\n')) {
                logger.info(line);
            }
        });

        child.stderr.on('data', (data: Buffer) => {
            const text = data.toString();
            chunks.push(text);
            for (const line of text.trimEnd().split('\n')) {
                logger.info(line);
            }
        });

        child.on('close', (code) => {
            const output = chunks.join('');
            if (code === 0) {
                resolve(output);
            } else {
                reject(new Error(output.trim() || `Docker process exited with code ${code}`));
            }
        });
    });
}

export function mapMinaNetworkToFrost(minaNetwork: string): string {
    return minaNetwork === 'mainnet' ? 'mainnet' : 'testnet';
}

// Best-effort close all sessions. Used on fatal exit paths to reduce stale sessions
// that cause SnowError(Decrypt) on the next run.
export async function closeAllSessions(frostConfigHostPath: string, frostServerUrl: string, _log: Logger) {
    try {
        await runFrostClient({
            frostConfigHostPath,
            args: [
                'sessions',
                '-c', frostGuestConfigPath(frostConfigHostPath),
                '-s', frostServerUrl,
                '--close-all',
            ],
        });
    } catch {
        // Best effort — don't fail if cleanup fails
    }
}

// Clean up stale FROST sessions and poll until confirmed clean.
// If a previous ceremony failed, participants may join the stale session instead of
// the new one, causing SnowError(Decrypt) due to mismatched Noise handshake state.
export async function ensureCleanSessions(frostConfigHostPath: string, frostServerUrl: string, log: Logger) {
    const sessionArgs = {
        frostConfigHostPath,
        args: [
            'sessions',
            '-c', frostGuestConfigPath(frostConfigHostPath),
            '-s', frostServerUrl,
        ],
    };
    const closeArgs = {
        frostConfigHostPath,
        args: [
            'sessions',
            '-c', frostGuestConfigPath(frostConfigHostPath),
            '-s', frostServerUrl,
            '--close-all',
        ],
    };

    log.log('Closing all sessions...');
    try {
        await runFrostClient(closeArgs);
    } catch (e) {
        log.error(`Failed to close sessions: ${(e as Error).message}`);
        log.fatal('Encountered a fatal error and cannot continue.');
        process.exit(1);
    }

    // Poll until confirmed clean
    for (let attempt = 1; attempt <= 10; attempt++) {
        await new Promise((r) => setTimeout(r, 2000));
        try {
            const check = await runFrostClient(sessionArgs);
            if (check.includes('No active sessions')) {
                log.log('Sessions confirmed clean. Waiting 5s for server to fully propagate...');
                await new Promise((r) => setTimeout(r, 5000));
                return;
            }
            log.warn(`Sessions still active after close, waiting (${attempt}/10)...`);
        } catch (e) {
            log.error(`Failed to check sessions: ${(e as Error).message}`);
            log.fatal('Encountered a fatal error and cannot continue.');
            process.exit(1);
        }
    }
    log.error('Could not confirm all sessions are closed after polling.');
    log.fatal('Encountered a fatal error and cannot continue.');
    process.exit(1);
}

