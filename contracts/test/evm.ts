/**
 * A tiny in-process EVM harness (@ethereumjs/vm) so the contracts can be exercised from Vitest
 * without Foundry. Each transaction is mined in its own block (like the mock chain), so
 * commit → reveal always spans two blocks.
 */
import { createBlock } from '@ethereumjs/block';
import { Common, Hardfork, Mainnet } from '@ethereumjs/common';
import { createLegacyTx } from '@ethereumjs/tx';
import { Account, createAddressFromPrivateKey, createAddressFromString, bytesToHex, hexToBytes } from '@ethereumjs/util';
import { createVM, runTx, type VM } from '@ethereumjs/vm';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  decodeErrorResult,
  decodeEventLog,
  decodeFunctionResult,
  encodeDeployData,
  encodeFunctionData,
  type Abi,
  type Hex,
} from 'viem';
import { privateKeyToAccount } from 'viem/accounts';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
export const artifact = (name: string) =>
  JSON.parse(readFileSync(join(root, 'artifacts', `${name}.json`), 'utf8')) as { abi: Abi; bytecode: Hex };

export interface TxOut {
  ok: boolean;
  error: string | null;
  logs: { eventName: string; args: Record<string, unknown> }[];
  created: Hex | null;
}

export class Evm {
  block = 1n;
  time = 1_800_000_000n;
  private constructor(
    readonly vm: VM,
    readonly common: Common,
  ) {}

  static async create() {
    const common = new Common({ chain: Mainnet, hardfork: Hardfork.Cancun });
    const vm = await createVM({ common });
    return new Evm(vm, common);
  }

  async fund(pk: Hex) {
    const addr = createAddressFromPrivateKey(hexToBytes(pk));
    await this.vm.stateManager.putAccount(addr, new Account(0n, 10n ** 24n));
    return privateKeyToAccount(pk).address;
  }

  warp(seconds: bigint) {
    this.time += seconds;
  }

  private header() {
    return createBlock(
      { header: { number: this.block, timestamp: this.time, gasLimit: 30_000_000n, baseFeePerGas: 7n } },
      { common: this.common },
    );
  }

  async send(pk: Hex, to: Hex | null, data: Hex, abis: Abi[] = []): Promise<TxOut> {
    const from = createAddressFromPrivateKey(hexToBytes(pk));
    const nonce = (await this.vm.stateManager.getAccount(from))?.nonce ?? 0n;
    const tx = createLegacyTx(
      { nonce, gasPrice: 10n, gasLimit: 12_000_000n, to: to ?? undefined, data: hexToBytes(data) },
      { common: this.common },
    ).sign(hexToBytes(pk));
    const block = this.header();
    this.block++;
    this.time += 1n;
    const res = await runTx(this.vm, { tx, block, skipBlockGasLimitValidation: true });
    const err = res.execResult.exceptionError;
    if (err) {
      const ret = bytesToHex(res.execResult.returnValue) as Hex;
      let reason = err.error;
      for (const abi of abis) {
        try {
          reason = decodeErrorResult({ abi, data: ret }).errorName;
          break;
        } catch {
          /* try the next abi */
        }
      }
      return { ok: false, error: reason, logs: [], created: null };
    }
    const logs: TxOut['logs'] = [];
    for (const [, topics, logData] of res.receipt.logs) {
      for (const abi of abis) {
        try {
          const d = decodeEventLog({ abi, topics: topics.map((t) => bytesToHex(t)) as [Hex, ...Hex[]], data: bytesToHex(logData) as Hex });
          logs.push({ eventName: d.eventName as string, args: d.args as Record<string, unknown> });
          break;
        } catch {
          /* not this abi */
        }
      }
    }
    return { ok: true, error: null, logs, created: res.createdAddress ? (res.createdAddress.toString() as Hex) : null };
  }

  async deploy(pk: Hex, name: string, args: unknown[]) {
    const a = artifact(name);
    const out = await this.send(pk, null, encodeDeployData({ abi: a.abi, bytecode: a.bytecode, args }), [a.abi]);
    if (!out.ok || !out.created) throw new Error(`deploy ${name} failed: ${out.error}`);
    return new Contract(this, out.created, a.abi);
  }
}

export class Contract {
  constructor(
    readonly evm: Evm,
    readonly address: Hex,
    readonly abi: Abi,
  ) {}

  write(pk: Hex, functionName: string, args: unknown[] = []) {
    return this.evm.send(pk, this.address, encodeFunctionData({ abi: this.abi, functionName, args } as never), [this.abi]);
  }

  async read<T = unknown>(functionName: string, args: unknown[] = []): Promise<T> {
    const data = encodeFunctionData({ abi: this.abi, functionName, args } as never);
    const res = await this.evm.vm.evm.runCall({
      to: createAddressFromString(this.address),
      data: hexToBytes(data),
      block: createBlock({ header: { number: this.evm.block, timestamp: this.evm.time } }, { common: this.evm.common }),
    });
    if (res.execResult.exceptionError) throw new Error(`read ${functionName} reverted`);
    return decodeFunctionResult({ abi: this.abi, functionName, data: bytesToHex(res.execResult.returnValue) as Hex } as never) as T;
  }
}
