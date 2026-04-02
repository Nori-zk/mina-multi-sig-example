import { execSync } from 'child_process';
import { existsSync, mkdirSync, readFileSync, rmSync } from 'fs';
import { join, resolve } from 'path';
import { type O1jsVersionInfo, readO1jsVersionInfo } from './versionInfo.js';
import { type ContractVkInfo, type TagInfo } from './notifications/events.js';
import { getRemoteUrl } from './preflight.js';
import { rootDir } from './path.js';

const CEREMONY_VERIFY_DIR = resolve(rootDir, '..', 'ceremony', 'verify');

export function verifyTag(
    tag: string,
    logger: { log: (msg: string) => void }
): TagInfo & { verifyDir: string } {
    const verifyDir = join(CEREMONY_VERIFY_DIR, tag);

    if (existsSync(verifyDir)) {
        logger.log(`Removing existing verification directory: '${verifyDir}'`);
        rmSync(verifyDir, { recursive: true, force: true });
    }

    mkdirSync(CEREMONY_VERIFY_DIR, { recursive: true });

    const remoteUrl = getRemoteUrl();
    logger.log(`Cloning '${tag}' from '${remoteUrl}' into '${verifyDir}'...`);
    execSync(`git clone "${remoteUrl}" "${verifyDir}"`, { stdio: 'inherit' });
    execSync(`git -C "${verifyDir}" checkout "${tag}"`, { stdio: 'inherit' });

    logger.log('Installing dependencies...');
    execSync('npm ci', { cwd: verifyDir, stdio: 'inherit' });

    logger.log('Baking VK hashes...');
    execSync('npm run bake-vk-hashes', { cwd: verifyDir, stdio: 'inherit' });

    logger.log('Verifying integrity files match committed values...');
    try {
        execSync('git diff --exit-code -- src/integrity/', {
            cwd: verifyDir,
            stdio: 'pipe',
        });
        logger.log('Integrity verified: committed values match compiled output.');
    } catch {
        const diff = execSync('git diff -- src/integrity/', {
            cwd: verifyDir,
            encoding: 'utf8',
        });
        throw new Error(
            `Integrity files at '${tag}' do not match bake-vk-hashes output.\n` +
            `Committed VkHash/VkData files are stale or incorrect.\n` +
            `Diff:\n${diff}`
        );
    }

    const o1jsVersionInfo = readO1jsVersionInfo(verifyDir);

    const integrityDir = join(verifyDir, 'src', 'integrity');
    const contracts: ContractVkInfo[] = [];
    for (const file of ['NoriTokenBridge.VkHash.json', 'FungibleToken.VkHash.json']) {
        const filePath = join(integrityDir, file);
        if (existsSync(filePath)) {
            const hash = JSON.parse(readFileSync(filePath, 'utf8')) as string;
            contracts.push({ name: file.replace('.VkHash.json', ''), vkHash: hash });
        }
    }

    return { tag, o1jsVersionInfo, contracts, verifyDir };
}

export function cleanupVerifyDir(verifyDir: string): void {
    if (existsSync(verifyDir)) {
        rmSync(verifyDir, { recursive: true, force: true });
    }
}

export function cleanupAllVerifyDirs(): void {
    if (existsSync(CEREMONY_VERIFY_DIR)) {
        rmSync(CEREMONY_VERIFY_DIR, { recursive: true, force: true });
    }
}
