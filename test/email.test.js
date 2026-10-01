// E-mail da nota de verdade, contra um servidor SMTP local (nada sai da máquina).
const test = require('node:test');
const assert = require('node:assert');
const { SMTPServer } = require('smtp-server');
const email = require('../src/email');

const CFG = {
  prestadorCnpj: '11222333000181',
  servico: { descricao: 'Análise e desenvolvimento de sistemas' },
  email: { remetente: 'eu@exemplo.com', nome: 'Fulano Dev', host: '127.0.0.1', seguro: false },
};
const DADOS = {
  tomador: { cnpj: '11444777000161', nome: 'ACME LTDA', email: 'fin@acme.com; contas@acme.com' },
  chave: '35503082211222333000181000000000001226106317551029', numero: '12', centavos: 350000, competencia: '30/10/2026',
};

function servidorFalso() {
  const recebidos = [];
  const logins = [];
  const servidor = new SMTPServer({
    secure: false, authOptional: false, disabledCommands: ['STARTTLS'], allowInsecureAuth: true, logger: false,
    onAuth(auth, sessao, cb) {
      logins.push({ usuario: auth.username, senha: auth.password });
      return auth.password === 'senha-de-app' ? cb(null, { user: auth.username }) : cb(new Error('Invalid login'));
    },
    onData(stream, sessao, cb) {
      let bruto = '';
      stream.on('data', d => { bruto += d; });
      stream.on('end', () => { recebidos.push({ de: sessao.envelope.mailFrom.address, para: sessao.envelope.rcptTo.map(r => r.address), bruto }); cb(); });
    },
  });
  return new Promise(res => servidor.listen(0, '127.0.0.1', () => res({ servidor, porta: servidor.server.address().port, recebidos, logins })));
}

test('mensagem: assunto, valores e link da consulta pública; nada de PDF inventado', () => {
  const m = email.montarMensagem(CFG, DADOS);
  assert.strictEqual(m.assunto, 'NFS-e nº 12 · Fulano Dev · 10/2026');
  assert.match(m.texto, /Valor:\s+R\$ 3\.500,00/);
  assert.match(m.texto, /Chave de acesso:\s+35503082211222333000181000000000001226106317551029/);
  assert.match(m.texto, /https:\/\/www\.nfse\.gov\.br\/consultapublica/);
  assert.match(m.html, /ACME LTDA/);
});

test('HTML escapa o que vem do cadastro', () => {
  const m = email.montarMensagem({ ...CFG, email: { ...CFG.email, nome: '<script>x</script>' } }, DADOS);
  assert.ok(!m.html.includes('<script>'));
});

test('validação de e-mails', () => {
  assert.strictEqual(email.emailValido('a@b.com'), true);
  assert.strictEqual(email.emailValido('a@b'), false);
  assert.strictEqual(email.emailValido('a b@c.com'), false);
  assert.strictEqual(email.emailsValidos('a@b.com, c@d.com.br'), true);
  assert.strictEqual(email.emailsValidos('a@b.com, nao'), false);
});

test('servidor por domínio: Gmail e Outlook', () => {
  assert.strictEqual(email.servidorDe({ remetente: 'x@gmail.com' }).host, 'smtp.gmail.com');
  assert.strictEqual(email.servidorDe({ remetente: 'x@hotmail.com' }).host, 'smtp-mail.outlook.com');
  assert.deepStrictEqual(email.servidorDe({ remetente: 'x@y.com', host: 'smtp.y.com', porta: 587 }), { host: 'smtp.y.com', port: 587, secure: false });
});

test('envia de verdade via SMTP: para os e-mails do cliente + cópia oculta para você', async () => {
  const s = await servidorFalso();
  try {
    const cfg = { ...CFG, email: { ...CFG.email, porta: s.porta } };
    const r = await email.enviarNota(cfg, 'senha-de-app', DADOS);
    assert.deepStrictEqual(r.para, ['fin@acme.com', 'contas@acme.com']);
    assert.strictEqual(s.recebidos.length, 1);
    assert.strictEqual(s.recebidos[0].de, 'eu@exemplo.com');
    assert.deepStrictEqual(s.recebidos[0].para.sort(), ['contas@acme.com', 'eu@exemplo.com', 'fin@acme.com']);
    assert.ok(!/^Bcc:/mi.test(s.recebidos[0].bruto), 'a cópia oculta não aparece no cabeçalho');
    assert.deepStrictEqual(s.logins, [{ usuario: 'eu@exemplo.com', senha: 'senha-de-app' }]);
    await email.testarLogin(cfg, 'senha-de-app');
  } finally { s.servidor.close(); }
});

test('senha de app errada: erro claro e nada enviado', async () => {
  const s = await servidorFalso();
  try {
    const cfg = { ...CFG, email: { ...CFG.email, porta: s.porta } };
    await assert.rejects(email.enviarNota(cfg, 'errada', DADOS), /Invalid login/);
    assert.strictEqual(s.recebidos.length, 0);
  } finally { s.servidor.close(); }
});

test('cliente sem e-mail válido: nem tenta', async () => {
  await assert.rejects(email.enviarNota(CFG, 'x', { ...DADOS, tomador: { ...DADOS.tomador, email: 'nao-e-email' } }), /e-mail do cliente inválido/);
});
