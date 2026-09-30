// Senha do Emissor Nacional guardada com DPAPI do Windows (só o seu usuário consegue ler).
const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');
const { ARQUIVO_CONFIG } = require('./config');

const ARQUIVO = path.join(path.dirname(ARQUIVO_CONFIG), 'credencial.xml');
// Sem -NonInteractive: o Get-Credential precisa abrir a janela do Windows.
const ps = script => execFileSync('powershell', ['-NoProfile', '-Command', script], { encoding: 'utf8' });
const aspas = s => `'${String(s).replace(/'/g, "''")}'`;

function temCredencial() {
  return process.platform === 'win32' && fs.existsSync(ARQUIVO);
}

function lerCredencial() {
  const saida = ps(`$c = Import-Clixml ${aspas(ARQUIVO)}; $c.UserName; $c.GetNetworkCredential().Password`);
  const [usuario, senha] = saida.replace(/\r?\n$/, '').split(/\r?\n/);
  return { usuario, senha };
}

// Abre a janela do Windows pedindo usuário e senha; a senha nunca passa pelo terminal.
function salvarCredencial(cnpj) {
  if (process.platform !== 'win32') throw new Error('Guardar a senha só é suportado no Windows por enquanto.');
  fs.mkdirSync(path.dirname(ARQUIVO), { recursive: true });
  ps(`$c = Get-Credential -UserName ${aspas(cnpj)} -Message 'CNPJ e senha do Emissor Nacional NFS-e'; if ($c) { $c | Export-Clixml ${aspas(ARQUIVO)} } else { exit 1 }`);
}

function apagarCredencial() {
  if (fs.existsSync(ARQUIVO)) fs.unlinkSync(ARQUIVO);
}

module.exports = { ARQUIVO, temCredencial, lerCredencial, salvarCredencial, apagarCredencial };
