import { defineConfig } from 'vite';

export default defineConfig({
  base: './',
  // Prebundle the lazy exporter and worker dependencies before the first
  // conversion, so Vite does not discover them and reload the preview mid-save.
  optimizeDeps: { include: ['gifenc', 'three/addons/utils/SkeletonUtils.js'] },
  server: { allowedHosts: ['.e2b.app'] },
  preview: { allowedHosts: ['.e2b.app'] },
  build: {
    rollupOptions: {
      output: {
        manualChunks(id) {
          if (id.replaceAll('\\', '/').endsWith('/three/build/three.core.js')) return 'three-core';
        },
      },
    },
  },
});
