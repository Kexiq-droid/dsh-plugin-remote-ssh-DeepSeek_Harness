import { defineConfig } from 'tsup';

export default defineConfig([
  {
    entry: { host: 'src/host/index.ts' },
    format: ['cjs', 'esm'],
    target: 'node18',
    platform: 'node',
    bundle: true,
    noExternal: ['ssh2', 'ssh-config'],
    external: ['electron', 'cpu-features', '@cordisjs/core'],
    clean: true,
    sourcemap: true,
    dts: false
  },
  {
    entry: { client: 'src/client/index.ts' },
    format: ['esm', 'cjs'],
    target: 'es2022',
    platform: 'browser',
    bundle: true,
    clean: false,
    sourcemap: true,
    dts: false
  }
]);