import type { Node } from 'comark'

/** A GitHub reference the plugin knows how to turn into a link. */
export type ReferenceType = 'issue' | 'repository' | 'mention' | 'commit' | 'compare'

export interface Repository {
  owner: string
  name: string
}

export interface LinkContext {
  baseUrl: string
  /** `baseUrl/owner/name` when a default repository is configured. */
  repoRoot?: string
  repository?: Repository
  issues: boolean
  repositories: boolean
  mentions: boolean
  commits: boolean
  compares: boolean
}

interface Hit {
  start: number
  end: number
  href: string
}

interface Span {
  end: number
  href?: string
}

const DENY_SHA = ['acceded', 'deedeed', 'defaced', 'effaced', 'fabaceae']
const DENY_MENTION = ['mention', 'mentions']

/**
 * Parse `owner/repo`, a GitHub URL, or a `git@host:owner/repo.git` remote.
 * Returns `undefined` when the value is not a repository.
 */
export function parseRepository(input: string): Repository | undefined {
  let value = input.trim()
  if (!value) return undefined

  const gitRemote = /^git@[^:\s]+:(.+)$/i.exec(value)
  if (gitRemote?.[1]) {
    value = gitRemote[1]
  } else if (/^[a-z][a-z0-9+.-]*:\/\//i.test(value)) {
    try {
      value = new URL(value).pathname
    } catch {
      return undefined
    }
  } else if (/^[^/\s]+\.[^/\s]+\//.test(value)) {
    value = value.slice(value.indexOf('/') + 1)
  }

  value = value.replace(/^\/+/, '').replace(/\.git$/i, '')
  const slash = value.indexOf('/')
  if (slash <= 0) return undefined

  const owner = value.slice(0, slash)
  const name = value.slice(slash + 1).split('/')[0]
  if (!name || !isUserSlice(owner, 0, owner.length) || !isRepoSlice(name, 0, name.length, true)) return undefined
  return { owner, name }
}

/** Split a text node into text and link nodes. `undefined` means nothing matched. */
export function linkifyText(text: string, ctx: LinkContext): Node[] | undefined {
  const hits = findHits(text, ctx)
  if (hits.length === 0) return undefined

  const nodes: Node[] = []
  let cursor = 0
  for (const hit of hits) {
    if (hit.start > cursor) nodes.push(text.slice(cursor, hit.start))
    nodes.push(['a', { href: hit.href }, text.slice(hit.start, hit.end)])
    cursor = hit.end
  }
  if (cursor < text.length) nodes.push(text.slice(cursor))
  return nodes
}

/**
 * One forward scan. Patterns are recognized from trigger characters, so plain
 * prose never compiles or runs a regular expression.
 */
function findHits(text: string, ctx: LinkContext): Hit[] {
  const hits: Hit[] = []
  const length = text.length
  urlScanPos = 0
  urlScanInside = false
  let i = 0
  while (i < length) {
    const code = text.charCodeAt(i)
    const span =
      code === 35
        ? parseHash(text, i, ctx)
        : code === 64
          ? parseAt(text, i, ctx)
          : isIdentStart(code)
            ? parseIdent(text, i, ctx)
            : undefined
    if (!span || span.end <= i) {
      i += 1
      continue
    }
    if (span.href) hits.push({ start: i, end: span.end, href: span.href })
    i = span.end
  }
  return hits
}

function parseHash(text: string, i: number, ctx: LinkContext): Span | undefined {
  if (!ctx.issues || !ctx.repoRoot) return undefined
  const end = readIssueEnd(text, i + 1)
  if (end < 0) return undefined
  return accept(text, i, end, `${ctx.repoRoot}/issues/${text.slice(i + 1, end)}`)
}

function parseAt(text: string, i: number, ctx: LinkContext): Span | undefined {
  if (!ctx.mentions) return undefined
  const userEnd = readUserEnd(text, i + 1)
  if (userEnd < 0) return undefined
  if (text.charCodeAt(userEnd) === 47) {
    const teamEnd = readUserEnd(text, userEnd + 1)
    if (teamEnd > 0 && isUserSlice(text, i + 1, userEnd) && isUserSlice(text, userEnd + 1, teamEnd)) {
      return accept(
        text,
        i,
        teamEnd,
        `${ctx.baseUrl}/orgs/${text.slice(i + 1, userEnd)}/teams/${text.slice(userEnd + 1, teamEnd)}`,
      )
    }
  }
  if (!isUserSlice(text, i + 1, userEnd) || isDenied(text, i + 1, userEnd, DENY_MENTION)) {
    return { end: userEnd }
  }
  return accept(text, i, userEnd, `${ctx.baseUrl}/${text.slice(i + 1, userEnd)}`)
}

