import { defineConfig, loadEnv, type Plugin } from "vite";
import preact from "@preact/preset-vite";

function headers(api: string): Plugin {
  const origin = api ? new URL(api).origin : "";
  const csp = [
    "default-src 'none'",
    "script-src 'self'",
    "style-src 'self' 'unsafe-inline'",
    "img-src 'self' data:",
    "font-src 'self'",
    `connect-src 'self' ${origin}`.trim(),
    "manifest-src 'self'",
    "base-uri 'none'",
    "form-action 'self'",
    "frame-ancestors 'none'",
  ].join("; ");
  const body = [
    "/*",
    `  Content-Security-Policy: ${csp}`,
    "  X-Frame-Options: DENY",
    "  X-Content-Type-Options: nosniff",
    "  Referrer-Policy: no-referrer",
    "  Permissions-Policy: camera=(), microphone=(), geolocation=(), payment=()",
    "  Cross-Origin-Opener-Policy: same-origin",
    "  Strict-Transport-Security: max-age=63072000; includeSubDomains",
    "",
    "/assets/*",
    "  Cache-Control: public, max-age=31536000, immutable",
    "",
  ].join("\n");
  return {
    name: "nativecloud-headers",
    apply: "build",
    generateBundle() {
      this.emitFile({ type: "asset", fileName: "_headers", source: body });
    },
  };
}

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, ".", "VITE_");
  return {
    plugins: [preact(), headers(env.VITE_SUPABASE_URL ?? "")],
    build: { target: "es2022", sourcemap: false, assetsInlineLimit: 0 },
    server: { host: "127.0.0.1", port: 5173, strictPort: true },
    preview: { host: "127.0.0.1" },
    test: { include: ["tests/unit/**/*.test.ts"], environment: "node" },
  };
});
