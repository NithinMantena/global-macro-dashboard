import { Link } from "react-router-dom";
import { useStatus } from "../lib/useStatus.ts";

export function Home() {
  const { data } = useStatus();
  const healthy = data?.series.filter((s) => s.status.result === "ok" && !s.derived?.stale).length ?? 0;
  return (
    <section className="page home">
      <p className="eyebrow">Phase 0 · Foundations</p>
      <h1>Where the world economy stands, without the noise.</h1>
      <p className="lede">
        This dashboard will show about 30 indicators across 15 economies, each with its history, its direction and where it
        sits against its own past, and explain every number in plain English.
      </p>
      <div className="panel">
        <h2>What is live now</h2>
        <p>
          The data pipeline. Every day at 06:00 UTC a GitHub Action fetches the starter series from public sources, stores
          them in this site's repository with a full revision history, and works out each series' trend and historical
          percentile.{" "}
          {data && (
            <>
              <strong>
                {healthy} of {data.series.length}
              </strong>{" "}
              starter series are up to date.
            </>
          )}
        </p>
        <p>
          <Link className="button" to="/status">
            Open data status
          </Link>
        </p>
      </div>
      <div className="panel subtle">
        <h2>Coming in Phase 1</h2>
        <ul className="ticks">
          <li>All 15 economies and the remaining indicators</li>
          <li>“What changed since your last visit”, ranked by significance</li>
          <li>Country and indicator pages with plain-English explanations at two depths</li>
          <li>Glossary of the jargon</li>
        </ul>
      </div>
    </section>
  );
}
