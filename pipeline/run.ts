// CLI for the data refresh. Used by the GitHub Actions workflow and `npm run refresh`.
//   node pipeline/run.ts [--tier scheduled|all|daily|weekly|monthly] [--only US.I1,EA.R2] [--today YYYY-MM-DD]

import { appendFileSync } from "node:fs";
import path from "node:path";
import { parseArgs } from "node:util";
import { runPipeline } from "./pipeline.ts";

const { values } = parseArgs({
  options: {
    tier: { type: "string", default: "all" },
    only: { type: "string", default: "" },
    today: { type: "string" },
  },
});

const only = (values.only ?? "").split(",").map((s) => s.trim()).filter(Boolean);
const summary = await runPipeline({
  root: path.resolve(import.meta.dirname, ".."),
  tier: values.tier ?? "all",
  only,
  today: values.today,
  env: process.env,
  trigger: process.env.GITHUB_EVENT_NAME ?? "local",
  log: (line) => console.log(line),
}).catch((err: Error) => {
  // Configuration or argument problems: nothing was fetched or written.
  console.error(`Refresh did not start: ${err.message}`);
  process.exit(2);
});

if (process.env.GITHUB_STEP_SUMMARY) {
  const lines = [
    `### Data refresh: ${summary.ok} ok, ${summary.failed} failed`,
    "",
    `${summary.attempted} series attempted · ${summary.new_rows} new rows · ${summary.revised_rows} revisions`,
    ...(summary.failures.length ? ["", "| Series | Error |", "| --- | --- |", ...summary.failures.map((f) => `| ${f.series} | ${f.error.replace(/\|/g, "/")} |`)] : []),
    "",
  ];
  appendFileSync(process.env.GITHUB_STEP_SUMMARY, lines.join("\n"));
}

// Partial failures are shown on the Data Status page; only a run where nothing worked fails the job.
if (summary.attempted > 0 && summary.ok === 0) process.exitCode = 1;
