// SPDX-License-Identifier: AGPL-3.0-only
// Lengths reach the screen in the display units — millimetres or inches, the
// person's choice in Settings — through src/core/units.ts and nothing else.
// This keeps it so: it fails on any text in the app that writes the word mm
// itself (also mm², mm³ and /mm), which is a length that will read mm with
// the setting on inches.
//
// Only text is read: string literals, template text and JSX text. Comments,
// types and import paths are not text anyone sees, and are skipped by
// parsing each file rather than matching lines. A literal that is exactly
// 'mm' compared against something (`units === 'mm'`) is a unit's id, not a
// word on screen.
//
// Some places say mm on purpose, and are allowed by path below: the agent's
// commands (an API, answered in millimetres always), the units modules, the
// import prompt, and the exporters that declare their file's unit. One line
// elsewhere that says mm on purpose — an id, a stored field's name — carries
// `units-ok` in a comment on it or on the line above, with why.
//
//   node scripts/check-units.mjs [root] [--count]
//
// Exits non-zero, listing each line, while any is left. --count prints how
// many there are per area instead of the lines.
import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join, relative, resolve, sep } from 'node:path'
import { fileURLToPath } from 'node:url'
import ts from 'typescript'

const args = process.argv.slice(2)
const countOnly = args.includes('--count')
const root = resolve(args.find((a) => !a.startsWith('--')) ?? fileURLToPath(new URL('../', import.meta.url)))

/** Folders read. */
const ROOTS = ['src', 'plugins']

/** Scripts beside the plugins, not app code. */
const SKIP_FILES = new Set(['plugins/readme-shots.mjs'])

const SKIP_DIRS = new Set(['node_modules', 'dist', '.git', 'tests', 'scripts', 'docs', 'guides', 'skills'])
const EXTENSIONS = /\.(ts|tsx|mts|js|jsx|mjs)$/
const TEST_FILE = /\.(test|spec)\.[cm]?[jt]sx?$/

/** Paths that say mm on purpose: a folder ends in /, a pattern is a RegExp. */
const ALLOWED = [
  // The agent's commands answer in millimetres, always — an API.
  'src/commands/',
  /^plugins\/[^/]+\/app\/[^/]*(Commands?|CommandCore|CommandAnswers|Schemas)\.ts$/,
  // The units themselves.
  'src/core/units.ts',
  'src/core/meshUnits.ts',
  // The STL import prompt: the units a file is in, not the display's.
  'src/ui/UnitsModal.tsx',
  'src/state/unitsPromptStore.ts',
  // The 2D sheet's exporters, which declare their file's unit.
  'src/core/flat/dxf.ts',
  'src/core/flat/svg.ts',
]

// Not part of a word; a digit before (12mm) or a power after (mm²) still counts.
const MM = /(?<![\p{L}_])mm(?![\p{L}\p{Nd}_])/u

const allowed = (rel) =>
  ALLOWED.some((a) => (typeof a === 'string' ? (a.endsWith('/') ? rel.startsWith(a) : rel === a) : a.test(rel)))

function* walk(dir) {
  for (const name of readdirSync(dir)) {
    const path = join(dir, name)
    const stat = statSync(path)
    if (stat.isDirectory()) {
      if (!SKIP_DIRS.has(name)) yield* walk(path)
    } else if (EXTENSIONS.test(name) && !TEST_FILE.test(name)) yield path
  }
}

/** Attributes whose value is an id or a style, never text on screen. */
const ID_ATTRIBUTES = new Set(['data-test', 'data-testid', 'testId', 'className', 'id', 'htmlFor', 'key', 'name'])

/** Whether a literal is a unit's id rather than a word on screen: exactly
 *  'mm', compared, switched on, a type, the fallback after ??, or the
 *  default of a parameter typed as units. */
function isUnitId(node) {
  if (node.text !== 'mm') return false
  const p = node.parent
  if (ts.isLiteralTypeNode(p)) return true
  if (ts.isCaseClause(p)) return true
  // A default for a parameter typed as units: given: MeshUnits = 'mm'
  if (ts.isParameter(p) && p.initializer === node && p.type && ts.isTypeReferenceNode(p.type)) return true
  if (ts.isBinaryExpression(p)) {
    const op = p.operatorToken.kind
    return (
      op === ts.SyntaxKind.EqualsEqualsEqualsToken ||
      op === ts.SyntaxKind.ExclamationEqualsEqualsToken ||
      op === ts.SyntaxKind.EqualsEqualsToken ||
      op === ts.SyntaxKind.ExclamationEqualsToken ||
      // The fallback of a unit read back: meshUnitsOf(stored) ?? 'mm'
      (op === ts.SyntaxKind.QuestionQuestionToken && p.right === node)
    )
  }
  return false
}

