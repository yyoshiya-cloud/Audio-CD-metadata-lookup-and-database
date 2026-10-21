import { defineConfig } from 'vitest/config';

// 画面（React コンポーネント）のテスト用。ロジックのテストは scripts/verify_*.ts（npm test）で実行する。
export default defineConfig({
  test: {
    environment: 'jsdom',
    include: ['src/**/*.test.{ts,tsx}'],
    setupFiles: ['./src/test/setup.ts'],
  },
});
