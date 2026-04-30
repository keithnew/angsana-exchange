// =============================================================================
// Vitest configuration for angsana-exchange.
//
// Scope (R2 PVS Slice 1, task 7b):
//   • Pure-logic unit tests for business rules that gate prod traffic —
//     `src/lib/wishlists/notesClassifier.ts` and
//     `src/lib/workItems/stateMachine.ts`.
//
// Out of scope (intentional, see spec §13):
//   • React component tests, route-handler tests, E2E. Those live in
//     Cegid-Spain smoke (task 7c) and a future tooling pass.
//
// The path alias `@/` matches `tsconfig.json` so test files can import
// from `@/lib/...` exactly like app code.
// =============================================================================

import { defineConfig } from 'vitest/config';
import path from 'node:path';

export default defineConfig({
  resolve: {
    alias: {
      '@': path.resolve(__dirname, 'src'),
    },
  },
  test: {
    include: ['tests/**/*.test.ts'],
    environment: 'node',
    globals: false,
  },
});
