import { readFileSync } from 'fs';
import { join } from 'path';

export type O1jsVersionInfo = {
    dependencySpec: string;
    lockedResolution: string;
    lockedIntegrity: string;
    installedVersion: string;
};

export function readO1jsVersionInfo(projectDir: string): O1jsVersionInfo {
    const pkgJson = JSON.parse(readFileSync(join(projectDir, 'package.json'), 'utf8')) as {
        dependencies?: Record<string, string>;
        peerDependencies?: Record<string, string>;
        devDependencies?: Record<string, string>;
    };
    const dependencySpec =
        pkgJson.peerDependencies?.['o1js'] ??
        pkgJson.dependencies?.['o1js'] ??
        pkgJson.devDependencies?.['o1js'] ??
        '<not found in package.json>';

    const lockJson = JSON.parse(readFileSync(join(projectDir, 'package-lock.json'), 'utf8')) as {
        packages?: Record<string, { version?: string; resolved?: string; integrity?: string }>;
    };
    const lockedEntry = lockJson.packages?.['node_modules/o1js'];
    const lockedResolution = lockedEntry?.resolved ?? '<not found in package-lock.json>';
    const lockedIntegrity = lockedEntry?.integrity ?? '<not found in package-lock.json>';

    let installedVersion: string;
    try {
        const installedPkg = JSON.parse(
            readFileSync(join(projectDir, 'node_modules', 'o1js', 'package.json'), 'utf8')
        ) as { version?: string };
        installedVersion = installedPkg.version ?? '<version field missing>';
    } catch {
        installedVersion = '<node_modules/o1js not found — run npm ci>';
    }

    return { dependencySpec, lockedResolution, lockedIntegrity, installedVersion };
}

export function formatO1jsVersionInfo(info: O1jsVersionInfo): string {
    return [
        '=== o1js Version Info ===',
        `Dependency (package.json):          ${info.dependencySpec}`,
        `Locked Resolution (package-lock):   ${info.lockedResolution}`,
        `Locked Integrity (package-lock):    ${info.lockedIntegrity}`,
        `Installed Version (node_modules):   ${info.installedVersion}`,
    ].join('\n');
}
