// Сборка public/styles.css из классов в public/index.html и public/app.js (Tailwind v4).
// Запуск: node tools/build-css.mjs  (нужен установленный пакет tailwindcss@4)
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';

const root = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');
const twDir = process.env.TAILWIND_DIR || path.dirname(createRequire(import.meta.url).resolve('tailwindcss/package.json'));
const { compile } = await import(path.join(twDir, 'dist/lib.mjs'));

const input = fs.readFileSync(path.join(root, 'tools/input.css'), 'utf8');
const compiler = await compile(input, {
  base: root,
  loadStylesheet: async (id, base) => {
    const file = id === 'tailwindcss' ? path.join(twDir, 'index.css') : path.resolve(base, id);
    return { path: file, base: path.dirname(file), content: fs.readFileSync(file, 'utf8') };
  },
  loadModule: async () => { throw new Error('plugins are not used'); }
});

const sources = ['public/index.html', 'public/app.js'].map((f) => fs.readFileSync(path.join(root, f), 'utf8')).join('\n');
const candidates = new Set(sources.match(/[^\s"'`<>=;{}()\\]+/g));
let css = compiler.build([...candidates]);
// простая минификация: убрать комментарии и лишние пробелы
css = css.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\n\s*/g, '\n').replace(/\n+/g, '\n');
fs.writeFileSync(path.join(root, 'public/styles.css'), css);
console.log('styles.css:', css.length, 'bytes,', candidates.size, 'candidates');
