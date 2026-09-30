const test = require('node:test');
const assert = require('node:assert');
const { ultimoDiaUtil, formatarBR, parseBR, pascoa } = require('../src/datas');
const { parseValor, formatarValor, formatarCnpj } = require('../src/valores');

test('páscoa', () => {
  assert.strictEqual(formatarBR(pascoa(2026)), '05/04/2026');
  assert.strictEqual(formatarBR(pascoa(2027)), '28/03/2027');
});

test('último dia útil', () => {
  assert.strictEqual(formatarBR(ultimoDiaUtil(2026, 9)), '30/09/2026'); // quarta
  assert.strictEqual(formatarBR(ultimoDiaUtil(2026, 5)), '29/05/2026'); // 31 é domingo
  assert.strictEqual(formatarBR(ultimoDiaUtil(2026, 10)), '30/10/2026'); // 31 é sábado
  assert.strictEqual(formatarBR(ultimoDiaUtil(2026, 12)), '31/12/2026'); // quinta
  assert.strictEqual(formatarBR(ultimoDiaUtil(2027, 1)), '29/01/2027'); // 31 domingo, 30 sábado
});

test('parseBR valida', () => {
  assert.strictEqual(formatarBR(parseBR('30/09/2026')), '30/09/2026');
  assert.throws(() => parseBR('31/09/2026'));
  assert.throws(() => parseBR('2026-09-30'));
});

test('valores', () => {
  assert.strictEqual(parseValor('1.234,56'), 123456);
  assert.strictEqual(parseValor('1200'), 120000);
  assert.strictEqual(parseValor('R$ 1.234,5'), 123450);
  assert.strictEqual(parseValor(1200), 120000);
  assert.strictEqual(parseValor('1200.75'), 120075);
  assert.throws(() => parseValor('abc'));
  assert.strictEqual(formatarValor(120000), '1.200,00');
  assert.strictEqual(formatarValor(123456789), '1.234.567,89');
  assert.strictEqual(formatarValor(5), '0,05');
});

test('cnpj', () => {
  assert.strictEqual(formatarCnpj('11222333000181'), '11.222.333/0001-81');
});
