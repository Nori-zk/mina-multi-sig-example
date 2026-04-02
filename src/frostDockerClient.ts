import { execSync } from 'child_process';
import { Logger, LogPrinter } from 'esm-iso-logger';

const logger = new Logger('FrostDockerClient');
new LogPrinter('FrostDockerClient');

const possibleFrostClientImage = process.env.FROST_CLIENT_IMAGE;
const defaultFrostClientImage = '0x6a6f6e6e79/frost-mina-client:latest';
const frostClientImage = possibleFrostClientImage || defaultFrostClientImage;

export const frostGuestMountDir = '/frost';
export const frostGuestConfigPath = `${frostGuestMountDir}/config`;
export const frostGuestAuditDir = '/ceremony/audit';

export type FrostDockerRunOptions = {
    frostConfigHostPath: string;
    args: string[];
    auditHostPath?: string;
};

export function runFrostClient(options: FrostDockerRunOptions): string {
    const { frostConfigHostPath, args, auditHostPath } = options;

    const mounts = [
        `-v "${frostConfigHostPath}:${frostGuestMountDir}"`,
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
