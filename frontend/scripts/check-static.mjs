// Phase 8 exit check: the public build must contain no API key, no model or backend URL,
// and no live-API code; an exported bundle must carry no identifiers or contact details.
// Run after `npm run build:static`. Exits non-zero on any finding.
import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join } from 'node:path'

const CODE = [
  [/api\.typesafe\.ai/i, 'the Jev API host'],
  [/TYPESAFE_API_KEY|typesafe_api_key/, 'the API key variable'],
  [/\bsk-[A-Za-z0-9_-]{16,}/, 'a secret-key-like string'],
  [/localhost:800[01]|127\.0\.0\.1:800[01]/, 'a local backend URL'],
  [/\/runs\/preflight|\/datasets\/csv|new EventSource\(/, 'live-API code'],
]
const DATA = [
  [/"author_hash"|"ext_id"|"steamid"/, 'an identifier field'],
  [/[\w.+-]+@[\w-]+\.[a-z]{2,}/i, 'an e-mail address'],
  [/TYPESAFE_API_KEY|api\.typesafe\.ai/i, 'a model API reference'],
]

function* files(dir) {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name)
    if (statSync(p).isDirectory()) yield* files(p)
    else yield p
  }
}

let findings = 0
let scanned = 0
for (const file of files('dist')) {
  const isData = file.includes(`${'dist'}${file.includes('\\') ? '\\' : '/'}bundle`)
  if (!/\.(js|html|css|json|txt)$/.test(file)) continue
  const text = readFileSync(file, 'utf8')
  scanned++
  for (const [rx, what] of isData ? DATA : CODE) {
    const m = text.match(rx)
    if (m) {
      findings++
      console.error(`${file}: ${what} (${JSON.stringify(m[0].slice(0, 40))})`)
    }
  }
}
console.log(`checked ${scanned} files: ${findings ? `${findings} finding(s)` : 'clean'}`)
process.exit(findings ? 1 : 0)
