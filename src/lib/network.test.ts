import { describe, expect, it } from "vitest";

import { STELLAR_NETWORK_PASSPHRASES, describeNetwork } from "./network";

describe("describeNetwork", () => {
  it("names the public network mainnet", () => {
    const network = describeNetwork(STELLAR_NETWORK_PASSPHRASES.mainnet);
    expect(network.id).toBe("mainnet");
    expect(network.name).toBe("mainnet");
    expect(network.label).toBe("Stellar mainnet");
  });

  it("names the SDF test network testnet", () => {
    expect(describeNetwork(STELLAR_NETWORK_PASSPHRASES.testnet).id).toBe(
      "testnet",
    );
  });

  it("names the future network futurenet", () => {
    expect(describeNetwork(STELLAR_NETWORK_PASSPHRASES.futurenet).id).toBe(
      "futurenet",
    );
  });

  it("tolerates surrounding whitespace, which env files pick up easily", () => {
    expect(
      describeNetwork(`  ${STELLAR_NETWORK_PASSPHRASES.mainnet}\n`).id,
    ).toBe("mainnet");
  });

  it("describes an unrecognised passphrase as custom instead of throwing", () => {
    const network = describeNetwork("Standalone Network ; February 2017");
    expect(network.id).toBe("custom");
    expect(network.label).toBe("a custom Stellar network");
  });

  it("does not mistake a near-miss passphrase for a known network", () => {
    expect(
      describeNetwork("Public Global Stellar Network ; September 2016").id,
    ).toBe("custom");
  });
});
