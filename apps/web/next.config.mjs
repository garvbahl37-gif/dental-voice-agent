/** @type {import('next').NextConfig} */
export default {
  devIndicators: false,
  transpilePackages: ['@vaani/shared', '@vaani/agent', '@vaani/live'],
  eslint: { ignoreDuringBuilds: true },
}
