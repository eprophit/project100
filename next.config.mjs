/** @type {import('next').NextConfig} */
const nextConfig = {
  // node:sqlite is a Node builtin behind an experimental flag; keep it out of the
  // bundler's module graph so the server runtime resolves it natively.
  serverExternalPackages: ['node:sqlite'],
  experimental: {
    // Route handlers touching the DB must run on the Node runtime, never edge.
    serverActions: { bodySizeLimit: '2mb' },
  },
};

export default nextConfig;
