import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'node',
    globals: false,
    include: ['tests/**/*.test.js'],
    testTimeout: 10000,
    setupFiles: ['./tests/setup.js'],
    server: {
      deps: {
        // Force Vitest to inline (transform) these CJS server modules so that
        // vi.mock() intercepts their require() calls correctly.
        inline: [/server\//],
      },
    },
  },
});
