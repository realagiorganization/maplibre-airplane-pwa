import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { VitePWA } from 'vite-plugin-pwa'

const pwaName = 'MapLibre Airplane PWA'
const pwaDescription =
  'Fly a rudimentary 3D airplane over an open-source 3D map scene powered by MapLibre and OpenFreeMap.'

export default defineConfig(({ command }) => ({
  base: command === 'build' ? './' : '/',
  build: {
    chunkSizeWarningLimit: 1200,
    rollupOptions: {
      output: {
        manualChunks: {
          map: ['maplibre-gl'],
        },
      },
    },
  },
  plugins: [
    react(),
    VitePWA({
      registerType: 'autoUpdate',
      injectRegister: false,
      includeAssets: ['plane-icon.svg'],
      manifest: {
        name: pwaName,
        short_name: 'Flight PWA',
        description: pwaDescription,
        theme_color: '#07141c',
        background_color: '#07141c',
        display: 'standalone',
        orientation: 'landscape',
        scope: './',
        start_url: './',
        icons: [
          {
            src: 'plane-icon.svg',
            sizes: 'any',
            type: 'image/svg+xml',
            purpose: 'any maskable',
          },
        ],
      },
      workbox: {
        globPatterns: ['**/*.{js,css,html,svg,png,webmanifest}'],
      },
    }),
  ],
}))
