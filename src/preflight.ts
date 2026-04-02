import { execSync } from 'child_process';
import { createInterface } from 'readline';

export function askYesNo(question: string): Promise<boolean> {
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
export function getLatestStableTag(): string | undefined {
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

export function getCurrentCheckout(): string {
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

export function isTag(ref: string): boolean {
    try {
        execSync(`git rev-parse "refs/tags/${ref}" 2>/dev/null`, { encoding: 'utf8' });
        return true;
    } catch {
        return false;
    }
}

export function refExists(ref: string): boolean {
    try {
        execSync(`git rev-parse --verify "${ref}" 2>/dev/null`, { encoding: 'utf8' });
        return true;
    } catch {
        return false;
    }
}

export function getRemoteUrl(): string {
    return execSync('git remote get-url origin', { encoding: 'utf8' }).trim();
}

/**
 * Validates a tag/commitish for ceremony use. Hard fails on missing refs and checkout mismatches.
 * Warns with y/N only if the ref is not a tag (commitish).
 */
export async function validateTagForCeremony(
    ref: string,
    label: string,
    logger: { log: (msg: string) => void; warn: (msg: string) => void },
    options: { checkCheckoutMatch: boolean } = { checkCheckoutMatch: true }
): Promise<void> {
    if (!refExists(ref)) {
        throw new Error(`${label} '${ref}' does not exist as a git ref.`);
    }

    if (options.checkCheckoutMatch) {
        const currentCheckout = getCurrentCheckout();
        const currentTag = currentCheckout.startsWith('tag ')
            ? currentCheckout.slice(4)
            : null;
        const currentBranch = currentCheckout.startsWith('branch ')
            ? currentCheckout.slice(7)
            : null;
        const currentSha = currentCheckout.startsWith('detached commit ')
            ? currentCheckout.slice(16)
            : null;

        const refMatches = currentTag === ref || currentBranch === ref || currentSha === ref;
        if (!refMatches) {
            throw new Error(
                `${label} '${ref}' does not match current checkout (${currentCheckout}). ` +
                `You must be checked out to '${ref}'.`
            );
        }
    }

    if (!isTag(ref)) {
        logger.warn(
            `${label} '${ref}' is not a tag — it looks like a branch or commit SHA. ` +
            'While this works, using a non-tagged commitish is not recommended. ' +
            'Tags provide a clear audit trail. Consider tagging a release first.'
        );
        if (!await askYesNo(`${label} is not a tag. Continue anyway?`)) {
            throw new Error('Aborted by user.');
        }
    }
}
