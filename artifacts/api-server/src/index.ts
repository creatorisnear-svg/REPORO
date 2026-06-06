import app from "./app";
import { logger } from "./lib/logger";
import { initDatabase } from "@workspace/db";
import { startBot } from "@workspace/bot";

const rawPort = process.env["PORT"];

if (!rawPort) {
  throw new Error("PORT environment variable is required but was not provided.");
}

const port = Number(rawPort);

if (Number.isNaN(port) || port <= 0) {
  throw new Error(`Invalid PORT value: "${rawPort}"`);
}

async function main(): Promise<void> {
  try {
    await initDatabase();
    logger.info("[DB] Database initialized");
  } catch (err) {
    logger.error({ err }, "[DB] Failed to initialize database");
  }

  startBot();

  app.listen(port, (err) => {
    if (err) {
      logger.error({ err }, "Error listening on port");
      process.exit(1);
    }
    logger.info({ port }, "Server listening");
  });
}

main().catch(err => {
  logger.error({ err }, "Fatal startup error");
  process.exit(1);
});
