// Keychain DE VERDADE: só roda no macOS do CI (o workflow cria um keychain temporário como padrão).
// Na sua máquina é pulado, para nunca mexer no seu Keychain.
const test = require('node:test');
const assert = require('node:assert');
const path = require('path');
const { spawnSync, execFileSync } = require('child_process');

const rodar = process.platform === 'darwin' && process.env.NFSE_MEI_TESTAR_KEYCHAIN === '1';
const RAIZ = path.join(__dirname, '..');

// O `expect` (vem no macOS) abre um terminal de verdade, espera o `security` pedir a senha
// e digita, duas vezes, como uma pessoa faria. A senha vai por variável de ambiente, não pela linha de comando.
function salvarComoPessoa(cnpj, senha) {
  const roteiro = `
    set timeout 20
    spawn ${process.execPath} -e "require('./src/credencial').salvarCredencial('${cnpj}')"
    expect -re {(?i)password}
    send -- "$env(SENHA_TESTE)\\r"
    expect -re {(?i)password}
    send -- "$env(SENHA_TESTE)\\r"
    expect eof
    lassign [wait] pid spawnid erro_os codigo
    exit $codigo
  `;
  return spawnSync('expect', ['-c', roteiro], {
    cwd: RAIZ, encoding: 'utf8', timeout: 40000, env: { ...process.env, SENHA_TESTE: senha },
  });
}

test('macOS: guardar a senha como uma pessoa faria, ler de volta e apagar', { skip: !rodar && 'só no macOS do CI' }, () => {
  const cred = require('../src/credencial');
  cred.apagarCredencial();
  assert.strictEqual(cred.temCredencial(), false);

  const senha = 'senha-de-teste-ci-123';
  const salvar = salvarComoPessoa('11222333000181', senha);
  assert.strictEqual(salvar.status, 0, salvar.stdout + salvar.stderr);
  assert.ok(!salvar.stdout.includes(senha), 'a senha não pode aparecer na tela (o security não ecoa)');

  assert.strictEqual(cred.temCredencial(), true);
  assert.deepStrictEqual(cred.lerCredencial(), { usuario: '11222333000181', senha });

  // Guardar de novo substitui (não acumula cópias).
  const deNovo = salvarComoPessoa('11444777000161', 'outra-senha');
  assert.strictEqual(deNovo.status, 0, deNovo.stdout + deNovo.stderr);
  assert.deepStrictEqual(cred.lerCredencial(), { usuario: '11444777000161', senha: 'outra-senha' });
  const itens = execFileSync('security', ['dump-keychain'], { encoding: 'utf8' }).match(/"svce"<blob>="nfse-mei"/g) || [];
  assert.strictEqual(itens.length, 1, 'só uma cópia no Keychain');

  cred.apagarCredencial();
  assert.strictEqual(cred.temCredencial(), false);
});
