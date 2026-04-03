import { formatO1jsVersionInfo } from '../versionInfo.js';
import {
    type CeremonyEventPayload,
    type JoinDkgPayload,
    type DkgCompletePayload,
    type VerifyAndSignPayload,
    type SigningCompletePayload,
    type TransactionSubmittedPayload,
    type TransactionConfirmedPayload,
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

export function formatDkgComplete(payload: DkgCompletePayload): string {
    return [
        '=== DKG Complete ===',
        `  Group: ${payload.description}`,
        `  Group public key: ${payload.groupPublicKey}`,
        '',
        'Add this to your .env:',
        '',
        `  ${payload.envVarLine}`,
    ].join('\n');
}

export function formatSigningComplete(payload: SigningCompletePayload): string {
    const header = formatOperationHeader(payload.operation);
    return [
        '=== Signing Complete ===',
        header,
        '',
        'All signatures collected. The coordinator is now submitting the transaction.',
    ].join('\n');
}

export function formatTransactionSubmitted(payload: TransactionSubmittedPayload): string {
    const header = formatOperationHeader(payload.operation);
    return [
        '=== Transaction Submitted ===',
        header,
        `  Transaction hash: ${payload.txHash}`,
        '',
        'Waiting for inclusion in a block.',
    ].join('\n');
}

export function formatTransactionConfirmed(payload: TransactionConfirmedPayload): string {
    const header = formatOperationHeader(payload.operation);
    return [
        '=== Transaction Confirmed ===',
        header,
        `  Transaction hash: ${payload.txHash}`,
        '',
        'Ceremony complete.',
    ].join('\n');
}

export function formatEvent(payload: CeremonyEventPayload): string {
    switch (payload.event) {
        case 'JoinDkg':
            return formatJoinDkg(payload);
        case 'DkgComplete':
            return formatDkgComplete(payload);
        case 'VerifyAndSign':
            return formatVerifyAndSign(payload);
        case 'SigningComplete':
            return formatSigningComplete(payload);
        case 'TransactionSubmitted':
            return formatTransactionSubmitted(payload);
        case 'TransactionConfirmed':
            return formatTransactionConfirmed(payload);
    }
}
