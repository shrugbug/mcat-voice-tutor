import type { NextConfig } from "next";
import { withSentryConfig } from "@sentry/nextjs";

const nextConfig: NextConfig = {
  // SENTRY_DSN is intentionally NOT mapped through `env`. Server code reads it at
  // runtime from process.env.SENTRY_DSN so a changed env var takes effect on restart.
  // The browser bundle uses NEXT_PUBLIC_SENTRY_DSN; Next.js inlines that at build
  // time, so changing it requires a rebuild.
};

// Source-map upload at build time (release tracking, readable stack traces). Requires
// the org:ci-scoped SENTRY_CI_TOKEN -- see SENTRY-VPS-SETUP.sh. Deliberately does NOT
// fall back to the nightly reader's event:read-scoped SENTRY_AUTH_TOKEN: that token
// lacks upload permission, and the Sentry build plugin throws on an auth/permission
// error rather than skipping silently, so a bad fallback token would break the build
// instead of leaving upload as a no-op. Missing SENTRY_CI_TOKEN is the actual no-op case.
export default withSentryConfig(nextConfig, {
  org: process.env.SENTRY_ORG,
  project: process.env.SENTRY_PROJECT,
  authToken: process.env.SENTRY_CI_TOKEN,
  widenClientFileUpload: true,
  tunnelRoute: "/monitoring",
  silent: !process.env.CI,
});
