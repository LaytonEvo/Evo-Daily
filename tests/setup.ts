/**
 * Load .env.test if it exists, so `npm test` picks up TEST_DATABASE_URL
 * without every developer exporting it by hand. Real environments set the
 * variable directly and this is a no-op.
 */
import { existsSync } from "node:fs";

if (existsSync(".env.test")) {
  process.loadEnvFile(".env.test");
}

if (!process.env.TEST_DATABASE_URL && process.env.DATABASE_URL) {
  process.env.TEST_DATABASE_URL = process.env.DATABASE_URL;
}
