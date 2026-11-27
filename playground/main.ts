import { parseMarkdown } from 'comark'
import { render } from 'comark/render'
import { textContent } from 'comark/utils'
import type { Node } from 'comark'
import plugin from '../src/index.ts'
import type { PluginOptions } from '../src/index.ts'

const SAMPLE = `Fix #32 in hello/blabla before merging GH-7.

See other/repo#4, ask @farnabaz, and ping @comarkdown/maintainers.

Landed abc1234 (farnabaz@abc1234). Compare abc1234...def5678.

A path such as src/index.ts stays text, and so does \`#32\` in code.
`

const STORAGE_KEY = 'comark-git-autolink:playground'
const TYPE_NAMES = ['issues', 'repositories', 'mentions', 'commits', 'compares'] as const

type TypeName = (typeof TYPE_NAMES)[number]

interface SavedState {
  markdown: string
  repository: string
  baseUrl: string
  types: Record<TypeName, boolean>
}

const sourceEl = document.querySelector<HTMLTextAreaElement>('#source')
const repositoryEl = document.querySelector<HTMLInputElement>('#repository')
const baseUrlEl = document.querySelector<HTMLInputElement>('#base-url')
const noticeEl = document.querySelector<HTMLElement>('#notice')
const previewEl = document.querySelector<HTMLElement>('#preview')
const linksEl = document.querySelector<HTMLOListElement>('#links')
const restoreEl = document.querySelector<HTMLButtonElement>('#restore')
const typeInputs = Object.fromEntries(
  TYPE_NAMES.map((name) => [name, document.querySelector<HTMLInputElement>(`input[name="${name}"]`)]),
) as Record<TypeName, HTMLInputElement | null>

if (!sourceEl || !repositoryEl || !baseUrlEl || !noticeEl || !previewEl || !linksEl || !restoreEl) {
  throw new Error('Playground markup is missing a required control.')
}

const source: HTMLTextAreaElement = sourceEl
const repository: HTMLInputElement = repositoryEl
const baseUrl: HTMLInputElement = baseUrlEl
const notice: HTMLElement = noticeEl
const preview: HTMLElement = previewEl
const links: HTMLOListElement = linksEl
const restore: HTMLButtonElement = restoreEl

const saved = readSaved()
source.value = saved?.markdown ?? SAMPLE
repository.value = saved?.repository ?? 'hello/blabla'
baseUrl.value = saved?.baseUrl ?? 'https://github.com'
for (const name of TYPE_NAMES) {
  const input = typeInputs[name]
  if (input) input.checked = saved?.types[name] ?? true
}

let ticket = 0

source.addEventListener('input', () => {
  void update()
})
repository.addEventListener('input', () => {
  void update()
})
baseUrl.addEventListener('input', () => {
  void update()
})
for (const name of TYPE_NAMES) {
  typeInputs[name]?.addEventListener('change', () => {
    void update()
  })
}
restore.addEventListener('click', () => {
  source.value = SAMPLE
  void update()
  source.focus()
})

void update()

async function update() {
  const current = ++ticket
  const options = readOptions()
  save(options.markdown)
  const built = buildPlugin(options.plugin)
  if (current !== ticket) return

  repository.setAttribute('aria-invalid', built.repositoryError ? 'true' : 'false')
  notice.textContent = built.message
  notice.classList.toggle('is-error', built.message !== '')

  try {
    const tree = await parseMarkdown(options.markdown, { plugins: [built.plugin] })
    if (current !== ticket) return
    const html = await render(tree, { format: 'text/html' })
    if (current !== ticket) return
    paint(html, collectLinks(tree.nodes))
  } catch (error) {
    if (current !== ticket) return
    notice.textContent = error instanceof Error ? error.message : String(error)
    notice.classList.add('is-error')
    paint('', [])
  }
}

