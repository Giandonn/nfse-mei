// Senhas guardadas pelo cofre do sistema (só o seu usuário consegue ler):
// Windows: DPAPI (arquivos credencial*.xml). macOS: Keychain (itens "nfse-mei" e "nfse-mei-email").
// Dois segredos: 'emissor' (CNPJ + senha do Emissor Nacional) e 'email' (endereço + senha de app do e-mail).
const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');
const { ARQUIVO_CONFIG } = require('./config');

const SEGREDOS = {
  emissor: { arquivo: 'credencial.xml', servico: 'nfse-mei', rotulo: 'nfse-mei (Emissor Nacional NFS-e)', mensagem: 'CNPJ e senha do Emissor Nacional NFS-e' },
  email: { arquivo: 'credencial-email.xml', servico: 'nfse-mei-email', rotulo: 'nfse-mei (senha de app do e-mail)', mensagem: 'E-mail e senha de app (não a senha normal do e-mail)' },
};
const arquivoDe = qual => path.join(path.dirname(ARQUIVO_CONFIG), SEGREDOS[qual].arquivo);
const ARQUIVO = arquivoDe('emissor');
const SUPORTADO = !process.env.NFSE_MEI_SEM_COFRE && ['win32', 'darwin'].includes(process.platform);
const ondeFica = (qual = 'emissor') => (process.platform === 'darwin'
  ? `no Keychain do macOS (item "${SEGREDOS[qual].servico}")`
  : `em ${arquivoDe(qual)} (criptografada com seu usuário do Windows)`);
const ONDE = ondeFica('emissor');

// Windows. Sem -NonInteractive: o Get-Credential precisa abrir a janela do Windows.
const ps = script => execFileSync('powershell', ['-NoProfile', '-Command', script], { encoding: 'utf8' });
const aspas = s => `'${String(s).replace(/'/g, "''")}'`;

// macOS: o `security` já vem no sistema.
const security = (args, opcoes = {}) => execFileSync('security', args, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], ...opcoes });

// Saída do `security find-generic-password`: tem uma linha `"acct"<blob>="11222333000181"`.
function contaDoKeychain(saida) {
  return /"acct"<blob>="([^"]*)"/.exec(saida)?.[1] || '';
}

function temCredencial(qual = 'emissor') {
  if (process.platform === 'darwin') {
    try { security(['find-generic-password', '-s', SEGREDOS[qual].servico]); return true; } catch { return false; }
  }
  return process.platform === 'win32' && fs.existsSync(arquivoDe(qual));
}

function lerCredencial(qual = 'emissor') {
  if (process.platform === 'darwin') {
    const servico = SEGREDOS[qual].servico;
    const usuario = contaDoKeychain(security(['find-generic-password', '-s', servico]));
    const senha = security(['find-generic-password', '-s', servico, '-w']).replace(/\r?\n$/, '');
    return { usuario, senha };
  }
  const saida = ps(`$c = Import-Clixml ${aspas(arquivoDe(qual))}; $c.UserName; $c.GetNetworkCredential().Password`);
  const [usuario, senha] = saida.replace(/\r?\n$/, '').split(/\r?\n/);
  return { usuario, senha };
}

// A senha nunca passa pelo terminal nem pela linha de comando:
// no Windows abre a janela do Get-Credential; no macOS o `security` pede a senha escondida (duas vezes).
function salvarCredencial(usuario, qual = 'emissor') {
  const s = SEGREDOS[qual];
  if (process.platform === 'darwin') {
    apagarCredencial(qual);
    // `-w` no fim, sem valor: o próprio `security` pergunta a senha, sem eco.
    security(['add-generic-password', '-s', s.servico, '-a', usuario, '-l', s.rotulo, '-w'], { stdio: 'inherit' });
    return;
  }
  if (process.platform !== 'win32') throw new Error('Guardar a senha só é suportado no Windows e no macOS por enquanto.');
  const arq = arquivoDe(qual);
  fs.mkdirSync(path.dirname(arq), { recursive: true });
  ps(`$c = Get-Credential -UserName ${aspas(usuario)} -Message ${aspas(s.mensagem)}; if ($c) { $c | Export-Clixml ${aspas(arq)} } else { exit 1 }`);
}

function apagarCredencial(qual = 'emissor') {
  if (process.platform === 'darwin') {
    // Apaga todas as cópias (pode ter sobrado mais de uma).
    for (let i = 0; i < 20; i++) {
      try { security(['delete-generic-password', '-s', SEGREDOS[qual].servico]); } catch { return; }
    }
    return;
  }
  const arq = arquivoDe(qual);
  if (fs.existsSync(arq)) fs.unlinkSync(arq);
}

module.exports = { ARQUIVO, SUPORTADO, ONDE, ondeFica, temCredencial, lerCredencial, salvarCredencial, apagarCredencial, contaDoKeychain };
