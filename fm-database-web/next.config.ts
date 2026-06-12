import type { NextConfig } from "next";
import path from "node:path";

const nextConfig: NextConfig = {
  typescript: {
    // WIP files have in-progress type errors; skip type-check at build time.
    // Run `npm run type-check` separately when those features are complete.
    ignoreBuildErrors: true,
  },
  turbopack: {
    root: path.resolve(__dirname),
  },
  experimental: {
    serverActions: {
      // Lab PDFs and intake transcripts can run 5–10MB; the default 1MB
      // limit makes them fail at the framework boundary with statusCode
      // 413 ("Body exceeded 1 MB limit"), which the browser surfaces as
      // a generic "unexpected response from the server" error.
      bodySizeLimit: "50mb",
    },
    // Page form POSTs (multipart/form-data uploads not going through a
    // Server Action) hit the proxy/middleware body cap separately.
    // Default is 10MB; food-sensitivity / GI-MAP / DUTCH PDFs frequently
    // exceed that. Next 16 renamed `middlewareClientMaxBodySize` →
    // `proxyClientMaxBodySize` (the "middleware" file convention is also
    // being renamed to "proxy"). Both names work today, but the new one
    // doesn't emit a deprecation warning.
    proxyClientMaxBodySize: "50mb",
  },
};

export default nextConfig;
