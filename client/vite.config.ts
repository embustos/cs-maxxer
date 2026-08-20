import path from 'node:path'
import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'

export default defineConfig({
  plugins: [react(), tailwindcss()],
  resolve: {
    // shadcn generates imports as `@/components/ui/...`, so this alias is required
    // for any shadcn component to resolve.
    alias: { '@': path.resolve(__dirname, './src') },
  },
})
