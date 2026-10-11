import {defineConfig} from 'vitest/config';
import react from '@vitejs/plugin-react';
import svgr from 'vite-plugin-svgr';
import * as path from 'node:path';
export default defineConfig({
  base: './',
  plugins: [react(), svgr({include: '**/*.svg?react'})],
  css: {preprocessorOptions: {scss: {loadPaths: [path.resolve(import.meta.dirname, 'src')]}}},
  resolve: {alias: {components: path.resolve(import.meta.dirname, 'src/components'), constants: path.resolve(import.meta.dirname, 'src/constants'), assets: path.resolve(import.meta.dirname, 'src/assets'), testUtils: path.resolve(import.meta.dirname, 'src/testUtils.tsx')}},
  build: {outDir: 'dist', assetsDir: 'static'},
  test: {globals: true, environment: 'happy-dom', setupFiles: './src/setupTests.ts', css: true},
});
