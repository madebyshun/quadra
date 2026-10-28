import { BaseLaunch } from "@/features/panels/BaseLaunch";

/**
 * Launch a coin on Base through this app's own launchpad (`BaseLaunch.tsx`).
 *
 * o1 sat beside it until 2026-10-02, when the owner took it out ("bỏ o1 khỏi launch") after the
 * launchpad's first real launch and fee collection had both worked. Its window, adapter, server
 * route and tests are in `archive/o1/`, outside the build — reversible, not deleted.
 */
export function LaunchPanel() {
  return <BaseLaunch />;
}
