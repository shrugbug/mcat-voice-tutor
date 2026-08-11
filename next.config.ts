import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // SENTRY_DSN is intentionally NOT mapped through `env`. Server code reads it at
  // runtime from process.env.SENTRY_DSN so a changed env var takes effect on restart.
  // The browser bundle uses NEXT_PUBLIC_SENTRY_DSN; Next.js inlines that at build
  // time, so changing it requires a rebuild.
};

export default nextConfig;
