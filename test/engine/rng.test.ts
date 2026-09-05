// makeRng must be bit-for-bit the POC's mulberry32 so the parity suite reproduces
// poc/results.json exactly. The expected sequences below were computed from poc/engine.mjs
// makeRng under Node 24 on 05/09/2026.

import { describe, expect, it } from "vitest";
import { makeRng } from "../../src/engine/rng.ts";

const first = (seed: number | undefined, n: number): number[] => {
  const rng = seed === undefined ? makeRng() : makeRng(seed);
  return Array.from({ length: n }, () => rng());
};

const EXPECTED: ReadonlyArray<readonly [seed: number, draws: readonly number[]]> = [
  [1337, [0.1844118325971067, 0.18998925131745636, 0.8104719922412187, 0.6437488221563399, 0.430774615611881]],
  [7, [0.011704753153026104, 0.06195825757458806, 0.97690763277933, 0.6990287057124078, 0.5214452685322613]],
  [0, [0.26642920868471265, 0.0003297457005828619, 0.2232720274478197, 0.1462021479383111, 0.46732782293111086]],
  [4294967295, [0.8964226141106337, 0.189478256739676, 0.7156526781618595, 0.9440599093213677, 0.8452364315744489]],
];

describe("makeRng (mulberry32, POC-identical)", () => {
  for (const [seed, draws] of EXPECTED) {
    it(`seed ${seed} reproduces the POC's first five draws exactly`, () => {
      // toStrictEqual on numbers is Object.is: no tolerance, bit-for-bit.
      expect(first(seed, 5)).toStrictEqual([...draws]);
    });
  }

  it("defaults to seed 1337", () => {
    expect(first(undefined, 5)).toStrictEqual(first(1337, 5));
  });

  it("two generators with the same seed agree over 10,000 draws", () => {
    const a = makeRng(20260905);
    const b = makeRng(20260905);
    for (let i = 0; i < 10_000; i++) expect(a()).toBe(b());
  });

  it("different seeds give different sequences", () => {
    expect(first(1, 5)).not.toStrictEqual(first(2, 5));
  });

  it("every draw is in [0, 1)", () => {
    for (const seed of [0, 1, 7, 1337, 4294967295]) {
      const rng = makeRng(seed);
      for (let i = 0; i < 10_000; i++) {
        const x = rng();
        expect(x).toBeGreaterThanOrEqual(0);
        expect(x).toBeLessThan(1);
      }
    }
  });
});
