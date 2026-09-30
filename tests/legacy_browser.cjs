// Firefox 68 (68.x ESR "Fennec") is the last Firefox for Android 4.1–4.4.
// Every card module must parse and run there: a single unsupported syntax
// feature stops the whole module, including `style: terminal`.
//
// Run `npm install --prefix tests` once, then `node tests/legacy_browser.cjs`.
const fs = require('node:fs');
const path = require('node:path');

let acorn;
try {
  acorn = require('acorn');
} catch (error) {
  console.error('acorn is missing: run `npm install --prefix tests` first.');
  process.exit(1);
}

const frontend = path.join(__dirname, '..', 'custom_components', 'beszel_machine_card', 'frontend');
const files = fs.readdirSync(frontend).filter(name => name.endsWith('.js'));

// Built-ins newer than Firefox 68 (version that added each in parentheses).
const NEWER_APIS = new Map([
  ['replaceAll', 'String#replaceAll (77)'],
  ['at', 'Array/String#at (90)'],
  ['findLast', 'Array#findLast (104)'],
  ['findLastIndex', 'Array#findLastIndex (104)'],
  ['hasOwn', 'Object.hasOwn (92)'],
  ['allSettled', 'Promise.allSettled (71)'],
  ['any', 'Promise.any (79)'],
  ['replaceChildren', 'Element#replaceChildren (78)'],
  ['toSorted', 'Array#toSorted (115)'],
  ['toReversed', 'Array#toReversed (115)'],
  ['toSpliced', 'Array#toSpliced (115)'],
  ['groupBy', 'Object.groupBy (119)'],
  ['randomUUID', 'crypto.randomUUID (95)'],
]);
const NEWER_GLOBALS = new Map([
  ['structuredClone', 'structuredClone (94)'],
  ['queueMicrotask', 'queueMicrotask (69)'],
  ['AggregateError', 'AggregateError (79)'],
  ['WeakRef', 'WeakRef (79)'],
]);

function visit(node, callback) {
  if (!node || typeof node.type !== 'string') return;
  callback(node);
  for (const value of Object.values(node)) {
    if (Array.isArray(value)) value.forEach(child => visit(child, callback));
    else if (value && typeof value.type === 'string') visit(value, callback);
  }
}

const problems = [];
for (const file of files) {
  const source = fs.readFileSync(path.join(frontend, file), 'utf8');
  const where = pos => `${file}:${source.slice(0, pos).split('\n').length}`;
  const regexes = [];
  let ast;
  try {
    // ES2019 rejects ?. (FF74), ?? (FF72), class fields (FF69+),
    // numeric separators (FF70), logical assignment (FF79), top-level await.
    ast = acorn.parse(source, {
      ecmaVersion: 2019,
      sourceType: 'module',
      onToken: token => { if (token.type === acorn.tokTypes.regexp) regexes.push(token); },
    });
  } catch (error) {
    problems.push(`${file}: syntax newer than Firefox 68 — ${error.message}`);
    continue;
  }
  // ES2018 regex syntax that Firefox only gained in 78.
  for (const token of regexes) {
    const { pattern, flags } = token.value;
    if (/\(\?<[=!]/.test(pattern)) problems.push(`${where(token.start)}: regex look-behind (FF78)`);
    if (/\(\?<[A-Za-z_$]/.test(pattern)) problems.push(`${where(token.start)}: regex named group (FF78)`);
    if (/\\[pP]\{/.test(pattern)) problems.push(`${where(token.start)}: regex unicode property escape (FF78)`);
    if (/[sdv]/.test(flags)) problems.push(`${where(token.start)}: regex flag "${flags}" (FF78+)`);
  }
  visit(ast, node => {
    if (node.type === 'MemberExpression' && !node.computed && NEWER_APIS.has(node.property.name)) {
      problems.push(`${where(node.start)}: ${NEWER_APIS.get(node.property.name)}`);
    }
    if (node.type === 'Identifier' && NEWER_GLOBALS.has(node.name)) {
      problems.push(`${where(node.start)}: ${NEWER_GLOBALS.get(node.name)}`);
    }
    if (node.type === 'NewExpression' && node.callee.type === 'Identifier' && node.callee.name === 'RegExp') {
      problems.push(`${where(node.start)}: dynamic RegExp — check its pattern manually`);
    }
  });
}

if (problems.length) {
  console.error(`Firefox 68 compatibility problems:\n  ${problems.join('\n  ')}`);
  process.exit(1);
}
console.log(`Firefox 68 compatibility check passed (${files.join(', ')}).`);
