const XLSX = require('/home/claude/test/node_modules/xlsx');
const E = require('../src/engine.js');

const wb = XLSX.readFile((process.env.REPORT_PATH || '../sample-data/NF_emitidas_no_dia.xls'));
const matrix = XLSX.utils.sheet_to_json(wb.Sheets[wb.SheetNames[0]], { header: 1, raw: true, defval: '' });
const parsed = E.parseMatrix(matrix);

let fails = 0;
function ok(cond, label, extra) {
  console.log((cond ? '  PASS  ' : '  FALHA ') + label + (extra ? '   ->  ' + extra : ''));
  if (!cond) fails++;
}

console.log('\n=== 1. LEITURA DO RELATÓRIO ===');
ok(parsed.ok, 'cabeçalho reconhecido na linha ' + (parsed.headerRow + 1));
console.log('  mapa de colunas:', JSON.stringify(parsed.map));
ok(parsed.orders.length === 87, 'pedidos importados = 87', parsed.orders.length);
ok(parsed.colisoes.length === 0, 'nenhuma colisão de identificadores', JSON.stringify(parsed.colisoes));
parsed.warnings.forEach(w => console.log('  aviso:', w));

const porTransp = {};
parsed.orders.forEach(o => porTransp[o.transportadora] = (porTransp[o.transportadora] || 0) + 1);
console.log('  transportadoras:', JSON.stringify(porTransp));

const orders = parsed.orders;
const idx = E.buildIndex(orders);
const byNf = n => orders.find(o => o.nf === String(n));

console.log('\n=== 2. CHAVE DE ACESSO DA NFe ===');
const k1 = E.parseChave('35260946588345000109550010000437571795302105');
ok(k1 && k1.nf === '43757' && k1.serie === '1', 'chave da etiqueta 1 -> NF 43757 / série 1', k1 && k1.nf + '/' + k1.serie);
const k2 = E.parseChave('35260946588345000109550010000438241852993501');
ok(k2 && k2.nf === '43824', 'chave da etiqueta Shopee -> NF 43824', k2 && k2.nf);
const k3 = E.parseChave('35260946588345000109550010000438311853008625');
ok(k3 && k3.nf === '43831', 'chave da etiqueta Mercado Livre -> NF 43831', k3 && k3.nf);

console.log('\n=== 3. RESOLUÇÃO DE CADA TIPO DE ETIQUETA ===');
function chk(code, nfEsperada, label) {
  const r = E.resolveScan(code, orders, idx);
  const o = r.orderId ? orders.find(x => x.id === r.orderId) : null;
  ok(r.status === 'OK' && o && o.nf === String(nfEsperada),
    label + ' [' + code + ']',
    r.status + (o ? ' NF ' + o.nf + ' via ' + r.matchedBy : ' (' + (r.candidatos || []).join(',') + ')'));
  return r;
}
chk('BR2693282575605', 43824, 'Shopee Xpress: código de barras da etiqueta');
chk('2609165MR44BTA', 43824, 'Shopee: nº do pedido da loja');
chk('35260946588345000109550010000438241852993501', 43824, 'DANFE simplificado: chave de acesso');
chk('43824', 43824, 'NF sem zeros');
chk('043824', 43824, 'NF com zeros à esquerda');
chk('48025137359', 43831, 'Mercado Livre agência: barcode do envio');
chk('MEL48025137359FMXDF01', 43831, 'Mercado Livre: rastreio completo MEL...');
chk('48025363095', 43830, 'Mercado Envios Flex: nº de envio');
chk('35260946588345000109550010000438301853006250', 43830, 'Flex: chave de acesso da DANFE');
chk('BR261114662447B', 43800, 'Entrega Direta: rastreio');
chk('26091664C6ST32', 43800, 'Entrega Direta: nº do pedido');
chk('BR2616776120829SPXLM16887854', 43790, 'Retirada pelo Comprador: etiqueta completa');
chk('BR2616776120829', 43790, 'Retirada: apenas a parte de rastreio');
chk('SPXLM16887854', 43790, 'Retirada: apenas o código SPX');
chk('  br2693282575605  ', 43824, 'tolerância a espaços/minúsculas do leitor');

console.log('\n=== 4. CÓDIGOS FORA DO ROMANEIO ===');
['BR266332430005N', '2609165EMSR16D', '35260946588345000109550010000437571795302105', '2000018482143882', 'XYZ123']
  .forEach(c => {
    const r = E.resolveScan(c, orders, idx);
    ok(r.status === 'NAO_ENCONTRADO', 'não encontrado: ' + c, r.status);
  });

console.log('\n=== 5. AMBIGUIDADE (conjunto sintético) ===');
const amb = E.parseMatrix([
  ['Número', 'Destinatário', 'Etiqueta', 'Nº PLP', 'Serviço'],
  ['000101 (Nota Fiscal)', 'Cliente A', 'BR2611146624471', '2609166XPTO01', 'Shopee Xpress'],
  ['000102 (Nota Fiscal)', 'Cliente B', 'BR2611146624472', '2609166XPTO01', 'Shopee Xpress']
]);
const ambIdx = E.buildIndex(amb.orders);
const rAmb = E.resolveScan('2609166XPTO01', amb.orders, ambIdx);
ok(rAmb.status === 'AMBIGUO' && rAmb.candidatos.length === 2, 'pedido repetido em 2 NFs -> AMBÍGUO, sem escolha automática', rAmb.status);
ok(amb.colisoes.length === 1, 'colisão detectada já na importação', JSON.stringify(amb.colisoes));
ok(E.resolveScan('BR2611146624471', amb.orders, ambIdx).status === 'OK', 'código único do mesmo conjunto continua resolvendo');

