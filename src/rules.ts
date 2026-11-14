// Lint rules for QNX mkifs buildfiles. Every rule cites the QNX SDP 8.0
// mkifs / "Buildfile syntax" documentation it enforces.
import { parse, type Attr, type Item, type Range } from './parser';

export type Severity = 'error' | 'warning' | 'info';
export type Diagnostic = { code: string; severity: Severity; message: string; range: Range; hint?: string };

type Spec = { kind: 'bool' | 'value' | 'both'; check?: (v: string) => string | null };

const NUM_OR_STAR = (v: string) => (/^(\*|\d+)$/.test(v) ? null : 'must be a number or "*"');
const MODE = (v: string) =>
  /^(\*|0?[0-7]{3,4})$/.test(v) || /^([ugoa]*[-+=][rwxsgt]*)(,[ugoa]*[-+=][rwxsgt]*)*$/.test(v)
    ? null
    : 'must be an octal mode (e.g. 0755), "*", or a symbolic mode like u+x,go-w';
const ADDR = (v: string) =>
  /^(0x[0-9a-f]+|\d+)?[kmg]?(-(0x[0-9a-f]+|\d+)[kmg]?)?(,(0x[0-9a-f]+|\d+)[kmg]?)?(=(0x[0-9a-f]+|\d+)[kmg]?)?(%(0x[0-9a-f]+|\d+)[kmg]?)?$/i.test(v)
    ? null
    : 'expected [start][-end][,maxsize][=totalsize][%align] with optional k/m/g suffixes';
const ONE_OF = (vals: string[]) => (v: string) => (vals.includes(v) ? null : `must be one of: ${vals.join(', ')}`);

// mkifs attributes (QNX SDP 8.0 Utilities Reference, "mkifs")
export const MKIFS_ATTRS: Record<string, Spec> = {
  autolink: { kind: 'bool' },
  big_pages: { kind: 'bool' },
  bigendian: { kind: 'bool' },
  dupignore: { kind: 'bool' },
  followlink: { kind: 'bool' },
  include: { kind: 'bool' },
  keeplinked: { kind: 'bool' },
  optional: { kind: 'bool' },
  page_align: { kind: 'bool' },
  raw: { kind: 'bool' },
  script: { kind: 'bool' },
  autoso: { kind: 'value', check: (v) => (/^(n(one)?|l(ist)?|a(dd)?)$/.test(v) ? null : 'must be none, list or add') },
  cd: { kind: 'value' },
  chain: { kind: 'value' },
  cksum: { kind: 'value', check: (v) => (/^(0x[0-9a-f]+|\d+)$/i.test(v) ? null : 'must be a number') },
  compress: { kind: 'both', check: ONE_OF(['1', '2', '3']) },
  dperms: { kind: 'value', check: MODE },
  drop: { kind: 'value' },
  filter: { kind: 'value' },
  gid: { kind: 'value', check: NUM_OR_STAR },
  uid: { kind: 'value', check: NUM_OR_STAR },
  ifs_csa: { kind: 'value', check: ONE_OF(['none', 'crc32c']) },
  image: { kind: 'value', check: ADDR },
  linker: { kind: 'value' },
  module: { kind: 'value' },
  mount: { kind: 'value' },
  mtime: { kind: 'value', check: (v) => (/^(\*|\d{4}-\d{2}-\d{2}-\d{2}:\d{2}:\d{2})$/.test(v) ? null : 'must be "*" or YYYY-MM-DD-HH:MM:SS (all six fields, UTC)') },
  pagesizes: { kind: 'value' },
  perms: { kind: 'value', check: MODE },
  phys_align: { kind: 'value' },
  physical: { kind: 'value' },
  prefix: { kind: 'value' },
  ram: { kind: 'value', check: ADDR },
  search: { kind: 'value' },
  sha256: { kind: 'value', check: (v) => (/^[0-9a-fA-F]{64}$/.test(v) ? null : 'must be exactly 64 hex digits with no prefix') },
  sha512: { kind: 'value', check: (v) => (/^[0-9a-fA-F]{128}$/.test(v) ? null : 'must be exactly 128 hex digits with no prefix') },
  type: { kind: 'value', check: ONE_OF(['link', 'fifo', 'file', 'dir']) },
  virtual: { kind: 'value' },
};

