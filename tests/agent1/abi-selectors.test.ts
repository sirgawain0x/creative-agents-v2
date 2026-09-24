import { describe, expect, it } from "vitest";
import { encodeFunctionData, toFunctionSelector } from "viem";

import {
  confirmedMintAbi,
  foundryQuoteAbi,
  provisionalMintAbi,
} from "@/lib/agent1/venue";

/** Live FoundryFacet on Base Diamond (verified vs crtv3 + code-alliance-dao buy path). */
const LIVE_MINT_SELECTOR = toFunctionSelector("mint(address,uint256,address)");
const LIVE_QUOTE_SELECTOR = toFunctionSelector("calculateMeTokensMinted(address,uint256)");
const ERC20_APPROVE_SELECTOR = toFunctionSelector("approve(address,uint256)");

describe("FoundryFacet selectors (ABI lock evidence)", () => {
  it("matches live Creative Platform mint + quote signatures", () => {
    expect(LIVE_MINT_SELECTOR).toBe("0x0d4d1513");
    expect(LIVE_QUOTE_SELECTOR).toBe("0xb9aa404a");
    expect(ERC20_APPROVE_SELECTOR).toBe("0x095ea7b3");
  });

  it("agent1 venue ABIs encode to the same selectors as live", () => {
    const meToken = "0xecb695544a3d2a64d579b3828f3f60f6932f4846";
    const recipient = "0x8f8c5df780cab54adfc5a8fdd8406d91bac5bf10";

    const confirmedCalldata = encodeFunctionData({
      abi: confirmedMintAbi,
      functionName: "mint",
      args: [meToken, 1_000_000n, recipient],
    });
    expect(confirmedCalldata.slice(0, 10)).toBe(LIVE_MINT_SELECTOR);

    const quoteCalldata = encodeFunctionData({
      abi: foundryQuoteAbi,
      functionName: "calculateMeTokensMinted",
      args: [meToken, 1_000_000n],
    });
    expect(quoteCalldata.slice(0, 10)).toBe(LIVE_QUOTE_SELECTOR);
  });

  it("provisional 2-arg mint selector differs from live 3-arg mint (fail-closed staging)", () => {
    const meToken = "0xecb695544a3d2a64d579b3828f3f60f6932f4846";
    const provisionalCalldata = encodeFunctionData({
      abi: provisionalMintAbi,
      functionName: "mint",
      args: [meToken, 1_000_000n],
    });
    expect(provisionalCalldata.slice(0, 10)).not.toBe(LIVE_MINT_SELECTOR);
    expect(provisionalCalldata.slice(0, 10)).toBe(toFunctionSelector("mint(address,uint256)"));
  });
});
