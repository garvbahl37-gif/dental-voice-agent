/** @type {import('next').NextConfig} */
export default {
  devIndicators: false,
  transpilePackages: ['@vaani/shared', '@vaani/db', '@vaani/knowledge'],
  eslint: { ignoreDuringBuilds: true },
}
