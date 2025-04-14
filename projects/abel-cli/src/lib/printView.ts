import { stringify } from "./util.js";

export async function printView<T>(
  aids: bigint[],
  viewName: string,
  fetcher: (bi: bigint[]) => any,
  sample = true,
  formatter = <K, V>(data: Map<K, V>): any => data.values()
) {
  console.warn("Fetching", aids.length, viewName, "view");
  try {
    const start = Date.now();
    const data = (await fetcher(aids)) as Map<string, any>;
    const end = Date.now();
    if (sample) {
      console.log("Sample:", formatter(data).next().value);
    } else {
      console.log(stringify(Array.from(formatter(data))));
    }
    console.warn(`Fetched ${aids.length} in `, end - start, "ms");
    console.warn("    ----");
  } catch (e) {
    console.error(e);
    console.error((e as Error).message);
  }
}
