/** @type {import('next').NextConfig} */
export default {
  devIndicators: false,
  transpilePackages: ['@vaani/shared'],
  eslint: { ignoreDuringBuilds: true },
}
