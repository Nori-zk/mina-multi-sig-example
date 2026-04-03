import { type O1jsVersionInfo } from '../versionInfo.js';

// --- Operation types ---

export type DeployOperation = {
    kind: 'deploy';
    tag: string;
    adminGroupPublicKey: string;
    tokenGroupPublicKey: string;
};

export type UpdateVkOperation = {
    kind: 'updateVk';
    fromTag: string;
    toTag: string;
    adminGroupPublicKey: string;
};

export type Operation = DeployOperation | UpdateVkOperation;

// --- Shared types ---

export type ContractVkInfo = {
    name: string;
    vkHash: string;
};

export type TagInfo = {
    tag: string;
    o1jsVersionInfo: O1jsVersionInfo;
    contracts: ContractVkInfo[];
};

// --- Event payloads ---

export type JoinDkgPayload = {
    event: 'JoinDkg';
    description: string;
    threshold: number;
    command: string;
};

export type DkgCompletePayload = {
    event: 'DkgComplete';
    description: string;
    groupPublicKey: string;
    envVarLine: string;
};

export type VerifyAndSignPayload = {
    event: 'VerifyAndSign';
    operation: Operation;
    txJsonPath: string;
    tags: TagInfo[];
    signingGroups: { groupName: string; groupPublicKey: string }[];
    command: string;
};

export type SigningCompletePayload = {
    event: 'SigningComplete';
    operation: Operation;
};

export type TransactionSubmittedPayload = {
    event: 'TransactionSubmitted';
    operation: Operation;
    txHash: string;
};

export type TransactionConfirmedPayload = {
    event: 'TransactionConfirmed';
    operation: Operation;
    txHash: string;
};

export type CeremonyEventPayload =
    | JoinDkgPayload
    | DkgCompletePayload
    | VerifyAndSignPayload
    | SigningCompletePayload
    | TransactionSubmittedPayload
    | TransactionConfirmedPayload;
