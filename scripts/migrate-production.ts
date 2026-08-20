import { spawnSync } from "node:child_process";

if (process.env.CONFIRM_PRODUCTION_MIGRATION !== "1") {
  console.error(
    "Refusing to migrate production. Run with CONFIRM_PRODUCTION_MIGRATION=1 after verifying DATABASE_URL/DIRECT_URL.",
  );
  process.exit(1);
}

const result = spawnSync(
  process.execPath,
  ["node_modules/prisma/build/index.js", "migrate", "deploy"],
  {
    stdio: "inherit",
    env: { ...process.env, NODE_ENV: "production" },
  },
);

process.exit(result.status ?? 1);

