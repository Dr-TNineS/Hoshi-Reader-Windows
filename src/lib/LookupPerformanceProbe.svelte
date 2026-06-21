<script lang="ts">
  import { onMount } from "svelte";
  import { LookupResultCache } from "./lookup-result-cache";

  let ready = $state(false);
  let error = $state("");
  let concurrentShared = $state(false);
  let normalized = $state(false);
  let failedReloaded = $state(false);
  let lruEvicted = $state(false);
  let clearReloaded = $state(false);

  onMount(() => {
    void run();
  });

  async function run() {
    try {
      const cache = new LookupResultCache<string>(2);
      let loadCount = 0;
      let resolveShared: ((value: string[]) => void) | undefined;
      const sharedLoader = (text: string) => {
        loadCount += 1;
        return new Promise<string[]>((resolve) => {
          resolveShared = resolve;
        }).then((values) => values.map((value) => `${text}:${value}`));
      };
      const first = cache.get(" school ", sharedLoader);
      const second = cache.get("school", sharedLoader);
      concurrentShared = first.promise === second.promise && !first.cacheHit && second.cacheHit;
      await Promise.resolve();
      resolveShared?.(["ready"]);
      const [firstResult, secondResult] = await Promise.all([first.promise, second.promise]);
      normalized = loadCount === 1 && firstResult[0] === "school:ready" && secondResult[0] === "school:ready";

      let failureCount = 0;
      await cache.get("failure", async () => {
        failureCount += 1;
        throw new Error("probe failure");
      }).promise.catch(() => undefined);
      await cache.get("failure", async () => {
        failureCount += 1;
        return ["recovered"];
      }).promise;
      failedReloaded = failureCount === 2;

      cache.clear();
      const loads = new Map<string, number>();
      const loader = async (text: string) => {
        loads.set(text, (loads.get(text) ?? 0) + 1);
        return [text];
      };
      await cache.get("a", loader).promise;
      await cache.get("b", loader).promise;
      await cache.get("a", loader).promise;
      await cache.get("c", loader).promise;
      await cache.get("b", loader).promise;
      lruEvicted = loads.get("a") === 1 && loads.get("b") === 2 && cache.size === 2;

      cache.clear();
      await cache.get("a", loader).promise;
      clearReloaded = loads.get("a") === 2;
      ready = true;
    } catch (cause) {
      error = cause instanceof Error ? cause.message : String(cause);
    }
  }
</script>

<main
  class="probe-state"
  data-ready={ready}
  data-error={error}
  data-concurrent-shared={concurrentShared}
  data-normalized={normalized}
  data-failed-reloaded={failedReloaded}
  data-lru-evicted={lruEvicted}
  data-clear-reloaded={clearReloaded}
>Lookup performance probe</main>
