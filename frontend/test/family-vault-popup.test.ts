import assert from "node:assert/strict";
import test from "node:test";
import { FamilyVaultPopup } from "../src/components/home/family-vault-popup";
import { VaultActivitySheet } from "../src/components/home/vault-activity-sheet";
import { WethFundingSheet } from "../src/components/home/weth-funding-sheet";

test("Add WETH opens only the dedicated funding popup, never the vault carousel", () => {
  let closed = false;
  const popup = FamilyVaultPopup({
    view: "funding",
    onClose: () => {
      closed = true;
    },
  });
  assert.ok(popup);
  assert.equal(popup.type, WethFundingSheet);
  assert.notEqual(popup.type, VaultActivitySheet);
  assert.equal("initialPanel" in popup.props, false);
  popup.props.onClose();
  assert.equal(closed, true);
});

test("the vault card still opens activity and closing leaves no popup mounted", () => {
  const popup = FamilyVaultPopup({ view: "activity", onClose: () => {} });
  assert.ok(popup);
  assert.equal(popup.type, VaultActivitySheet);
  assert.equal("initialPanel" in popup.props, false);
  assert.equal(FamilyVaultPopup({ view: null, onClose: () => {} }), null);
});
