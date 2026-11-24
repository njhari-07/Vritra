import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vite';
import tailwindcss from '@tailwindcss/vite';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

export default defineConfig({
  plugins: [tailwindcss()],
  resolve: {
    // `@/` points at src/, as shadcn/ui expects (see jsconfig.json and components.json).
    alias: {
      '@': path.resolve(__dirname, './src')
    }
  },
  server: {
    proxy: {
      '/api': 'http://127.0.0.1:8765'
    }
  },
  build: {
    rollupOptions: {
      output: {
        manualChunks: {
          'vendor-vis': ['vis-network', 'vis-data'],
          'vendor-react': ['react', 'react-dom']
        }
      }
    }
  }
});
