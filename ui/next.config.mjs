/** @type {import('next').NextConfig} */
const nextConfig = {
  experimental: {
    serverComponentsExternalPackages: ['@aws-sdk/client-sqs', '@aws-sdk/client-dynamodb', '@aws-sdk/lib-dynamodb'],
  },
};

export default nextConfig;