function parseIdent(text: string, i: number, ctx: LinkContext): Span | undefined {
  if (ctx.issues && ctx.repoRoot && isGh(text, i)) {
    const end = readIssueEnd(text, i + 3)
    if (end > 0) return accept(text, i, end, `${ctx.repoRoot}/issues/${text.slice(i + 3, end)}`)
  }

  const userEnd = readUserEnd(text, i)
  if (userEnd < 0) return undefined
  const next = text.charCodeAt(userEnd)

  if (next === 47) return parseSlash(text, i, userEnd, ctx)
  if (next === 64) return parseUserSha(text, i, userEnd, ctx)
  return parseBareSha(text, i, ctx) ?? { end: userEnd }
}

function parseSlash(text: string, i: number, userEnd: number, ctx: LinkContext): Span | undefined {
  const nameStart = userEnd + 1
  const nameEnd = readRepoEnd(text, nameStart, true)
  if (nameEnd < 0 || endsWithGit(text, nameStart, nameEnd) || !isUserSlice(text, i, userEnd)) {
    return nameEnd > nameStart ? { end: nameEnd } : undefined
  }

  const after = text.charCodeAt(nameEnd)
  if (after === 35 && ctx.issues) {
    const issueEnd = readIssueEnd(text, nameEnd + 1)
    if (issueEnd > 0) {
      return accept(
        text,
        i,
        issueEnd,
        `${ctx.baseUrl}/${text.slice(i, userEnd)}/${text.slice(nameStart, nameEnd)}/issues/${text.slice(nameEnd + 1, issueEnd)}`,
      )
    }
  }
  if (after === 64 && (ctx.commits || ctx.compares)) {
    const shaEnd = readShaEnd(text, nameEnd + 1, false)
    if (shaEnd > 0) {
      return parseShaRef(
        text,
        i,
        nameEnd + 1,
        shaEnd,
        ctx,
        text.slice(i, userEnd),
        text.slice(nameStart, nameEnd),
        false,
      )
    }
  }
  if (!ctx.repositories || userEnd - i < 2) return { end: nameEnd }
  const bareEnd = readRepoEnd(text, nameStart, false)
  if (bareEnd < 0) return { end: nameEnd }
  return accept(text, i, bareEnd, `${ctx.baseUrl}/${text.slice(i, userEnd)}/${text.slice(nameStart, bareEnd)}`)
}

function parseUserSha(text: string, i: number, userEnd: number, ctx: LinkContext): Span | undefined {
  if (!ctx.repository || (!ctx.commits && !ctx.compares)) return undefined
  const shaEnd = readShaEnd(text, userEnd + 1, true)
  if (shaEnd < 0 || !isUserSlice(text, i, userEnd)) return { end: Math.max(userEnd, shaEnd) }
  return parseShaRef(text, i, userEnd + 1, shaEnd, ctx, text.slice(i, userEnd), ctx.repository.name, true)
}

function parseBareSha(text: string, i: number, ctx: LinkContext): Span | undefined {
  if (!ctx.repository || (!ctx.commits && !ctx.compares)) return undefined
  const shaEnd = readShaEnd(text, i, true)
  if (shaEnd < 0) return undefined
  return parseShaRef(text, i, i, shaEnd, ctx, ctx.repository.owner, ctx.repository.name, true)
}

function parseShaRef(
  text: string,
  start: number,
  shaStart: number,
  shaEnd: number,
  ctx: LinkContext,
  owner: string,
  name: string,
  strict: boolean,
): Span {
  if (startsWithDots(text, shaEnd)) {
    const head = readShaEnd(text, shaEnd + 3, strict)
    if (head > 0) {
      if (!ctx.compares) return { end: head }
      return accept(
        text,
        start,
        head,
        `${ctx.baseUrl}/${owner}/${name}/compare/${text.slice(shaStart, shaEnd)}...${text.slice(shaEnd + 3, head)}`,
      )
    }
  }
  if (!ctx.commits || startsWithDots(text, shaEnd)) return { end: shaEnd }
  return accept(text, start, shaEnd, `${ctx.baseUrl}/${owner}/${name}/commit/${text.slice(shaStart, shaEnd)}`)
}

