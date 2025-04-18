
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { defineConfig } from 'vite'
import dts from 'vite-plugin-dts'

const __dirname = dirname(fileURLToPath(import.meta.url))

export default defineConfig({
  build: {
    lib: {
      entry: resolve(__dirname, 'src/index.ts'),
      name: 'ome-zarr',
      // the proper extensions will be added
      fileName: 'ome-zarr',
    },
    rollupOptions: {
      // make sure to externalize deps that shouldn't be bundled
      // into your library
      external: ['zarrita'],
      output: {
        // Provide global variables to use in the UMD build
        // for externalized deps
        globals: {
            zarrita: 'zarr',
        },
      },
    },
  },
  // generate single ome-zarr.d.ts file on build
  plugins: [dts({ tsconfigPath: './tsconfig.json', rollupTypes: true })]
})
