// Parser for QNX mkifs buildfiles (QNX SDP 8.0 grammar).
// Produces a flat list of items with attributes resolved, inline-file bodies,
// and precise source ranges for diagnostics.

export type Range = { line: number; col: number; endCol: number }; // 1-based line, 0-based cols

export type Attr = {
  raw: string;
  name: string;
  kind: 'bool' | 'value';
  sign?: '+' | '-';
  value?: string;
  conditional: boolean; // leading '?'
  range: Range;
};

export type AttrGroup = { attrs: Attr[]; range: Range; text: string };

export type Item = {
  kind: 'file' | 'inline' | 'attrs-only';
  line: number;
  groups: AttrGroup[]; // attribute groups on this line
  target?: string; // path inside the image
  host?: string; // host path (target=host)
  targetRange?: Range;
  inlineBody?: { text: string; startLine: number; endLine: number; lines: string[] };
  effective: Record<string, Attr>; // attributes in effect (sticky + local)
  raw: string;
};

export type Comment = { line: number; col: number; precededBySpace: boolean };

export type ParseResult = {
  items: Item[];
  comments: Comment[];
  problems: { range: Range; message: string; code: string }[]; // syntax-level
  lines: string[];
};

const ATTR_RE = /^(\?)?([+-])?([A-Za-z_][A-Za-z0-9_]*)(\s*=\s*)?(.*)$/s;

const parseAttr = (raw: string, line: number, col: number): Attr | null => {
  const m = ATTR_RE.exec(raw);
  if (!m) return null;
  const [, q, sign, name, eq, rest] = m;
  const range = { line, col, endCol: col + raw.length };
  if (eq !== undefined) {
    return { raw, name: name!, kind: 'value', value: rest!, conditional: !!q, range, sign: sign as '+' | '-' | undefined };
  }
  return { raw, name: name!, kind: 'bool', sign: (sign as '+' | '-') ?? undefined, conditional: !!q, range };
};

// split the inside of [...] into attribute tokens, honoring double quotes and \] escapes
const splitAttrs = (inner: string, line: number, baseCol: number) => {
  const out: Attr[] = [];
  let i = 0;
  while (i < inner.length) {
    while (i < inner.length && /\s/.test(inner[i]!)) i++;
    if (i >= inner.length) break;
    const start = i;
    let inQ = false;
    while (i < inner.length) {
      const ch = inner[i]!;
      if (ch === '\\' && i + 1 < inner.length) {
        i += 2;
        continue;
      }
      if (ch === '"') inQ = !inQ;
      // "name = value" with spaces is a user error we want to detect, so keep
      // tokens split on whitespace only outside quotes
      if (!inQ && /\s/.test(ch)) break;
      i++;
    }
    const tok = inner.slice(start, i);
    const a = parseAttr(tok, line, baseCol + start);
    if (a) out.push(a);
  }
  return out;
};

// Find the position of an unescaped, unquoted '#' that starts a comment.
const commentStart = (s: string): number => {
  let inQ = false;
  let depth = 0;
  for (let i = 0; i < s.length; i++) {
    const ch = s[i]!;
    if (ch === '\\') {
      i++;
      continue;
    }
    if (ch === '"') inQ = !inQ;
    else if (!inQ && ch === '[') depth++;
    else if (!inQ && ch === ']') depth = Math.max(0, depth - 1);
    else if (!inQ && depth === 0 && ch === '#') return i;
  }
  return -1;
};

const STICKY_SKIP = new Set<string>(); // all attributes on their own line are sticky

