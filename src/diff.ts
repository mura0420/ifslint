// Semantic diff of two mkifs buildfiles: what changes in the *image*,
// not in the text. Useful in code review of BSP / image changes.
import { parse } from './parser';

export type Entry = {
  path: string;
  kind: 'file' | 'inline' | 'link' | 'dir' | 'script';
  host?: string;
  perms?: string;
  uid?: string;
  gid?: string;
  content?: string; // inline body
};

export type ImageModel = {
  bootstrap: { virtual: string | null; commands: string[] };
  script: string[];
  entries: Map<string, Entry>;
};

const norm = (s: string) => s.trim().replace(/\s+/g, ' ');

export const model = (text: string): ImageModel => {
  const { items } = parse(text);
  const m: ImageModel = { bootstrap: { virtual: null, commands: [] }, script: [], entries: new Map() };
  for (const it of items) {
    if (!it.target || it.kind === 'attrs-only') continue;
    const isBoot = it.kind === 'inline' && it.groups.some((g) => g.attrs.some((a) => a.name === 'virtual'));
    if (isBoot) {
      m.bootstrap.virtual = it.effective.virtual?.value ?? null;
      m.bootstrap.commands = (it.inlineBody?.lines ?? []).map(norm).filter((l) => l && !l.startsWith('#'));
      continue;
    }
    if (it.effective.script?.sign === '+' && it.kind === 'inline') {
      m.script.push(...(it.inlineBody?.lines ?? []).map(norm).filter((l) => l && !l.startsWith('#')));
      continue;
    }
    const prefix = it.effective.prefix?.value ?? 'proc/boot';
    const path = it.target.startsWith('/') ? it.target : `/${prefix}/${it.target}`.replace(/\/+/g, '/');
    const type = it.effective.type?.value;
    const e: Entry = {
      path,
      kind: type === 'link' ? 'link' : type === 'dir' ? 'dir' : it.kind === 'inline' ? 'inline' : 'file',
      host: it.host,
      perms: it.effective.perms?.value,
      uid: it.effective.uid?.value,
      gid: it.effective.gid?.value,
      content: it.inlineBody?.text,
    };
    m.entries.set(path, e);
  }
  return m;
};

export type Change = { path: string; field: string; from: string; to: string };

export type ImageDiff = {
  added: Entry[];
  removed: Entry[];
  changed: Change[];
  bootstrap: { virtual?: { from: string | null; to: string | null }; added: string[]; removed: string[] };
  script: { added: string[]; removed: string[] };
};

const listDiff = (a: string[], b: string[]) => ({
  added: b.filter((x) => !a.includes(x)),
  removed: a.filter((x) => !b.includes(x)),
});

export const diff = (oldText: string, newText: string): ImageDiff => {
  const A = model(oldText);
  const B = model(newText);
  const added = [...B.entries.values()].filter((e) => !A.entries.has(e.path));
  const removed = [...A.entries.values()].filter((e) => !B.entries.has(e.path));
  const changed: Change[] = [];
  for (const [p, b] of B.entries) {
    const a = A.entries.get(p);
    if (!a) continue;
    for (const f of ['kind', 'host', 'perms', 'uid', 'gid'] as const) {
      if ((a[f] ?? '') !== (b[f] ?? '')) changed.push({ path: p, field: f, from: a[f] ?? '(default)', to: b[f] ?? '(default)' });
    }
    if ((a.content ?? '') !== (b.content ?? '')) changed.push({ path: p, field: 'inline content', from: `${(a.content ?? '').split('\n').length} line(s)`, to: `${(b.content ?? '').split('\n').length} line(s)` });
  }
  const bd = listDiff(A.bootstrap.commands, B.bootstrap.commands);
  const sd = listDiff(A.script, B.script);
  return {
    added,
    removed,
    changed,
    bootstrap: { ...(A.bootstrap.virtual !== B.bootstrap.virtual ? { virtual: { from: A.bootstrap.virtual, to: B.bootstrap.virtual } } : {}), ...bd },
    script: sd,
  };
};

export const isEmpty = (d: ImageDiff) =>
  !d.added.length && !d.removed.length && !d.changed.length && !d.bootstrap.virtual && !d.bootstrap.added.length && !d.bootstrap.removed.length && !d.script.added.length && !d.script.removed.length;

export const formatDiff = (d: ImageDiff, c: (code: string, s: string) => string = (_c, s) => s) => {
  if (isEmpty(d)) return 'No changes to the image.';
  const out: string[] = [];
  if (d.bootstrap.virtual) out.push(c('1', 'Bootstrap'), `  ~ virtual: ${d.bootstrap.virtual.from ?? '(none)'} → ${d.bootstrap.virtual.to ?? '(none)'}`);
  if (d.bootstrap.added.length || d.bootstrap.removed.length) {
    if (!d.bootstrap.virtual) out.push(c('1', 'Bootstrap'));
    for (const l of d.bootstrap.removed) out.push(c('31', `  - ${l}`));
    for (const l of d.bootstrap.added) out.push(c('32', `  + ${l}`));
  }
  if (d.script.added.length || d.script.removed.length) {
    out.push(c('1', 'Startup script'));
    for (const l of d.script.removed) out.push(c('31', `  - ${l}`));
    for (const l of d.script.added) out.push(c('32', `  + ${l}`));
  }
  if (d.added.length || d.removed.length || d.changed.length) {
    out.push(c('1', 'Image files'));
    for (const e of d.removed) out.push(c('31', `  - ${e.path}${e.kind === 'link' ? ` -> ${e.host}` : ''}`));
    for (const e of d.added) out.push(c('32', `  + ${e.path}${e.kind === 'link' ? ` -> ${e.host}` : ''}${e.perms ? ` (perms=${e.perms})` : ''}`));
    for (const ch of d.changed) out.push(c('33', `  ~ ${ch.path}: ${ch.field} ${ch.from} → ${ch.to}`));
  }
  const n = d.added.length + d.removed.length + d.changed.length;
  out.push('', `${d.added.length} added, ${d.removed.length} removed, ${d.changed.length} changed file attribute(s); ${d.script.added.length + d.script.removed.length} startup-script and ${d.bootstrap.added.length + d.bootstrap.removed.length} bootstrap line change(s)`);
  void n;
  return out.join('\n');
};
