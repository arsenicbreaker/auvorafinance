import { execFile } from "node:child_process";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { parseEnv, promisify } from "node:util";
import { KeyPair } from "near-api-js";

const exec = promisify(execFile);
const ROOT = fileURLToPath(new URL("../../", import.meta.url));
const DEFAULT_RPC = "https://rpc.testnet.near.org";

export function parseDoctorArgs(args) {
  const options = {
    offline: false,
    json: false,
    help: false,
    webUrl: "http://127.0.0.1:3000",
  };
  for (let index = 0; index < args.length; index++) {
    const arg = args[index];
    if (arg === "--offline") options.offline = true;
    else if (arg === "--json") options.json = true;
    else if (arg === "--help") options.help = true;
    else if (arg === "--web-url" && args[index + 1])
      options.webUrl = args[++index];
    else throw new Error("Invalid options. Use pnpm local:doctor --help.");
  }
  const url = new URL(options.webUrl);
  if (
    url.protocol !== "http:" ||
    !["localhost", "127.0.0.1", "[::1]"].includes(url.hostname) ||
    url.username ||
    url.password ||
    url.search ||
    url.hash ||
    url.pathname !== "/"
  ) {
    throw new Error(
      "The web URL must be a local HTTP origin, for example http://127.0.0.1:3010.",
    );
  }
  options.webUrl = url.origin;
  return options;
}

async function isIgnored(root, path) {
  try {
    await exec("git", ["-C", root, "check-ignore", "--quiet", "--", path]);
    // A tracked file can still match an ignore rule after changing the index.
    const tracked = await exec("git", ["-C", root, "ls-files", "--", path]);
    return !tracked.stdout.trim();
  } catch {
    return false;
  }
}

function account(value) {
  return (
    typeof value === "string" &&
    value.length <= 64 &&
    /^[a-z0-9]+(?:[-_.][a-z0-9]+)*\.testnet$/.test(value)
  );
}

function httpsRpc(value) {
  try {
    const url = new URL(value);
    return (
      url.protocol === "https:" && !url.username && !url.password && !url.hash
    );
  } catch {
    return false;
  }
}

function integer(value, fallback, min, max) {
  if (value === undefined) return fallback;
  if (!/^\d+$/.test(value)) return null;
  const parsed = Number(value);
  return Number.isSafeInteger(parsed) && parsed >= min && parsed <= max
    ? parsed
    : null;
}

