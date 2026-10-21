import { defineConfig } from 'vite';

export default defineConfig({
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
