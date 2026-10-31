import { createRequire } from "node:module";
import { describe, expect, it } from "vitest";

const requireFromWeb = createRequire(import.meta.url);
const adapterPath = requireFromWeb.resolve(
  "@near-wallet-selector/meteor-wallet",
);
const sdkPath = createRequire(adapterPath).resolve("@meteorwallet/sdk");
const queryString = createRequire(sdkPath)("query-string") as {
  stringify: (value: Record<string, string>) => string;
  parse: (value: string) => Record<string, string>;
};

describe("Meteor wallet URI compatibility", () => {
  it("round-trips popup parameters through the SDK's installed query-string dependency", () => {
    const parameters = {
      source: "website_post_message",
      connectionUid: "fixture-uid",
      pageUri: encodeURIComponent(
        "https://example.test/payment?note=café & reserve=2#review",
      ),
    };
    expect(queryString.parse(queryString.stringify(parameters))).toEqual(
      parameters,
    );
  });

  it("uses the patched decoder through the CommonJS loader on malformed input", () => {
    expect(queryString.parse("note=caf%C3%A9%zz").note).toBe("café%zz");
  });
});
