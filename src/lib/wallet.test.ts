import { describe, expect, it } from "vitest";

import { selectWalletThroughModal } from "./wallet";

/**
 * Stands in for `StellarWalletsKit`. Its `openModal` reads `this`, exactly as
 * the real kit does when it reaches for `this.modalElement` — so calling it
 * detached from the instance throws the same TypeError seen in production.
 */
function fakeKit(walletId = "freighter") {
  return {
    modalElement: { id: "stellar-wallets-modal" },
    setWalletCalls: [] as string[],
    openModal(input: { onWalletSelected: (option: { id: string }) => void }) {
      // Touching `this` is the whole point: an unbound call makes it undefined.
      void this.modalElement.id;
      input.onWalletSelected({ id: walletId });
    },
    setWallet(id: string) {
      this.setWalletCalls.push(id);
    },
  };
}

describe("selectWalletThroughModal", () => {
  it("calls openModal bound to the kit, so the kit can reach its own modal element", async () => {
    const kit = fakeKit();

    await expect(selectWalletThroughModal(kit)).resolves.toBe("freighter");
  });

  it("tells the kit which wallet the user picked", async () => {
    const kit = fakeKit("xbull");

    await selectWalletThroughModal(kit);

    expect(kit.setWalletCalls).toEqual(["xbull"]);
  });

  it("resolves with no selection when the kit exposes no modal", async () => {
    await expect(selectWalletThroughModal({})).resolves.toBeUndefined();
  });
});
