const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { vigiarDownloads, destinoDaNota, acharArquivo } = require('../src/downloads');

const CHAVE = '1'.repeat(50);
const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), 'nfse-mei-'));

test('destino padronizado por mês', () => {
  assert.strictEqual(
    destinoDaNota('/notas', '2026-09-30', 'acme', CHAVE, 'pdf'),
    path.join('/notas', '2026-09', `NFSe_2026-09_acme_${CHAVE.slice(-8)}.pdf`),
  );
});

test('acha "<chave>.pdf" e "<chave> (1).pdf", ignora outros', () => {
  const dl = tmp();
  fs.writeFileSync(path.join(dl, 'outra.pdf'), 'x');
  assert.strictEqual(acharArquivo(dl, CHAVE, 'pdf'), null);
  fs.writeFileSync(path.join(dl, `${CHAVE} (1).pdf`), '%PDF');
  assert.strictEqual(path.basename(acharArquivo(dl, CHAVE, 'pdf')), `${CHAVE} (1).pdf`);
});

test('vigia move os arquivos quando chegam', async () => {
  const dl = tmp();
  const notas = tmp();
  const destino = ext => destinoDaNota(notas, '2026-09-30', 'acme', CHAVE, ext);
  const vigia = vigiarDownloads({ pastaDownloads: dl, chave: CHAVE, tipos: ['pdf', 'xml'], destino, log: () => {}, intervaloMs: 20 });
  setTimeout(() => fs.writeFileSync(path.join(dl, `${CHAVE}.pdf`), '%PDF-1.7'), 50);
  setTimeout(() => fs.writeFileSync(path.join(dl, `${CHAVE}.xml`), '<xml/>'), 80);
  const salvos = await vigia.promessa;
  assert.strictEqual(fs.readFileSync(salvos.pdf, 'utf8'), '%PDF-1.7');
  assert.strictEqual(fs.readFileSync(salvos.xml, 'utf8'), '<xml/>');
  assert.ok(!fs.existsSync(path.join(dl, `${CHAVE}.pdf`)), 'saiu de Downloads');
});
