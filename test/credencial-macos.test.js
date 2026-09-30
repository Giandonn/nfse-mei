// Simula o macOS: finge process.platform = 'darwin' e troca o `security` por um Keychain em memória.
const test = require('node:test');
const assert = require('node:assert');
const childProcess = require('child_process');

const plataformaReal = Object.getOwnPropertyDescriptor(process, 'platform');
const execReal = childProcess.execFileSync;
const chamadas = [];
let itens = [];

function securityFalso(cmd, args, opcoes) {
  assert.strictEqual(cmd, 'security');
  chamadas.push({ args, opcoes });
  const [acao] = args;
  const naoAchou = () => { const e = new Error('The specified item could not be found in the keychain.'); e.status = 44; throw e; };
  if (acao === 'add-generic-password') {
    itens.push({ conta: args[args.indexOf('-a') + 1], senha: 'senha secreta' }); // o `security` perguntaria no terminal
    return '';
  }
  if (acao === 'find-generic-password') {
    if (!itens.length) naoAchou();
    return args.includes('-w') ? `${itens[0].senha}\n` : `keychain: "/Users/voce/Library/Keychains/login.keychain-db"\nattributes:\n    "acct"<blob>="${itens[0].conta}"\n    "svce"<blob>="nfse-mei"\n`;
  }
  if (acao === 'delete-generic-password') {
    if (!itens.length) naoAchou();
    itens.shift();
    return '';
  }
  throw new Error(`ação inesperada: ${acao}`);
}

Object.defineProperty(process, 'platform', { value: 'darwin' });
childProcess.execFileSync = securityFalso;
const cred = require('../src/credencial');
test.after(() => {
  Object.defineProperty(process, 'platform', plataformaReal);
  childProcess.execFileSync = execReal;
});

test('macOS: guardar, ler e apagar a senha no Keychain', () => {
  assert.strictEqual(cred.SUPORTADO, true);
  assert.match(cred.ONDE, /Keychain/);
  assert.strictEqual(cred.temCredencial(), false);

  itens = [{ conta: '99999999000191', senha: 'antiga' }]; // sobra de um cadastro anterior
  cred.salvarCredencial('11222333000181');
  const add = chamadas.find(c => c.args[0] === 'add-generic-password');
  assert.deepStrictEqual(add.args.slice(-1), ['-w'], 'a senha é perguntada pelo security, nunca vai na linha de comando');
  assert.strictEqual(add.opcoes.stdio, 'inherit');
  assert.strictEqual(itens.length, 1, 'o cadastro antigo foi apagado antes');

  assert.strictEqual(cred.temCredencial(), true);
  assert.deepStrictEqual(cred.lerCredencial(), { usuario: '11222333000181', senha: 'senha secreta' });

  cred.apagarCredencial();
  assert.strictEqual(cred.temCredencial(), false);
});

test('contaDoKeychain lê o CNPJ da saída do security', () => {
  assert.strictEqual(cred.contaDoKeychain('    "acct"<blob>="11222333000181"\n'), '11222333000181');
  assert.strictEqual(cred.contaDoKeychain('sem conta'), '');
});
