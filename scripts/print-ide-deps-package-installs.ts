import { formatGlobalPackageInstallLines, readIdeDeps } from "./lib/ideDeps";

const deps = await readIdeDeps(process.cwd());
process.stdout.write(formatGlobalPackageInstallLines(deps));
