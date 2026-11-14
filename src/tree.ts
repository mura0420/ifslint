import { parse } from './parser';

export const imageTree = (text: string, c: (code: string, s: string) => string = (_code, s) => s) => {
  const { items } = parse(text);
  const paths: { path: string; note: string }[] = [];
  for (const it of items) {
    if (!it.target || it.kind === 'attrs-only') continue;
    const isBoot = it.kind === 'inline' && !!it.effective.virtual && it.groups.some((g) => g.attrs.some((a) => a.name === 'virtual'));
    if (isBoot) {
      paths.push({ path: '(bootstrap)', note: `virtual=${it.effective.virtual!.value}` });
      continue;
    }
    const prefix = it.effective.prefix?.value ?? 'proc/boot';
    const full = it.target.startsWith('/') ? it.target : `/${prefix}/${it.target}`.replace(/\/+/g, '/');
    const notes: string[] = [];
    if (it.effective.script?.sign === '+') notes.push('startup script');
    if (it.effective.type?.value === 'link') notes.push(`-> ${it.host}`);
    else if (it.kind === 'inline') notes.push('inline');
    if (it.effective.perms) notes.push(`perms=${it.effective.perms.value}`);
    if (it.effective.uid || it.effective.gid) notes.push(`${it.effective.uid?.value ?? '*'}:${it.effective.gid?.value ?? '*'}`);
    paths.push({ path: full, note: notes.join(' ') });
  }
  // render as tree
  type Node = { children: Map<string, Node>; note?: string };
  const root: Node = { children: new Map() };
  const extra: string[] = [];
  for (const p of paths) {
    if (!p.path.startsWith('/')) {
      extra.push(`${p.path}  ${c('2', p.note)}`);
      continue;
    }
    let n = root;
    for (const part of p.path.split('/').filter(Boolean)) {
      if (!n.children.has(part)) n.children.set(part, { children: new Map() });
      n = n.children.get(part)!;
    }
    n.note = p.note;
  }
  const out = [...extra, '/'];
  const walk = (n: Node, pre: string) => {
    const kids = [...n.children.entries()];
    kids.forEach(([name, k], i) => {
      const last = i === kids.length - 1;
      out.push(`${pre}${last ? '└── ' : '├── '}${k.children.size ? c('34;1', name + '/') : name}${k.note ? '  ' + c('2', k.note) : ''}`);
      walk(k, pre + (last ? '    ' : '│   '));
    });
  };
  walk(root, '');
  return out.join('\n');
};

