import { describe, expect, it } from "vitest";
import { addMonths, formatPeriod, normalizePeriod, periodEnd } from "../shared/periods.ts";

describe("normalizePeriod", () => {
  it("maps source labels to the first day of the period", () => {
    expect(normalizePeriod("2026-09", "M")).toBe("2026-09-01");
    expect(normalizePeriod("2026M09", "M")).toBe("2026-09-01");
    expect(normalizePeriod("2026-09-01", "M")).toBe("2026-09-01");
    expect(normalizePeriod("2025-Q3", "Q")).toBe("2025-07-01");
    expect(normalizePeriod("2025Q4", "Q")).toBe("2025-10-01");
    expect(normalizePeriod("2026-04-01", "Q")).toBe("2026-04-01");
    expect(normalizePeriod("2026-05-15", "Q")).toBe("2026-04-01");
    expect(normalizePeriod("2025", "A")).toBe("2025-01-01");
    expect(normalizePeriod("2026-10-13", "D")).toBe("2026-10-13");
  });

  it("rejects labels it does not understand", () => {
    expect(() => normalizePeriod("Sep 2026", "M")).toThrow(/Unrecognised/);
    expect(() => normalizePeriod("2026-13", "M")).toThrow(/Invalid/);
  });
});

describe("date arithmetic", () => {
  it("adds months and clamps to month end", () => {
    expect(addMonths("2026-01-31", 1)).toBe("2026-02-28");
    expect(addMonths("2026-03-01", -12)).toBe("2025-03-01");
    expect(addMonths("2026-01-01", -3)).toBe("2025-10-01");
  });

  it("finds the end of a period", () => {
    expect(periodEnd("2026-08-01", "M")).toBe("2026-09-01");
    expect(periodEnd("2026-04-01", "Q")).toBe("2026-07-01");
    expect(periodEnd("2026-12-31", "D")).toBe("2027-01-01");
  });

  it("formats periods for people", () => {
    expect(formatPeriod("2026-09-01", "M")).toBe("Sep 2026");
    expect(formatPeriod("2026-04-01", "Q")).toBe("Q2 2026");
    expect(formatPeriod("2026-10-13", "D")).toBe("13 Oct 2026");
    expect(formatPeriod("2025-01-01", "A")).toBe("2025");
  });
});
