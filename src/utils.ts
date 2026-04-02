import {
  Bytes,
  Field,
  type ProvableType,
  Struct,
  UInt8,
  VerificationKey,
  type SmartContract,
  type Cache,
} from 'o1js';
import { type Tuple } from 'o1js/dist/node/lib/util/types.js';
import {
  type PrivateInput,
  type ZkProgram as ZkProgramFunc,
} from 'o1js/dist/node/lib/proof-system/zkprogram.js';

import { type Logger } from 'esm-iso-logger';

import { stat, mkdir } from 'fs/promises'; 
import { homedir } from 'os';
import path, { resolve } from 'path';
import { mkdirSync, statSync } from 'fs';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type Constructor<T = unknown> = new (...args: any[]) => T;

export type ZkProgram<
  Config extends {
    publicInput?: ProvableType;
    publicOutput?: ProvableType;
    methods: {
      [I in string]: {
        privateInputs: Tuple<PrivateInput>;
        auxiliaryOutput?: ProvableType;
      };
    };
  },
> = ReturnType<typeof ZkProgramFunc<Config>>;

export type CompilableZkProgram = {
  compile: (options?: unknown) => Promise<{
    verificationKey: {
      data: string;
      hash: Field;
    };
  }>;
};

// Compile and verify contracts utility

// Deprecate this!
export async function compileAndVerifyContracts(
  logger: Logger,
  contracts: {
    name: string;
    program: typeof SmartContract | CompilableZkProgram; // Ideally we would use CompilableZkProgram
    integrityHash: string;
  }[]
) {
  try {
    const results: Record<
      string,
      {
        data: string;
        hash: Field;
      }
    > = {};
    const mismatches: string[] = [];

    for (const { name, program, integrityHash } of contracts) {
      logger.log(`Compiling ${name} contract.`);
      const timer = createTimer();
      const compiled = await program.compile();
      logger.log(`${name} compiled in ${timer()}`);
      const verificationKey = compiled.verificationKey;
      const calculatedHash = verificationKey.hash.toString();

      logger.log(`${name} contract vk hash compiled: '${calculatedHash}'`);

      results[`${name}VerificationKey`] = verificationKey;

      if (calculatedHash !== integrityHash) {
        mismatches.push(
          `${name}: Computed hash '${calculatedHash}' ` +
            `doesn't match expected hash '${integrityHash}'`
        );
      }
    }

    if (mismatches.length > 0) {
      const errorMessage = [
        'Verification key hash mismatch detected:',
        ...mismatches,
        '',
        `Refusing to start. Try clearing your o1js cache directory, typically found at '~/.cache/o1js'. Or do you need to run 'npm run bake-vk-hashes' in the eth-processor or o1js-zk-utils nori-bridge-sdk folder and commit the change?`,
      ].join('\n');

      throw new Error(errorMessage);
    }

    logger.log('All contracts compiled and verified successfully.');
    return results;
  } catch (err) {
    logger.error(`Error compiling contracts:\n${String(err)}`);
    logger.error((err as Error).stack);
    throw err;
  }
}

export type VerificationKeySafe = {
  hashStr: string;
  data: string;
};

export function vkToVkSafe(vk: VerificationKey): VerificationKeySafe {
  const { data, hash } = vk;
  return {
    hashStr: hash.toBigInt().toString(),
    data,
  };
}

export function vkSafeToVk(vkSafe: VerificationKeySafe): VerificationKey {
  return {
    data: vkSafe.data,
    hash: new Field(BigInt(vkSafe.hashStr)),
  };
}

