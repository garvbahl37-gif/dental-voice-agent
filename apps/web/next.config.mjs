/** @type {import('next').NextConfig} */
export default {
  devIndicators: false,
  transpilePackages: ['@vaani/shared', '@vaani/db'],
  eslint: { ignoreDuringBuilds: true },
}
