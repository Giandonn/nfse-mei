#!/usr/bin/env node
// Monta o instalador do Windows: dist/windows (app + Node portátil + atalho) -> dist/nfse-mei-setup-<versão>.exe.
//   node instalador/montar-windows.js                     baixa o Node do nodejs.org (confere o SHA-256)
//   node instalador/montar-windows.js --node <node.exe>   usa um node.exe que você já tem
//   node instalador/montar-windows.js --sem-npm           reaproveita o node_modules da pasta (teste local)
// O .exe só sai se o Inno Setup 6 estiver instalado (ISCC.exe); sem ele, fica só a pasta dist/windows.
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { execFileSync } = require('child_process');
const { parseArgs } = require('util');

const RAIZ = path.resolve(__dirname, '..');
const DIST = path.join(RAIZ, 'dist');
const PASTA = path.join(DIST, 'windows');
const NODE_MAIOR = 22; // LTS que vai junto no instalador
const { version: VERSAO } = require(path.join(RAIZ, 'package.json'));

const { values: op } = parseArgs({ options: { node: { type: 'string' }, 'sem-npm': { type: 'boolean' } } });
const log = m => console.log(m);

async function baixar(url) {
  const r = await fetch(url);
  if (!r.ok) throw new Error(`${url}: HTTP ${r.status}`);
  return Buffer.from(await r.arrayBuffer());
}

// Último Node LTS da linha NODE_MAIOR para Windows x64, conferido pelo SHASUMS256 oficial.
async function nodeOficial(destino) {
  const lista = JSON.parse((await baixar('https://nodejs.org/dist/index.json')).toString());
  const v = lista.find(x => x.lts && x.version.startsWith(`v${NODE_MAIOR}.`) && x.files.includes('win-x64-zip')).version;
  const nome = `node-${v}-win-x64`;
  log(`Baixando Node ${v}...`);
  const zip = await baixar(`https://nodejs.org/dist/${v}/${nome}.zip`);
  const somas = (await baixar(`https://nodejs.org/dist/${v}/SHASUMS256.txt`)).toString();
  const esperado = new RegExp(`^([0-9a-f]{64})\\s+${nome}\\.zip$`, 'm').exec(somas)?.[1];
  const obtido = crypto.createHash('sha256').update(zip).digest('hex');
  if (!esperado || esperado !== obtido) throw new Error(`SHA-256 do Node não confere (${obtido} != ${esperado})`);
  const tmp = fs.mkdtempSync(path.join(DIST, 'node-'));
  fs.writeFileSync(path.join(tmp, 'node.zip'), zip);
  // O tar do Windows 10+ (bsdtar) abre .zip.
  execFileSync('tar', ['-xf', 'node.zip', `${nome}/node.exe`], { cwd: tmp, stdio: 'inherit' });
  fs.copyFileSync(path.join(tmp, nome, 'node.exe'), destino);
  fs.rmSync(tmp, { recursive: true, force: true });
}

function acharIscc() {
  const candidatos = [
    process.env.ISCC,
    path.join(process.env['ProgramFiles(x86)'] || '', 'Inno Setup 6', 'ISCC.exe'),
    path.join(process.env.ProgramFiles || '', 'Inno Setup 6', 'ISCC.exe'),
    path.join(process.env.LOCALAPPDATA || '', 'Programs', 'Inno Setup 6', 'ISCC.exe'),
  ];
  return candidatos.find(c => c && fs.existsSync(c));
}

async function main() {
  fs.rmSync(PASTA, { recursive: true, force: true });
  const app = path.join(PASTA, 'app');
  fs.mkdirSync(app, { recursive: true });

  log('Copiando o nfse-mei...');
  for (const item of ['bin', 'src', 'package.json', 'package-lock.json', 'LICENSE', 'README.md', 'config.example.json']) {
    fs.cpSync(path.join(RAIZ, item), path.join(app, item), { recursive: true });
  }
  if (op['sem-npm']) {
    fs.cpSync(path.join(RAIZ, 'node_modules'), path.join(app, 'node_modules'), { recursive: true });
  } else {
    log('Instalando as dependências (só as de produção)...');
    execFileSync(process.platform === 'win32' ? 'npm.cmd' : 'npm', ['ci', '--omit=dev', '--no-audit', '--no-fund'], { cwd: app, stdio: 'inherit', shell: process.platform === 'win32' });
  }

  fs.mkdirSync(path.join(PASTA, 'node'));
  const nodeExe = path.join(PASTA, 'node', 'node.exe');
  if (op.node) fs.copyFileSync(op.node, nodeExe);
  else await nodeOficial(nodeExe);

  fs.copyFileSync(path.join(__dirname, 'windows', 'abrir.vbs'), path.join(PASTA, 'abrir.vbs'));
  fs.copyFileSync(path.join(__dirname, 'icone.ico'), path.join(PASTA, 'icone.ico'));
  log(`Pasta pronta: ${PASTA}`);

  const iscc = acharIscc();
  if (!iscc) {
    log('Inno Setup 6 não encontrado (ISCC.exe): o instalador .exe não foi gerado.');
    return;
  }
  execFileSync(iscc, ['/Q', path.join(__dirname, 'windows', 'nfse-mei.iss')], { stdio: 'inherit', env: { ...process.env, NFSE_MEI_VERSAO: VERSAO } });
  log(`Instalador: ${path.join(DIST, `nfse-mei-setup-${VERSAO}.exe`)}`);
}

main().catch(e => {
  console.error(`Erro: ${e.message}`);
  process.exit(1);
});
