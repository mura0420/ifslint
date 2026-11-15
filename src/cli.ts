#!/usr/bin/env node
// ifslint — lint and visualize QNX mkifs buildfiles.
import { readFileSync } from 'node:fs';
import { counts, lint, type Diagnostic } from './rules';
import { imageTree as renderTree } from './tree';
import { diff, formatDiff } from './diff';

const useColor = process.stdout.isTTY && !process.env.NO_COLOR;
const c = (code: string, s: string) => (useColor ? `\x1b[${code}m${s}\x1b[0m` : s);
const sev = { error: (s: string) => c('31;1', s), warning: (s: string) => c('33;1', s), info: (s: string) => c('36', s) };

const usage = `ifslint — lint QNX OS image buildfiles (mkifs, QNX SDP 8.0)

Usage: ifslint [options] <buildfile...>
       ifslint --diff <old.build> <new.build>

Options:
  --json            machine-readable output
  --diff A B        show what changes in the image between two buildfiles
  --tree            print the image's file tree after linting
  --max-warnings N  exit non-zero if warnings exceed N (CI)
  --quiet           only report errors
  -h, --help        show this help
`;

export const formatDiagnostics = (file: string, text: string, ds: Diagnostic[]) => {
  const lines = text.replace(/\r\n?/g, '\n').split('\n');
  const out: string[] = [];
  for (const d of ds) {
    out.push(`${c('1', `${file}:${d.range.line}:${d.range.col + 1}`)} ${sev[d.severity](d.severity)} ${c('2', d.code)} ${d.message}`);
    const src = lines[d.range.line - 1] ?? '';
    out.push(`  ${c('2', String(d.range.line).padStart(4))} | ${src}`);
    const width = Math.max(1, Math.min(d.range.endCol, src.length) - d.range.col);
    out.push(`       | ${' '.repeat(d.range.col)}${sev[d.severity]('^'.repeat(width))}`);
    if (d.hint) out.push(`       = ${c('32', 'hint:')} ${d.hint}`);
  }
  return out.join('\n');
};

const main = () => {
  const args = process.argv.slice(2);
  if (args.length === 0 || args.includes('-h') || args.includes('--help')) {
    process.stdout.write(usage);
    process.exit(args.length === 0 ? 2 : 0);
  }
  if (args[0] === '--diff') {
    if (args.length < 3) {
      process.stdout.write(usage);
      process.exit(2);
    }
    const d = diff(readFileSync(args[1]!, 'utf8'), readFileSync(args[2]!, 'utf8'));
    console.log(args.includes('--json') ? JSON.stringify(d, null, 2) : formatDiff(d, c));
    process.exit(0);
  }
  const json = args.includes('--json');
  const tree = args.includes('--tree');
  const quiet = args.includes('--quiet');
  const mwIdx = args.indexOf('--max-warnings');
  const maxWarnings = mwIdx >= 0 ? Number(args[mwIdx + 1]) : Infinity;
  const files = args.filter((a, i) => !a.startsWith('--') && !(mwIdx >= 0 && i === mwIdx + 1));
  let errors = 0;
  let warnings = 0;
  const report: Record<string, Diagnostic[]> = {};
  for (const f of files) {
    const text = readFileSync(f, 'utf8');
    let ds = lint(text, { file: f });
    if (quiet) ds = ds.filter((d) => d.severity === 'error');
    report[f] = ds;
    const k = counts(ds);
    errors += k.error;
    warnings += k.warning;
    if (!json) {
      if (ds.length) console.log(formatDiagnostics(f, text, ds) + '\n');
      if (tree) console.log(renderTree(text, c) + '\n');
    }
  }
  if (json) console.log(JSON.stringify(report, null, 2));
  else {
    const summary = `${errors} error(s), ${warnings} warning(s) in ${files.length} file(s)`;
    console.log(errors ? sev.error('✖ ' + summary) : warnings ? sev.warning('⚠ ' + summary) : c('32;1', '✔ ' + summary));
  }
  process.exit(errors > 0 || warnings > maxWarnings ? 1 : 0);
};

if (require.main === module) main();
