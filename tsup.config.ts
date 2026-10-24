import { defineConfig } from 'tsup';

const stubNativeAddonsPlugin = {
  name: 'stub-native-ssh-addons',
  setup(build: any) {
    build.onResolve({ filter: /^(cpu-features|.*sshcrypto\.node)$/ }, (args: any) => ({
      path: args.path,
      namespace: 'native-stub'
    }));
    build.onLoad({ filter: /.*/, namespace: 'native-stub' }, () => ({
      contents: 'throw new Error("Native addon disabled: using pure Node.js crypto fallback");',
      loader: 'js'
    }));
  }
};

export default defineConfig([
  {
    entry: { host: 'src/host/index.ts' },
    format: ['cjs', 'esm'],
    target: 'node18',
    platform: 'node',
    bundle: true,
    noExternal: ['ssh2', 'ssh-config', 'asn1', 'safer-buffer', 'bcrypt-pbkdf', 'tweetnacl'],
    external: ['electron', '@cordisjs/core'],
    esbuildPlugins: [stubNativeAddonsPlugin],
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