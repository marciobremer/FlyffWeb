/** @type {import('next').NextConfig} */
const nextConfig = {
  output: 'standalone',
  // NEXT_DIST_DIR permite um `next dev` de teste sem mexer no .next do site em produção
  distDir: process.env.NEXT_DIST_DIR || '.next',
  images: {
    domains: ['localhost'],
    unoptimized: true
  },
  // Disable React StrictMode in production if you have issues with double renders
  reactStrictMode: false,
  // Enable static compression for better performance
  compress: true,
  // Add powered by header
  poweredByHeader: false,
  // Configure environment variables
  env: {
    NEXT_PUBLIC_API_URL: process.env.NEXT_PUBLIC_API_URL,
  },
  // Handle 404s and redirects
  async redirects() {
    return [
      {
        source: '/home',
        destination: '/',
        permanent: true,
      },
    ]
  },
  // Custom error handling
  async rewrites() {
    return {
      beforeFiles: [
        // Add any API rewrites here
        {
          source: '/api/:path*',
          destination: '/api/:path*',
        },
      ],
      fallback: [
        {
          source: '/:path*',
          destination: '/_error',
        },
      ],
    }
  },
  // Add proper headers for security
  async headers() {
    return [
      {
        source: '/(.*)',
        headers: [
          {
            key: 'X-Content-Type-Options',
            value: 'nosniff',
          },
          {
            key: 'X-Frame-Options',
            value: 'DENY',
          },
          {
            key: 'X-XSS-Protection',
            value: '1; mode=block',
          },
        ],
      },
    ]
  },
}

module.exports = nextConfig 