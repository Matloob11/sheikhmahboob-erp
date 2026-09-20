import { useEffect, useState } from "react";

const bus = new EventTarget();

export function notifyDb(): void {
  bus.dispatchEvent(new Event("change"));
}

export function useDbVersion(): number {
  const [version, setVersion] = useState(0);
  useEffect(() => {
    const onChange = () => setVersion((value) => value + 1);
    bus.addEventListener("change", onChange);
    return () => bus.removeEventListener("change", onChange);
  }, []);
  return version;
}

export function useLiveState<T>(
  loader: () => Promise<T>,
  fallback: T,
  deps: ReadonlyArray<unknown> = [],
): { data: T; ready: boolean; error: string | null } {
  const version = useDbVersion();
  const [data, setData] = useState<T>(fallback);
  const [ready, setReady] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    void loader()
      .then((value) => {
        if (active) {
          setData(value);
          setError(null);
          setReady(true);
        }
      })
      .catch((err: unknown) => {
        if (active) {
          setError(err instanceof Error ? err.message : "Could not read the desk.");
          setReady(true);
        }
      });
    return () => {
      active = false;
    };
    // loader is recreated by callers; deps + version are the refresh contract
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [version, ...deps]);

  return { data, ready, error };
}

export function useLive<T>(
  loader: () => Promise<T>,
  fallback: T,
  deps: ReadonlyArray<unknown> = [],
): T {
  return useLiveState(loader, fallback, deps).data;
}
