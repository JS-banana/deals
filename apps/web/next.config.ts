import { existsSync } from 'node:fs';
import path from 'node:path';
import type { NextConfig } from 'next';
import createNextIntlPlugin from 'next-intl/plugin';

// Local Compose and workspace commands share one .env at the repository root.
const workspaceEnv = path.join(import.meta.dirname, '../../.env');
if (process.env.NODE_ENV === 'development' && existsSync(workspaceEnv)) {
  process.loadEnvFile(workspaceEnv);
}

const nextConfig: NextConfig = {
  output: 'standalone',
  outputFileTracingRoot: path.join(import.meta.dirname, '../..'),
  transpilePackages: ['@deals/core', '@deals/db'],
  poweredByHeader: false,
  // Keep an internal locale rewrite on the original origin, including numeric loopback hosts.
  skipProxyUrlNormalize: true,
  turbopack: {
    rules: {
      '*.css': {
        loaders: ['@tailwindcss/turbopack'],
        as: '*.css',
      },
    },
  },
};

export default createNextIntlPlugin('./src/i18n/request.ts')(nextConfig);
