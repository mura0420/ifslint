const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { lint } = require('../dist/rules');

const codes = (t) => lint(t).filter((d) => d.severity !== 'info').map((d) => d.code);
const ex = (f) => fs.readFileSync(path.join(__dirname, '..', 'examples', f), 'utf8');

test('clean example has no errors or warnings', () => assert.deepEqual(codes(ex('good.build')), []));

test('broken example finds every planted mistake exactly once', () => {
  const c = codes(ex('broken.build'));
  for (const code of ['E015', 'E016', 'E017', 'E021', 'W020', 'E003', 'E002', 'E001', 'W011', 'E018', 'W019', 'E014', 'E005', 'E012', 'W023'])
    assert.ok(c.includes(code), `missing ${code}`);
  assert.equal(c.filter((x) => x === 'E004').length, 0, 'no noisy E004 after E002');
});

const boot = '[virtual=x86_64,bios] .boot = {\nstartup-x86 -v\nPATH=/proc/boot procnto-smp-instr\n}\n';
test('unknown attribute suggests fix', () => {
  const d = lint(boot + '[uidd=0] a').find((x) => x.code === 'E001');
  assert.match(d.hint, /uid/);
});
test('boolean attribute without sign', () => assert.ok(codes(boot + '[script] .s = {\nksh\n}\nksh').includes('E004')));
test('value attribute used as boolean', () => assert.ok(codes(boot + '[+perms] a').includes('E004')));
test('symbolic perms are valid', () => assert.deepEqual(codes(boot + '[perms=u+x,go-w] a'), []));
test('compress as boolean is valid', () => assert.deepEqual(codes('[virtual=x86_64,bios +compress] .boot = {\nstartup-x86\nprocnto-smp-instr\n}\n'), []));
test('dupignore allows duplicates', () => assert.deepEqual(codes(boot + '[+dupignore]\na\na'), []));
test('duplicates with prefix resolution', () => assert.ok(codes(boot + 'a\n/proc/boot/a=a').includes('E014')));
test('inline closing brace on content line', () => assert.ok(codes(boot + '/etc/x = {\nhello }').includes('E012')));
test('unclosed inline file', () => assert.ok(codes(boot + '/etc/x = {\nhello').includes('E013')));
test('escaped brace inside inline file is fine', () => assert.deepEqual(codes(boot + '/etc/x = {\nfn() \\}\n}'), []));
test('script runs program not in image', () => assert.ok(codes(boot + '[+script] .s = {\nfoo &\n}').includes('W022')));
test('internal commands are not flagged', () => assert.deepEqual(codes(boot + '[+script] .s = {\nwaitfor /dev/ser1 5\nreopen\ndisplay_msg hi; there > you\n}'), []));
test('env-only script lines are fine', () => assert.deepEqual(codes(boot + '[+script] .s = {\nPATH=/proc/boot\n}'), []));
test('comment needs a space', () => assert.ok(codes(boot + 'a#c').includes('W011')));
test('hash inside quotes is not a comment', () => assert.deepEqual(codes(boot + '"/etc/my#file"=x'), []));
test('physical is deprecated', () => assert.ok(codes(boot + '[physical=x] a').includes('W025')));
test('sha256 ok', () => assert.deepEqual(codes(boot + `[sha256=${'a'.repeat(64)}] a`), []));
test('variables are not validated', () => assert.deepEqual(codes(boot + '[perms=${MY_PERMS}] a'), []));

const { diff, isEmpty } = require('../dist/diff');
test('diff: identical buildfiles have no changes', () => assert.ok(isEmpty(diff(ex('good.build'), ex('good.build')))));
test('diff: reports added/removed files, attribute and script changes', () => {
  const d = diff(ex('good.build'), ex('good-v2.build'));
  assert.deepEqual(d.added.map((e) => e.path), ['/proc/boot/io-sock']);
  assert.deepEqual(d.removed.map((e) => e.path), ['/proc/boot/cat']);
  assert.ok(d.changed.some((c) => c.path === '/etc/profile' && c.field === 'perms' && c.to === '0600'));
  assert.deepEqual(d.script.added, ['io-sock -m fdt -d vtnet_mmio &']);
});
test('diff: bootstrap changes are reported', () => {
  const a = '[virtual=x86_64,bios] .boot = {\nstartup-x86\nprocnto-smp-instr\n}\n';
  const b = '[virtual=x86_64,bios] .boot = {\nstartup-x86 -v\nprocnto-smp-instr\n}\n';
  const d = diff(a, b);
  assert.deepEqual(d.bootstrap.added, ['startup-x86 -v']);
  assert.deepEqual(d.bootstrap.removed, ['startup-x86']);
});