// script-file modifiers (mkifs "Script files")
const SCRIPT_MODIFIERS = new Set(['argv0', 'cpu', 'critical', 'external', 'pri', 'session', 'sched_aps', 'uid', 'gid', 'umask']);
const INTERNAL_CMDS = new Set(['display_msg', 'procmgr_symlink', 'reopen', 'waitfor']);

const closest = (name: string, pool: string[]) => {
  let best = '';
  let bestD = 3;
  for (const p of pool) {
    const d = lev(name, p);
    if (d < bestD) {
      bestD = d;
      best = p;
    }
  }
  return best || null;
};
const lev = (a: string, b: string) => {
  const dp = Array.from({ length: a.length + 1 }, (_, i) => [i, ...Array(b.length).fill(0)] as number[]);
  for (let j = 1; j <= b.length; j++) dp[0]![j] = j;
  for (let i = 1; i <= a.length; i++)
    for (let j = 1; j <= b.length; j++)
      dp[i]![j] = Math.min(dp[i - 1]![j]! + 1, dp[i]![j - 1]! + 1, dp[i - 1]![j - 1]! + (a[i - 1] === b[j - 1] ? 0 : 1));
  return dp[a.length]![b.length]!;
};

const attrDiagnostics = (a: Attr): Diagnostic[] => {
  const out: Diagnostic[] = [];
  const spec = MKIFS_ATTRS[a.name];
  if (!spec) {
    const sug = closest(a.name, Object.keys(MKIFS_ATTRS));
    out.push({
      code: 'E001',
      severity: 'error',
      message: `Unknown mkifs attribute "${a.name}"`,
      range: a.range,
      hint: sug ? `Did you mean "${sug}"?` : undefined,
    });
    return out;
  }
  if (a.kind === 'bool' && spec.kind === 'value')
    out.push({ code: 'E004', severity: 'error', message: `"${a.name}" is a value attribute; write ${a.name}=<value>`, range: a.range });
  if (a.kind === 'value' && spec.kind === 'bool')
    out.push({ code: 'E004', severity: 'error', message: `"${a.name}" is a boolean attribute; write +${a.name} or -${a.name}`, range: a.range });
  if (a.kind === 'bool' && spec.kind !== 'value' && !a.sign)
    out.push({ code: 'E004', severity: 'error', message: `Boolean attribute "${a.name}" needs a + or - prefix`, range: a.range });
  if (a.name === 'physical')
    out.push({ code: 'W025', severity: 'warning', message: '"physical" is not implemented in QNX 8.0; use "virtual"', range: a.range });
  if (a.kind === 'value' && spec.check && a.value !== undefined) {
    const v = a.value.replace(/^"|"$/g, '');
    if (!v.includes('${')) {
      const err = spec.check(v);
      if (err) out.push({ code: 'E005', severity: 'error', message: `Invalid value for ${a.name}: "${v}" ${err}`, range: a.range });
    }
  }
  return out;
};

const basename = (p: string) => p.replace(/\/+$/, '').split('/').pop() ?? p;

