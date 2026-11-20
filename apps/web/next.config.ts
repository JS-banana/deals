import path from 'node:path';
import type { NextConfig } from 'next';
import createNextIntlPlugin from 'next-intl/plugin';

const nextConfig: NextConfig = {
  output: 'standalone',
  outputFileTracingRoot: path.join(import.meta.dirname, '../..'),
  transpilePackages: ['@deals/core', '@deals/db'],
  poweredByHeader: false,
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
