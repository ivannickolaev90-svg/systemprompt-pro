// Генерация промокодов для каналов.
//   node tools/gen-promo.mjs <первый номер канала> <сколько каналов> <папка для CSV вне репозитория>
// На каждый канал: 1 бессрочный PRO (владельцу) + 10 одноразовых PRO на 30 дней, метка канала chNN.
// В репозиторий (lib/promo-codes.js) попадают ТОЛЬКО хэши кодов; сами коды — в CSV, его в репозиторий не класть.
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';

const [from = '1', count = '30', outDir] = process.argv.slice(2);
if (!outDir) { console.error('Укажите папку для CSV вне репозитория'); process.exit(1); }
const A = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; // без 0/O, 1/I
const code = () => 'SP-' + [0, 1, 2].map(() => Array.from(crypto.randomBytes(4), (b) => A[b % 32]).join('')).join('-');
const sha = (s) => crypto.createHash('sha256').update(s).digest('hex');

const file = new URL('../lib/promo-codes.js', import.meta.url);
let map = {};
if (fs.existsSync(file)) map = (await import(file.href + '?' + Date.now())).PROMO;
const rows = ['канал;название канала (заполнить);тип;код;ссылка'];
for (let i = +from; i < +from + +count; i++) {
  const ch = 'ch' + String(i).padStart(2, '0');
  const list = [['life', code()], ...Array.from({ length: 10 }, () => ['m30', code()])];
  for (const [t, c] of list) {
    map[sha('p:' + c)] = { c: ch, t };
    rows.push([ch, '', t === 'life' ? 'бессрочный PRO (владельцу)' : 'PRO на 30 дней, одноразовый', c, 'https://systemprompt-pro.com/?promo=' + c].join(';'));
  }
}
fs.writeFileSync(file, '// Хэши промокодов (sha256 от "p:"+код) → канал и тип. Сами коды здесь не хранятся.\n// Генерирует tools/gen-promo.mjs. life — бессрочный PRO, m30 — PRO на 30 дней (одноразовый).\nexport const PROMO = ' + JSON.stringify(map, null, 0).replace(/},"/g, '},\n"') + ';\n');
const out = path.join(outDir, `promo-ch${String(from).padStart(2, '0')}-ch${String(+from + +count - 1).padStart(2, '0')}.csv`);
fs.writeFileSync(out, '﻿' + rows.join('\n') + '\n');
console.log('Кодов:', rows.length - 1, '→', out);
