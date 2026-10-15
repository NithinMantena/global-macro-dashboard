import { useEffect, useState } from "react";
import type { StatusBundle } from "../../shared/types.ts";

type State = { data: StatusBundle | null; error: string | null };

let cache: Promise<StatusBundle> | null = null;

function load(): Promise<StatusBundle> {
  cache ??= fetch(`${import.meta.env.BASE_URL}data/status.json`, { cache: "no-cache" }).then((r) => {
    if (!r.ok) throw new Error(`Could not load data (HTTP ${r.status})`);
    return r.json() as Promise<StatusBundle>;
  });
  return cache;
}

/** The status bundle built from the repository's data folder at deploy time. */
export function useStatus(): State {
  const [state, setState] = useState<State>({ data: null, error: null });
  useEffect(() => {
    let live = true;
    load().then(
      (data) => live && setState({ data, error: null }),
      (err: Error) => live && setState({ data: null, error: err.message }),
    );
    return () => {
      live = false;
    };
  }, []);
  return state;
}