function accept(text: string, start: number, end: number, href: string): Span {
  if (blockedBefore(text, start) || blockedAfter(text, end) || insideUrl(text, start) || followedByDotWord(text, end)) {
    return { end }
  }
  return { end, href }
}

function readUserEnd(text: string, i: number): number {
  const startCode = text.charCodeAt(i)
  if (!isAlnum(startCode)) return -1
  const limit = Math.min(text.length, i + 39)
  let end = i + 1
  while (end < limit && isUserChar(text.charCodeAt(end))) end += 1
  while (end > i + 1 && text.charCodeAt(end - 1) === 45) end -= 1
  return end
}

function readRepoEnd(text: string, i: number, allowDot: boolean): number {
  if (!isRepoStart(text.charCodeAt(i))) return -1
  const limit = Math.min(text.length, i + 100)
  let end = i + 1
  while (end < limit && isRepoChar(text.charCodeAt(end), allowDot)) end += 1
  return end
}

function readIssueEnd(text: string, i: number): number {
  const code = text.charCodeAt(i)
  if (code < 49 || code > 57) return -1
  const limit = Math.min(text.length, i + 10)
  let end = i + 1
  while (end < limit) {
    const next = text.charCodeAt(end)
    if (next < 48 || next > 57) break
    end += 1
  }
  return end
}

/**
 * End index of a 7–40 hex sha, or -1. Does not consume a longer run.
 *
 * `strict` is for shapes with no explicit `owner/repo@` marker (a bare sha or
 * `user@sha`), where ordinary words and numbers are easy to mistake for a sha.
 * A strict sha needs at least one digit and one letter, and is not scientific
 * notation such as `1e100000`. A real 7 character sha is all letters about
 * 0.1% of the time, so this costs almost nothing. A non-strict sha only needs
 * a letter and must not be a dictionary word.
 */
function readShaEnd(text: string, i: number, strict: boolean): number {
  let end = i
  let letters = 0
  let hasDigit = false
  let firstLetter = 0
  let firstLetterAt = -1
  const limit = Math.min(text.length, i + 41)
  while (end < limit) {
    const code = text.charCodeAt(end)
    if (code >= 48 && code <= 57) {
      hasDigit = true
    } else if ((code >= 65 && code <= 70) || (code >= 97 && code <= 102)) {
      if (letters === 0) {
        firstLetter = code | 32
        firstLetterAt = end
      }
      letters += 1
    } else {
      break
    }
    end += 1
  }
  const length = end - i
  if (length < 7 || length > 40 || letters === 0) return -1
  if (!strict) return isDenied(text, i, end, DENY_SHA) ? -1 : end
  if (!hasDigit) return -1
  // 1e100000 is a number, not a commit.
  if (letters === 1 && firstLetter === 101 && firstLetterAt > i && firstLetterAt < end - 1) return -1
  return end
}

function isUserSlice(text: string, start: number, end: number): boolean {
  const length = end - start
  if (length < 1 || length > 39 || text.charCodeAt(end - 1) === 45) return false
  for (let i = start; i < end; i += 1) {
    const code = text.charCodeAt(i)
    if (!isUserChar(code)) return false
    if (code === 45 && text.charCodeAt(i + 1) === 45) return false
  }
  return true
}

function isRepoSlice(text: string, start: number, end: number, allowDot: boolean): boolean {
  const length = end - start
  if (length < 1 || length > 100 || !isRepoStart(text.charCodeAt(start)) || endsWithGit(text, start, end)) return false
  for (let i = start + 1; i < end; i += 1) {
    if (!isRepoChar(text.charCodeAt(i), allowDot)) return false
  }
  return true
}

function isDenied(text: string, start: number, end: number, words: readonly string[]): boolean {
  const length = end - start
  for (const word of words) {
    if (word.length !== length) continue
    let same = true
    for (let i = 0; i < length; i += 1) {
      let code = text.charCodeAt(start + i)
      if (code >= 65 && code <= 90) code += 32
      if (code !== word.charCodeAt(i)) {
        same = false
        break
      }
    }
    if (same) return true
  }
  return false
}

function endsWithGit(text: string, start: number, end: number): boolean {
  if (end - start < 4 || text.charCodeAt(end - 4) !== 46) return false
  const g = text.charCodeAt(end - 3)
  const i = text.charCodeAt(end - 2)
  const t = text.charCodeAt(end - 1)
  return (g === 71 || g === 103) && (i === 73 || i === 105) && (t === 84 || t === 116)
}

