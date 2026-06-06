const fs = require('fs');
const path = require('path');
const vm = require('vm');

function extractFunctionSource(source, name) {
  const markers = [`function ${name}(`, `async function ${name}(`];
  const start = markers
    .map((marker) => source.indexOf(marker))
    .filter((idx) => idx >= 0)
    .sort((a, b) => a - b)[0];
  if (start == null) throw new Error(`Function not found: ${name}`);
  const marker = source.startsWith(`async function ${name}(`, start)
    ? `async function ${name}(`
    : `function ${name}(`;
  const followingDeclarations = [
    '\nfunction ',
    '\nasync function ',
    '\nconst ',
    '\nlet ',
    '\nvar ',
    '\nclass ',
  ];
  const next = followingDeclarations
    .map((token) => source.indexOf(token, start + marker.length))
    .filter((idx) => idx >= 0)
    .sort((a, b) => a - b)[0];
  if (next != null) return source.slice(start, next);
  const braceStart = source.indexOf('{', start);
  if (braceStart < 0) throw new Error(`Function body not found: ${name}`);
  let depth = 0;
  let state = 'code';
  let quote = null;
  for (let i = braceStart; i < source.length; i++) {
    const ch = source[i];
    const nextCh = source[i + 1];
    if (state === 'line-comment') {
      if (ch === '\n') state = 'code';
      continue;
    }
    if (state === 'block-comment') {
      if (ch === '*' && nextCh === '/') {
        state = 'code';
        i++;
      }
      continue;
    }
    if (state === 'string') {
      if (ch === quote && source[i - 1] !== '\\') {
        state = 'code';
        quote = null;
      }
      continue;
    }
    if (ch === '/' && nextCh === '/') {
      state = 'line-comment';
      i++;
      continue;
    }
    if (ch === '/' && nextCh === '*') {
      state = 'block-comment';
      i++;
      continue;
    }
    if (ch === '"' || ch === "'" || ch === '`') {
      state = 'string';
      quote = ch;
      continue;
    }
    if (ch === '{') depth++;
    if (ch === '}') {
      depth--;
      if (depth === 0) {
        return source.slice(start, i + 1);
      }
    }
  }
  throw new Error(`Unterminated function: ${name}`);
}

function loadMainFunctions(names, stubs = {}) {
  const source = fs.readFileSync(path.join(__dirname, '..', 'main.js'), 'utf8');
  const sandbox = Object.assign({
    console,
    Math,
    Date,
    JSON,
    String,
    Number,
    Boolean,
    Array,
    Set,
    Map,
    Object,
    RegExp,
    Promise,
    parseInt,
    parseFloat,
    isNaN,
    isFinite,
  }, stubs);
  sandbox.globalThis = sandbox;
  sandbox.window = sandbox;
  sandbox.self = sandbox;
  for (const name of names) {
    const fnSource = extractFunctionSource(source, name);
    vm.runInNewContext(`${fnSource}\nthis.${name} = ${name};`, sandbox, { filename: 'main.js' });
  }
  return sandbox;
}

module.exports = { loadMainFunctions };
