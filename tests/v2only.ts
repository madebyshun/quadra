import { afterEach, beforeEach } from "vitest";
import { CONTRACTS } from "@/config/chain";

/**
 * For a file whose fixtures are real v2/v1 captures: run it with launchpad v3 unset, exactly as
 * the app behaved before v3 was deployed (2026-10-22), and restore the real config after each test.
 */
export function withoutV3(): void {
  const saved = CONTRACTS.launchFactoryV3;
  const target = CONTRACTS as { launchFactoryV3: typeof saved };
  beforeEach(() => { target.launchFactoryV3 = null; });
  afterEach(() => { target.launchFactoryV3 = saved; });
}
