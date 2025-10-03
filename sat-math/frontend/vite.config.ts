import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react-swc'

// https://vite.dev/config/
export default defineConfig({
  plugins: [react()],
  // Ensure assets resolve correctly on GitHub Pages under /dsat-math/
  base: '/dsat-math/',
  build: {
    outDir: 'dist',
    emptyOutDir: true,
  },
})
