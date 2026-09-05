// Milestone 2 parity suite (BRIEF.md §7.2) around the fixed test/parity/scenarios.json.
//
// For every scenario the TS engine builds the pool from public/data, runs estimate() with the
// POC's seed (7) and the scenario's sims, and is checked in two stages:
//
//   Stage 1  POC reproduction: |p - poc_p| <= 2 x the POC's 95% CI, same sims, same forced mods.
//            Exact reproduction of `hits` is also computed. It is asserted only when PARITY_EXACT
//            is set in the environment: the port is bit-for-bit the POC, so with the same RePoE
//            data hits must match exactly, but an upstream RePoE update would legitimately move
//            hits while stage 1 still passes. Without PARITY_EXACT the comparison is recorded in
//            the summary table instead.
//   Stage 2  Craft of Exile: |p - coe_p| / coe_p <= 0.05. coe_p is read off craftofexile.com by
//            hand; null means PENDING and the test is skipped, not failed (CLAUDE.md rule 4).
//
// Each scenario's estimate runs once (beforeAll) and its it() blocks share the result. afterAll
// prints one summary table and writes the same rows to .cache/parity-last-run.json.

import { mkdirSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";

import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { buildPool, essenceForBase, findBase } from "../../src/engine/pool.ts";
import { estimate, type Estimate } from "../../src/engine/roll.ts";
import { ROOT, loadPocResults, loadPoolFileFor, loadScenarios, pocResultFor, type PocResult, type Scenario } from "../helpers/data.ts";

/** The POC's default when a scenario has no `sims` of its own (poc/engine.mjs SIMS). */
const DEFAULT_SIMS = 200_000;
/** The POC's estimate() default seed; poc/results.json was produced with it. */
const SEED = 7;
/** Stage 1 tolerance: twice the POC's own 95% CI (absolute). */
const STAGE1_CI_MULTIPLE = 2;
/** Stage 2 tolerance: 5% relative to Craft of Exile's number. */
const STAGE2_REL = 0.05;
/** Room for the 2M-roll scenarios even when vite.config.ts is not in play. */
const HOOK_TIMEOUT_MS = 900_000;

const EXACT_ASSERTED = Boolean(process.env["PARITY_EXACT"]);
const OUT_PATH = resolve(ROOT, ".cache", "parity-last-run.json");

interface Row {
  id: string;
  sims: number;
  ts_p: number;
  ts_hits: number;
  poc_p: number;
  poc_hits: number;
  /** |ts_p - poc_p| / ci95_abs; the stage 1 bound is STAGE1_CI_MULTIPLE. */
  dp_over_ci95: number;
  stage1: "PASS" | "FAIL";
  exact_hits: boolean;
  coe_p: number | null;
  stage2: "PASS" | "FAIL" | "PENDING";
  forced: string[];
  /** Wall time of estimate() alone. */
  seconds: number;
}

const scenariosFile = loadScenarios();
const pocFile = loadPocResults();
const rows: Row[] = [];
const suiteStart = performance.now();

/** Everything the it() blocks of one scenario share. */
interface Run {
  result: Estimate;
  poc: PocResult;
  row: Row;
}

function runScenario(sc: Scenario): Run {
  const file = loadPoolFileFor(sc.base);
  const base = findBase(file, sc.base);
  const poolInfo = buildPool(file, base, sc.ilvl);
  const forcedIds = sc.method.kind === "essence" ? [essenceForBase(file, sc.method.essence, base)] : [];
  const sims = sc.sims ?? DEFAULT_SIMS;

  const t0 = performance.now();
  const result = estimate({ poolInfo, target: sc.target, forcedIds, sims, seed: SEED });
  const seconds = (performance.now() - t0) / 1000;

  const poc = pocResultFor(pocFile, sc.id);
  const dp = Math.abs(result.p - poc.poc_p);
  const row: Row = {
    id: sc.id,
    sims: result.sims,
    ts_p: result.p,
    ts_hits: result.hits,
    poc_p: poc.poc_p,
    poc_hits: poc.hits,
    dp_over_ci95: poc.ci95_abs > 0 ? dp / poc.ci95_abs : dp === 0 ? 0 : Infinity,
    stage1: dp <= STAGE1_CI_MULTIPLE * poc.ci95_abs && result.sims === poc.sims ? "PASS" : "FAIL",
    exact_hits: result.hits === poc.hits,
    coe_p: sc.coe_p,
    stage2: sc.coe_p == null ? "PENDING" : Math.abs(result.p - sc.coe_p) / sc.coe_p <= STAGE2_REL ? "PASS" : "FAIL",
    forced: result.forced,
    seconds,
  };
  rows.push(row);
  return { result, poc, row };
}

// ---------------------------------------------------------------------------

for (const sc of scenariosFile.scenarios) {
  describe(sc.id, () => {
    let run: Run | undefined;
    const get = (): Run => {
      if (!run) throw new Error(`${sc.id}: estimate did not run`);
      return run;
    };

    beforeAll(() => {
      run = runScenario(sc);
    }, HOOK_TIMEOUT_MS);

    it(`stage 1: p within ${STAGE1_CI_MULTIPLE} x the POC's 95% CI of poc_p, same sims, same forced mods`, () => {
      const { result, poc } = get();
      expect(result.sims).toBe(poc.sims);
      expect(result.sims).toBe(sc.sims ?? DEFAULT_SIMS);
      expect(result.forced).toEqual(poc.forced);
      expect(Math.abs(result.p - poc.poc_p)).toBeLessThanOrEqual(STAGE1_CI_MULTIPLE * poc.ci95_abs);
    });

    if (EXACT_ASSERTED) {
      it("exact: hits equal poc/results.json hits bit for bit (PARITY_EXACT set)", () => {
        const { result, poc } = get();
        expect(result.hits).toBe(poc.hits);
      });
    } else {
      it("exact: hits compared with poc/results.json and recorded in the summary (set PARITY_EXACT=1 to assert)", () => {
        const { row } = get();
        expect(typeof row.exact_hits).toBe("boolean");
      });
    }

    if (sc.coe_p == null) {
      it.skip("stage 2: Craft of Exile PENDING (coe_p not filled in)", () => {});
    } else {
      const coe = sc.coe_p;
      it(`stage 2: p within ${STAGE2_REL * 100}% relative of Craft of Exile's ${coe}`, () => {
        const { result } = get();
        expect(Math.abs(result.p - coe) / coe).toBeLessThanOrEqual(STAGE2_REL);
      });
    }
  });
}

// The scenarios file says so itself: alch and chaos reroll from scratch with no forced mod, so with
// the same seed they must be the same run, not merely close.
describe("cross-scenario sanity", () => {
  it("astral-alch-life2-fire2 reproduces astral-chaos-life2-fire2 exactly", () => {
    const chaos = rows.find((r) => r.id === "astral-chaos-life2-fire2");
    const alch = rows.find((r) => r.id === "astral-alch-life2-fire2");
    expect(chaos).toBeDefined();
    expect(alch).toBeDefined();
    expect(alch?.ts_hits).toBe(chaos?.ts_hits);
    expect(alch?.ts_p).toBe(chaos?.ts_p);
  });
});

// ---------------------------------------------------------------------------
// Summary
// ---------------------------------------------------------------------------

const fmtP = (p: number | null): string => (p == null ? "-" : p.toFixed(6));

function summaryTable(): string {
  const cols: [header: string, width: number, cell: (r: Row) => string][] = [
    ["id", 26, (r) => r.id],
    ["sims", 9, (r) => String(r.sims)],
    ["ts_p", 9, (r) => fmtP(r.ts_p)],
    ["ts_hits", 8, (r) => String(r.ts_hits)],
    ["poc_p", 9, (r) => fmtP(r.poc_p)],
    ["poc_hits", 8, (r) => String(r.poc_hits)],
    ["|dp|/ci95", 9, (r) => r.dp_over_ci95.toFixed(3)],
    ["stage1", 6, (r) => r.stage1],
    ["exact", 5, (r) => (r.exact_hits ? "yes" : "NO")],
    ["coe_p", 9, (r) => fmtP(r.coe_p)],
    ["stage2", 7, (r) => r.stage2],
    ["seconds", 7, (r) => r.seconds.toFixed(2)],
  ];
  const line = (cells: string[]): string => cells.map((c, i) => (i === 0 ? c.padEnd(cols[i]?.[1] ?? 0) : c.padStart(cols[i]?.[1] ?? 0))).join(" | ");
  const out = [line(cols.map((c) => c[0])), line(cols.map((c) => "-".repeat(c[1])))];
  for (const r of rows) out.push(line(cols.map((c) => c[2](r))));
  return out.join("\n");
}

afterAll(() => {
  const totalSeconds = (performance.now() - suiteStart) / 1000;
  const exactAll = rows.length > 0 && rows.every((r) => r.exact_hits);
  const counts = {
    stage1Pass: rows.filter((r) => r.stage1 === "PASS").length,
    stage2Pass: rows.filter((r) => r.stage2 === "PASS").length,
    stage2Pending: rows.filter((r) => r.stage2 === "PENDING").length,
  };

  // process.stdout.write, not console.log: vitest 5's default reporter drops console output from
  // passing files when stdout is not a TTY (only --reporter=verbose shows it), and this table is
  // the whole point of the run.
  process.stdout.write(
    `\nParity summary — ${rows.length}/${scenariosFile.scenarios.length} scenarios ran, seed ${SEED}, league ${scenariosFile.league}, POC run ${pocFile.generated}\n` +
      `${summaryTable()}\n` +
      `stage 1 PASS ${counts.stage1Pass}/${rows.length}; exact hits ${rows.filter((r) => r.exact_hits).length}/${rows.length}${EXACT_ASSERTED ? " (asserted)" : " (recorded only)"}; ` +
      `stage 2 PASS ${counts.stage2Pass}, PENDING ${counts.stage2Pending}, FAIL ${rows.length - counts.stage2Pass - counts.stage2Pending}; ` +
      `rolling ${rows.reduce((s, r) => s + r.seconds, 0).toFixed(1)} s, suite ${totalSeconds.toFixed(1)} s\n\n`,
  );

  mkdirSync(resolve(ROOT, ".cache"), { recursive: true });
  writeFileSync(
    OUT_PATH,
    `${JSON.stringify(
      {
        generated: new Date().toISOString(),
        seed: SEED,
        league: scenariosFile.league,
        poc_generated: pocFile.generated,
        exact_asserted: EXACT_ASSERTED,
        all_hits_exact: exactAll,
        total_seconds: Number(totalSeconds.toFixed(3)),
        rows,
      },
      null,
      2,
    )}\n`,
  );
});