function readOptions(): { markdown: string; plugin: PluginOptions } {
  const pluginOptions: PluginOptions = {}
  const repositoryValue = repository.value.trim()
  const baseUrlValue = baseUrl.value.trim()
  if (repositoryValue) pluginOptions.repository = repositoryValue
  if (baseUrlValue) pluginOptions.baseUrl = baseUrlValue
  for (const name of TYPE_NAMES) {
    pluginOptions[name] = typeInputs[name]?.checked ?? true
  }
  return { markdown: source.value, plugin: pluginOptions }
}

function buildPlugin(options: PluginOptions) {
  try {
    return { plugin: plugin(options), message: '', repositoryError: false }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    const fallback = { ...options }
    delete fallback.repository
    delete fallback.baseUrl
    try {
      return {
        plugin: plugin(fallback),
        message,
        repositoryError: message.includes('repository'),
      }
    } catch {
      return { plugin: plugin({}), message, repositoryError: false }
    }
  }
}

function paint(html: string, found: { text: string; href: string }[]) {
  preview.replaceChildren()
  if (!html.trim()) {
    const empty = document.createElement('p')
    empty.className = 'empty'
    empty.textContent = 'The source is empty.'
    preview.append(empty)
  } else {
    preview.innerHTML = html
    for (const anchor of preview.querySelectorAll('a')) {
      anchor.target = '_blank'
      anchor.rel = 'noopener noreferrer'
    }
  }

  links.replaceChildren()
  if (found.length === 0) {
    const item = document.createElement('li')
    item.textContent = 'No links in this document.'
    links.append(item)
    return
  }
  for (const foundLink of found) {
    const item = document.createElement('li')
    const label = document.createElement('span')
    label.className = 'label'
    label.textContent = foundLink.text || foundLink.href
    const anchor = document.createElement('a')
    anchor.href = foundLink.href
    anchor.target = '_blank'
    anchor.rel = 'noopener noreferrer'
    anchor.textContent = foundLink.href
    item.append(label, anchor)
    links.append(item)
  }
}

function collectLinks(nodes: Node[]): { text: string; href: string }[] {
  const found: { text: string; href: string }[] = []
  walk(nodes, found)
  return found
}

function walk(nodes: Node[], found: { text: string; href: string }[]) {
  for (const node of nodes) {
    if (typeof node === 'string' || !Array.isArray(node) || node[0] == null) continue
    if (node[0] === 'a' && typeof node[1]?.href === 'string') {
      found.push({ text: textContent(node), href: node[1].href })
    }
    walk(node.slice(2) as Node[], found)
  }
}

function save(markdown: string) {
  const state: SavedState = {
    markdown,
    repository: repository.value,
    baseUrl: baseUrl.value,
    types: {
      issues: typeInputs.issues?.checked ?? true,
      repositories: typeInputs.repositories?.checked ?? true,
      mentions: typeInputs.mentions?.checked ?? true,
      commits: typeInputs.commits?.checked ?? true,
      compares: typeInputs.compares?.checked ?? true,
    },
  }
  localStorage.setItem(STORAGE_KEY, JSON.stringify(state))
}

function readSaved(): SavedState | undefined {
  const raw = localStorage.getItem(STORAGE_KEY)
  if (!raw) return undefined
  try {
    const parsed = JSON.parse(raw) as Partial<SavedState>
    if (!parsed || typeof parsed.markdown !== 'string' || !parsed.types) return undefined
    return {
      markdown: parsed.markdown,
      repository: typeof parsed.repository === 'string' ? parsed.repository : 'hello/blabla',
      baseUrl: typeof parsed.baseUrl === 'string' ? parsed.baseUrl : 'https://github.com',
      types: {
        issues: parsed.types.issues !== false,
        repositories: parsed.types.repositories !== false,
        mentions: parsed.types.mentions !== false,
        commits: parsed.types.commits !== false,
        compares: parsed.types.compares !== false,
      },
    }
  } catch {
    return undefined
  }
}
