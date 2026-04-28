/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  // Self-contained server bundle. Lets us deploy a ~50MB .next/standalone/
  // instead of shipping the full ~480MB node_modules. Critical on 1GB EC2.
  output: 'standalone',
  experimental: {
    instrumentationHook: true,
  },
};

export default nextConfig;
