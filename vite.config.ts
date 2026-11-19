import { defineConfig } from "vite";
import react from "@vitejs/plugin-react-swc";
import path from "path";
import { componentTagger } from "lovable-tagger";
import { VitePWA } from "vite-plugin-pwa";

export default defineConfig(({ mode }) => ({
  define: {
    __APP_BUILD_ID__: JSON.stringify(process.env.VERCEL_GIT_COMMIT_SHA || process.env.COMMIT_REF || Date.now().toString()),
  },
  server: {
    host: "::",
    port: 8080,
    hmr: {
      overlay: false,
    },
    // Local development talks to the live server for /api and the database API.
    // DEV_UPSTREAM may be an IP (when local DNS lags); the Host header picks the site.
    proxy: Object.fromEntries(
      ["/api", "/auth/v1", "/rest/v1", "/storage/v1", "/functions/v1", "/realtime/v1"].map((p) => [
        p,
        {
          target: process.env.DEV_UPSTREAM || "https://garage.jmsurf.co.ke",
          changeOrigin: false,
          secure: false,
          ws: p === "/realtime/v1",
          headers: { Host: "garage.jmsurf.co.ke" },
        },
      ]),
    ),
  },
  plugins: [
    react(),
    mode === "development" && componentTagger(),
    VitePWA({
      registerType: "autoUpdate",
      injectRegister: null,
      filename: "sw.js",
      includeAssets: ["favicon.svg", "favicon.ico", "jm-favicon.ico", "jm-icon-32.png", "jm-icon-180.png", "jm-icon-192.png", "jm-icon-512.png", "jm-icon-maskable-512.png"],
      devOptions: { enabled: false },
      workbox: {
        cleanupOutdatedCaches: true,
        skipWaiting: true,
        clientsClaim: true,
        maximumFileSizeToCacheInBytes: 6 * 1024 * 1024,
        globPatterns: ["**/*.{js,css,html,ico,png,svg,woff2,woff,ttf}"],
        // No navigateFallback: the page itself always comes from the network when online. A precached
        // index.html saved while a release was rolling out pointed at the previous build and kept
        // visitors on it until the next release. Offline, the saved shell below is used instead.
        // (vite-plugin-pwa turns navigateFallback on unless it is explicitly null.)
        navigateFallback: null,
        runtimeCaching: [
          {
            urlPattern: ({ request, url }) => request.mode === "navigate" && !url.pathname.startsWith("/api/"),
            handler: "NetworkFirst",
            options: {
              cacheName: "pages-cache",
              // Long enough for a server that is just starting after a release; the saved page is for offline.
              networkTimeoutSeconds: 20,
              cacheableResponse: { statuses: [200] },
              precacheFallback: { fallbackURL: "index.html" },
              expiration: { maxEntries: 30, maxAgeSeconds: 60 * 60 * 24 * 7 },
            },
          },
          {
            // Company data (read requests only) so the app opens offline. Any host: every company address
            // reads the database through garage.jmsurf.co.ke.
            urlPattern: ({ url, request }) => request.method === "GET" && /\/rest\/v1\//.test(url.pathname),
            handler: "NetworkFirst",
            options: {
              cacheName: "api-cache",
              networkTimeoutSeconds: 5,
              expiration: { maxEntries: 300, maxAgeSeconds: 60 * 60 * 24 * 7 },
              cacheableResponse: { statuses: [0, 200] },
            },
          },
          {
            urlPattern: ({ url, request }) => request.method === "GET" && /\/storage\/v1\/object\/public\//.test(url.pathname) && !/\.(mp4|webm|mov|m4v)$/i.test(url.pathname) && request.destination !== "video",
            handler: "CacheFirst",
            options: {
              cacheName: "storage-cache",
              expiration: { maxEntries: 400, maxAgeSeconds: 60 * 60 * 24 * 30 },
              cacheableResponse: { statuses: [0, 200] },
            },
          },
          {
            urlPattern: /^https:\/\/fonts\.googleapis\.com\/.*/i,
            handler: "CacheFirst",
            options: {
              cacheName: "google-fonts-cache",
              expiration: { maxEntries: 10, maxAgeSeconds: 60 * 60 * 24 * 365 },
            },
          },
          {
            urlPattern: /^https:\/\/fonts\.gstatic\.com\/.*/i,
            handler: "CacheFirst",
            options: {
              cacheName: "google-fonts-assets",
              expiration: { maxEntries: 30, maxAgeSeconds: 60 * 60 * 24 * 365 },
            },
          },
        ],
      },
      manifest: {
        name: "JMSURF Garage - All-in-One Business Management",
        short_name: "JMSURF Garage",
        description: "Books, inventory, CRM, HRM, projects and more for businesses everywhere",
        theme_color: "#a8121b",
        background_color: "#f6f6f7",
        display: "standalone",
        orientation: "any",
        scope: "/",
        start_url: "/",
        icons: [
          {
            src: "/jm-icon-192.png",
            sizes: "192x192",
            type: "image/png",
          },
          {
            src: "/jm-icon-512.png",
            sizes: "512x512",
            type: "image/png",
          },
          {
            src: "/jm-icon-maskable-512.png",
            sizes: "512x512",
            type: "image/png",
            purpose: "maskable",
          },
        ],
        categories: ["business", "finance", "productivity"],
      },
    }),
  ].filter(Boolean),
  build: {
    rollupOptions: {
      output: {
        // Libraries change rarely; keeping them in their own files means a
        // new release only re-downloads the app code, not React and friends.
        manualChunks(id: string) {
          if (!id.includes("node_modules")) return;
          if (/[\\/]node_modules[\\/](react|react-dom|scheduler|react-router|react-router-dom|@remix-run)[\\/]/.test(id)) return "vendor-react";
          if (id.includes("@supabase")) return "vendor-supabase";
          if (id.includes("@tanstack")) return "vendor-query";
          if (id.includes("@radix-ui")) return "vendor-radix";
          if (id.includes("lucide-react")) return "vendor-icons";
        },
      },
    },
  },
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
      // react-helmet-async 3 never writes <head> under React 18; see src/lib/head.tsx.
      "react-helmet-async": path.resolve(__dirname, "./src/lib/head.tsx"),
    },
  },
}));
