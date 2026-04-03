import { execSync } from 'child_process';
import { dirname } from 'path';
import { Logger, LogPrinter } from 'esm-iso-logger';
import { getAbsolutePath } from './utils.js';

const logger = new Logger('FrostDockerClient');
new LogPrinter('FrostDockerClient');

const possibleFrostClientImage = process.env.FROST_CLIENT_IMAGE;
const defaultFrostClientImage = '0x6a6f6e6e79/frost-mina-client:latest';
const frostClientImage = possibleFrostClientImage || defaultFrostClientImage;

export const frostGuestConfigDir = '/frost';
export const frostGuestConfigPath = '/frost/config';
export const frostGuestAuditDir = '/ceremony/audit';

export type FrostDockerRunOptions = {
    frostConfigHostPath: string;
    args: string[];
    auditHostPath?: string;
};

export function runFrostClient(options: FrostDockerRunOptions): string {
    const { frostConfigHostPath, args, auditHostPath } = options;

    const absoluteHostPath = getAbsolutePath(frostConfigHostPath);
    const hostDir = dirname(absoluteHostPath);

    const mounts = [
        `-v "${hostDir}:${frostGuestConfigDir}"`,
    ];

    if (auditHostPath) {
        mounts.push(`-v "${auditHostPath}:${frostGuestAuditDir}"`);
    }

    const cmd = [
        'docker run --rm',
        ...mounts,
        frostClientImage,
        ...args,
    ].join(' ');

    logger.info(`Running image: ${frostClientImage}`);
    logger.info(`Command: ${args.join(' ')}`);

    return execSync(cmd, { encoding: 'utf8' });
}

export function mapMinaNetworkToFrost(minaNetwork: string): string {
    return minaNetwork === 'mainnet' ? 'mainnet' : 'testnet';
}