export const lint = (text: string, opts: { file?: string } = {}): Diagnostic[] => {
  const { items, comments, problems, lines } = parse(text);
  const d: Diagnostic[] = problems.map((p) => ({ ...p, severity: 'error' as Severity }));

  // attribute syntax
  for (const it of items) {
    if (it.groups.length > 1)
      d.push({
        code: 'E003',
        severity: 'error',
        message: 'Combine attributes in one set of brackets, e.g. [uid=0 gid=0] — separate bracket groups are not valid',
        range: { line: it.line, col: it.groups[0]!.range.col, endCol: it.groups[it.groups.length - 1]!.range.endCol },
      });
    for (const g of it.groups) {
      if (/(^|[^\\"\s])\s+=|=\s+(?=[^\s\]])/.test(g.text.replace(/"[^"]*"/g, '""'))) {
        d.push({ code: 'E002', severity: 'error', message: 'No spaces are allowed around "=" in attributes', range: g.range, hint: g.text.replace(/\s*=\s*/g, '=') });
        continue;
      }
      for (const a of g.attrs) d.push(...attrDiagnostics(a));
    }
  }

  // comments need a space before '#'
  for (const c of comments)
    if (!c.precededBySpace)
      d.push({
        code: 'W011',
        severity: 'warning',
        message: 'Put a space before "#" — without it the "#" may become part of the file specification',
        range: { line: c.line, col: c.col, endCol: c.col + 1 },
      });

  // windows-style separators
  for (const it of items)
    if (it.kind === 'file' && it.host && /\\/.test(it.host.replace(/\\[\\$"\]]/g, '')))
      d.push({ code: 'W023', severity: 'warning', message: 'Use "/" as the directory separator, even on Windows hosts', range: it.targetRange! });

  // duplicates
  const seen = new Map<string, Item>();
  for (const it of items) {
    if (!it.target || it.kind === 'attrs-only') continue;
    if (it.effective.virtual && it.kind === 'inline') continue; // bootstrap pseudo-file
    if (it.effective.script?.sign === '+') continue; // script files merge by design
    const prefix = it.effective.prefix?.value ?? 'proc/boot';
    const full = it.target.startsWith('/') ? it.target : `/${prefix}/${it.target}`.replace(/\/+/g, '/');
    const prev = seen.get(full);
    if (prev && it.effective.dupignore?.sign !== '+')
      d.push({
        code: 'E014',
        severity: 'error',
        message: `Duplicate target path ${full} (first defined on line ${prev.line})`,
        range: it.targetRange!,
        hint: 'Remove one entry or set [+dupignore] if this is intentional',
      });
    else seen.set(full, it);
  }

  // bootstrap section
  const boots = items.filter((i) => i.kind === 'inline' && i.groups.some((g) => g.attrs.some((a) => a.name === 'virtual')));
  if (boots.length > 1)
    d.push({ code: 'W026', severity: 'warning', message: 'More than one bootstrap ([virtual=...]) section', range: { line: boots[1]!.line, col: 0, endCol: lines[boots[1]!.line - 1]!.length } });
  for (const b of boots) {
    const cmds = (b.inlineBody?.lines ?? [])
      .map((l, n) => ({ l: l.trim(), line: b.inlineBody!.startLine + n }))
      .filter((x) => x.l && !x.l.startsWith('#'));
    const progOf = (s: string) => s.replace(/^\[[^\]]*\]\s*/, '').split(/\s+/).find((t) => !/^[A-Za-z_][A-Za-z0-9_]*=/.test(t)) ?? '';
    if (cmds.length) {
      const first = cmds[0]!;
      const last = cmds[cmds.length - 1]!;
      if (!basename(progOf(first.l)).startsWith('startup-'))
        d.push({ code: 'E015', severity: 'error', message: `The first bootstrap executable must be a startup-* program, found "${progOf(first.l)}"`, range: { line: first.line, col: 0, endCol: lines[first.line - 1]!.length } });
      if (!basename(progOf(last.l)).startsWith('procnto'))
        d.push({ code: 'E016', severity: 'error', message: `The last bootstrap executable must be procnto, found "${progOf(last.l)}"`, range: { line: last.line, col: 0, endCol: lines[last.line - 1]!.length } });
      for (const c of cmds)
        if (/\[[^\]]*\+optional/.test(c.l))
          d.push({ code: 'E017', severity: 'error', message: '+optional cannot be enabled for bootstrap executables', range: { line: c.line, col: 0, endCol: lines[c.line - 1]!.length } });
    }
  }
  if (boots.length === 0 && items.some((i) => i.kind !== 'attrs-only'))
    d.push({
      code: 'I030',
      severity: 'info',
      message: 'No bootstrap section ([virtual=...]); the image will not be bootable and PROCESSOR defaults to x86_64 if unset',
      range: { line: 1, col: 0, endCol: (lines[0] ?? '').length },
    });

  // symlinks
  const links = items.filter((i) => i.effective.type?.value === 'link' && i.target);
  for (const l of links)
    if (!l.host)
      d.push({ code: 'E018', severity: 'error', message: `Symbolic link "${l.target}" has no target; write [type=link] ${l.target}=<target>`, range: l.targetRange! });
  const linkPaths = new Set(links.map((l) => l.target!.replace(/\/+$/, '')));
  for (const it of items)
    for (const lp of linkPaths)
      if (it.target && it.target !== lp && it.target.startsWith(lp + '/'))
        d.push({
          code: 'W019',
          severity: 'warning',
          message: `"${lp}" is a symlink; mkifs does not resolve symlinks used as path components of other entries`,
          range: it.targetRange!,
        });

  // script files
  // directory imports (e.g. /usr/bin=/host/dir) bring in files we can't see statically
  const hasDirImports = items.some((i) => i.kind === 'file' && i.host && i.target?.startsWith('/') && !/\.[A-Za-z0-9]+$/.test(i.target) && /(^|\/)(s?bin|lib|usr|opt)(\/|$)/.test(i.target));
  const imageNames = new Set(items.filter((i) => i.target).map((i) => basename(i.target!)));
  for (const s of items.filter((i) => i.kind === 'inline' && i.effective.script?.sign === '+')) {
    const body = s.inlineBody?.lines ?? [];
    body.forEach((l0, n) => {
      const lineNo = s.inlineBody!.startLine + n;
      const t = l0.trim();
      if (!t || t.startsWith('#')) return;
      const full = lines[lineNo - 1] ?? l0;
      const rng = { line: lineNo, col: full.indexOf(t), endCol: full.indexOf(t) + t.length };
      // modifiers
      const mods = /^\[([^\]]*)\]/.exec(t);
      if (mods)
        for (const tok of mods[1]!.trim().split(/\s+/).filter(Boolean)) {
          const nm = tok.replace(/^[?+-]+/, '').split('=')[0]!;
          if (!SCRIPT_MODIFIERS.has(nm))
            d.push({ code: 'W020', severity: 'warning', message: `Unknown script modifier "${nm}"`, range: rng, hint: closest(nm, [...SCRIPT_MODIFIERS]) ? `Did you mean "${closest(nm, [...SCRIPT_MODIFIERS])}"?` : undefined });
        }
      const cmd = t.replace(/^\[[^\]]*\]\s*/, '');
      if (!cmd) return;
      const words = cmd.split(/\s+/).filter((w) => !/^[A-Za-z_][A-Za-z0-9_]*=/.test(w));
      const prog = words[0];
      if (prog === 'display_msg') return;
      const unsupported: [RegExp, string][] = [
        [/(^|\s)\|(\s|$)/, 'pipes (|)'],
        [/(^|[^\d&])>{1,2}\s*\S/, 'output redirection (>)'],
        [/^(if|then|else|fi|for|while|do|done|case|esac)\b/, 'branches and loops'],
        [/\$\(|`/, 'subshells'],
        [/(^|\s)[^\s=]*[*?][^\s]*/, 'wildcards / filename expansion'],
        [/;\s*\S/, 'command lists (;)'],
      ];
      for (const [re, what] of unsupported)
        if (re.test(cmd)) {
          d.push({ code: 'E021', severity: 'error', message: `Script files don't support ${what}: "${cmd}"`, range: rng, hint: 'Script files are not shell scripts; run a real shell (e.g. ksh -c "...") if you need this' });
          return;
        }
      if (!prog || INTERNAL_CMDS.has(prog) || /\[[^\]]*\+external/.test(t)) return;
      if (!prog.startsWith('/') && !imageNames.has(basename(prog)))
        d.push({
          code: 'W022',
          severity: hasDirImports ? 'info' : 'warning',
          message: `"${prog}" is run by the startup script but isn't included in this image`,
          range: rng,
          hint: 'Add it to the buildfile, or make sure a filesystem that provides it is mounted earlier in the script',
        });
    });
  }

  // optional with missing host file can't be checked statically; flag inline files with perms on Windows
  void opts;
  return d.sort((a, b) => a.range.line - b.range.line || a.range.col - b.range.col);
};

export const counts = (ds: Diagnostic[]) => ({
  error: ds.filter((x) => x.severity === 'error').length,
  warning: ds.filter((x) => x.severity === 'warning').length,
  info: ds.filter((x) => x.severity === 'info').length,
});
