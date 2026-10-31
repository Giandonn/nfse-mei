// Primeiro uso: o que o passo a passo descobre sozinho a partir do portal e da BrasilAPI.
const test = require('node:test');
const assert = require('node:assert');
const { servicoDosCampos, apelidoSugerido, clientesDasNotas } = require('../src/importar');
const { consultarCnpj } = require('../src/cnpj');
const { cadastroDoAssistente } = require('../src/cadastro');

// Como a tela "Visualizar" do portal (versão 1.6.0.0) entrega os campos.
const CAMPOS = [
  { aba: 'nfse', rotulo: 'Município de Incidência', valor: 'São Paulo/SP' },
  { aba: 'servicos', rotulo: 'País', valor: 'Brasil' },
  { aba: 'servicos', rotulo: 'Município', valor: 'São Paulo/SP' },
  { aba: 'servicos', rotulo: 'Código de Tributação Nacional', valor: '010101 - Análise e desenvolvimento de sistemas.' },
  { aba: 'servicos', rotulo: 'Item da NBS correspondente ao serviço prestado', valor: '115022000 - Serviços de projeto e desenvolvimento' },
  { aba: 'servicos', rotulo: 'Descrição do serviço', valor: 'Desenvolvimento de software' },
];

test('serviço vem da tela Visualizar da última nota', () => {
  assert.deepStrictEqual(servicoDosCampos(CAMPOS), {
    municipio: 'São Paulo/SP', codigoTributacaoNacional: '01.01.01', nbs: '115022000', descricao: 'Desenvolvimento de software',
  });
  assert.strictEqual(servicoDosCampos(CAMPOS.filter(c => c.rotulo !== 'Descrição do serviço')), null, 'faltando campo: a pessoa preenche');
  assert.strictEqual(servicoDosCampos([]), null);
});

test('apelido sugerido: primeira palavra que diz algo, sem acento e sem repetir', () => {
  assert.strictEqual(apelidoSugerido('HYPEX HOLDING LTDA'), 'hypex');
  assert.strictEqual(apelidoSugerido('Padaria São João ME'), 'padaria');
  assert.strictEqual(apelidoSugerido('12.345.678 FULANO DE TAL'), 'fulano');
  assert.strictEqual(apelidoSugerido('ACME LTDA', ['acme']), 'acme2');
  assert.strictEqual(apelidoSugerido(''), 'cliente');
});

const nota = (cnpj, nome, mes, numero, centavos, cancelada = false) => ({ cnpj, nome, mes, numero: String(numero), centavos, cancelada, chave: String(numero).padStart(50, '0') });

test('clientes das notas: mais recente primeiro, último valor e "todo mês" quando teve nota em 2 dos últimos 3 meses', () => {
  const notas = [
    nota('11444777000161', 'ACME LTDA', '2026-08', 1, 300000),
    nota('11444777000161', 'ACME LTDA', '2026-09', 2, 350000),
    nota('11444777000161', 'ACME LTDA', '2026-10', 5, 999900, true), // cancelada não conta
    nota('11222333000181', 'BETA SERVICOS LTDA', '2026-05', 3, 120000),
    nota('', 'sem tomador identificado', '2026-10', 4, 5000),
  ];
  const cs = clientesDasNotas(notas, new Date(2026, 9, 30));
  assert.deepStrictEqual(cs.map(c => [c.apelido, c.ultimoValor, c.mensal, c.notas]), [
    ['acme', '3.500,00', true, 2],
    ['beta', '1.200,00', false, 1],
  ]);
});

test('consulta de CNPJ (BrasilAPI): nome, município e erros claros', async () => {
  const buscar = async url => {
    if (url.endsWith('11444777000161')) return { ok: true, status: 200, json: async () => ({ razao_social: 'ACME LTDA ', municipio: 'SAO PAULO', uf: 'SP', email: 'FIN@ACME.COM' }) };
    return { ok: false, status: 404 };
  };
  assert.deepStrictEqual(await consultarCnpj('11.444.777/0001-61', buscar), { cnpj: '11444777000161', nome: 'ACME LTDA', municipio: 'SAO PAULO/SP', email: 'fin@acme.com' });
  await assert.rejects(consultarCnpj('11222333000181', buscar), /não encontrado/);
  // BrasilAPI fora do ar: tenta a segunda fonte.
  const reserva = async url => (url.includes('brasilapi')
    ? { ok: false, status: 503 }
    : { ok: true, status: 200, json: async () => ({ razao_social: 'ACME LTDA', estabelecimento: { cidade: { nome: 'Campinas' }, estado: { sigla: 'SP' } } }) });
  assert.strictEqual((await consultarCnpj('11444777000161', reserva)).municipio, 'Campinas/SP');
  await assert.rejects(consultarCnpj('123', buscar), /CNPJ inválido/);
});

test('cadastro do passo a passo: vários clientes, erros por cliente e config marcado como em andamento', () => {
  const base = {
    prestador: { prestadorCnpj: '11.222.333/0001-81', pastaNotas: '~/Documents/NFSe' },
    servico: { municipio: 'São Paulo/SP', codigoTributacaoNacional: '01.01.01', nbs: '115022000', descricao: 'Software' },
  };
  const ok = cadastroDoAssistente({ ...base, clientes: [
    { apelido: 'acme', cnpj: '11444777000161', nome: 'ACME LTDA', email: 'fin@acme.com', mensal: { ativo: true, valor: '3500', automatico: false } },
    { apelido: 'beta', cnpj: '11222333000181', nome: 'BETA' },
  ] });
  assert.ok(ok.ok);
  assert.deepStrictEqual(Object.keys(ok.cfg.tomadores), ['acme', 'beta']);
  assert.deepStrictEqual(ok.cfg.tomadores.acme.mensal, { ativo: true, valor: '3.500,00', automatico: false });
  assert.strictEqual(ok.cfg.tomadorPadrao, 'acme');
  assert.deepStrictEqual(ok.cfg.assistente, { emAndamento: true });

  const ruim = cadastroDoAssistente({ ...base, clientes: [
    { apelido: 'acme', cnpj: '11444777000161', nome: 'ACME' },
    { apelido: 'acme', cnpj: '123', nome: 'X', mensal: { ativo: true, automatico: true } },
  ] });
  assert.deepStrictEqual(Object.keys(ruim.erros).sort(), ['clientes.1.apelido', 'clientes.1.cnpj', 'clientes.1.valor']);
  assert.match(cadastroDoAssistente({ ...base, clientes: [] }).erros.geral, /pelo menos um cliente/);
});
