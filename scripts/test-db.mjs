#!/usr/bin/env node
/** Private, disposable fixture database. Never reads the app's .env or a remote URL. */
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, readdirSync, realpathSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const root = realpathSync(path.resolve(path.dirname(fileURLToPath(import.meta.url)), ".."));
const suffix = createHash("sha256").update(root).digest("hex").slice(0, 12);
// macOS's usual temp directory is too long for a PostgreSQL Unix socket.
const state = path.join(process.platform === "darwin" ? "/tmp" : tmpdir(), `nt-fixture-${suffix}`);
const data = path.join(state, "data");
const socket = path.join(state, "socket");
const port = "55432";
const databaseUrl = `postgresql://nt_fixture@localhost:55432/nutritracker_test?host=${encodeURIComponent(socket)}`;
const clientEnv = process.env.TEST_POSTGRES_CLIENT_ENV
  ? JSON.parse(readFileSync(process.env.TEST_POSTGRES_CLIENT_ENV, "utf8"))
  : {};
const env = { ...process.env, ...clientEnv, DATABASE_URL: databaseUrl };
// Clear libpq defaults so a developer's production connection cannot be inherited.
for (const key of Object.keys(env)) if (/^PG(?:HOST|PORT|USER|PASSWORD|DATABASE|SERVICE|SERVICEFILE|PASSFILE|OPTIONS|SSLMODE)$/.test(key)) delete env[key];
const bin = process.env.TEST_POSTGRES_BIN || "";
const pg = (name) => bin ? path.join(bin, name) : name;
function run(command, args, { allowFailure = false, quiet = false } = {}) {
  const result = spawnSync(command, args, { cwd: root, env, encoding: "utf8" });
  if (!quiet && result.stdout) process.stdout.write(result.stdout);
  if (!quiet && result.stderr) process.stderr.write(result.stderr);
  if (result.error) throw result.error;
  if (result.status !== 0 && !allowFailure) throw new Error(`${path.basename(command)} exited with ${result.status}`);
  return result;
}
function start() {
  mkdirSync(state, { recursive: true, mode: 0o700 });
  mkdirSync(socket, { recursive: true, mode: 0o700 });
  if (!existsSync(path.join(data, "PG_VERSION"))) {
    run(pg("initdb"), ["-D", data, "-U", "nt_fixture", "--auth-local=trust", "--auth-host=reject", "--encoding=UTF8", "--no-locale", "-c", "timezone=GMT", "-c", "log_timezone=GMT",
      ...(process.env.TEST_POSTGRES_SHARE ? ["-L", process.env.TEST_POSTGRES_SHARE] : []),
      ...(process.env.TEST_POSTGRES_LIBRARY ? ["-c", `dynamic_library_path=${process.env.TEST_POSTGRES_LIBRARY}`] : []),
    ]);
    writeFileSync(path.join(data, "postgresql.auto.conf"), `listen_addresses = ''\nunix_socket_directories = '${socket.replaceAll("'", "''")}'\nunix_socket_permissions = 0700\nport = ${port}\n`, { mode: 0o600 });
  }
  if (run(pg("pg_ctl"), ["-D", data, "status"], { allowFailure: true, quiet: true }).status !== 0) {
    run(pg("pg_ctl"), ["-D", data, "-l", path.join(state, "postgres.log"), "-w", "start"]);
  }
  const args = ["--host", socket, "--port", port, "--username", "nt_fixture"];
  const check = run(pg("psql"), [...args, "--dbname", "postgres", "-At", "-c", "SELECT 1 FROM pg_database WHERE datname = 'nutritracker_test'"], { quiet: true });
  if (!check.stdout.trim()) run(pg("createdb"), [...args, "nutritracker_test"]);
  writeFileSync(path.join(state, "connection.json"), JSON.stringify({ databaseUrl, state, socket, fixtureOnly: true }, null, 2), { mode: 0o600 });
}
function prepare() {
  start();
  run(process.execPath, ["node_modules/prisma/build/index.js", "db", "push", "--skip-generate"]);
}
const command = process.argv[2] || "start";
if (command === "start") {
  start();
  console.log(JSON.stringify({ databaseUrl, state, socket, fixtureOnly: true }, null, 2));
} else if (command === "prepare") {
  prepare();
  console.log(JSON.stringify({ databaseUrl, state, fixtureOnly: true }, null, 2));
} else if (command === "run") {
  prepare();
  const tests = readdirSync(path.join(root, "tests")).filter((name) => name.endsWith(".integration.test.ts")).map((name) => `tests/${name}`);
  if (!tests.length) throw new Error("No PostgreSQL integration tests found.");
  const result = run(process.execPath, ["--import", "tsx", "--test", "--test-concurrency=1", ...tests], { allowFailure: true });
  process.exitCode = result.status ?? 1;
} else if (command === "stop") {
  if (existsSync(path.join(data, "PG_VERSION"))) run(pg("pg_ctl"), ["-D", data, "-m", "fast", "-w", "stop"]);
} else if (command === "url") {
  console.log(databaseUrl);
} else {
  throw new Error("Usage: node scripts/test-db.mjs start|prepare|run|stop|url");
}
