// Load environment variables from .env file
import 'dotenv/config';
import { execSync } from 'child_process';
import { createInterface } from 'readline';
import { mkdtempSync, rmSync } from 'fs';
import { tmpdir } from 'os';
import { join, resolve } from 'path';
import { Logger, LogPrinter } from 'esm-iso-logger';
import { rootDir } from '../path.js';

const logger = new Logger('MigrateVkToTag');

new LogPrinter('NoriTokenBridge');

function askYesNo(question: string): Promise<boolean> {
    const rl = createInterface({ input: process.stdin, output: process.stdout });
    return new Promise((resolve) => {
        rl.question(`${question} [y/N] `, (answer) => {
            rl.close();
            resolve(answer.trim().toLowerCase() === 'y');
        });
    });
}

/**
 * Returns the latest stable semver tag (ignoring prerelease suffixes like -rc.1, -beta, etc.)
 * sorted by version number, not by date. Returns undefined if no stable tags exist.
 */
function getLatestStableTag(): string | undefined {
    try {
        const raw = execSync('git tag --list', { encoding: 'utf8' }).trim();
        if (!raw) return undefined;
        const stablePattern = /^v?\d+\.\d+\.\d+$/;
        const stableTags = raw.split('\n').filter((t) => stablePattern.test(t.trim()));
        if (stableTags.length === 0) return undefined;
        stableTags.sort((a, b) => {
            const pa = a.replace(/^v/, '').split('.').map(Number);
            const pb = b.replace(/^v/, '').split('.').map(Number);
            for (let i = 0; i < 3; i++) {
                if (pa[i] !== pb[i]) return pa[i] - pb[i];
            }
            return 0;
        });
        return stableTags[stableTags.length - 1];
    } catch {
        return undefined;
    }
}

function getCurrentCheckout(): string {
    try {
        const tag = execSync('git describe --exact-match --tags HEAD 2>/dev/null', {
            encoding: 'utf8',
        }).trim();
        return `tag ${tag}`;
    } catch {
        try {
            const branch = execSync('git rev-parse --abbrev-ref HEAD', {
                encoding: 'utf8',
            }).trim();
            if (branch !== 'HEAD') return `branch ${branch}`;
        } catch { /* ignore */ }
        const sha = execSync('git rev-parse --short HEAD', { encoding: 'utf8' }).trim();
        return `detached commit ${sha}`;
    }
}

function isTag(ref: string): boolean {
    try {
        execSync(`git rev-parse "refs/tags/${ref}" 2>/dev/null`, { encoding: 'utf8' });
        return true;
    } catch {
        return false;
    }
}

const targetCommitish = process.argv[2];

if (!targetCommitish) {
    logger.fatal(
        'Missing required first argument: targetCommitish (git tag or commit SHA)'
    );
    process.exit(1);
}

// Get the remote URL of the current repo
let remoteUrl: string;
try {
    remoteUrl = execSync('git remote get-url origin', {
        encoding: 'utf8',
    }).trim();
} catch (e) {
    logger.fatal(`Failed to get git remote URL: ${(e as Error).message}`);
    process.exit(1);
}

logger.log(`Target commitish: '${targetCommitish}'`);
logger.log(`Remote URL: '${remoteUrl}'`);

// --- Pre-flight checks: help the user confirm they're on the right checkout ---

const currentCheckout = getCurrentCheckout();
const latestStableTag = getLatestStableTag();

logger.log(`You are currently checked out to: ${currentCheckout}`);

if (latestStableTag) {
    logger.log(`Latest stable tag: ${latestStableTag}`);
} else {
    logger.warn(
        'No stable semver tags found in this repository. ' +
        'This is unusual — make sure you know which version is currently deployed on-chain.'
    );
    if (!await askYesNo('No tags found. Are you sure you want to continue?')) {
        logger.log('Aborted by user.');
        process.exit(0);
    }
}

if (!isTag(targetCommitish)) {
    logger.warn(
        `'${targetCommitish}' is not a tag — it looks like a branch or commit SHA. ` +
        'While this works, migrating to a non-tagged commitish is not recommended. ' +
        'Tags provide a clear audit trail for what was deployed. Consider tagging a release first.'
    );
    if (!await askYesNo('Target is not a tag. Do you want to continue anyway?')) {
        logger.log('Aborted by user.');
        process.exit(0);
    }
}

