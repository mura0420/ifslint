# ifslint — lint QNX OS image buildfiles

`ifslint` catches mistakes in QNX **mkifs buildfiles** (QNX SDP 8.0) *before* you build and boot the image — in your terminal, in CI, and live in VS Code.

A typo in a buildfile usually means a failed `mkifs` run at best, or an image that boots to a hung startup script at worst. Every rule in ifslint is taken from the QNX SDP 8.0 *mkifs* Utilities Reference and the *Buildfile syntax* chapter of *Building Embedded Systems*.

```
$ ifslint examples/broken.build
examples/broken.build:16:2 error E001 Unknown mkifs attribute "perm"
    16 | [perm=0755]
       |  ^^^^^^^^^
       = hint: Did you mean "perms"?
examples/broken.build:8:5 error E021 Script files don't support pipes (|): "devc-virtio -e 0x9000000,33 | tee /dev/null"
...
✖ 17 error(s), 4 warning(s) in 1 file(s)
```

## Install
```
git clone https://github.com/mura0420/ifslint && cd ifslint
npm install && npm run build
node dist/cli.js my.build            # or: npm link, then `ifslint my.build`

# VS Code extension
npm run vsix                         # builds vscode/qnx-buildfile-0.1.0.vsix
code --install-extension vscode/qnx-buildfile-0.1.0.vsix
```

## Usage
```
ifslint [--tree] [--json] [--quiet] [--max-warnings N] <buildfile...>
```
- `--tree` prints the file tree of the resulting image (prefix `proc/boot` applied, symlinks, inline files, permissions)
- `--json` for tooling; non-zero exit on errors for CI

## Rules
| Code | Severity | What it catches | Source in QNX docs |
|---|---|---|---|
| E001 | error | Unknown attribute, with a "did you mean" suggestion | mkifs › Attributes |
| E002 | error | Spaces around `=` in an attribute | mkifs › "Don't put any spaces around the equals sign" |
| E003 | error | `[uid=5] [gid=5]` — attributes split across bracket groups | Buildfile syntax › combine attributes |
| E004 | error | Boolean attribute without `+`/`-`, or used with a value (and vice versa) | mkifs › boolean vs value attributes |
| E005 | error | Invalid values: `perms`/`dperms` modes, `uid`/`gid`, `type`, `mtime`, `sha256`/`sha512`, `compress`, `autoso`, `ifs_csa`, `image`/`ram` | mkifs › each attribute |
| E012 | error | Inline file content on the same line as `{` or `}` | mkifs › Inline files |
| E013 | error | Inline file never closed | mkifs › Inline files |
| E014 | error | Duplicate target path (after applying `prefix`), unless `+dupignore` | mkifs › dupignore |
| E015 | error | Bootstrap: first executable is not `startup-*` | mkifs › virtual / bootstrap |
| E016 | error | Bootstrap: last executable is not `procnto` | mkifs › virtual / bootstrap |
| E017 | error | `+optional` on a bootstrap executable | mkifs › optional |
| E018 | error | `[type=link]` without a link target | mkifs › type |
| E021 | error | Script file uses pipes, redirection, loops/branches, subshells, wildcards or `;` | mkifs › Script files ("not supported") |
| W011 | warning | `#` comment without a preceding space | mkifs › comments |
| W019 | warning | A symlink used as a path component of another entry | mkifs › Symbolic links |
| W020 | warning | Unknown script modifier, with suggestion | mkifs › Script modifiers |
| W022 | warning | Startup script runs a program that isn't in the image | mkifs › "Executables must be present when run" |
| W023 | warning | `\` used as a directory separator | mkifs › use `/` even on Windows |
| W025 | warning | `physical` attribute (not implemented in 8.0) | mkifs › physical |
| I030 | info | No bootstrap section (image not bootable; PROCESSOR defaults to x86_64) | Building Embedded Systems › The bootstrap file |

## CI
See [.github/workflows/ifslint.yml](.github/workflows/ifslint.yml) — lint every `*.build` file on each pull request.

## Development
```
npm install && npm run build && npm test   # 20 tests
```

## License
Apache-2.0. Built with AI assistance (Claude); every rule was checked against the QNX SDP 8.0 documentation.
