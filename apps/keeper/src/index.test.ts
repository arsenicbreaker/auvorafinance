import { describe, expect, it } from "vitest";

import { getKeeperHealth, KEEPER_ALLOWED_METHOD } from "./index.js";

describe("keeper foundation", () => {
  it("is hard-bound to testnet and the harmless proof method", () => {
    expect(getKeeperHealth()).toEqual({
      networkId: "testnet",
      service: "auvora-keeper",
      status: "ready",
    });
    expect(KEEPER_ALLOWED_METHOD).toBe("execute_due");
  });
});
