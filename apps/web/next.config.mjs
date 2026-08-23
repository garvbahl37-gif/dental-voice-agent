/** @type {import('next').NextConfig} */
export default {
  devIndicators: false,
  transpilePackages: [
    '@vaani/shared',
    '@vaani/db',
    '@vaani/knowledge',
    '@vaani/agent',
    '@vaani/core',
    '@vaani/live',
    '@vaani/providers',
    '@vaani/session-host',
  ],
  /**
   * Left for Node to load, not bundled.
   *
   * The Gemini SDK opens its own WebSocket through `ws`, which reaches for
   * native masking helpers at runtime. Bundling it replaced those with stubs
   * and every call died on "b.mask is not a function" the moment it tried to
   * talk to Live.
   */
  serverExternalPackages: ['@google/genai', 'ws', 'bufferutil', 'utf-8-validate'],
  eslint: { ignoreDuringBuilds: true },
}
