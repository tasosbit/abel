import { abel } from "./config.js";
import { die } from "./util.js";

export async function wrapAction<T extends Array<any>>(name: string, args: T, actionFn: (...args: any[]) => Promise<any>) {
  if (args.some((a) => a === undefined)) {
    die(`${name}\nError: provide ${args.length} arguments`);
  }
  try {
    console.warn(name, "with", args);
    await actionFn.apply(abel, args);
  } catch (e) {
    console.log(`    ----\nError message: ${(e as Error).message}`);
  }
}
