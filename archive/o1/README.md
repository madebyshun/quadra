# archive/o1 — launching through o1, retired 2026-10-02

The owner took o1 out of the Launch window on 2026-10-02, once this app's own launchpad
(`contracts/src/LaunchFactory.sol`) had launched a real token and collected its fees. Kept here,
outside tsconfig's include, so it neither builds nor counts toward coverage:

- `src/features/panels/LaunchPanel.tsx` — the o1 form (as `O1Launch`) beside the launchpad
- `src/adapters/http/o1.ts` — the prepare call, `checkPlan`, the factory reads
- `src/config/o1.ts` — o1's factory address (verified), pairs, limits
- `src/server/o1.ts` — the dev-server route holding `O1_API_KEY`
- `tests/launch.test.tsx` — its tests

To bring it back: move the files to the same paths under the repo root, restore the `devO1` plugin in
`vite.config.ts` and `O1_API_KEY` in `.env.example`, and the mode chips in `LaunchPanel.tsx`.
o1's public API answered 500 on every route the whole time it was built against.