export async function runDoctor({
  root = ROOT,
  offline = false,
  webUrl = "http://127.0.0.1:3000",
  environment = process.env,
  nodeVersion = process.versions.node,
  fetchImpl = fetch,
  readFileImpl = readFile,
  ignoredImpl = isIgnored,
  now = Date.now(),
} = {}) {
  // Validate again for programmatic callers before making any request.
  webUrl = parseDoctorArgs(["--web-url", webUrl]).webUrl;
  const checks = [];
  function add(id, passed, message, fix = "") {
    checks.push({
      id,
      status: passed ? "pass" : "fail",
      message,
      ...(passed ? {} : { fix }),
    });
  }
  function skip(id, message) {
    checks.push({ id, status: "skip", message });
  }
  const [major, minor] = nodeVersion.split(".").map(Number);
  add(
    "node",
    major === 22 && minor >= 12,
    "Node 22.12+ within 22.x is required.",
    "Select the Node version in .nvmrc, then reinstall with pnpm install --frozen-lockfile.",
  );

  async function load(path, id) {
    try {
      const values = parseEnv(await readFileImpl(join(root, path), "utf8"));
      add(id, true, `${path} can be read.`);
      const ignored = await ignoredImpl(root, path);
      add(
        `${id}_ignored`,
        ignored,
        `${path} must be ignored and untracked.`,
        "Keep local environment files out of Git; inspect git status before continuing.",
      );
      return { ...values, ...environment };
    } catch {
      add(
        id,
        false,
        `${path} could not be read.`,
        "Create this local environment file using .env.example and the setup guide. Do not print or commit its secrets.",
      );
      return null;
    }
  }
  const [web, keeper] = await Promise.all([
    load("apps/web/.env.local", "web_env"),
    load(".env.keeper.local", "keeper_env"),
  ]);
  const webRpc = web?.NEXT_PUBLIC_NEAR_RPC_URL || DEFAULT_RPC;
  const webValid =
    !!web && account(web.NEXT_PUBLIC_AUVORA_CONTRACT_ID) && httpsRpc(webRpc);
  add(
    "web_config",
    webValid,
    "Web needs a named testnet contract and HTTPS RPC.",
    "Set NEXT_PUBLIC_AUVORA_CONTRACT_ID and NEXT_PUBLIC_NEAR_RPC_URL in apps/web/.env.local, then restart/rebuild the web app.",
  );
  const port = integer(keeper?.KEEPER_HEALTH_PORT, 3001, 1, 65535);
  const poll = integer(keeper?.KEEPER_POLL_INTERVAL_MS, 15000, 1000, 300000);
  let publicKey = "";
  try {
    publicKey = KeyPair.fromString(keeper?.KEEPER_PRIVATE_KEY ?? "")
      .getPublicKey()
      .toString();
  } catch {
    /* Report only the field name below. */
  }
  let databaseValid = false;
  try {
    databaseValid = ["postgres:", "postgresql:"].includes(
      new URL(keeper?.DATABASE_URL).protocol,
    );
  } catch {
    /* Missing or invalid local configuration. */
  }
  const keeperValid =
    !!keeper &&
    keeper.NEAR_NETWORK_ID === "testnet" &&
    account(keeper.AUVORA_CONTRACT_ID) &&
    account(keeper.KEEPER_ACCOUNT_ID) &&
    httpsRpc(keeper.NEAR_RPC_URL) &&
    databaseValid &&
    !!publicKey &&
    port !== null &&
    poll !== null &&
    integer(keeper.KEEPER_LEASE_MS, 60000, 10000, 600000) !== null &&
    integer(keeper.KEEPER_PAGE_SIZE, 20, 1, 50) !== null &&
    integer(keeper.KEEPER_FINALITY_TIMEOUT_MS, 60000, 5000, 300000) !== null &&
    (keeper.KEEPER_INSTANCE_ID === undefined ||
      (keeper.KEEPER_INSTANCE_ID.length > 0 &&
        keeper.KEEPER_INSTANCE_ID.length <= 128));
  add(
    "keeper_config",
    keeperValid,
    "Keeper needs testnet accounts, a valid key, PostgreSQL URL, HTTPS RPC, and valid runtime settings.",
    "Review .env.keeper.local against .env.example. Key contents and database credentials are intentionally omitted from this report.",
  );
  add(
    "config_alignment",
    webValid &&
      keeperValid &&
      web.NEXT_PUBLIC_AUVORA_CONTRACT_ID === keeper.AUVORA_CONTRACT_ID &&
      webRpc === keeper.NEAR_RPC_URL,
    "Web and keeper must use the same contract and RPC.",
    "Align both local environment files, then restart affected services. Existing production builds retain their build-time public configuration.",
  );

  async function request(url, options = {}) {
    return fetchImpl(url, {
      ...options,
      redirect: "error",
      signal: AbortSignal.timeout(5000),
    });
  }
  async function rpc(method, params) {
    const response = await request(keeper.NEAR_RPC_URL, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        id: "auvora-doctor",
        jsonrpc: "2.0",
        method,
        params,
      }),
    });
    if (!response.ok) throw new Error("RPC unavailable");
    const body = await response.json();
    if (body.error || body.result === undefined)
      throw new Error("RPC result unavailable");
    return body.result;
  }
  async function probe(id, operation, message, fix) {
    try {
      add(id, await operation(), message, fix);
    } catch {
      add(id, false, message, fix);
    }
  }
  if (offline) {
    for (const id of [
      "web_http",
      "keeper_ready",
      "rpc_network",
      "contract",
      "keeper_key",
    ])
      skip(id, "Runtime check skipped in offline mode.");
  } else {
    await Promise.all([
      probe(
        "web_http",
        async () => {
          const response = await request(webUrl);
          const html = response.ok ? await response.text() : "";
          return html.includes("Auvora") && html.includes('id="builder"');
        },
        "Local URL must serve the Auvora payment page.",
        "Run pnpm --filter @auvora/web dev, or pass --web-url with the existing local port.",
      ),
      keeperValid
        ? probe(
            "keeper_ready",
            async () => {
              const response = await request(`http://127.0.0.1:${port}/ready`);
              if (!response.ok) return false;
              const body = await response.json();
              const lastPoll = Date.parse(body.lastSuccessfulPollAt);
              return (
                body.service === "auvora-keeper" &&
                body.live === true &&
                body.ready === true &&
                body.lastErrorCode === null &&
                Number.isFinite(lastPoll) &&
                lastPoll <= now + 5000 &&
                now - lastPoll <= poll * 3
              );
            },
            "Keeper must report a recent successful poll with no current error.",
            "Check PostgreSQL, run pnpm db:migrate:deploy, then pnpm keeper:dev in a separate terminal. Inspect keeper logs if readiness stays unavailable.",
          )
        : Promise.resolve(
            skip(
              "keeper_ready",
              "Fix keeper configuration before probing readiness.",
            ),
          ),
    ]);
    if (!keeperValid) {
      for (const id of ["rpc_network", "contract", "keeper_key"])
        skip(id, "Fix keeper configuration before querying RPC.");
    } else {
      let testnet = false;
      await probe(
        "rpc_network",
        async () => {
          const status = await rpc("status", []);
          testnet = status.chain_id === "testnet";
          return testnet;
        },
        "RPC must identify its chain as testnet.",
        "Check NEAR_RPC_URL and connectivity. No further chain queries run when network identity is unverified.",
      );
      if (!testnet) {
        skip("contract", "Testnet identity was not verified.");
        skip("keeper_key", "Testnet identity was not verified.");
      } else {
        await Promise.all([
          probe(
            "contract",
            async () => {
              const result = await rpc("query", {
                request_type: "call_function",
                finality: "final",
                account_id: keeper.AUVORA_CONTRACT_ID,
                method_name: "get_status",
                args_base64: "e30=",
              });
              const status = JSON.parse(
                Buffer.from(result.result).toString("utf8"),
              );
              return (
                status.status === "phase-2-ready" && account(status.owner_id)
              );
            },
            "Configured contract must expose the expected finalized status.",
            "Confirm the intended Auvora testnet contract and deployed version. This command does not deploy or upgrade it.",
          ),
          probe(
            "keeper_key",
            async () => {
              const result = await rpc("query", {
                request_type: "view_access_key",
                finality: "final",
                account_id: keeper.KEEPER_ACCOUNT_ID,
                public_key: publicKey,
              });
              const permission = result.permission?.FunctionCall;
              return (
                !!permission &&
                permission.receiver_id === keeper.AUVORA_CONTRACT_ID &&
                Array.isArray(permission.method_names) &&
                permission.method_names.length === 1 &&
                permission.method_names[0] === "execute_due" &&
                typeof permission.allowance === "string" &&
                /^\d+$/.test(permission.allowance) &&
                BigInt(permission.allowance) > 0n
              );
            },
            "Keeper key must allow only execute_due on this contract, with a positive gas allowance.",
            "Inspect the configured keeper key and its allowance. Full-access, unrestricted, wrong-contract, and exhausted keys are not ready; key provisioning is a separate reviewed action.",
          ),
        ]);
      }
    }
  }
  const ok = checks.every((check) => check.status !== "fail");
  return {
    version: 1,
    mode: offline ? "configuration-only" : "local-readiness",
    ok,
    runtimeReady: offline ? null : ok,
    webUrl,
    checks,
    limitations: [
      "Reads local configuration and public status only; sends no transaction and starts no service.",
      "Keeper readiness is a recent-poll signal, not proof of a new payment or an attestation of the running service's configuration.",
      "Web HTTP checks do not attest the public configuration embedded in an existing build.",
      "Wallet acceptance, completed payments, and release approval remain separate checks.",
    ],
  };
}

export function formatDoctor(report) {
  const lines = [
    report.mode === "configuration-only"
      ? "Auvora configuration checks (runtime not tested)"
      : "Auvora local readiness",
    `Web: ${report.webUrl}`,
  ];
  for (const check of report.checks) {
    lines.push(`[${check.status.toUpperCase()}] ${check.id}: ${check.message}`);
    if (check.fix) lines.push(`  Next: ${check.fix}`);
  }
  lines.push(
    report.ok
      ? report.runtimeReady
        ? "Requested local readiness checks passed."
        : "Configuration checks passed; runtime was not tested."
      : "Resolve the failed checks, then run pnpm local:doctor again.",
  );
  lines.push(...report.limitations);
  return `${lines.join("\n")}\n`;
}
