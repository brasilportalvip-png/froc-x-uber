import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import path from 'path';
import {defineConfig} from 'vite';
import {VitePWA} from 'vite-plugin-pwa';

export default defineConfig(() => {
  return {
    plugins: [
      {
        // Códigos de verificação do Google Search Console e do Bing Webmaster (variáveis na Vercel).
        name: 'froc-site-verification',
        transformIndexHtml(html: string) {
          const tags = [
            process.env.GOOGLE_SITE_VERIFICATION && `<meta name="google-site-verification" content="${process.env.GOOGLE_SITE_VERIFICATION.replace(/"/g, '')}" />`,
            process.env.BING_SITE_VERIFICATION && `<meta name="msvalidate.01" content="${process.env.BING_SITE_VERIFICATION.replace(/"/g, '')}" />`,
          ].filter(Boolean);
          return tags.length ? html.replace('</head>', `    ${tags.join('\n    ')}\n  </head>`) : html;
        },
      },
      react(),
      tailwindcss(),
      VitePWA({
        registerType: 'autoUpdate',
        includeAssets: ['icon.svg', 'favicon.ico', 'favicon-48x48.png', 'og-froc-x.jpg', 'apple-touch-icon.png', 'pwa-192x192.png', 'pwa-512x512.png', 'pwa-maskable-512x512.png'],
        manifest: {
          id: '/',
          name: 'Froc X Uber',
          short_name: 'Froc X',
          description: 'Corridas, preço negociado, caronas entre cidades, fretes e entregas num app só.',
          lang: 'pt-BR',
          dir: 'ltr',
          categories: ['travel', 'navigation', 'business'],
          theme_color: '#050505',
          background_color: '#050505',
          display: 'standalone',
          start_url: '/',
          scope: '/',
          orientation: 'portrait-primary',
          icons: [
            {
              src: '/pwa-192x192.png',
              sizes: '192x192',
              type: 'image/png',
              purpose: 'any',
            },
            {
              src: '/pwa-512x512.png',
              sizes: '512x512',
              type: 'image/png',
              purpose: 'any',
            },
            {
              src: '/pwa-maskable-512x512.png',
              sizes: '512x512',
              type: 'image/png',
              purpose: 'maskable',
            },
          ],
        },
        workbox: {
          globPatterns: ['**/*.{js,css,html,ico,png,svg,jpg,woff,woff2}'],
          navigateFallbackDenylist: [/^\/\.well-known\//, /^\/api\//, /^\/legal\//, /^\/blog/, /^\/sitemap/, /^\/rss\.xml/, /^\/robots\.txt/, /^\/(corridas-por-aplicativo|caronas-intermunicipais|fretes-e-mudancas|seja-motorista|como-funciona|regras-e-requisitos|perguntas-frequentes|desenvolvedores)/],
          runtimeCaching: [
            {
              urlPattern: /^https:\/\/fonts\.googleapis\.com\/.*/i,
              handler: 'CacheFirst',
              options: {
                cacheName: 'google-fonts-cache',
                expiration: {
                  maxEntries: 10,
                  maxAgeSeconds: 60 * 60 * 24 * 365,
                },
                cacheableResponse: {
                  statuses: [0, 200],
                },
              },
            },
            {
              urlPattern: /^https:\/\/fonts\.gstatic\.com\/.*/i,
              handler: 'CacheFirst',
              options: {
                cacheName: 'gstatic-fonts-cache',
                expiration: {
                  maxEntries: 10,
                  maxAgeSeconds: 60 * 60 * 24 * 365,
                },
                cacheableResponse: {
                  statuses: [0, 200],
                },
              },
            },
          ],
        },
        devOptions: {
          enabled: true,
          type: 'module',
        },
      }),
    ],
    // Mapa do código no site publicado: o console mostra o nome real do arquivo e da linha do erro.
    build: { sourcemap: true },
    resolve: {
      alias: {
        '@': path.resolve(__dirname, '.'),
      },
    },
    server: {
      hmr: process.env.DISABLE_HMR !== 'true',
      watch: process.env.DISABLE_HMR === 'true' ? null : {},
    },
  };
});
