// Depois do captcha o navegador salva "<chave>.pdf" / "<chave>.xml" na pasta Downloads.
// Aqui a gente fica de olho nela e move os arquivos para a pasta do mês, com nome padronizado.
const fs = require('fs');
const os = require('os');
const path = require('path');

function pastaDownloadsPadrao() {
  return path.join(os.homedir(), 'Downloads');
}

function destinoDaNota(pastaNotas, competenciaISO, apelido, chave, ext) {
  const mes = competenciaISO.slice(0, 7);
  return path.join(pastaNotas, mes, `NFSe_${mes}_${apelido}_${chave.slice(-8)}.${ext}`);
}

// "<chave>.pdf" ou "<chave> (1).pdf" (quando o navegador já tinha um arquivo com o mesmo nome)
function acharArquivo(pasta, chave, ext) {
  const re = new RegExp(`^${chave}( \\(\\d+\\))?\\.${ext}$`, 'i');
  let nomes;
  try { nomes = fs.readdirSync(pasta); } catch { return null; }
  const achados = nomes.filter(n => re.test(n)).map(n => path.join(pasta, n));
  if (!achados.length) return null;
  return achados.sort((a, b) => fs.statSync(b).mtimeMs - fs.statSync(a).mtimeMs)[0];
}

function moverArquivo(origem, destino) {
  fs.mkdirSync(path.dirname(destino), { recursive: true });
  try {
    fs.renameSync(origem, destino);
  } catch {
    fs.copyFileSync(origem, destino); // outro disco: copia e mantém o original
  }
}

// Vigia a pasta até achar os arquivos pedidos. Retorna { promessa, cancelar }.
function vigiarDownloads({ pastaDownloads, chave, tipos, destino, log, intervaloMs = 1500 }) {
  const faltando = new Set(tipos);
  const salvos = {};
  let timer;
  let resolver;
  const verificar = () => {
    for (const ext of [...faltando]) {
      const arq = acharArquivo(pastaDownloads, chave, ext);
      if (!arq) continue;
      // Os navegadores baixam em ".crdownload"/".part" e só renomeiam no fim: se o nome final existe, terminou.
      if (!fs.statSync(arq).size) continue;
      const alvo = destino(ext);
      moverArquivo(arq, alvo);
      salvos[ext] = alvo;
      faltando.delete(ext);
      log(`   ✅ ${ext.toUpperCase()} salvo: ${alvo}`);
    }
    if (!faltando.size) cancelar();
  };
  const cancelar = () => {
    clearInterval(timer);
    resolver?.(salvos);
  };
  const promessa = new Promise(res => {
    resolver = res;
    timer = setInterval(verificar, intervaloMs);
    verificar();
  });
  return { promessa, cancelar, salvos };
}

module.exports = { pastaDownloadsPadrao, destinoDaNota, acharArquivo, vigiarDownloads };
