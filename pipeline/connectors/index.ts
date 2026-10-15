import type { SourceId } from "../../shared/types.ts";
import { dbnomics } from "./dbnomics.ts";
import { eurostat } from "./eurostat.ts";
import { fred } from "./fred.ts";
import type { Connector } from "./types.ts";

export const connectors: Record<SourceId, Connector> = { fred, dbnomics, eurostat };
