# Codelab: Catch QNX image build mistakes before you boot

**Duration:** 20 minutes · **You'll need:** Node.js 18+, VS Code, a QNX SDP 8.0 buildfile (or the examples in this repo)

## What you'll learn
- How a QNX mkifs buildfile is structured: attributes, the bootstrap section, the startup script, and regular files
- The five buildfile mistakes that most often break an image — and why
- How to lint buildfiles in the terminal, in VS Code, and in CI with **ifslint**

## 1. Anatomy of a buildfile
A buildfile is a list of lines in the form `[attributes] file_specification`.
- **Attributes on their own line** apply to every file after them. Attributes on the same line as a file apply only to that file.
- The **bootstrap section** (`[virtual=aarch64le,raw] .bootstrap = { ... }`) lists the startup program first and `procnto` last.
- The **startup script** (`[+script] .script = { ... }`) is run by procnto after the process manager starts. It is *not* a shell script.
- **Inline files** (`/etc/profile = { ... }`) take their contents from the buildfile itself.

Open `examples/good.build` and find each of these parts.

## 2. Run ifslint
```
git clone https://github.com/mura0420/ifslint && cd ifslint
npm install && npm run build
node dist/cli.js examples/good.build --tree
```
You'll see `✔ 0 error(s)` and the file tree of the image, with everything that has no absolute path placed under `/proc/boot`.

## 3. Break things on purpose
Run `node dist/cli.js examples/broken.build`. Walk through the five most common mistakes:

1. **`[uid = 0] [gid=0]`** — mkifs wants no spaces around `=` and all attributes in *one* set of brackets: `[uid=0 gid=0]`.
2. **`[perm=0755]`** — the attribute is `perms`. ifslint suggests the fix.
3. **Bootstrap order** — `startup-*` must come first and `procnto` last. Swapping them gives an image that never boots.
4. **Shell syntax in the startup script** — `|`, `>`, `for`, `$( )` and wildcards are not supported. Run `ksh -c "..."` if you really need a shell.
5. **Programs the script can't find** — every executable the script starts must be in the image (or on a filesystem mounted earlier). ifslint's W022 lists them.

Fix each one in your copy and re-run until you get `✔`.

## 4. Lint as you type in VS Code
```
npm run vsix
code --install-extension vscode/qnx-buildfile-0.1.0.vsix
```
Open any `.build` file: errors are underlined as you type. Run **QNX Buildfile: Show image tree** from the Command Palette to see the image layout.

## 5. Add it to CI
Copy `.github/workflows/ifslint.yml` into your BSP repository. Every pull request that touches a buildfile is now checked before anyone spends time building and flashing an image. Use `--max-warnings 0` to make warnings fail the build too.

## 6. Review image changes with --diff
When a pull request touches a buildfile, the text diff rarely tells you what the *image* will look like. Run:
```
node dist/cli.js --diff examples/good.build examples/good-v2.build
```
ifslint lists files added to or removed from the image, permission and owner changes, edited inline files, and new or removed startup-script and bootstrap lines.

## What's next
- Run `ifslint --json` to feed results into your own tooling
- Contribute a rule: each rule is a few lines in `src/rules.ts` with a test in `test/rules.test.js`