logger.log('');
logger.log('=== IMPORTANT ===');
logger.log(
    `This will generate a proof using your CURRENT checkout (${currentCheckout}) — ` +
    'which must be the version currently deployed on-chain — and replace the on-chain ' +
    `verification key with the one compiled from '${targetCommitish}'.`
);
logger.log(
    'If your current checkout does NOT match what is deployed on-chain, ' +
    'the proof will be invalid and the transaction will be rejected.'
);
logger.log('=================');
logger.log('');

if (!await askYesNo('Do you want to proceed?')) {
    logger.log('Aborted by user.');
    process.exit(0);
}

const tmpDir = mkdtempSync(join(tmpdir(), 'nori-migrate-vk-'));
logger.log(`Created tmp directory: '${tmpDir}'`);

function cleanup() {
    try {
        rmSync(tmpDir, { recursive: true });
        logger.log(`Cleaned up tmp directory: '${tmpDir}'`);
    } catch (e) {
        logger.warn(
            `Failed to clean up tmp directory '${tmpDir}': ${(e as Error).message}`
        );
    }
}

try {
    // Clone and checkout target commitish
    logger.log('Cloning repository...');
    execSync(`git clone "${remoteUrl}" "${tmpDir}"`, { stdio: 'inherit' });
    execSync(`git -C "${tmpDir}" checkout "${targetCommitish}"`, {
        stdio: 'inherit',
    });

    // Install dependencies at the monorepo root
    logger.log('Installing dependencies...');
    execSync('npm ci', { cwd: tmpDir, stdio: 'inherit' });

    // Run bake-vk-hashes in the mina-token-bridge package
    const tmpTokenBridgeDir = join(
        tmpDir,
        'contracts',
        'mina',
        'mina-token-bridge'
    );
    logger.log('Baking VK hashes in target commitish...');
    execSync('npm run bake-vk-hashes', {
        cwd: tmpTokenBridgeDir,
        stdio: 'inherit',
    });

    // Verify the integrity files were not mutated
    logger.log(
        'Verifying integrity files match committed values for this commitish...'
    );
    try {
        execSync(
            'git diff --exit-code -- contracts/mina/mina-token-bridge/src/integrity/',
            { cwd: tmpDir, stdio: 'pipe' }
        );
        logger.log(
            'Integrity files verified: committed values match compiled output.'
        );
    } catch {
        const diff = execSync(
            'git diff -- contracts/mina/mina-token-bridge/src/integrity/',
            { cwd: tmpDir, encoding: 'utf8' }
        );
        logger.fatal(
            [
                `The integrity files committed at '${targetCommitish}' do not match the output of bake-vk-hashes.`,
                `This means the VkHash.json or VkData.json committed at that tag are stale or incorrect.`,
                `The migration cannot proceed safely.`,
                `Diff:\n${diff}`,
            ].join('\n')
        );
        cleanup();
        process.exit(1);
    }

    // Derive paths to integrity files in the tmp clone
    const vkDataPath = join(
        tmpTokenBridgeDir,
        'src',
        'integrity',
        'NoriTokenBridge.VkData.json'
    );
    const vkHashPath = join(
        tmpTokenBridgeDir,
        'src',
        'integrity',
        'NoriTokenBridge.VkHash.json'
    );

    logger.log(`VkData path: '${vkDataPath}'`);
    logger.log(`VkHash path: '${vkHashPath}'`);

    // Run update-vk from the current checkout, pointing at the target integrity files
    const packageRoot = resolve(rootDir, '..'); // Relative to build
    logger.log('Running update-vk against target integrity files...');
    execSync(`npm run update-vk -- "${vkDataPath}" "${vkHashPath}"`, {
        cwd: packageRoot,
        stdio: 'inherit',
    });

    cleanup();
    logger.log('VK migration complete.');
} catch (e) {
    logger.fatal(`Migration failed: ${(e as Error).message}`);
    cleanup();
    process.exit(1);
}
