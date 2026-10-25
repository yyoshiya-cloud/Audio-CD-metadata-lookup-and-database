import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { defineConfig } from 'vite';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

function getPackageVersion(): string {
  try {
    const pkgRaw = fs.readFileSync(path.resolve(__dirname, 'package.json'), 'utf-8');
    const pkg = JSON.parse(pkgRaw);
    return pkg.version || '1.1.2';
  } catch {
    return '1.1.2';
  }
}

function getBuildDateJST(): string {
  const jstTime = new Date(Date.now() + 9 * 60 * 60 * 1000);
  return jstTime.toISOString().slice(0, 10);
}

export default defineConfig(() => {
  const appVersion = getPackageVersion();
  const buildDateJST = getBuildDateJST();

  return {
    define: {
      __APP_VERSION__: JSON.stringify(appVersion),
      __BUILD_DATE_JST__: JSON.stringify(buildDateJST),
    },
    plugins: [react(), tailwindcss()],
    resolve: {
      alias: {
        '@': path.resolve(__dirname, './src'),
      },
    },
    server: {
      allowedHosts: [
        'audio-cd-metadata-lookup-and-database.onrender.com',
        '.onrender.com',
        '.run.app',
      ],
      // HMR is disabled in AI Studio via DISABLE_HMR env var.
      // Do not modify—file watching is disabled to prevent flickering during agent edits.
      hmr: process.env.DISABLE_HMR !== 'true',
      // Disable file watching when DISABLE_HMR is true to save CPU during agent edits.
      watch: process.env.DISABLE_HMR === 'true' ? null : {},
    },
  };
});