function isGh(text: string, i: number): boolean {
  const first = text.charCodeAt(i)
  const second = text.charCodeAt(i + 1)
  return (first === 71 || first === 103) && (second === 72 || second === 104) && text.charCodeAt(i + 2) === 45
}

function startsWithDots(text: string, i: number): boolean {
  return text.charCodeAt(i) === 46 && text.charCodeAt(i + 1) === 46 && text.charCodeAt(i + 2) === 46
}

function blockedBefore(text: string, index: number): boolean {
  if (index <= 0) return false
  return isBoundaryChar(text, index - 1, false)
}

function blockedAfter(text: string, index: number): boolean {
  if (index >= text.length) return false
  return isBoundaryChar(text, index, true)
}

function isBoundaryChar(text: string, index: number, after: boolean): boolean {
  const code = text.charCodeAt(index)
  if (code < 128) {
    return isAlnum(code) || code === 95 || code === 64 || code === 38 || code === 35 || (after && code === 47)
  }
  return isUnicodeLetterOrNumber(text, index)
}

// Cached answer for `insideUrl`: whether the token that ends just before
// `urlScanPos` contains a `://`. Hits are found left to right, so a later hit
// scans back only as far as the previous one, and a long token is read once
// instead of once per hit. Reset in `findHits`.
let urlScanPos = 0
let urlScanInside = false

/** True when `start` sits in the same whitespace-free token as an earlier `://`. */
function insideUrl(text: string, start: number): boolean {
  let inside = urlScanInside
  const floor = urlScanPos < 2 ? 2 : urlScanPos
  for (let i = start - 1; i >= floor; i -= 1) {
    const code = text.charCodeAt(i)
    if (isSpace(code)) {
      inside = false
      break
    }
    if (code === 47 && text.charCodeAt(i - 1) === 47 && text.charCodeAt(i - 2) === 58) {
      inside = true
      break
    }
  }
  urlScanPos = start
  urlScanInside = inside
  return inside
}

function followedByDotWord(text: string, end: number): boolean {
  return text.charCodeAt(end) === 46 && end + 1 < text.length && isLetterOrNumber(text, end + 1)
}

function isLetterOrNumber(text: string, index: number): boolean {
  const code = text.charCodeAt(index)
  return code < 128 ? isAlnum(code) : isUnicodeLetterOrNumber(text, index)
}

const UNICODE_ALNUM = /[\p{L}\p{N}]/u

function isUnicodeLetterOrNumber(text: string, index: number): boolean {
  let code = text.charCodeAt(index)
  if (code < 128) return false
  // Land on the start of an astral character when `index` is its low half.
  if (code >= 0xdc00 && code <= 0xdfff && index > 0) {
    const high = text.charCodeAt(index - 1)
    if (high >= 0xd800 && high <= 0xdbff) {
      index -= 1
      code = high
    }
  }
  // Common non-alphanumeric ranges (Latin-1 symbols, general and CJK
  // punctuation, full-width punctuation) skip the Unicode property lookup.
  if (
    (code >= 0xa0 && code <= 0xa9) ||
    (code >= 0x2000 && code <= 0x206f) ||
    (code >= 0x3000 && code <= 0x3004) ||
    (code >= 0x3008 && code <= 0x3020) ||
    (code >= 0xff01 && code <= 0xff0f) ||
    (code >= 0xff1a && code <= 0xff20)
  ) {
    return false
  }
  return UNICODE_ALNUM.test(String.fromCodePoint(text.codePointAt(index) ?? code))
}

function isSpace(code: number): boolean {
  return code === 32 || code === 9 || code === 10 || code === 13 || code === 12 || code === 160
}

function isAlnum(code: number): boolean {
  return (code >= 48 && code <= 57) || (code >= 65 && code <= 90) || (code >= 97 && code <= 122)
}

function isUserChar(code: number): boolean {
  return isAlnum(code) || code === 45
}

function isIdentStart(code: number): boolean {
  return isAlnum(code) || code === 95
}

function isRepoStart(code: number): boolean {
  return isAlnum(code) || code === 95
}

function isRepoChar(code: number, allowDot: boolean): boolean {
  return isAlnum(code) || code === 95 || code === 45 || (allowDot && code === 46)
}
