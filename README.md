# comark-git-autolink

[![npm version](https://img.shields.io/npm/v/comark-git-autolink?color=black)](https://npmx.dev/comark-git-autolink)
[![npm downloads](https://img.shields.io/npm/dm/comark-git-autolink?color=black)](https://npm.chart.dev/comark-git-autolink)
[![CI](https://img.shields.io/github/actions/workflow/status/farnabaz/comark-git-autolink/ci.yml?branch=main&color=black)](https://github.com/farnabaz/comark-git-autolink/actions/workflows/ci.yml)
[![license](https://img.shields.io/github/license/farnabaz/comark-git-autolink?color=black)](https://github.com/farnabaz/comark-git-autolink/blob/main/LICENSE)

A [Comark](https://comark.dev) plugin that turns git forge references into links.
`#32` becomes an issue link, and `other/repo#4` links into another repository.
Each reference type has its own option.

The syntax is the one GitHub uses, and links follow GitHub's URL layout
(`/issues/n`, `/commit/sha`, `/compare/a...b`, `/orgs/org/teams/team`). Set
`baseUrl` to point them at GitHub Enterprise or another host that uses the same
layout. Hosts with a different layout, such as GitLab (`/-/issues/n`), are not
supported.

Issue and pull request numbers share GitHub's `#` syntax and link to
`/issues/n`, which GitHub resolves for both.

## Install

```bash
pnpm add comark-git-autolink
```

## Usage

```ts
import { parseMarkdown } from 'comark'
import gitAutolink from 'comark-git-autolink'

const tree = await parseMarkdown('Fix #32 in hello/blabla', {
  plugins: [gitAutolink({ repository: 'hello/blabla' })],
})
```

`repository` is the default repo for shorthand references (`#32`, `GH-32`, a
bare commit SHA). Qualified references such as `other/repo#4` and
`hello/blabla` do not need it. Pass `owner/repo`, a repository URL, or
`git@host:owner/repo.git`.

For GitHub Enterprise, set `baseUrl`:

```ts
gitAutolink({
  repository: 'acme/app',
  baseUrl: 'https://github.example.com',
})
```

## References

| Reference | Example | Option | Needs `repository` |
| --- | --- | --- | --- |
| Issue or pull request | `#32`, `GH-32` | `issues` | yes |
| Issue in another repo | `other/repo#32` | `issues` | no |
| Repository (opt-in) | `hello/blabla` | `repositories` | no |
| User mention | `@farnabaz` | `mentions` | no |
| Team mention | `@acme/maintainers` | `mentions` | no |
| Commit | `abc1234`, `owner/repo@abc1234` | `commits` | bare SHA only |
| Compare range | `abc1234...def5678` | `compares` | bare range only |

The visible text is left as written. References inside code, existing links,
and HTML comments are not rewritten.

Bare commit SHAs (and `user@sha`) must be 7–40 hex characters with at least one
digit and one letter, so plain numbers (`1234567`), words made only of hex
letters (`deadbeef`, `defaced`) and scientific notation (`1e100000`) stay text.
A SHA written as `owner/repo@sha` only needs a letter, because the `@` already
says it is a commit. Repository references do not match paths (`src/index.ts`,
`hello/blabla/src`) or a trailing file extension (`hello/blabla.txt`).

References are not linked when they touch a letter or digit, so `foo#32` and
`中文#32` stay text, while `（#32）` and `🎉#32` link.

## Options

Every reference option defaults to `true` except `repositories`, which defaults
to `false`. Set one to `false` to leave that type as plain text:

```ts
gitAutolink({
  repository: 'hello/blabla',
  issues: true,
  mentions: false,
  commits: false,
  compares: false,
})
```

To also link bare `owner/repo` text, opt in with `repositories: true`.

| Option | Default | Description |
| --- | --- | --- |
| `repository` | — | Default `owner/repo` for shorthand references |
| `baseUrl` | `https://github.com` | Origin used in generated links |
| `issues` | `true` | `#32`, `GH-32`, `owner/repo#32` |
| `repositories` | `false` | Bare `owner/repo`, such as `hello/blabla` |
| `mentions` | `true` | `@user` and `@org/team` |
| `commits` | `true` | Commit SHAs |
| `compares` | `true` | `sha...sha` ranges |

`repositories` is off by default because any `word/word` pair looks like a
repository: with it on, `and/or`, `TCP/IP` and `24/7` become links to
`github.com/and/or` and so on. Qualified references (`other/repo#4`,
`other/repo@abc1234`) work without it.

## Benchmarks

`pnpm bench` times a single scan and a full parse on about 40 KB of plain prose, 67 KB of dense references, 22 KB of CJK text and a 20 KB URL-like token with thousands of mentions. The scanner walks each text node once and does not compile a regular expression per node. The script fails if the scan or the plugin overhead regresses past a loose budget.

To compare against another copy of `src/` (for example the code before a change), point `BENCH_SRC` at it:

```bash
cp -R src /tmp/src-before
BENCH_SRC=/tmp/src-before pnpm bench
```

## Playground

`pnpm play` opens a local page where you can edit Markdown, change the repository, and turn each reference type on or off. The preview and the link list update as you type.

## Scripts

| Script | Description |
| --- | --- |
| `pnpm play` | Open the playground at <http://localhost:5173> |
| `pnpm bench` | Time the scanner and a full parse against plain prose and dense references |
| `pnpm test` | Run the test suite once |
| `pnpm test:watch` | Run tests in watch mode |
| `pnpm typecheck` | Type-check the whole project (no emit) |
| `pnpm build` | Bundle `dist/` (ESM + declarations) via tsdown |
| `pnpm dev` | Rebuild on change (`tsdown --watch`) |

Requires Node.js ≥ 22.18 for development. The published package runs on Node ≥ 20.

## Releasing

Releases are driven by [uppt](https://github.com/danielroe/uppt) from
[conventional commits](https://www.conventionalcommits.org) (`feat:`, `fix:`,
`feat!:` for a breaking change).

1. Merge to `main`. The `release` workflow opens or updates a draft release PR
   with the next version and changelog. Edit `version` in `package.json` on that
   branch to pick a different one.
2. Merge the release PR. The workflow tags `vX.Y.Z`, creates the GitHub release,
   builds the tarball (`prepack` runs `pnpm build`) and stages it to npm.
3. Approve the staged version on npmjs.com.

For a prerelease, run `gh workflow run release.yml -f prerelease=beta`.

One-time setup:

- On npmjs.com, add a trusted publisher for the package pointing at this
  repository and `release.yml`, with the environment name set to `npm`. The
  package must already exist on npm.
- Create a GitHub environment named `npm`.
- Enable **Allow GitHub Actions to create and approve pull requests** under
  Settings, Actions, General.

## License

[MIT](./LICENSE)
