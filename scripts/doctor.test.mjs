import { describe, expect, it, vi } from "vitest";
import { KeyPair } from "near-api-js";
import {
  formatDoctor,
  parseDoctorArgs,
  runDoctor,
} from "./lib/local-doctor.mjs";

const privateKey = KeyPair.fromRandom("ed25519").toString();
const secret = "DOCTOR_TEST_SECRET_MUST_NOT_BE_PRINTED";
const now = Date.parse("2026-10-31T10:00:00Z");
const keeperDefaults = {
  NEAR_NETWORK_ID: "testnet",
  NEAR_RPC_URL: "https://rpc.testnet.near.org",
  AUVORA_CONTRACT_ID: "treasury.testnet",
  KEEPER_ACCOUNT_ID: "keeper.testnet",
  KEEPER_PRIVATE_KEY: privateKey,
  DATABASE_URL: `postgresql://user:${secret}@localhost:5432/auvora`,
};
const webDefaults = {
  NEXT_PUBLIC_AUVORA_CONTRACT_ID: "treasury.testnet",
  NEXT_PUBLIC_NEAR_RPC_URL: "https://rpc.testnet.near.org",
};

function fixture({
  keeper = {},
  web = {},
  health = {},
  permission = {},
  chain = "testnet",
  contract = {},
  ...overrides
} = {}) {
  const fetchImpl = vi.fn(async (url, options) => {
    if (url.startsWith("http:")) {
      return url.endsWith("/ready")
        ? Response.json({
            service: "auvora-keeper",
            live: true,
            ready: true,
            lastSuccessfulPollAt: new Date(now - 1000).toISOString(),
            lastErrorCode: null,
            ...health,
          })
        : new Response('<title>Auvora</title><section id="builder"></section>');
    }
    const { method, params } = JSON.parse(options.body);
    if (method === "status")
      return Response.json({ result: { chain_id: chain } });
    if (params.request_type === "view_access_key")
      return Response.json({
        result: {
          permission: {
            FunctionCall: {
              receiver_id: "treasury.testnet",
              method_names: ["execute_due"],
              allowance: "1000",
              ...permission,
            },
          },
        },
      });
    return Response.json({
      result: {
        result: [
          ...Buffer.from(
            JSON.stringify({
              status: "phase-2-ready",
              owner_id: "owner.testnet",
              ...contract,
            }),
          ),
        ],
      },
    });
  });
  const readFileImpl = vi.fn(async (path) => {
    const values = String(path)
      .replaceAll("\\", "/")
      .endsWith("apps/web/.env.local")
      ? { ...webDefaults, ...web }
      : { ...keeperDefaults, ...keeper };
    return Object.entries(values)
      .filter(([, value]) => value !== undefined)
      .map(([name, value]) => `${name}=${value}`)
      .join("\n");
  });
  return {
    root: "C:/doctor-fixture",
    environment: {},
    nodeVersion: "22.22.1",
    now,
    fetchImpl,
    readFileImpl,
    ignoredImpl: vi.fn(async () => true),
    ...overrides,
  };
}

function check(report, id) {
  return report.checks.find((value) => value.id === id);
}

