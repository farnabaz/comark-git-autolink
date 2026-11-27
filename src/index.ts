import { defineComarkPlugin } from 'comark'
import type { ComarkPluginFactory, Node } from 'comark'
import { linkifyText, parseRepository } from './references.ts'
import type { LinkContext } from './references.ts'

const PLUGIN_NAME = 'comark-git-autolink'

const SKIP_TAGS = new Set(['a', 'code', 'pre', 'script', 'style', 'kbd', 'math', 'samp', 'textarea'])

/**
 * Options for {@link plugin}.
 *
 * Each reference type has its own switch. Omitted switches default to `true`,
 * except `repositories`, which defaults to `false` because it also matches
 * ordinary slash phrases such as `and/or` and `24/7`.
 * Shorthand references (`#32`, `GH-32`, a bare commit SHA) need `repository`.
 * Fully qualified references (`hello/blabla`, `other/repo#32`) do not.
 */
export interface PluginOptions {
  /**
   * Repository used for shorthand references such as `#32` and bare commit SHAs.
   * `owner/repo`, a github.com URL, or `git@host:owner/repo.git`.
   */
  repository?: string
  /**
   * Origin used in generated links. Defaults to `https://github.com`.
   * Set this for GitHub Enterprise or another host with GitHub's URL layout,
   * for example `https://github.example.com`.
   */
  baseUrl?: string
  /** Link issue and pull request references: `#32`, `GH-32`, `owner/repo#32`. */
  issues?: boolean
  /**
   * Link repository references such as `hello/blabla`. Defaults to `false`:
   * any `word/word` pair looks like a repository, including `and/or`, `TCP/IP`
   * and `24/7`. Qualified references (`owner/repo#32`, `owner/repo@sha`) are
   * controlled by `issues` and `commits` and work either way.
   */
  repositories?: boolean
  /** Link `@username` and `@org/team` mentions. */
  mentions?: boolean
  /** Link commit SHAs, including `owner/repo@sha` and `user@sha`. */
  commits?: boolean
  /** Link compare ranges such as `sha...sha` and `owner/repo@sha...sha`. */
  compares?: boolean
}

/**
 * Turn git forge references (GitHub syntax and URL layout) into links.
 *
 * @example
 * ```ts
 * import { parseMarkdown } from 'comark'
 * import gitAutolink from 'comark-git-autolink'
 *
 * const tree = await parseMarkdown('Fix #32 in hello/blabla', {
 *   plugins: [gitAutolink({ repository: 'hello/blabla' })],
 * })
 * ```
 */
const plugin: ComarkPluginFactory<PluginOptions> = defineComarkPlugin<PluginOptions>((options = {}) => {
  const issues = options.issues !== false
  const repositories = options.repositories === true
  const mentions = options.mentions !== false
  const commits = options.commits !== false
  const compares = options.compares !== false
  const enabled = issues || repositories || mentions || commits || compares

  const baseUrl = normalizeBaseUrl(options.baseUrl ?? 'https://github.com')
  const repository = options.repository == null ? undefined : requireRepository(options.repository)
  const ctx: LinkContext = {
    baseUrl,
    repoRoot: repository ? `${baseUrl}/${repository.owner}/${repository.name}` : undefined,
    repository,
    issues,
    repositories,
    mentions,
    commits,
    compares,
  }

  return {
    name: PLUGIN_NAME,
    post(state) {
      if (!enabled) return
      walk(state.tree.nodes, 0, false, ctx)
    },
  }
})

export default plugin

function requireRepository(input: string) {
  const repository = parseRepository(input)
  if (!repository) {
    throw new Error(
      `${PLUGIN_NAME}: expected \`repository\` to be \`owner/repo\` or a GitHub URL, got ${JSON.stringify(input)}`,
    )
  }
  return repository
}

function normalizeBaseUrl(input: string): string {
  let url: URL
  try {
    url = new URL(input)
  } catch {
    throw new Error(
      `${PLUGIN_NAME}: expected \`baseUrl\` to be an absolute http(s) URL, got ${JSON.stringify(input)}`,
    )
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    throw new Error(
      `${PLUGIN_NAME}: expected \`baseUrl\` to use http or https, got ${JSON.stringify(input)}`,
    )
  }
  const path = url.pathname.replace(/\/+$/, '')
  return url.origin + (path === '/' || path === '' ? '' : path)
}

function walk(nodes: unknown[], start: number, skip: boolean, ctx: LinkContext) {
  for (let i = start; i < nodes.length; i++) {
    const node: unknown = nodes[i]
    if (typeof node === 'string') {
      if (skip) continue
      const next = linkifyText(node, ctx)
      if (!next) continue
      nodes.splice(i, 1, ...next)
      i += next.length - 1
      continue
    }
    if (isElement(node) && !SKIP_TAGS.has(node[0])) {
      walk(node, 2, skip, ctx)
    }
  }
}

function isElement(node: unknown): node is [string, ...Node[]] {
  return Array.isArray(node) && typeof node[0] === 'string'
}
