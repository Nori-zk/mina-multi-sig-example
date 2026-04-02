import { appendFileSync, existsSync, mkdirSync, readFileSync } from 'fs';
import { dirname, resolve } from 'path';
import { type O1jsVersionInfo } from './versionInfo.js';
import { type DeployOperation, type UpdateVkOperation } from './notifications/events.js';
import { rootDir } from './path.js';

const HISTORY_FILE = resolve(rootDir, '..', 'ceremony', 'history.jsonl');

export type DeployHistoryEntry = {
    operation: DeployOperation;
    timestamp: string;
    txHash: string;
    vkHashes: { name: string; vkHash: string }[];
    o1jsVersionInfo: O1jsVersionInfo;
};

export type UpdateVkHistoryEntry = {
    operation: UpdateVkOperation;
    timestamp: string;
    txHash: string;
    fromVkHashes: { name: string; vkHash: string }[];
    toVkHashes: { name: string; vkHash: string }[];
    fromO1jsVersionInfo: O1jsVersionInfo;
    toO1jsVersionInfo: O1jsVersionInfo;
};

export type HistoryEntry = DeployHistoryEntry | UpdateVkHistoryEntry;

export function appendHistoryEntry(entry: HistoryEntry): void {
    const dir = dirname(HISTORY_FILE);
    if (!existsSync(dir)) {
        mkdirSync(dir, { recursive: true });
    }
    appendFileSync(HISTORY_FILE, JSON.stringify(entry) + '\n', 'utf8');
}

export function readHistory(): HistoryEntry[] {
    if (!existsSync(HISTORY_FILE)) {
        return [];
    }
    const content = readFileSync(HISTORY_FILE, 'utf8').trim();
    if (!content) {
        return [];
    }
    return content.split('\n').map((line) => JSON.parse(line) as HistoryEntry);
}

export function getHistoryFilePath(): string {
    return HISTORY_FILE;
}
