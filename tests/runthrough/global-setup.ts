/**
 * Refuses to start the runthrough when the seed's format version is not
 * the code's (K144), pointing at `npm run seed:upgrade`. Also sweeps
 * temp trackers an earlier run left behind.
 */

import { checkSeedVersion, sweepTemp } from "./lib/seed.ts";

export default async function setup(): Promise<void> {
  const problem = await checkSeedVersion();
  if (problem !== null) {
    console.error(`\n${problem}`);
    throw new Error("runthrough refused to start: seed format version mismatch (see above)");
  }
  await sweepTemp();
}