/** Whether a node is somewhere no text reaches the screen from. */
function isSkipped(node) {
  const p = node.parent
  if (!p) return false
  // import … from 'x', export … from 'x', import('x')
  if (ts.isImportDeclaration(p) || ts.isExportDeclaration(p) || ts.isExternalModuleReference(p)) return true
  if (ts.isCallExpression(p) && p.expression.kind === ts.SyntaxKind.ImportKeyword) return true
  // A property's name: { 'mm': … }
  if ((ts.isPropertyAssignment(p) || ts.isPropertySignature(p)) && p.name === node) return true
  // A JSX attribute that holds an id: data-test="dim-mm"
  if (ts.isJsxAttribute(p) && ID_ATTRIBUTES.has(p.name.getText())) return true
  // Inside a type: a literal type, an indexed access …
  for (let n = p; n; n = n.parent) {
    if (ts.isTypeNode(n) && !ts.isExpressionWithTypeArguments(n)) return true
    if (ts.isStatement(n) || ts.isSourceFile(n)) break
  }
  return false
}

const TEXT_KINDS = new Set([
  ts.SyntaxKind.StringLiteral,
  ts.SyntaxKind.NoSubstitutionTemplateLiteral,
  ts.SyntaxKind.TemplateHead,
  ts.SyntaxKind.TemplateMiddle,
  ts.SyntaxKind.TemplateTail,
  ts.SyntaxKind.JsxText,
])

function offending(file, text) {
  const kind = file.endsWith('x') ? ts.ScriptKind.TSX : file.endsWith('.ts') || file.endsWith('.mts') ? ts.ScriptKind.TS : ts.ScriptKind.JS
  const source = ts.createSourceFile(file, text, ts.ScriptTarget.Latest, true, kind)
  const lines = text.split(/\r?\n/)
  const marked = (line) => /units-ok/.test(lines[line] ?? '') || /units-ok/.test(lines[line - 1] ?? '')
  const found = new Map()
  const visit = (node) => {
    if (TEXT_KINDS.has(node.kind) && MM.test(node.text) && !isUnitId(node) && !isSkipped(node)) {
      const line = source.getLineAndCharacterOfPosition(node.getStart(source)).line
      if (!marked(line)) found.set(line, lines[line].trim())
    }
    ts.forEachChild(node, visit)
  }
  visit(source)
  return [...found].map(([line, code]) => ({ line: line + 1, code }))
}

/** The area a file counts toward: src/, or the plugin and its folder. */
const areaOf = (rel) => {
  const parts = rel.split('/')
  return parts[0] === 'plugins' ? parts.slice(0, 3).join('/') : 'src'
}

const hits = []
for (const top of ROOTS) {
  const dir = join(root, top)
  try {
    statSync(dir)
  } catch {
    continue // A tree without plugins/.
  }
  for (const file of walk(dir)) {
    const rel = relative(root, file).split(sep).join('/')
    if (SKIP_FILES.has(rel) || allowed(rel)) continue
    for (const hit of offending(file, readFileSync(file, 'utf8'))) hits.push({ rel, ...hit })
  }
}

if (countOnly) {
  const by = new Map()
  for (const h of hits) by.set(areaOf(h.rel), (by.get(areaOf(h.rel)) ?? 0) + 1)
  for (const [area, n] of [...by].sort()) console.log(`${String(n).padStart(5)}  ${area}`)
  console.log(`${String(hits.length).padStart(5)}  in all`)
  process.exit(hits.length > 0 ? 1 : 0)
}

if (hits.length > 0) {
  console.error(`Text that says mm itself (${hits.length}):\n`)
  for (const h of hits) console.error(`  ${h.rel}:${h.line}  ${h.code}`)
  console.error(
    '\nA length on screen goes through src/core/units.ts (fmtLen, or kind="length" on a NumberField), so it reads in the units chosen in Settings.' +
      '\nA line that says mm on purpose — an id, a stored field — carries a `units-ok` comment saying why.',
  )
  process.exit(1)
}
console.log('Units hold: no text says mm outside the allowed files.')
