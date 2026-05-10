import type { NextConfig } from "next";
import path from "node:path";

const nextConfig: NextConfig = {
  turbopack: {
    root: path.resolve(__dirname),
  },
  experimental: {
    serverActions: {
      // Lab PDFs and intake transcripts can run 5-10MB; the default 1MB
      // limit makes them fail at the framework boundary with statusCode
      // 413 ("Body exceeded 1 MB limit"), which the browser surfaces as
      // a generic "unexpected response from the server" error.
      bodySizeLimit: "20mb",
    },
  },
};

export default nextConfig;
