import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import ts from 'typescript'
import { collectNotices, root } from './generate-notices.mjs'

const dist = path.join(root, 'dist')
const references = new Set()
const checkedSource = new Set()
const forbiddenImports = /(?:^|\/)(?:sockette|socket\.io|firebase|plausible-tracker|@microsoft\/clarity|sentry)(?:$|\/)/i
const assetExtension = /\.(?:m?js|css|woff2?|ttf|otf|eot|svg|png|jpe?g|gif|webp|avif|ico|wasm|mp3|mp4|ogg|wav)(?:[?#].*)?$/i
const external = /^(?:[a-z][a-z\d+.-]*:|\/\/)/i
const harmlessURL = /^(?:https?:\/\/www\.w3\.org\/(?:1999\/xhtml|2000\/svg|1998\/Math\/MathML|1999\/xlink|XML\/1998\/namespace)|https:\/\/react\.dev\/errors\/|https?:\/\/(?:opensource\.org|spdx\.org|scripts\.sil\.org)\/(?:licenses|OFL)|https:\/\/openfontlicense\.org\/|https?:\/\/json-schema\.org\/(?:draft|schema)|https:\/\/github\.github\.com\/gfm\/)/i
const scriptExtensions = /\.[cm]?[jt]sx?$/i

function walk(directory) {
  const result = []
  for (const entry of fs.readdirSync(directory, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))) {
    const filename = path.join(directory, entry.name)
    assert(!entry.isSymbolicLink(), `Release/source must not contain symlink: ${filename}`)
    if (entry.isDirectory()) result.push(...walk(filename))
    else { assert(entry.isFile(), `Not a regular file: ${filename}`); result.push(filename) }
  }
  return result
}

function localAsset(value, from, { documentRelative = false } = {}) {
  value = value.trim().replace(/&amp;/g, '&')
  if (!value || value.startsWith('#') || /^data:/i.test(value)) return
  assert(!external.test(value), `External asset ${value} in ${path.relative(root, from)}`)
  assert(!value.includes('\\'), `Backslash in asset path: ${value}`)
  const clean = decodeURIComponent(value.split(/[?#]/)[0])
  const target = clean.startsWith('/')
    ? path.resolve(dist, '.' + clean)
    : path.resolve(documentRelative ? dist : path.dirname(from), clean)
  assert(target.startsWith(dist + path.sep), `Asset escapes release: ${value}`)
  assert(fs.existsSync(target) && fs.statSync(target).isFile(), `Missing asset ${value} in ${path.relative(root, from)}`)
  references.add(path.relative(dist, target).split(path.sep).join('/'))
}

function scanCSS(css, filename, built) {
  const clean = css.replace(/\/\*[\s\S]*?\*\//g, '')
  for (const match of clean.matchAll(/url\(\s*(?:"([^"\n]+)"|'([^'\n]+)'|([^\s)]+))\s*\)/gi)) {
    const value = match[1] ?? match[2] ?? match[3]
    if (built) localAsset(value, filename)
    else assert(!external.test(value) || /^data:/i.test(value), `External source CSS asset ${value} in ${filename}`)
  }
  for (const match of clean.matchAll(/@import\s+['"]([^'"]+)['"]/gi)) {
    if (built) localAsset(match[1], filename)
    else assert(!external.test(match[1]), `External source CSS import ${match[1]} in ${filename}`)
  }
}

function parseSource(filename, source) {
  return ts.createSourceFile(filename, source, ts.ScriptTarget.Latest, true, filename.endsWith('.tsx') ? ts.ScriptKind.TSX : filename.endsWith('.ts') ? ts.ScriptKind.TS : ts.ScriptKind.JS)
}

function vitePreloadFetch(node, source) {
  // Vite's isolated preload polyfill fetches only <link rel=modulepreload> hrefs.
  // Those hrefs are independently verified as local assets below. No other
  // application or dependency fetch is exempted.
  let current = node.parent
  while (current && !ts.isSourceFile(current)) {
    if (ts.isFunctionExpression(current) || ts.isArrowFunction(current)) {
      const text = current.getText(source)
      if (text.length < 2500 && /createElement\(["'`]link["'`]\)/.test(text) && /modulepreload/.test(text) && /relList/.test(text)) return true
    }
    current = current.parent
  }
  return false
}

function networkCheck(source, filename, built = false) {
  const parsed = parseSource(filename, source)
  const issues = []
  const localNames = new Set()
  function bindings(node) {
    if ((ts.isVariableDeclaration(node) || ts.isParameter(node) || ts.isFunctionDeclaration(node)) && node.name) {
      const addName = name => {
        if (ts.isIdentifier(name)) localNames.add(name.text)
        else if (ts.isObjectBindingPattern(name) || ts.isArrayBindingPattern(name)) for (const element of name.elements) if (ts.isBindingElement(element)) addName(element.name)
      }
      addName(node.name)
    }
    ts.forEachChild(node, bindings)
  }
  bindings(parsed)
  const add = (node, message) => {
    const pos = parsed.getLineAndCharacterOfPosition(node.getStart(parsed))
    issues.push(`${path.relative(root, filename)}:${pos.line + 1}:${pos.character + 1}: ${message}`)
  }
  function visit(node) {
    if (ts.isStringLiteralLike(node) || node.kind === ts.SyntaxKind.TemplateHead) {
      const value = node.text
      if (/^(?:https?|wss?):\/\//i.test(value) && !harmlessURL.test(value)) add(node, `External URL remains: ${value.slice(0, 180)}`)
      if (/^\/\/[^/]/.test(value)) add(node, `Protocol-relative external URL remains: ${value.slice(0, 180)}`)
    }
    if (ts.isElementAccessExpression(node) && ts.isStringLiteralLike(node.argumentExpression)) {
      const object = node.expression.getText(parsed)
      const member = node.argumentExpression.text
      if (['WebSocket', 'XMLHttpRequest', 'EventSource', 'RTCPeerConnection', 'importScripts', 'sendBeacon'].includes(member) || member === 'fetch' && /^(?:window|globalThis|self)$/.test(object)) add(node, `Forbidden computed network API: ${member}`)
    }
    if (ts.isIdentifier(node)) {
      const name = node.text
      const memberName = ts.isPropertyAccessExpression(node.parent) && node.parent.name === node
      const propertyName = (ts.isPropertyAssignment(node.parent) || ts.isMethodDeclaration(node.parent) || ts.isPropertySignature(node.parent)) && node.parent.name === node
      if (['WebSocket', 'XMLHttpRequest', 'EventSource', 'RTCPeerConnection', 'importScripts', 'sendBeacon'].includes(name)) add(node, `Forbidden network API: ${name}`)
      if (name === 'fetch' && (!memberName && !propertyName || memberName && /^(?:window|globalThis|self)$/.test(node.parent.expression.getText(parsed)))) {
        if (!(built && vitePreloadFetch(node, parsed))) add(node, 'Forbidden network API: fetch')
      }
    }
    if (ts.isCallExpression(node)) {
      const expression = node.expression.getText(parsed)
      if (/^(?:window|globalThis|self)\.open$/.test(expression) || expression === 'open' && !localNames.has('open') || /^(?:window\.)?location\.(?:assign|replace)$/.test(expression)) add(node, `Outside navigation API: ${expression}`)
      if (/serviceWorker\s*\.\s*register$/.test(expression)) add(node, 'Service worker registration remains')
    }
    ts.forEachChild(node, visit)
  }
  visit(parsed)
  return { parsed, issues }
}

function scanJS(source, filename, built) {
  const { parsed, issues } = networkCheck(source, filename, built)
  assert.equal(issues.length, 0, issues.join('\n'))
  const imports = []
  const handled = new Set()
  function reference(node, documentRelative = false) {
    if (!node || !ts.isStringLiteralLike(node)) return
    handled.add(node)
    if (built) localAsset(node.text, filename, { documentRelative })
    else imports.push(node.text)
  }
  function visit(node) {
    if (ts.isImportDeclaration(node) && !node.importClause?.isTypeOnly) reference(node.moduleSpecifier)
    if (ts.isExportDeclaration(node) && !node.isTypeOnly) reference(node.moduleSpecifier)
    if (ts.isCallExpression(node) && node.expression.kind === ts.SyntaxKind.ImportKeyword) {
      assert(node.arguments[0] && ts.isStringLiteralLike(node.arguments[0]), `Unverifiable computed import in ${filename}`)
      reference(node.arguments[0])
    }
    if (ts.isNewExpression(node) && node.expression.getText(parsed) === 'URL' && node.arguments?.[1]?.getText(parsed) === 'import.meta.url') reference(node.arguments[0])
    if (ts.isNewExpression(node) && /^(?:Worker|SharedWorker)$/.test(node.expression.getText(parsed))) {
      const value = node.arguments?.[0]
      assert(value && (ts.isStringLiteralLike(value) || ts.isNewExpression(value) && value.expression.getText(parsed) === 'URL'), `Unverifiable worker URL in ${filename}`)
      if (ts.isStringLiteralLike(value)) reference(value, true)
    }
    ts.forEachChild(node, visit)
  }
  visit(parsed)
  if (built) {
    // Includes Vite's dependency/preload tables and font/image URL constants,
    // in addition to the import declarations and new URL references above.
    const literals = node => {
      if (ts.isStringLiteralLike(node) && !handled.has(node) && assetExtension.test(node.text) && /^(?:\.?\.?\/|assets\/|static\/|fonts\/)/.test(node.text)) {
        localAsset(node.text, filename, { documentRelative: /^(?:\.\/)?(?:assets|static|fonts)\//.test(node.text) })
      }
      if (ts.isStringLiteralLike(node) && /url\(/i.test(node.text)) scanCSS(node.text, filename, true)
      ts.forEachChild(node, literals)
    }
    literals(parsed)
  }
  return imports
}

function scanMarkup(source, filename, built) {
  const clean = source.replace(/<!--[\s\S]*?-->/g, '')
  assert(!/<base\b/i.test(clean), `Base URL can escape release: ${filename}`)
  const sourceImports = []
  for (const tag of clean.matchAll(/<([a-z][\w:-]*)\b[^>]*>/gi)) {
    const name = tag[1].toLowerCase()
    if (['iframe', 'object', 'embed'].includes(name)) assert.fail(`Embedded outside-capable document remains: ${filename}`)
    if (name === 'meta' && /http-equiv\s*=\s*['"]?refresh\b/i.test(tag[0])) assert.fail(`Meta redirect remains: ${filename}`)
    for (const attribute of tag[0].matchAll(/\b(src|href|xlink:href|poster|srcset|style|action)\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+))/gi)) {
      const key = attribute[1].toLowerCase()
      const value = attribute[2] ?? attribute[3] ?? attribute[4]
      if (key === 'style') { scanCSS(value, filename, built); continue }
      if (key === 'action') { assert(!value, `Form submission remains in ${filename}`); continue }
      if (name === 'a') {
        assert(!external.test(value) || harmlessURL.test(value), `External navigation URL in ${filename}: ${value}`)
        continue
      }
      if (key === 'srcset') {
        assert(!value.includes('data:'), `Inline srcset must be made explicit for verification: ${filename}`)
        for (const item of value.split(',')) if (built) localAsset(item.trim().split(/\s+/)[0], filename)
        continue
      }
      if (built) localAsset(value, filename)
      else {
        assert(!external.test(value) || /^data:/i.test(value), `External source markup asset ${value} in ${filename}`)
        if (name === 'script' || name === 'link') sourceImports.push(value)
      }
    }
  }
  for (const match of clean.matchAll(/<style\b[^>]*>([\s\S]*?)<\/style>/gi)) scanCSS(match[1], filename, built)
  for (const match of clean.matchAll(/<script\b([^>]*)>([\s\S]*?)<\/script>/gi)) if (match[2].trim() && !/type\s*=\s*['"](?:application\/ld\+json|application\/json)['"]/i.test(match[1])) scanJS(match[2], filename + '.js', built)
  return sourceImports
}

function scanProductionSource() {
  const configFile = ts.readConfigFile(path.join(root, 'tsconfig.json'), ts.sys.readFile)
  assert(!configFile.error, 'Unable to read tsconfig.json')
  const options = ts.parseJsonConfigFileContent(configFile.config, ts.sys, root).options
  function resolve(specifier, filename) {
    assert(!forbiddenImports.test(specifier), `Forbidden service dependency: ${specifier}`)
    assert(!external.test(specifier), `External source import: ${specifier}`)
    const clean = specifier.split('?')[0]
    const resolved = ts.resolveModuleName(clean, filename, options, ts.sys).resolvedModule?.resolvedFileName
    if (resolved) return resolved.includes(`${path.sep}node_modules${path.sep}`) ? null : resolved
    if (/^[^./]/.test(clean)) {
      // Package styles are emitted by Vite and checked in dist. Resolve local
      // aliases before concluding that an unresolved style is package-owned.
      const local = path.join(root, 'src', clean)
      if (fs.existsSync(local)) return local
      if (fs.existsSync(path.join(root, 'node_modules', clean))) return null
    }
    const candidate = clean.startsWith('/') ? path.join(root, clean) : path.resolve(path.dirname(filename), clean)
    if (fs.existsSync(candidate)) return candidate
    assert.fail(`Unresolved production source import ${specifier} from ${filename}`)
  }
  function visit(filename) {
    filename = path.resolve(filename)
    if (checkedSource.has(filename) || !fs.statSync(filename).isFile()) return
    checkedSource.add(filename)
    const source = fs.readFileSync(filename, 'utf8')
    let imports = []
    if (scriptExtensions.test(filename)) imports = scanJS(source, filename, false)
    else if (/\.(?:html|svg)$/i.test(filename)) imports = scanMarkup(source, filename, false)
    else if (/\.(?:css|scss|sass)$/i.test(filename)) {
      scanCSS(source, filename, false)
      for (const match of source.matchAll(/@(?:use|forward|import)\s+['"]([^'"]+)['"]/g)) {
        if (match[1].startsWith('sass:')) continue
        const name = match[1]
        const directory = path.dirname(filename)
        const candidates = [directory, path.join(root, 'src')].flatMap(base => [name, `${name}.scss`, path.join(path.dirname(name), `_${path.basename(name)}.scss`)].map(item => path.resolve(base, item)))
        const stylesheet = candidates.find(item => fs.existsSync(item))
        if (stylesheet) visit(stylesheet)
        else {
          const resolved = resolve(name, filename)
          if (resolved) visit(resolved)
        }
      }
    }
    for (const specifier of imports) {
      const resolved = resolve(specifier, filename)
      if (resolved) visit(resolved)
    }
  }
  visit(path.join(root, 'index.html'))
}

function selfTest() {
  const filename = path.join(root, 'src/audit-fixture.ts')
  for (const source of ["fetch('/api/board')", "window.fetch('/api/board')", "window['fetch']('/api/board')", "const f = fetch;", "new WebSocket('wss://host.test')", "navigator.sendBeacon('/track', 'x')", "new EventSource('/events')", "const x = 'https://scrumlr.io/api'", "const x = `https://${host}/api`", "window.open('https://example.com')"]) assert(networkCheck(source, filename).issues.length, `Network scanner missed ${source}`)
  assert.equal(networkCheck("// https://scrumlr.io is donor documentation\nconst license = 'https://opensource.org/licenses/MIT'; const x = 'http://www.w3.org/2000/svg';", filename).issues.length, 0)
  assert.equal(networkCheck("const x = 'https://react.dev/errors/123';", filename, true).issues.length, 0)
  assert.equal(networkCheck("function menu(open) { open(); }", filename).issues.length, 0)
  const preload = '(function(){ const p = document.createElement(`link`).relList; p.supports(`modulepreload`); function f(e){fetch(e.href)} })()'
  assert.equal(networkCheck(preload, filename, true).issues.length, 0)
  assert(networkCheck(preload, filename, false).issues.length)
  assert(networkCheck('fetch("./data.json")', filename, true).issues.length)
  assert.throws(() => localAsset('https://example.com/font.woff2', path.join(dist, 'index.html')), /External asset/)
  assert.throws(() => localAsset('../../outside.png', path.join(dist, 'index.html')), /escapes release/)
  assert.throws(() => scanCSS('@import "https://example.com/style.css";', path.join(dist, 'style.css'), true), /External asset/)
  assert.throws(() => scanMarkup('<script src="https://example.com/app.js"></script>', path.join(dist, 'index.html'), true), /External asset/)
  console.log(JSON.stringify({ result: 'passed', selfTest: 'Forbidden-network AST and external/escaping asset positive and negative fixtures' }, null, 2))
}

if (process.argv.includes('--self-test')) selfTest()
else if (process.argv.includes('--source-only')) {
  scanProductionSource()
  console.log(JSON.stringify({ result: 'passed', sourceOnly: true, productionSourceFilesChecked: [...checkedSource].map(filename => path.relative(root, filename)).sort() }, null, 2))
}
else {
  const files = walk(dist)
  const bytes = files.reduce((sum, filename) => sum + fs.statSync(filename).size, 0)
  assert(files.length <= 2000, `Release has ${files.length} files, limit 2000`)
  assert(bytes <= 20 * 1024 * 1024, `Release has ${bytes} bytes, limit 20 MiB`)
  const manifest = JSON.parse(fs.readFileSync(path.join(dist, 'app.json'), 'utf8'))
  assert.equal(typeof manifest.entry, 'string', 'Manifest entry missing')
  localAsset(manifest.entry, path.join(dist, 'app.json'))
  for (const filename of files) {
    if (/\.(?:html|svg)$/i.test(filename)) scanMarkup(fs.readFileSync(filename, 'utf8'), filename, true)
    else if (/\.css$/i.test(filename)) scanCSS(fs.readFileSync(filename, 'utf8'), filename, true)
    else if (/\.m?js$/i.test(filename)) scanJS(fs.readFileSync(filename, 'utf8'), filename, true)
    assert(!/\.(?:map|ts|tsx)$/i.test(filename), `Unneeded source artifact in release: ${filename}`)
  }
  scanProductionSource()
  const fonts = files.filter(filename => /\.(?:woff2?|ttf|otf)$/i.test(filename))
  assert(fonts.length > 0, 'No local font files found')
  for (const filename of fonts) assert(references.has(path.relative(dist, filename).split(path.sep).join('/')), `Unreferenced font asset: ${filename}`)
  for (const name of ['app.json', 'schema.yaml']) assert(fs.readFileSync(path.join(root, name), 'utf8') === fs.readFileSync(path.join(dist, name), 'utf8'), `${name} differs from source`)
  const notices = collectNotices()
  for (const [relative, contents] of Object.entries(notices.files)) assert(fs.readFileSync(path.join(dist, relative), 'utf8') === contents, `Missing, stale, or incomplete distributed notice: ${relative}`)
  console.log(JSON.stringify({
    result: 'passed',
    files: files.length,
    bytes,
    mebibytes: Number((bytes / 1024 / 1024).toFixed(3)),
    limitFiles: 2000,
    limitBytes: 20 * 1024 * 1024,
    entry: manifest.entry,
    fontFiles: fonts.length,
    referencedAssets: [...references].sort(),
    productionSourceFilesChecked: [...checkedSource].map(filename => path.relative(root, filename)).sort(),
    notices: { packages: notices.packages.length, missingLicenseFiles: notices.missingLicenseFiles, licenseGaps: notices.licenseGaps },
    redistributionStatus: notices.licenseGaps.length ? 'Unresolved license/attribution gaps; technical checks do not establish redistribution permission.' : 'No declared license gaps detected; not a legal opinion.',
    verification: 'Local artifact and reachable production source only. Static checks are not runtime network interception, live publication, or browser acceptance.',
  }, null, 2))
}
