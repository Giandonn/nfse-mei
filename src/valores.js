// Conversões de dinheiro e documentos.

function parseValor(v) {
  if (typeof v === 'number') return Math.round(v * 100);
  const s = String(v).trim().replace(/^R\$\s*/, '');
  // "1.234,56" / "1234,5" (BR) ou "1234.56" (ponto decimal)
  const normal = s.includes(',') ? s.replace(/\./g, '').replace(',', '.') : s;
  const n = Number(normal);
  if (!Number.isFinite(n) || n <= 0) throw new Error(`Valor inválido: "${v}"`);
  return Math.round(n * 100);
}

function formatarValor(centavos) {
  const reais = Math.floor(centavos / 100).toString().replace(/\B(?=(\d{3})+(?!\d))/g, '.');
  return `${reais},${String(centavos % 100).padStart(2, '0')}`;
}

const soDigitos = s => String(s || '').replace(/\D/g, '');

function formatarCnpj(c) {
  const d = soDigitos(c);
  return d.length === 14 ? d.replace(/^(\d{2})(\d{3})(\d{3})(\d{4})(\d{2})$/, '$1.$2.$3/$4-$5') : d;
}

// Confere os dois dígitos verificadores do CNPJ (pega erro de digitação antes de ir pro portal).
function cnpjValido(c) {
  const d = soDigitos(c);
  if (d.length !== 14 || /^(\d)\1{13}$/.test(d)) return false;
  const digito = n => {
    const pesos = n === 12 ? [5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2] : [6, 5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2];
    const resto = pesos.reduce((soma, p, i) => soma + p * Number(d[i]), 0) % 11;
    return resto < 2 ? 0 : 11 - resto;
  };
  return digito(12) === Number(d[12]) && digito(13) === Number(d[13]);
}

module.exports = { parseValor, formatarValor, soDigitos, formatarCnpj, cnpjValido };
