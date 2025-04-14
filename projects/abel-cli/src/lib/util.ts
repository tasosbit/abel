import { AlgorandClient } from "@algorandfoundation/algokit-utils";

export function die(msg: string) {
  console.error(msg);
  process.exit(1);
}

export async function accountFromMnemonic(algorand: AlgorandClient, mnem: string) {
  try {
    return algorand.account.fromMnemonic(mnem);
  } catch (e) {
    die(`Mnemonic was invalid - ${(e as Error).message}`);
  }
}

export function chunk<T>(array: T[], chunkSize: number): T[][] {
  if (chunkSize <= 0) {
    throw new Error("Chunk size must be greater than 0");
  }

  const result: T[][] = [];

  for (let i = 0; i < array.length; i += chunkSize) {
    result.push(array.slice(i, i + chunkSize));
  }

  return result;
}

export function stringify(obj: any): string {
  return JSON.stringify(obj, (_key, value) => (typeof value === "bigint" ? value.toString() + "n" : value));
}

export function parseArgs<T extends ((arg: string) => any)[]>(...types: T): { [K in keyof T]: ReturnType<T[K]> } {
  const argv = process.argv.slice(2);
  return types.map((typeFn, idx) => argv[idx] === undefined ? undefined : typeFn(argv[idx])) as { [K in keyof T]: ReturnType<T[K]> };
}

export const parseArgvBigints = () => {
  const aids = process.argv.slice(2).map(n => BigInt(n));
  if (!aids.length) {
    die("Provide asset IDs as arguments");
  }
  return aids
}

export async function sleep(ms: number) {
  return new Promise(resolve => setTimeout(resolve, ms));
}


