import { parseMarkdown } from 'comark'
import { performance } from 'node:perf_hooks'
import type * as Index from '../src/index.ts'
import type * as References from '../src/references.ts'
import type { LinkContext } from '../src/references.ts'

// `BENCH_SRC=../.bench-before/src pnpm bench` times another copy of `src/`,
// for example the code before a change, under the same conditions.
const src = process.env.BENCH_SRC ?? '../src'
const plugin = ((await import(`${src}/index.ts`)) as typeof Index).default
const { linkifyText } = (await import(`${src}/references.ts`)) as typeof References

const repository = 'hello/blabla'
const pluginOptions = { repository, repositories: true }
const ctx: LinkContext = {
  baseUrl: 'https://github.com',
  repoRoot: 'https://github.com/hello/blabla',
  repository: { owner: 'hello', name: 'blabla' },
  issues: true,
  repositories: true,
  mentions: true,
  commits: true,
  compares: true,
}

const prose = repeat(
  'The parser walks ordinary sentences and should leave them untouched. Nothing here is a reference.\n\n',
  400,
)
const dense = repeat(
  'Fix #32 in hello/blabla before GH-7. See other/repo#4, ask @farnabaz, and ping @comarkdown/maintainers. Landed abc1234 (farnabaz@abc1234). Compare abc1234...def5678.\n\n',
  400,
)

// Mixed Chinese prose where references touch full-width punctuation.
const cjk = repeat('修复了登录问题，见 #32（hello/blabla），感谢 @farnabaz。提交 abc1234。\n\n', 400)
// One long token with a `://` up front and many mentions. Every hit used to
// rescan the token back to its start.
const urlToken = `foo://x/${repeat('@ab,', 5000)}`

const cases = [
  {
    name: 'scan prose',
    run: () => linkifyText(prose, ctx),
  },
  {
    name: 'scan dense references',
    run: () => linkifyText(dense, ctx),
  },
  {
    name: 'scan CJK prose',
    run: () => linkifyText(cjk, ctx),
  },
  {
    name: 'scan long URL-like token',
    run: () => linkifyText(urlToken, ctx),
  },
  {
    name: 'parse prose',
    run: () => parseMarkdown(prose, { plugins: [plugin(pluginOptions)] }),
  },
  {
    name: 'parse dense references',
    run: () => parseMarkdown(dense, { plugins: [plugin(pluginOptions)] }),
  },
  {
    name: 'parse prose, no plugin',
    run: () => parseMarkdown(prose),
  },
  {
    name: 'parse dense, no plugin',
    run: () => parseMarkdown(dense),
  },
]

const results: Array<{ name: string; ops: number; mean: number; p99: number }> = []
for (const item of cases) {
  results.push({ name: item.name, ...(await measure(item.run)) })
}

const byName = (name: string) => {
  const found = results.find((result) => result.name === name)
  if (!found) throw new Error(`Benchmark case "${name}" did not run`)
  return found
}
const scanProse = byName('scan prose')
const scanDense = byName('scan dense references')
const scanUrlToken = byName('scan long URL-like token')
const parseProse = byName('parse prose')
const parseDense = byName('parse dense references')
const bareProse = byName('parse prose, no plugin')
const bareDense = byName('parse dense, no plugin')

console.log('')
console.log(`source ${src}`)
console.log(`input  prose ${prose.length} chars, dense ${dense.length} chars, CJK ${cjk.length} chars, URL token ${urlToken.length} chars`)
console.log('')
console.log(pad('case', 28), pad('ops/sec', 12), pad('mean', 12), 'p99')
for (const result of results) {
  console.log(
    pad(result.name, 28),
    pad(formatOps(result.ops), 12),
    pad(`${result.mean.toFixed(3)} ms`, 12),
    `${result.p99.toFixed(3)} ms`,
  )
}
console.log('')
console.log(`plugin overhead, prose  ${(parseProse.mean - bareProse.mean).toFixed(3)} ms`)
console.log(`plugin overhead, dense  ${(parseDense.mean - bareDense.mean).toFixed(3)} ms`)

// Budgets are loose enough for a busy CI runner and tight enough to catch
// a return to per-node regular expressions.
const failures: string[] = []
if (scanProse.mean > 5) failures.push(`scan prose mean ${scanProse.mean.toFixed(3)} ms > 5 ms`)
if (scanDense.mean > 8) failures.push(`scan dense mean ${scanDense.mean.toFixed(3)} ms > 8 ms`)
if (scanUrlToken.mean > 10) failures.push(`scan URL-like token mean ${scanUrlToken.mean.toFixed(3)} ms > 10 ms`)
if (parseDense.mean - bareDense.mean > 15) {
  failures.push(`dense plugin overhead ${(parseDense.mean - bareDense.mean).toFixed(3)} ms > 15 ms`)
}
if (failures.length > 0) {
  console.error('')
  for (const failure of failures) console.error(`slow: ${failure}`)
  process.exitCode = 1
}

async function measure(run: () => unknown): Promise<{ ops: number; mean: number; p99: number }> {
  for (let i = 0; i < 8; i += 1) await run()
  const samples: number[] = []
  const started = performance.now()
  while (samples.length < 20 || performance.now() - started < 300) {
    const at = performance.now()
    await run()
    samples.push(performance.now() - at)
    if (samples.length >= 80) break
  }
  samples.sort((a, b) => a - b)
  const total = samples.reduce((sum, sample) => sum + sample, 0)
  const mean = total / samples.length
  const p99 = samples[Math.min(samples.length - 1, Math.ceil(samples.length * 0.99) - 1)] ?? mean
  return { ops: mean === 0 ? Infinity : 1000 / mean, mean, p99 }
}

function repeat(text: string, count: number): string {
  let out = ''
  for (let i = 0; i < count; i += 1) out += text
  return out
}

function pad(value: string, width: number): string {
  return value.padEnd(width)
}

function formatOps(ops: number): string {
  if (ops >= 1000) return `${Math.round(ops).toLocaleString('en-US')}`
  return ops.toFixed(1)
}
