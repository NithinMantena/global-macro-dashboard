import { NavLink, Route, Routes } from "react-router-dom";
import { formatTimestamp } from "./lib/format.ts";
import { useStatus } from "./lib/useStatus.ts";
import { DataStatus } from "./pages/DataStatus.tsx";
import { Home } from "./pages/Home.tsx";

export function App() {
  const { data } = useStatus();
  const sources = data ? [...new Set(data.series.map((s) => s.source_label))].join(", ") : null;
  return (
    <div className="shell">
      <a className="skip" href="#main">Skip to content</a>
      <header className="masthead">
        <div className="wrap masthead-inner">
          <NavLink to="/" className="wordmark" aria-label="Global Macro Dashboard, home">
            <svg viewBox="0 0 32 32" width="22" height="22" aria-hidden="true">
              <circle cx="16" cy="16" r="13" fill="none" stroke="currentColor" strokeWidth="2.5" />
              <path d="M6 19 L12 14 L17 17 L26 9" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
            <span>Global Macro</span>
          </NavLink>
          <nav aria-label="Main">
            <NavLink to="/" end>Home</NavLink>
            <NavLink to="/status">Data status</NavLink>
          </nav>
        </div>
      </header>
      <main id="main" className="wrap">
        <Routes>
          <Route path="/" element={<Home />} />
          <Route path="/status" element={<DataStatus />} />
          <Route path="*" element={<NotFound />} />
        </Routes>
      </main>
      <footer className="wrap footer">
        <span>
          Data as of {data?.data_as_of ? formatTimestamp(data.data_as_of) : "—"}
        </span>
        {sources && <span>Sources: {sources}</span>}
        <span>Refreshed daily at 06:00 UTC by GitHub Actions</span>
      </footer>
    </div>
  );
}

function NotFound() {
  return (
    <section className="page">
      <h1>Page not found</h1>
      <p>
        <NavLink to="/">Back to the home screen</NavLink>
      </p>
    </section>
  );
}
