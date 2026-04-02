import { formatO1jsVersionInfo } from '../versionInfo.js';
import {
    type CeremonyEventPayload,
    type JoinDkgPayload,
    type VerifyAndSignPayload,
    type TagInfo,
} from './events.js';

function formatTagInfo(tag: TagInfo): string {
    const lines = [
        `  Tag: ${tag.tag}`,
        formatO1jsVersionInfo(tag.o1jsVersionInfo)
            .split('\n')
            .map((l) => `  ${l}`)
            .join('\n'),
        '  Contracts:',
        ...tag.contracts.map((c) => `    ${c.name}: ${c.vkHash}`),
    ];
    return lines.join('\n');
}

function formatOperationHeader(op: VerifyAndSignPayload['operation']): string {
    switch (op.kind) {
        case 'deploy':
            return `[Deploy] tag: ${op.tag}`;
        case 'updateVk':
            return `[UpdateVK] from: ${op.fromTag} → to: ${op.toTag}`;
    }
}

export function formatJoinDkg(payload: JoinDkgPayload): string {
    return [
        '=== Action Required: Join DKG Session ===',
        `  Description: ${payload.description}`,
        `  Threshold: ${payload.threshold}`,
        '',
        'Run:',
        '',
        `  ${payload.command}`,
    ].join('\n');
}

export function formatVerifyAndSign(payload: VerifyAndSignPayload): string {
    const header = formatOperationHeader(payload.operation);
    return [
        '=== Action Required: Verify Code and Sign ===',
        header,
        `  Transaction: ${payload.txJsonPath}`,
        '',
        ...payload.tags.map((tag) => formatTagInfo(tag)),
        '',
        '  Signing groups:',
        ...payload.signingGroups.map(
            (g) => `    ${g.groupName}: ${g.groupPublicKey}`
        ),
        '',
        'Run:',
        '',
        `  ${payload.command}`,
    ].join('\n');
}

export function formatEvent(payload: CeremonyEventPayload): string {
    switch (payload.event) {
        case 'JoinDkg':
            return formatJoinDkg(payload);
        case 'VerifyAndSign':
            return formatVerifyAndSign(payload);
    }
}
