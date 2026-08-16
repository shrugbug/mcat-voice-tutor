import type { NextConfig } from "next";
import { withSentryConfig } from "@sentry/nextjs";

const nextConfig: NextConfig = {
  // SENTRY_DSN is intentionally NOT mapped through `env`. Server code reads it at
  // runtime from process.env.SENTRY_DSN so a changed env var takes effect on restart.
  // The browser bundle uses NEXT_PUBLIC_SENTRY_DSN; Next.js inlines that at build
  // time, so changing it requires a rebuild.
};

// Source-map upload at build time (release tracking, readable stack traces). Uses a
// separate org:ci-scoped SENTRY_CI_TOKEN rather than the nightly reader's
// event:read-scoped SENTRY_AUTH_TOKEN -- see SENTRY-VPS-SETUP.sh. Inert (no-op) when
// no token is set, so this is safe to ship before the VPS is configured.
export default withSentryConfig(nextConfig, {
  org: process.env.SENTRY_ORG,
  project: process.env.SENTRY_PROJECT,
  authToken: process.env.SENTRY_CI_TOKEN ?? process.env.SENTRY_AUTH_TOKEN,
  widenClientFileUpload: true,
  tunnelRoute: "/monitoring",
  silent: !process.env.CI,
});