/**
 * Compiles a list of SmartContracts or CompilableZkPrograms and optionally verifies their
 * verification key hashes against provided integrity hashes.
 *
 * @template T - An array of contract descriptors. Each descriptor must include:
 *  - `name`: The contract/program name (used as a key for the returned verification key).
 *  - `program`: Either a `SmartContract` class or a `CompilableZkProgram`.
 *  - `integrityHash` (optional): The expected verification key hash to validate against.
 *
 * @param logger - Logger object with a `.log(string)` method for outputting progress messages.
 *                 Type: `{ log: (msg: string) => void }`.
 * @param contracts - Array of contract/program descriptors to compile and optionally verify.
 * @param cacheConfig - Optional cache configuration (`FileSystem` or `Network`) to use during compilation.
 *
 * @returns A Promise resolving to an object mapping each contract name to its `VerificationKey`.
 *          Keys are of the form `${name}VerificationKey`.
 *
 * @throws Will throw an Error if any computed verification key hash does not match
 *         its expected `integrityHash`, including a helpful message on clearing the cache
 *         or regenerating verification keys.
 *
 * Example usage:
 * ```ts
 * const vks = await compileAndOptionallyVerifyContracts(
 *   { log: console.log },
 *   [
 *     { name: 'MyContract', program: MyContract, integrityHash: '12345' },
 *     { name: 'MyProgram', program: MyZkProgram },
 *   ],
 *   cacheConfig
 * );
 * ```
 */
export async function compileAndOptionallyVerifyContracts<
  T extends readonly {
    name: string;
    program: typeof SmartContract | CompilableZkProgram;
    integrityHash?: string;
  }[],
>(
  logger: { log: (msg: string) => void },
  contracts: T,
  cache?: Cache
  //cacheConfig?: CacheConfig
): Promise<{
  [K in T[number]['name'] as `${K}VerificationKey`]: VerificationKey;
}> {
  type ReturnMap = {
    [K in T[number]['name'] as `${K}VerificationKey`]: VerificationKey;
  };

  //const cache = !cacheConfig ? undefined: await cacheFactory(cacheConfig);

  const entries: Array<[keyof ReturnMap, VerificationKey]> = [];
  const mismatches: string[] = [];

  for (const c of contracts) {
    const { name, program, integrityHash } = c;

    logger.log(`Compiling ${name} contract/program.`);
    const timer = createTimer();
    const compiled = await (cache ? program.compile({ cache }) : program.compile());
    logger.log(`${name} compiled in ${timer()}`);

    const vk = compiled.verificationKey;
    const hashStr = vk.hash.toBigInt().toString();

    logger.log(`${name} contract/program vk hash compiled: '${hashStr}'`);

    // Validate only if integrityHash is provided
    if (integrityHash && hashStr !== integrityHash) {
      mismatches.push(
        `${name}: Computed hash '${hashStr}' doesn't match expected hash '${integrityHash}'`
      );
    }

    const mappedKey = `${name}VerificationKey` as keyof ReturnMap;
    entries.push([mappedKey, vk]);
  }

  if (mismatches.length > 0) {
    const errorMessage = [
      'Verification key hash mismatch detected:',
      ...mismatches,
      '',
      `Refusing to start. Try clearing your o1js cache directory, typically found at '~/.cache/o1js'. Or do you need to run 'npm run bake-vk-hashes' and commit the changes?`,
    ].join('\n');

    throw new Error(errorMessage);
  }

  logger.log('All contracts compiled successfully.');

  return Object.fromEntries(entries) as ReturnMap;
}

// Timing utilities to replace console.time/timeEnd
export function createTimer() {
  const start = Date.now();
  return () => formatDuration(Date.now() - start);
}

export function formatDuration(ms: number): string {
  if (ms < 1000) return `${ms}ms`;
  if (ms < 60000) return `${(ms / 1000).toFixed(2)}s`;
  const minutes = Math.floor(ms / 60000);
  const seconds = ((ms % 60000) / 1000).toFixed(2);
  return `${minutes}m ${seconds}s`;
}

// Paths and folders

const expand = (p: string) => p.replace(/^~/, homedir());

export const getAbsolutePath = (p: string) => resolve(expand(p));

export const checkDirectory = (p: string): string | null => {
    try {
        return statSync(p).isDirectory() ? p : null;
    } catch {
        return null;
    }
};

export const ensureDirectory = (p: string): string => {
  const abs = getAbsolutePath(p);
  mkdirSync(abs, { recursive: true });
  return abs;
};

// Byte conversion utilities

export const bytesToHex = (bytes: Uint8Array): string => Buffer.from(bytes).toString('hex');

export const hexToBytes = (hex: string): Uint8Array => Buffer.from(hex, 'hex');