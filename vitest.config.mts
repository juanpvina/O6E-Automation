import { defineConfig } from 'vitest/config';
import { fileURLToPath } from 'node:url';

export default defineConfig({
  resolve: {
    alias: {
      '@opencode/shared': fileURLToPath(new URL('./packages/shared/src/types.ts', import.meta.url))
    }
  },
  test: {
    include: ['packages/**/*.test.ts', 'packages/**/*.test.tsx'],
    environment: 'node'
  }
});
