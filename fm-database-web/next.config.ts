import type { NextConfig } from "next";
import path from "node:path";

const nextConfig: NextConfig = {
  typescript: {
    // Type errors now FAIL the build. The codebase type-checks clean
    // (`npm run type-check` == 0 errors, enforced in CI), so there's no reason
    // to ship past a regression silently — which is exactly what the old
    // `ignoreBuildErrors: true` allowed.
    ignoreBuildErrors: false,
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