describe("local readiness doctor", () => {
  it("passes a healthy setup using only read operations and omits credentials", async () => {
    const input = fixture();
    const report = await runDoctor(input);
    expect(report.ok).toBe(true);
    expect(report.runtimeReady).toBe(true);
    for (const [, options] of input.fetchImpl.mock.calls) {
      expect(options.redirect).toBe("error");
      expect(options.signal).toBeInstanceOf(AbortSignal);
      if (options.body) {
        const body = JSON.parse(options.body);
        expect(["status", "query"]).toContain(body.method);
        if (body.method === "query") expect(body.params.finality).toBe("final");
        expect(options.body).not.toContain(privateKey);
      }
    }
    for (const output of [JSON.stringify(report), formatDoctor(report)]) {
      expect(output).not.toContain(privateKey);
      expect(output).not.toContain(secret);
      expect(output).not.toContain("postgresql://");
    }
  });

  it("checks configuration offline without claiming runtime readiness", async () => {
    const input = fixture({ offline: true });
    const report = await runDoctor(input);
    expect(report.ok).toBe(true);
    expect(report.runtimeReady).toBeNull();
    expect(
      report.checks.filter((value) => value.status === "skip"),
    ).toHaveLength(5);
    expect(input.fetchImpl).not.toHaveBeenCalled();
    expect(formatDoctor(report)).toContain("runtime was not tested");
  });

  it("reports missing local files without forwarding filesystem errors", async () => {
    const report = await runDoctor(
      fixture({
        readFileImpl: async () => {
          throw new Error(secret);
        },
      }),
    );
    expect(report.ok).toBe(false);
    expect(check(report, "keeper_env").status).toBe("fail");
    expect(JSON.stringify(report)).not.toContain(secret);
  });

  it("blocks readiness when environment files are not ignored and untracked", async () => {
    const report = await runDoctor(fixture({ ignoredImpl: async () => false }));
    expect(check(report, "keeper_env_ignored").status).toBe("fail");
    expect(report.ok).toBe(false);
  });

  it.each(["20.19.0", "22.11.0", "23.0.0", "26.0.0"])(
    "rejects unsupported Node %s",
    async (nodeVersion) => {
      const report = await runDoctor(fixture({ nodeVersion, offline: true }));
      expect(check(report, "node").status).toBe("fail");
    },
  );

  it.each([
    { NEAR_NETWORK_ID: "mainnet" },
    { AUVORA_CONTRACT_ID: "treasury.near" },
    { NEAR_RPC_URL: "http://rpc.testnet.near.org" },
    { KEEPER_ACCOUNT_ID: "keeper.near" },
    { KEEPER_PRIVATE_KEY: "invalid" },
    { DATABASE_URL: "https://database.example" },
    { KEEPER_HEALTH_PORT: "0" },
    { KEEPER_HEALTH_PORT: "65536" },
    { KEEPER_POLL_INTERVAL_MS: "1e3" },
    { KEEPER_LEASE_MS: "1" },
    { KEEPER_PAGE_SIZE: "51" },
    { KEEPER_FINALITY_TIMEOUT_MS: "0" },
    { KEEPER_INSTANCE_ID: "" },
  ])("rejects invalid keeper configuration: %j", async (keeper) => {
    const input = fixture({ keeper });
    const report = await runDoctor(input);
    expect(check(report, "keeper_config").status).toBe("fail");
    expect(check(report, "rpc_network").status).toBe("skip");
    expect(
      input.fetchImpl.mock.calls.every(([url]) => url.startsWith("http:")),
    ).toBe(true);
  });

  it("detects mismatched web and keeper configuration", async () => {
    const report = await runDoctor(
      fixture({ web: { NEXT_PUBLIC_AUVORA_CONTRACT_ID: "other.testnet" } }),
    );
    expect(check(report, "config_alignment").status).toBe("fail");
  });

  it("respects process environment precedence over local files", async () => {
    const report = await runDoctor(
      fixture({ offline: true, environment: { NEAR_NETWORK_ID: "mainnet" } }),
    );
    expect(check(report, "keeper_config").status).toBe("fail");
  });

  it("stops chain queries if an HTTPS RPC identifies itself as mainnet", async () => {
    const input = fixture({ chain: "mainnet" });
    const report = await runDoctor(input);
    expect(check(report, "rpc_network").status).toBe("fail");
    expect(check(report, "keeper_key").status).toBe("skip");
    expect(
      input.fetchImpl.mock.calls.filter(([, options]) => options.body),
    ).toHaveLength(1);
  });

  it.each([
    { ready: false },
    { service: "another-app" },
    { lastErrorCode: secret },
    { lastSuccessfulPollAt: new Date(now - 46000).toISOString() },
    { lastSuccessfulPollAt: new Date(now + 6000).toISOString() },
    { lastSuccessfulPollAt: null },
  ])("rejects unhealthy or stale keeper responses: %j", async (health) => {
    const report = await runDoctor(fixture({ health }));
    expect(check(report, "keeper_ready").status).toBe("fail");
    expect(JSON.stringify(report)).not.toContain(secret);
  });

  it.each([
    { receiver_id: "other.testnet" },
    { method_names: [] },
    { method_names: ["execute_due", "withdraw_available"] },
    { allowance: "0" },
    { allowance: null },
  ])(
    "rejects overly broad, wrong-target or exhausted key permissions: %j",
    async (permission) => {
      const report = await runDoctor(fixture({ permission }));
      expect(check(report, "keeper_key").status).toBe("fail");
    },
  );

  it("rejects full access instead of treating a valid secret as a restricted key", async () => {
    const input = fixture();
    const original = input.fetchImpl.getMockImplementation();
    input.fetchImpl.mockImplementation(async (url, options) => {
      if (
        options.body &&
        JSON.parse(options.body).params?.request_type === "view_access_key"
      )
        return Response.json({ result: { permission: "FullAccess" } });
      return original(url, options);
    });
    expect(check(await runDoctor(input), "keeper_key").status).toBe("fail");
  });

  it("rejects a wrong deployed contract status", async () => {
    expect(
      check(
        await runDoctor(fixture({ contract: { status: "uninitialized" } })),
        "contract",
      ).status,
    ).toBe("fail");
  });

  it("does not consider an arbitrary HTTP 200 page to be Auvora", async () => {
    const input = fixture();
    const original = input.fetchImpl.getMockImplementation();
    input.fetchImpl.mockImplementation((url, options) =>
      url === "http://127.0.0.1:3000"
        ? new Response("Another app")
        : original(url, options),
    );
    expect(check(await runDoctor(input), "web_http").status).toBe("fail");
  });

  it("reports unreachable services without leaking thrown errors", async () => {
    const report = await runDoctor(
      fixture({
        fetchImpl: async () => {
          throw new Error(secret);
        },
      }),
    );
    expect(check(report, "web_http").status).toBe("fail");
    expect(check(report, "keeper_ready").status).toBe("fail");
    expect(check(report, "rpc_network").status).toBe("fail");
    expect(JSON.stringify(report)).not.toContain(secret);
  });

  it("handles malformed RPC responses as blockers", async () => {
    const report = await runDoctor(
      fixture({ fetchImpl: async () => new Response(secret, { status: 503 }) }),
    );
    expect(check(report, "rpc_network").status).toBe("fail");
    expect(JSON.stringify(report)).not.toContain(secret);
  });

  it("accepts a custom loopback web port and JSON/offline options", () => {
    expect(
      parseDoctorArgs([
        "--web-url",
        "http://127.0.0.1:3010/",
        "--json",
        "--offline",
      ]),
    ).toMatchObject({
      webUrl: "http://127.0.0.1:3010",
      json: true,
      offline: true,
    });
  });

  it.each([
    "https://example.com",
    "http://192.168.1.5:3000",
    "http://localhost:3000/?token=secret",
    "http://user:pass@localhost:3000",
    "http://localhost:3000/other",
  ])("rejects nonlocal or credential-bearing web targets: %s", (url) => {
    expect(() => parseDoctorArgs(["--web-url", url])).toThrow();
  });

  it.each([["--unknown"], ["--web-url"]])(
    "rejects invalid CLI options: %j",
    (args) => {
      expect(() => parseDoctorArgs(args)).toThrow();
    },
  );
});