export const parse = (text: string): ParseResult => {
  const lines = text.replace(/\r\n?/g, '\n').split('\n');
  const items: Item[] = [];
  const comments: Comment[] = [];
  const problems: ParseResult['problems'] = [];
  const sticky: Record<string, Attr> = {};

  for (let ln = 0; ln < lines.length; ln++) {
    let raw = lines[ln]!;
    // line continuation outside inline files
    let joined = raw;
    while (/(^|[^\\])\\$/.test(joined) && ln + 1 < lines.length) {
      ln++;
      joined = joined.slice(0, -1) + lines[ln]!;
    }
    raw = joined;
    const lineNo = ln + 1;
    const c = commentStart(raw);
    let code = raw;
    if (c >= 0) {
      comments.push({ line: lineNo, col: c, precededBySpace: c === 0 || /\s/.test(raw[c - 1]!) });
      code = raw.slice(0, c);
    }
    if (code.trim() === '') continue;

    // attribute groups at the start of the line
    const groups: AttrGroup[] = [];
    let i = 0;
    while (true) {
      while (i < code.length && /\s/.test(code[i]!)) i++;
      if (code[i] !== '[') break;
      let j = i + 1;
      let inQ = false;
      while (j < code.length) {
        if (code[j] === '\\') {
          j += 2;
          continue;
        }
        if (code[j] === '"') inQ = !inQ;
        else if (!inQ && code[j] === ']') break;
        j++;
      }
      if (j >= code.length) {
        problems.push({ code: 'E100', message: 'Unterminated attribute list: missing "]"', range: { line: lineNo, col: i, endCol: code.length } });
        i = code.length;
        break;
      }
      const inner = code.slice(i + 1, j);
      groups.push({ attrs: splitAttrs(inner, lineNo, i + 1), range: { line: lineNo, col: i, endCol: j + 1 }, text: code.slice(i, j + 1) });
      i = j + 1;
    }
    const spec = code.slice(i).trim();
    const specCol = i + (code.slice(i).length - code.slice(i).trimStart().length);

    if (!spec) {
      // attributes on their own line: sticky for all following files
      for (const g of groups) for (const a of g.attrs) if (!STICKY_SKIP.has(a.name)) sticky[a.name] = a;
      items.push({ kind: 'attrs-only', line: lineNo, groups, effective: { ...sticky }, raw });
      continue;
    }

    const local: Record<string, Attr> = {};
    for (const g of groups) for (const a of g.attrs) local[a.name] = a;
    const effective = { ...sticky, ...local };

    // inline file: target = {   (brace must end the line)
    const inl = /^("[^"]*"|[^=\s]+)\s*=\s*\{\s*(.*)$/.exec(spec);
    if (inl) {
      const target = inl[1]!.replace(/^"|"$/g, '');
      const after = inl[2]!;
      const item: Item = {
        kind: 'inline',
        line: lineNo,
        groups,
        target,
        targetRange: { line: lineNo, col: specCol, endCol: specCol + inl[1]!.length },
        effective,
        raw,
      };
      if (after.trim() !== '') {
        problems.push({
          code: 'E012',
          message: 'Inline file contents cannot be on the same line as the opening brace',
          range: { line: lineNo, col: raw.indexOf('{'), endCol: raw.length },
        });
        if (/(^|[^\\])\}\s*$/.test(after)) {
          item.inlineBody = { text: after.replace(/\}\s*$/, ''), startLine: lineNo, endLine: lineNo, lines: [after.replace(/\}\s*$/, '')] };
          items.push(item);
          continue;
        }
      }
      // collect body until a line whose unescaped '}' closes it
      const body: string[] = [];
      let closed = false;
      const startLine = lineNo + 1;
      while (ln + 1 < lines.length) {
        ln++;
        const l = lines[ln]!;
        const close = /(^|[^\\])\}/.exec(l);
        if (close) {
          const idx = close.index + close[1]!.length;
          const before = l.slice(0, idx);
          if (before.trim() !== '') {
            problems.push({
              code: 'E012',
              message: 'Inline file contents cannot be on the same line as the closing brace',
              range: { line: ln + 1, col: 0, endCol: idx + 1 },
            });
            body.push(before);
          }
          closed = true;
          break;
        }
        body.push(l);
      }
      if (!closed)
        problems.push({ code: 'E013', message: `Inline file "${target}" is never closed with "}"`, range: { line: lineNo, col: 0, endCol: raw.length } });
      item.inlineBody = { text: body.join('\n'), startLine, endLine: ln + 1, lines: body };
      items.push(item);
      continue;
    }

    // regular file: target[=host]
    const fm = /^("[^"]*"|[^=\s]+)(?:\s*=\s*("[^"]*"|\S+))?\s*(.*)$/.exec(spec);
    if (fm) {
      const target = fm[1]!.replace(/^"|"$/g, '');
      const host = fm[2]?.replace(/^"|"$/g, '');
      items.push({
        kind: 'file',
        line: lineNo,
        groups,
        target,
        host,
        targetRange: { line: lineNo, col: specCol, endCol: specCol + fm[1]!.length },
        effective,
        raw,
      });
      if (fm[3] && fm[3].trim())
        problems.push({
          code: 'E101',
          message: `Unexpected text after file specification: "${fm[3].trim()}" (quote filenames that contain spaces)`,
          range: { line: lineNo, col: raw.indexOf(fm[3].trim()), endCol: raw.length },
        });
    }
  }
  return { items, comments, problems, lines };
};