console.log('\n=== 6. CONCILIAÇÃO COMPLETA (simulação de expedição) ===');
let n = 0;
const ev = (code, ts, est) => {
  const r = E.resolveScan(code, orders, idx);
  return {
    id: 'E' + (++n), ts, code: r.code, orderId: r.orderId || null, status: r.status,
    matchedBy: r.matchedBy, estacao: est || 'EXP-1', candidatos: r.candidatos,
    serie: r.chave ? r.chave.serie : ''
  };
};
const T = h => '2026-09-16T' + h + '-03:00';
const eventos = [
  ev('BR2693282575605', T('18:00:01')),                                   // Shopee OK
  ev('48025137359', T('18:00:12')),                                       // ML agência OK
  ev('48025363095', T('18:00:25'), 'EXP-2'),                              // Flex OK
  ev('BR261114662447B', T('18:00:40')),                                   // Entrega Direta OK
  ev('SPXLM16887854', T('18:01:00')),                                     // Retirada OK
  ev('35260946588345000109550010000438241852993501', T('18:01:20')),      // DUPLICADO (mesma NF 43824, outro identificador)
  ev('BR266332430005N', T('18:01:45')),                                   // NÃO PERTENCE (etiqueta de 15/09)
  ev('BR266332430005N', T('18:02:00')),                                   // mesma ocorrência, 2ª tentativa
  ev('2609165MR44BTA', T('18:02:30'), 'EXP-2')                            // DUPLICADO novamente (NF 43824)
];
// + 20 pedidos Shopee bipados normalmente
orders.filter(o => o.transportadora === 'SHOPEE').slice(0, 20).forEach((o, i) => {
  if (!eventos.some(e => e.orderId === o.id)) eventos.push(ev(o.etiquetaRaw, T('18:' + String(10 + Math.floor(i / 60)).padStart(2, '0') + ':' + String(i % 60).padStart(2, '0'))));
});

const rec = E.reconcile(orders, eventos);
const r = rec.resumo;
console.log('  resumo:', JSON.stringify(r));

const alvo = rec.linhas.find(l => l.order.nf === '43824');
ok(alvo.status === 'EMBALADO', 'NF 43824 permanece EMBALADO após bipagens duplicadas', alvo.status);
ok(alvo.duplicadas.length === 2, 'NF 43824 com 2 tentativas duplicadas registradas', alvo.duplicadas.length);
ok(alvo.primeira.code === 'BR2693282575605', 'primeira bipagem preservada (não sobrescrita)', alvo.primeira.code);
ok(alvo.bipagens.length === 3, 'todas as 3 bipagens da NF 43824 preservadas no histórico', alvo.bipagens.length);
ok(rec.naoEncontrados.length === 1 && rec.naoEncontrados[0].tentativas.length === 2,
  'BR266332430005N: 1 ocorrência com 2 tentativas', JSON.stringify(rec.naoEncontrados.map(x => [x.code, x.tentativas.length])));
ok(r.embalados + r.pendentes === 87, 'embalados + pendentes = total do romaneio', r.embalados + '+' + r.pendentes);
ok(r.pendentes > 0, 'pedidos do relatório não bipados ficam PENDENTE', r.pendentes);
ok(r.naoPertencentes === 1, 'contador de não pertencentes', r.naoPertencentes);
ok(r.pedidosComDuplicidade === 1, 'contador de pedidos com duplicidade', r.pedidosComDuplicidade);
ok(r.percentual === Math.round(r.embalados / 87 * 1000) / 10, 'percentual coerente', r.percentual + '%');
ok(rec.linhas.filter(l => l.status === 'EMBALADO').length === r.embalados, 'linhas EMBALADO conferem com o resumo');

console.log('\n=== 7. EXPORTAÇÃO ===');
const rows = E.exportRows(rec, { id: 'R1', nome: 'Romaneio 16/09/2026', dataReferencia: '16/09/2026', arquivo: 'NF_emitidas_no_dia.xls' });
ok(rows[0].length === E.EXPORT_HEADERS.length, 'cabeçalho da planilha com ' + E.EXPORT_HEADERS.length + ' colunas');
ok(rows.length === 87 + 1 + 1, 'linhas exportadas = 87 pedidos + 1 não pertencente + cabeçalho', rows.length);
const linhaExp = rows.find(x => x[3] === '43824');
console.log('  exemplo NF 43824:', JSON.stringify(linhaExp));
ok(linhaExp[0] === 'EMBALADO (COM DUPLICIDADE)' && linhaExp[16] === 2, 'status e contagem de duplicidade na exportação');
const resumo = E.resumoRows(rec, { nome: 'Romaneio 16/09/2026', dataReferencia: '16/09/2026' });
ok(resumo.length >= 10, 'aba Resumo montada', resumo.length + ' linhas');

console.log('\n' + (fails === 0 ? 'TODOS OS TESTES PASSARAM' : fails + ' TESTE(S) FALHARAM') + '\n');
process.exit(fails ? 1 : 0);
