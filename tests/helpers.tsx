import { act, render, type RenderResult } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { App } from "@/App";

/** Match main.tsx, so tests exercise the same router behaviour production has. */
export const ROUTER_FUTURE = { v7_startTransition: true, v7_relativeSplatPath: true } as const;

/**
 * Mount the real app at a url. MemoryRouter rather than BrowserRouter because
 * jsdom shares one history per file and tests would leak location into each other.
 */
export function renderAt(path: string): RenderResult {
  return render(
    <MemoryRouter initialEntries={[path]} future={ROUTER_FUTURE}>
      <App />
    </MemoryRouter>,
  );
}

/**
 * Let a panel's load effect resolve before asserting.
 *
 * Panels that read from an adapter set state in a `.then`, which lands outside
 * `act` and makes React warn. Only the windows that open a real panel need this,
 * so it is separate from `renderAt` rather than making every route test async.
 */
export async function settle(): Promise<void> {
  await act(async () => {});
}
