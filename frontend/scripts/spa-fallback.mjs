// Static hosts serve files, but the app's routes (/runs/<id>/results, /help...) are
// client-side. Each host has its own fallback: Netlify / Cloudflare Pages read
// public/_redirects, Vercel reads vercel.json, GitHub Pages serves 404.html.
import { copyFileSync, existsSync } from 'node:fs'

if (!existsSync('dist/index.html')) throw new Error('run vite build first')
copyFileSync('dist/index.html', 'dist/404.html')
if (!existsSync('dist/bundle/index.json')) {
  console.warn('warning: dist/bundle is missing: run tools/export_bundle.py before building the demo')
}
console.log('SPA fallback: dist/404.html')
