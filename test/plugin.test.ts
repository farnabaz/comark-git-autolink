import { parseMarkdown } from 'comark'
import { describe, expect, it } from 'vitest'
import plugin from '../src/index.ts'
import type { PluginOptions } from '../src/index.ts'

const repository = 'hello/blabla'
const withRepositories: PluginOptions = { repository, repositories: true }

async function nodes(markdown: string, options: PluginOptions = { repository }) {
  const tree = await parseMarkdown(markdown, { plugins: [plugin(options)] })
  return tree.nodes
}

describe('comark-git-autolink', () => {
  it('links shorthand issues and repository references', async () => {
    await expect(nodes('Fix #32 in hello/blabla.', withRepositories)).resolves.toEqual([
      [
        'p',
        {},
        'Fix ',
        ['a', { href: 'https://github.com/hello/blabla/issues/32' }, '#32'],
        ' in ',
        ['a', { href: 'https://github.com/hello/blabla' }, 'hello/blabla'],
        '.',
      ],
    ])
  })

  it('links GH- issues without changing the visible text', async () => {
    await expect(nodes('See GH-7 and gh-8.')).resolves.toEqual([
      [
        'p',
        {},
        'See ',
        ['a', { href: 'https://github.com/hello/blabla/issues/7' }, 'GH-7'],
        ' and ',
        ['a', { href: 'https://github.com/hello/blabla/issues/8' }, 'gh-8'],
        '.',
      ],
    ])
  })

  it('links a qualified issue without a default repository', async () => {
    await expect(nodes('other/repo#4', {})).resolves.toEqual([
      ['p', {}, ['a', { href: 'https://github.com/other/repo/issues/4' }, 'other/repo#4']],
    ])
  })

  it('leaves shorthand issues as text when no repository is configured', async () => {
    await expect(nodes('Fix #32', {})).resolves.toEqual([['p', {}, 'Fix #32']])
  })

  it('links mentions, including teams', async () => {
    await expect(nodes('Ask @farnabaz or @comarkdown/maintainers.')).resolves.toEqual([
      [
        'p',
        {},
        'Ask ',
        ['a', { href: 'https://github.com/farnabaz' }, '@farnabaz'],
        ' or ',
        ['a', { href: 'https://github.com/orgs/comarkdown/teams/maintainers' }, '@comarkdown/maintainers'],
        '.',
      ],
    ])
  })

  it('does not link the historical @mention words', async () => {
    await expect(nodes('Read @mention and @mentions.')).resolves.toEqual([
      ['p', {}, 'Read @mention and @mentions.'],
    ])
  })

  it('links commit SHAs and compare ranges, keeping the written text', async () => {
    await expect(nodes('Landed abc1234, see abc1234...def5678.')).resolves.toEqual([
      [
        'p',
        {},
        'Landed ',
        ['a', { href: 'https://github.com/hello/blabla/commit/abc1234' }, 'abc1234'],
        ', see ',
        ['a', { href: 'https://github.com/hello/blabla/compare/abc1234...def5678' }, 'abc1234...def5678'],
        '.',
      ],
    ])
  })

  it('links qualified commits and compares without a default repository', async () => {
    await expect(nodes('other/repo@abc1234 and other/repo@abc1234...def5678', {})).resolves.toEqual([
      [
        'p',
        {},
        ['a', { href: 'https://github.com/other/repo/commit/abc1234' }, 'other/repo@abc1234'],
        ' and ',
        ['a', { href: 'https://github.com/other/repo/compare/abc1234...def5678' }, 'other/repo@abc1234...def5678'],
      ],
    ])
  })

  it('links a fork commit against the configured project', async () => {
    await expect(nodes('farnabaz@abc1234')).resolves.toEqual([
      ['p', {}, ['a', { href: 'https://github.com/farnabaz/blabla/commit/abc1234' }, 'farnabaz@abc1234']],
    ])
  })

  it('does not treat plain numbers, dictionary words, or file names as commits', async () => {
    await expect(nodes('1234567 acceded deadbeef.txt')).resolves.toEqual([
      ['p', {}, '1234567 acceded deadbeef.txt'],
    ])
  })

  it('accepts a repository URL or git remote for shorthand references', async () => {
    const href = 'https://github.com/Hello/Bla-Bla/issues/3'
    await expect(nodes('#3', { repository: 'https://github.com/Hello/Bla-Bla.git' })).resolves.toEqual([
      ['p', {}, ['a', { href }, '#3']],
    ])
    await expect(nodes('#3', { repository: 'git@github.com:Hello/Bla-Bla.git' })).resolves.toEqual([
      ['p', {}, ['a', { href }, '#3']],
    ])
    await expect(nodes('#3', { repository: 'github.com/Hello/Bla-Bla/issues/9' })).resolves.toEqual([
      ['p', {}, ['a', { href }, '#3']],
    ])
  })

  it('uses baseUrl for every generated link', async () => {
    await expect(
      nodes('#32 and hello/blabla', {
        ...withRepositories,
        baseUrl: 'https://github.example.com/',
      }),
    ).resolves.toEqual([
      [
        'p',
        {},
        ['a', { href: 'https://github.example.com/hello/blabla/issues/32' }, '#32'],
        ' and ',
        ['a', { href: 'https://github.example.com/hello/blabla' }, 'hello/blabla'],
      ],
    ])
  })

  it.each([
    ['issues', '#32', '/issues/'],
    ['repositories', 'hello/blabla', 'https://github.com/hello/blabla'],
    ['mentions', '@farnabaz', 'https://github.com/farnabaz'],
    ['commits', 'abc1234', '/commit/'],
    ['compares', 'abc1234...def5678', '/compare/'],
  ] as const)('can disable %s on its own', async (option, markdown, hrefPart) => {
    const disabled = await nodes(markdown, { ...withRepositories, [option]: false })
    const enabled = await nodes(markdown, withRepositories)
    expect(JSON.stringify(disabled)).not.toContain(hrefPart)
    expect(JSON.stringify(enabled)).toContain(hrefPart)
  })

  it('keeps a disabled type as text while linking the others', async () => {
    await expect(nodes('Fix #32 in hello/blabla', { ...withRepositories, issues: false })).resolves.toEqual([
      [
        'p',
        {},
        'Fix #32 in ',
        ['a', { href: 'https://github.com/hello/blabla' }, 'hello/blabla'],
      ],
    ])
  })

  it('does not link references inside code, links, or comments', async () => {
    const markdown = [
      'Use `#32` and `hello/blabla`.',
      '',
      '```ts',
      '#32',
      'hello/blabla',
      '```',
      '',
      '[#32](https://example.com) and https://github.com/hello/blabla',
      '',
      '<!-- #32 hello/blabla -->',
    ].join('\n')

    await expect(nodes(markdown, withRepositories)).resolves.toEqual([
      [
        'p',
        {},
        'Use ',
        ['code', {}, '#32'],
        ' and ',
        ['code', {}, 'hello/blabla'],
        '.',
      ],
      ['pre', { language: 'ts' }, ['code', { class: 'language-ts' }, '#32\nhello/blabla']],
      [
        'p',
        {},
        ['a', { href: 'https://example.com' }, '#32'],
        ' and ',
        ['a', { href: 'https://github.com/hello/blabla' }, 'https://github.com/hello/blabla'],
      ],
      [null, {}, ' #32 hello/blabla '],
    ])
  })

  it('links references inside emphasis, lists, and blockquotes', async () => {
    await expect(nodes('**#32** and _hello/blabla_', withRepositories)).resolves.toEqual([
      [
        'p',
        {},
        ['strong', {}, ['a', { href: 'https://github.com/hello/blabla/issues/32' }, '#32']],
        ' and ',
        ['em', {}, ['a', { href: 'https://github.com/hello/blabla' }, 'hello/blabla']],
      ],
    ])
    await expect(nodes('> #32\n\n- hello/blabla', withRepositories)).resolves.toEqual([
      ['blockquote', {}, ['a', { href: 'https://github.com/hello/blabla/issues/32' }, '#32']],
      ['ul', {}, ['li', {}, ['a', { href: 'https://github.com/hello/blabla' }, 'hello/blabla']]],
    ])
  })

  it('does not link paths, glued tokens, or references inside a URL', async () => {
    await expect(
      nodes(
        'foo#32 src/index.ts hello/blabla/src C:/Users visit https://example.com/hello/blabla today',
        withRepositories,
      ),
    ).resolves.toEqual([
      [
        'p',
        {},
        'foo#32 src/index.ts hello/blabla/src C:/Users visit ',
        ['a', { href: 'https://example.com/hello/blabla' }, 'https://example.com/hello/blabla'],
        ' today',
      ],
    ])
  })

  it('leaves repository references as text unless `repositories` is enabled', async () => {
    await expect(nodes('and/or TCP/IP 24/7 hello/blabla')).resolves.toEqual([
      ['p', {}, 'and/or TCP/IP 24/7 hello/blabla'],
    ])
    await expect(nodes('hello/blabla', withRepositories)).resolves.toEqual([
      ['p', {}, ['a', { href: 'https://github.com/hello/blabla' }, 'hello/blabla']],
    ])
  })

  it('keeps qualified issues and commits linked while `repositories` is off', async () => {
    await expect(nodes('other/repo#4 other/repo@abc1234', {})).resolves.toEqual([
      [
        'p',
        {},
        ['a', { href: 'https://github.com/other/repo/issues/4' }, 'other/repo#4'],
        ' ',
        ['a', { href: 'https://github.com/other/repo/commit/abc1234' }, 'other/repo@abc1234'],
      ],
    ])
  })

  it('needs a digit and a letter for a bare commit SHA', async () => {
    await expect(nodes('deadbeef decadeface defaced 1234567')).resolves.toEqual([
      ['p', {}, 'deadbeef decadeface defaced 1234567'],
    ])
    await expect(nodes('1abcdef')).resolves.toEqual([
      ['p', {}, ['a', { href: 'https://github.com/hello/blabla/commit/1abcdef' }, '1abcdef']],
    ])
  })

  it('does not treat scientific notation as a commit SHA', async () => {
    await expect(nodes('1e100000 12e3456 5E12345')).resolves.toEqual([['p', {}, '1e100000 12e3456 5E12345']])
  })

  it('is stricter for `user@sha` than for an explicit `owner/repo@sha`', async () => {
    await expect(nodes('farnabaz@deadbeef')).resolves.toEqual([['p', {}, 'farnabaz@deadbeef']])
    await expect(nodes('other/repo@deadbeef', {})).resolves.toEqual([
      ['p', {}, ['a', { href: 'https://github.com/other/repo/commit/deadbeef' }, 'other/repo@deadbeef']],
    ])
  })

  it('does not link a compare range when one side is not a SHA', async () => {
    await expect(nodes('abc1234...notasha')).resolves.toEqual([['p', {}, 'abc1234...notasha']])
    await expect(nodes('abc1234...1234567')).resolves.toEqual([['p', {}, 'abc1234...1234567']])
    await expect(nodes('abc1234...def5678', { repository, compares: false })).resolves.toEqual([
      ['p', {}, 'abc1234...def5678'],
    ])
  })

  it('keeps a path prefix in baseUrl, with or without a trailing slash', async () => {
    for (const baseUrl of ['https://ghe.example.com/git', 'https://ghe.example.com/git/']) {
      await expect(nodes('#32 @farnabaz', { repository, baseUrl })).resolves.toEqual([
        [
          'p',
          {},
          ['a', { href: 'https://ghe.example.com/git/hello/blabla/issues/32' }, '#32'],
          ' ',
          ['a', { href: 'https://ghe.example.com/git/farnabaz' }, '@farnabaz'],
        ],
      ])
    }
  })

  it('only links well-formed team mentions', async () => {
    await expect(nodes('@org/team/extra @org/ @a--b @-bad')).resolves.toEqual([
      ['p', {}, '@org/team/extra @org/ @a--b @-bad'],
    ])
  })

  it('drops a trailing hyphen from a mention', async () => {
    await expect(nodes('ask @farnabaz- now')).resolves.toEqual([
      ['p', {}, 'ask ', ['a', { href: 'https://github.com/farnabaz' }, '@farnabaz'], '- now'],
    ])
  })

  it('does not link twice when the plugin runs twice', async () => {
    const options = { ...withRepositories }
    const markdown = 'Fix #32 in hello/blabla, ask @farnabaz, landed abc1234.'
    const once = await parseMarkdown(markdown, { plugins: [plugin(options)] })
    const twice = await parseMarkdown(markdown, { plugins: [plugin(options), plugin(options)] })
    expect(twice.nodes).toEqual(once.nodes)
    expect(JSON.stringify(twice.nodes).match(/"a"/g)).toHaveLength(4)
  })

  it('links around emoji and CJK punctuation but not against a letter', async () => {
    await expect(nodes('🎉#32 （#32） 修复，#32 中文#32')).resolves.toEqual([
      [
        'p',
        {},
        '🎉',
        ['a', { href: 'https://github.com/hello/blabla/issues/32' }, '#32'],
        ' （',
        ['a', { href: 'https://github.com/hello/blabla/issues/32' }, '#32'],
        '） 修复，',
        ['a', { href: 'https://github.com/hello/blabla/issues/32' }, '#32'],
        ' 中文#32',
      ],
    ])
  })

  it('stays inside one URL-like token and resets at whitespace', async () => {
    const many = Array.from({ length: 200 }, () => '@ab').join(',')
    const tree = await nodes(`foo://x/${many} then @ab`)
    const links = JSON.stringify(tree).match(/"href"/g) ?? []
    expect(links).toHaveLength(1)
    expect(JSON.stringify(tree)).toContain('"@ab"]')
  })

  it('rejects an unusable repository or baseUrl', () => {
    expect(() => plugin({ repository: 'not a repo' })).toThrow(/repository/)
    expect(() => plugin({ baseUrl: 'javascript:alert(1)' })).toThrow(/baseUrl/)
  })
})
