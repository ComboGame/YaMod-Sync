import { getStableBuild } from "./api";
import { processBuild } from "./patcher";

const stableBuild = await getStableBuild();

if (stableBuild.isErr()) {
  console.error(stableBuild.error);
  process.exit(1);
}

const dev = process.argv.includes("--dev");

try {
  for (const file of stableBuild.value) {
    await processBuild(file, { dev });
  }
} catch (error) {
  console.error(`❌ ${error instanceof Error ? error.message : error}`);
  process.exit(1);
}
