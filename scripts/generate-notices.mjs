import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { createHash } from 'node:crypto'
import { fileURLToPath } from 'node:url'

export const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
export const donorCommit = '6bae213129563eea946ec58e7a38d068dc53e0c3'
const separator = '\n' + '='.repeat(80) + '\n'
const supplementalLicense = {
  name: '@cfworker/json-schema',
  version: '4.1.1',
  file: 'licenses/cfworker-json-schema-MIT.txt',
  source: 'https://github.com/cfworker/cfworker/blob/5409fdc2bd144f68e8b28c61c71fcb16600000a6/LICENSE.md',
  sha256: '376944252ab78ca6b41aee44ddea8894927ee67891e77e61eb9d59af63e35094',
}

// Keep published license identifiers and full distributed notices intact. Do not
// infer a license grant from the application's or another package's MIT license.
export function collectNotices() {
  const lock = JSON.parse(fs.readFileSync(path.join(root, 'package-lock.json'), 'utf8'))
  const donorLicense = fs.readFileSync(path.join(root, 'LICENSE'), 'utf8')
  const parts = [
    'THIRD-PARTY NOTICES\n\nRetro Board includes modified software and local assets from inovex/scrumlr.io,\n' +
    `pinned at commit ${donorCommit}. The donor MIT notice\n` +
    'covers the retained donor source, SCSS, and icons. Raleway font files are\n' +
    'distributed locally under their separate SIL Open Font License below.\n\n' +
    'The dependency notices below cover the installed production dependency\n' +
    'closure in package-lock.json, a superset of packages actually bundled.\n' +
    'Development-only build and test dependencies are not distributed. Published\n' +
    'license identifiers are reported without inventing missing permission.\n\n' +
    "Each package's published license grant is retained below.\n",
    separator + 'Donor: inovex/scrumlr.io\n' +
    `Source: https://github.com/inovex/scrumlr.io/tree/${donorCommit}\n` +
    `Commit: ${donorCommit}\nLicense identifier: MIT\n\n` + donorLicense,
  ]
  const packages = []
  const missingLicenseFiles = []
  const licenseGaps = []
  const errors = []
  const supplements = {}
  let ralewayLicense
  for (const [relative, entry] of Object.entries(lock.packages).sort(([a], [b]) => a.localeCompare(b))) {
    if (!relative || entry.dev) continue
    const directory = path.join(root, relative)
    const manifest = path.join(directory, 'package.json')
    if (!fs.existsSync(manifest)) {
      if (!entry.optional) errors.push(`Required production package is not installed: ${relative}`)
      continue
    }
    const pkg = JSON.parse(fs.readFileSync(manifest, 'utf8'))
    assert.equal(pkg.version, entry.version, `Installed version differs from lockfile: ${relative}`)
    const identifier = typeof pkg.license === 'string' ? pkg.license : JSON.stringify(pkg.license ?? pkg.licenses ?? 'Not declared')
    const licenseFiles = fs.readdirSync(directory).filter(file =>
      /^(licen[cs]e|copying|copyright|notice|ofl)(?:[.\-_]|$)/i.test(file) && fs.statSync(path.join(directory, file)).isFile()
    ).sort()
    const item = { name: pkg.name, version: pkg.version, license: identifier }
    packages.push(item)
    parts.push(separator + `${pkg.name} ${pkg.version}\nLicense identifier: ${identifier}\nInstalled path: ${relative}\n`)
    if (!licenseFiles.length) {
      parts.push('\nNo license or notice file was distributed at the package root.\n')
      if (pkg.name === supplementalLicense.name && pkg.version === supplementalLicense.version) {
        const contents = fs.readFileSync(path.join(root, 'public', supplementalLicense.file), 'utf8')
        assert.equal(createHash('sha256').update(contents).digest('hex'), supplementalLicense.sha256, 'Supplemental upstream license text changed')
        supplements[supplementalLicense.file] = contents
        parts.push(`\nOriginal license text supplied from the package publication commit.\nSource: ${supplementalLicense.source}\n\n${contents}`)
      } else {
        missingLicenseFiles.push(item)
        errors.push(`Missing distributed license text: ${pkg.name} ${pkg.version}`)
      }
    }
    if (/^(UNLICENSED|Not declared)$/i.test(identifier)) {
      licenseGaps.push(item)
      errors.push(`Unresolved license grant: ${pkg.name} ${pkg.version}`)
    }
    for (const file of licenseFiles) {
      const contents = fs.readFileSync(path.join(directory, file), 'utf8')
      parts.push(`\n--- ${file} ---\n\n${contents}\n`)
      if (pkg.name === '@fontsource/raleway' && /SIL OPEN FONT LICENSE/i.test(contents)) ralewayLicense = contents
    }
  }
  assert(ralewayLicense, 'Installed Raleway SIL Open Font License text was not found')
  assert.equal(errors.length, 0, errors.join('\n'))
  return {
    files: {
      'LICENSE.txt': donorLicense,
      'THIRD_PARTY_NOTICES.txt': parts.join(''),
      'licenses/Raleway-OFL.txt': ralewayLicense,
      'licenses/PROVENANCE.txt': fs.readFileSync(path.join(root, 'public/licenses/PROVENANCE.txt'), 'utf8'),
      ...supplements,
    },
    packages,
    missingLicenseFiles,
    licenseGaps,
  }
}

export function generateNotices({ check = false } = {}) {
  const result = collectNotices()
  for (const [relative, contents] of Object.entries(result.files)) {
    const destination = path.join(root, 'public', relative)
    if (check) assert.equal(fs.readFileSync(destination, 'utf8'), contents, `Stale or incomplete notice: ${relative}`)
    else {
      fs.mkdirSync(path.dirname(destination), { recursive: true })
      fs.writeFileSync(destination, contents)
    }
  }
  return {
    packages: result.packages.length,
    missingLicenseFiles: result.missingLicenseFiles,
    licenseGaps: result.licenseGaps,
    redistributionStatus: result.licenseGaps.length ? 'Unresolved license/attribution gaps; technical checks do not establish redistribution permission.' : 'No declared license gaps detected; not a legal opinion.',
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  console.log(JSON.stringify(generateNotices({ check: process.argv.includes('--check') }), null, 2))
}
