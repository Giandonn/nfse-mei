// Senha do Emissor Nacional guardada pelo cofre do sistema (só o seu usuário consegue ler):
// Windows: DPAPI (arquivo credencial.xml). macOS: Keychain (item "nfse-mei" no login.keychain).
const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');
const { ARQUIVO_CONFIG } = require('./config');

const ARQUIVO = path.join(path.dirname(ARQUIVO_CONFIG), 'credencial.xml');
const SERVICO_KEYCHAIN = 'nfse-mei';
const SUPORTADO = !process.env.NFSE_MEI_SEM_COFRE && ['win32', 'darwin'].includes(process.platform);
const ONDE = process.platform === 'darwin'
  ? 'no Keychain do macOS (item "nfse-mei")'
  : `em ${ARQUIVO} (criptografada com seu usuário do Windows)`;

// Windows. Sem -NonInteractive: o Get-Credential precisa abrir a janela do Windows.
const ps = script => execFileSync('powershell', ['-NoProfile', '-Command', script], { encoding: 'utf8' });
const aspas = s => `'${String(s).replace(/'/g, "''")}'`;

// macOS: o `security` já vem no sistema.
const security = (args, opcoes = {}) => execFileSync('security', args, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], ...opcoes });

// Saída do `security find-generic-password`: tem uma linha `"acct"<blob>="11222333000181"`.
function contaDoKeychain(saida) {
  return /"acct"<blob>="([^"]*)"/.exec(saida)?.[1] || '';
}

function temCredencial() {
  if (process.platform === 'darwin') {
    try { security(['find-generic-password', '-s', SERVICO_KEYCHAIN]); return true; } catch { return false; }
  }
  return process.platform === 'win32' && fs.existsSync(ARQUIVO);
}

function lerCredencial() {
  if (process.platform === 'darwin') {
    const usuario = contaDoKeychain(security(['find-generic-password', '-s', SERVICO_KEYCHAIN]));
    const senha = security(['find-generic-password', '-s', SERVICO_KEYCHAIN, '-w']).replace(/\r?\n$/, '');
    return { usuario, senha };
  }
  const saida = ps(`$c = Import-Clixml ${aspas(ARQUIVO)}; $c.UserName; $c.GetNetworkCredential().Password`);
  const [usuario, senha] = saida.replace(/\r?\n$/, '').split(/\r?\n/);
  return { usuario, senha };
}

// A senha nunca passa pelo terminal nem pela linha de comando:
// no Windows abre a janela do Get-Credential; no macOS o `security` pede a senha escondida (duas vezes).
function salvarCredencial(cnpj) {
  if (process.platform === 'darwin') {
    apagarCredencial();
    // `-w` no fim, sem valor: o próprio `security` pergunta a senha, sem eco.
    security(['add-generic-password', '-s', SERVICO_KEYCHAIN, '-a', cnpj, '-l', 'nfse-mei (Emissor Nacional NFS-e)', '-w'],
      { stdio: 'inherit' });
    return;
  }
  if (process.platform !== 'win32') throw new Error('Guardar a senha só é suportado no Windows e no macOS por enquanto.');
  fs.mkdirSync(path.dirname(ARQUIVO), { recursive: true });
  ps(`$c = Get-Credential -UserName ${aspas(cnpj)} -Message 'CNPJ e senha do Emissor Nacional NFS-e'; if ($c) { $c | Export-Clixml ${aspas(ARQUIVO)} } else { exit 1 }`);
}

function apagarCredencial() {
  if (process.platform === 'darwin') {
    // Apaga todas as cópias (pode ter sobrado mais de uma).
    for (let i = 0; i < 20; i++) {
      try { security(['delete-generic-password', '-s', SERVICO_KEYCHAIN]); } catch { return; }
    }
    return;
  }
  if (fs.existsSync(ARQUIVO)) fs.unlinkSync(ARQUIVO);
}

module.exports = { ARQUIVO, SUPORTADO, ONDE, temCredencial, lerCredencial, salvarCredencial, apagarCredencial, contaDoKeychain };
