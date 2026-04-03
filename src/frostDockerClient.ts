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

