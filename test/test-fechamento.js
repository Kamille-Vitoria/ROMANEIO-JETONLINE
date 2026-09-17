/* Testes obrigatórios 1..10 do fluxo multi-importação / fechamento.
   Os relatórios são derivados do arquivo real: o relatório 1 é um recorte
   das 85 primeiras NFs reais, e os seguintes acrescentam NFs novas no
   mesmo formato das etiquetas reais (Shopee, ML agência e ML Flex). */
const fs = require('fs');
const NM = '/home/claude/test/node_modules';
const { JSDOM } = require(NM + '/jsdom');
const XLSX = require(NM + '/xlsx');

let fails = 0;
const ok = (c, label, extra) => { console.log((c ? '  PASS  ' : '  FALHA ') + label + (extra !== undefined ? '   ->  ' + extra : '')); if (!c) fails++; };

/* ---------- monta os três relatórios ---------- */
const wbReal = XLSX.readFile((process.env.REPORT_PATH || '../sample-data/NF_emitidas_no_dia.xls'));
const real = XLSX.utils.sheet_to_json(wbReal.Sheets[wbReal.SheetNames[0]], { header: 1, raw: true, defval: '' });
const header = real[0];
const reais = real.slice(1, 88);                 // 87 linhas reais

function sintetico(i) {
  // NFs novas a partir de 043900, alternando os três formatos reais de etiqueta
  const nf = String(43900 + i).padStart(6, '0') + ' (Nota Fiscal)';
  const modo = i % 3;
  const etiqueta = modo === 0 ? 'BR' + String(269900000000 + i * 7919).slice(0, 12) + 'X'
    : modo === 1 ? 'MEL' + (48090000000 + i * 137) + 'FMXDF01'
      : (48091000000 + i * 211);
  const pedido = modo === 0 ? '2609167SYN' + String(1000 + i) : '';
  const servico = modo === 0 ? 'Shopee Xpress' : modo === 1 ? 'Normal ao endereço (515462)' : 'Mercado Envios Flex';
  return [nf, 'Cliente Sintético ' + i, 'Rua Teste, ' + i, 'Centro', '01.000-000', 'São Paulo - SP', etiqueta, pedido, servico];
}

const rel1 = [header].concat(reais.slice(0, 85)).concat([[' ', ' ', ' ', ' ', ' ', ' ', ' ', ' ', 'Quantidade: 85']]);
const novos25 = Array.from({ length: 25 }, (_, i) => sintetico(i + 1));
const rel2 = [header].concat(reais).concat(novos25).concat([[' ', ' ', ' ', ' ', ' ', ' ', ' ', ' ', 'Quantidade: 112']]);
const novos14 = Array.from({ length: 14 }, (_, i) => sintetico(i + 100));
const rel3 = [header].concat(reais).concat(novos25).concat(novos14).concat([[' ', ' ', ' ', ' ', ' ', ' ', ' ', ' ', 'Quantidade: 126']]);

function xlsxBuf(aoa) {
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(aoa), 'Worksheet');
  return XLSX.write(wb, { bookType: 'xlsx', type: 'buffer' });
}
const F = {
  r1: { nome: 'NF_1609_0730.xlsx', buf: xlsxBuf(rel1), qtd: 85 },
  r2: { nome: 'NF_1609_1015.xlsx', buf: xlsxBuf(rel2), qtd: 112 },
  r3: { nome: 'NF_1609_1430.xlsx', buf: xlsxBuf(rel3), qtd: 126 }
};

/* ---------- sobe o app ---------- */
const html = fs.readFileSync('/mnt/user-data/outputs/romaneio-expedicao.html', 'utf8');
const dom = new JSDOM(html, {
  runScripts: 'dangerously', pretendToBeVisual: true, url: 'https://exemplo.local/',
  beforeParse(w) {
    w.XLSX = XLSX;
    w.prompt = () => 'Supervisor Teste';
    w.AudioContext = function () { return { currentTime: 0, createOscillator: () => ({ connect() { }, start() { }, stop() { }, frequency: {}, type: '' }), createGain: () => ({ connect() { }, gain: { setValueAtTime() { }, exponentialRampToValueAtTime() { } } }), destination: {} }; };
    w.URL.createObjectURL = () => 'blob:x'; w.URL.revokeObjectURL = () => { };
  }
});
const w = dom.window, d = w.document;
const sleep = ms => new Promise(r => setTimeout(r, ms));
const txt = sel => (d.querySelector(sel) || {}).textContent || '';
const num = label => { const m = txt('#counters').replace(/\s+/g, ' ').match(new RegExp('(\\d+)\s*' + label)); return m ? Number(m[1]) : null; };

function bipar(code) {
  const inp = d.querySelector('#scanInput');
  inp.value = code;
  inp.dispatchEvent(new w.KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true }));
}

async function selecionarArquivo(f) {
  const input = d.querySelector('#file');
  const file = new w.File([new Uint8Array(f.buf)], f.nome);
  Object.defineProperty(input, 'files', { value: [file], configurable: true });
  input.dispatchEvent(new w.Event('change'));
  await sleep(900);
}

(async () => {
  await sleep(6200);   // aguarda a resolução do armazenamento
  // identificação do operador (obrigatória para bipar, importar e excluir)
  d.querySelector('[data-view="oper"]').click();
  d.querySelector('#novoOperador').value = 'João Operador';
  d.querySelector('#btnAddOperador').click();
  await sleep(150);
  d.querySelector('[data-view="import"]').click();

  console.log('\n=== TESTE 1 — criar romaneio com 85 pedidos ===');
  d.querySelector('[data-view="import"]').click();
  await selecionarArquivo(F.r1);
  ok(/Como deseja importar este relatório/.test(txt('#importResult')), 'tela de confirmação de destino exibida');
  ok(!!d.querySelector('.destino label[data-d="novo"]') && !!d.querySelector('.destino label[data-d="add"]') && !!d.querySelector('#btnCancelImport'),
    'três opções: criar novo, adicionar ao existente, cancelar');
  d.querySelector('.destino label[data-d="novo"]').click();
  await sleep(50);
  d.querySelector('#btnConfirmImport').click();
  await sleep(900);
  ok(num('Total de pedidos') === 85, 'romaneio criado com 85 pedidos', num('Total de pedidos'));
  ok(/Romaneio aberto/.test(txt('#romStatus')), 'estado inicial: 🟢 ROMANEIO ABERTO', txt('#romStatus').trim());
  ok(/1\s*importação/.test(txt('#dashMeta')), 'painel indica 1 importação', txt('#dashMeta').replace(/\s+/g, ' ').trim());

  console.log('\n=== TESTE 2 — segundo relatório com 112 pedidos ===');
  d.querySelector('[data-view="import"]').click();
  await selecionarArquivo(F.r2);
  d.querySelector('.destino label[data-d="add"]').click();
  await sleep(700);
  const prev = txt('#mergeBox').replace(/\s+/g, ' ');
  console.log('  prévia:', prev.slice(0, 160));
  ok(/112\s*No arquivo/.test(prev), 'prévia: 112 no arquivo');
  ok(/85\s*Já no romaneio/.test(prev), 'prévia: 85 já existentes');
  ok(/27\s*Novos a adicionar/.test(prev), 'prévia: 27 novos');
  d.querySelector('#btnConfirmImport').click();
  await sleep(900);
  ok(num('Total de pedidos') === 112, 'romaneio consolidado = 112', num('Total de pedidos'));
  ok(num('Pendentes') === 112, 'os 27 novos entram como pendentes e ficam bipáveis', num('Pendentes'));
  d.querySelector('[data-view="concil"]').click(); await sleep(80);
  ok(d.querySelectorAll('#impList .imp-row').length === 2, 'histórico de importações com 2 registros', d.querySelectorAll('#impList .imp-row').length);
  ok(/85 novos/.test(txt('#impList')) && /27 novos/.test(txt('#impList')), 'histórico mostra novos por importação');

  console.log('\n=== TESTE 3 — bipar um pedido antigo ===');
  d.querySelector('[data-view="scan"]').click(); await sleep(50);
  const alvo = 'BR261114662447B';   // NF 043800, veio no relatório 1
  bipar(alvo); await sleep(80);
  ok(/PEDIDO BIPADO COM SUCESSO/.test(txt('#verdict')) && /43800/.test(txt('#verdict')), 'pedido antigo confirmado: EMBALADO');
  ok(num('Bipados') === 1, 'contador de bipados = 1', num('Bipados'));

  console.log('\n=== TESTE 4 — terceiro relatório com 126 pedidos ===');
  d.querySelector('[data-view="import"]').click();
  await selecionarArquivo(F.r3);
  d.querySelector('.destino label[data-d="add"]').click();
  await sleep(700);
  const prev3 = txt('#mergeBox').replace(/\s+/g, ' ');
  ok(/112\s*Já no romaneio/.test(prev3) && /14\s*Novos a adicionar/.test(prev3), 'prévia: 112 existentes + 14 novos', prev3.slice(0, 120));
  d.querySelector('#btnConfirmImport').click();
  await sleep(900);
  ok(num('Total de pedidos') === 126, 'romaneio consolidado = 126', num('Total de pedidos'));
  ok(num('Bipados') === 1, 'o pedido bipado continua EMBALADO após a nova importação', num('Bipados'));
  d.querySelector('[data-view="concil"]').click(); await sleep(80);
  d.querySelector('#fTexto').value = '43800'; d.querySelector('#fTexto').dispatchEvent(new w.Event('input'));
  ok(/Embalado/.test(txt('#tblConcil tbody')), 'NF 43800 segue com status Embalado, não voltou para Pendente');
  d.querySelector('#btnLimparF').click();

  console.log('\n=== TESTE 5 — bipar o mesmo pedido de novo ===');
  d.querySelector('[data-view="scan"]').click(); await sleep(50);
  bipar(alvo); await sleep(80);
  ok(/PEDIDO DUPLICADO/.test(txt('#verdict')), 'segunda leitura acusa DUPLICADO');
  ok(num('Bipados') === 1 && num('Duplicados') === 1, 'duplicada não conta como novo embalado', num('Bipados') + '/' + num('Duplicados'));

  console.log('\n=== TESTE 6 — fechar o romaneio ===');
  ok(!d.querySelector('#btnFechar').classList.contains('hidden'), 'botão Fechar romaneio visível enquanto aberto');
  d.querySelector('#btnFechar').click(); await sleep(60);
  const mtxt = txt('.modal').replace(/\s+/g, ' ');
  ok(/prestes a fechar o romaneio/.test(mtxt), 'confirmação de fechamento exibida');
  ok(/126/.test(mtxt) && /pendentes/i.test(mtxt), 'confirmação mostra os números do romaneio');
  ok(/125\s*pedidos pendentes/.test(mtxt), 'sugere revisar os pendentes sem impedir o fechamento');
  d.querySelector('.modal [data-x=ok]').click(); await sleep(300);
  ok(/Romaneio fechado/.test(txt('#romStatus')), 'estado: 🔒 ROMANEIO FECHADO', txt('#romStatus').trim());
  ok(/não pode mais ser alterado/.test(txt('#lockBar')), 'aviso de somente leitura na tela de bipagem');
  ok(d.querySelector('#btnFechar').classList.contains('hidden') && !d.querySelector('#btnReabrir').classList.contains('hidden'),
    'botão de fechar some e o de reabrir aparece');

  console.log('\n=== TESTE 7 — importar com o romaneio fechado ===');
  d.querySelector('[data-view="import"]').click();
  await selecionarArquivo(F.r3);
  const addLabel = d.querySelector('.destino label[data-d="add"]');
  ok(addLabel.querySelector('input').disabled, 'opção "adicionar ao existente" bloqueada: nenhum romaneio aberto');
  ok(/Romaneios fechados não aceitam importação/.test(addLabel.textContent), 'motivo informado ao usuário');
  addLabel.click(); await sleep(60);
  ok(d.querySelector('#btnConfirmImport').disabled, 'importação não prossegue');
  d.querySelector('#btnCancelImport').click(); await sleep(30);

  console.log('\n=== TESTE 8 — bipar com o romaneio fechado ===');
  d.querySelector('[data-view="scan"]').click(); await sleep(50);
  bipar('BR2693282575605'); await sleep(80);
  ok(/ROMANEIO FECHADO/.test(txt('#verdict')), 'leitura recusada com aviso de romaneio fechado');
  ok(/não aceita novas bipagens/.test(txt('#verdict')), 'mensagem explica o bloqueio');
  ok(num('Bipados') === 1, 'tentativa não entra como embalagem', num('Bipados'));
  d.querySelector('[data-view="concil"]').click(); await sleep(80);
  ok(/Tentativa de bipagem com romaneio fechado/.test(txt('#audList')), 'tentativa registrada na auditoria');

  console.log('\n=== TESTE 9 — reabrir o romaneio ===');
  d.querySelector('#btnReabrir').click(); await sleep(60);
  ok(/Reabrir permitirá novas importações e bipagens/.test(txt('.modal')), 'confirmação forte exibida');
  ok(d.querySelector('.modal [data-x=ok]').disabled, 'confirmação exige o aceite explícito');
  const chk = d.querySelector('#modalCheck'); chk.checked = true; chk.dispatchEvent(new w.Event('change'));
  ok(!d.querySelector('.modal [data-x=ok]').disabled, 'aceite libera o botão');
  d.querySelector('.modal [data-x=ok]').click(); await sleep(300);
  ok(/Romaneio aberto/.test(txt('#romStatus')), 'romaneio voltou a ABERTO');
  ok(num('Total de pedidos') === 126 && num('Bipados') === 1 && num('Duplicados') === 1, 'nenhum dado perdido na reabertura');
  bipar('BR2693282575605'); await sleep(80);
  ok(/PEDIDO BIPADO COM SUCESSO/.test(txt('#verdict')), 'bipagem liberada após reabertura');
  ok(num('Bipados') === 2, 'nova bipagem contabilizada', num('Bipados'));
  d.querySelector('[data-view="import"]').click();
  await selecionarArquivo(F.r3);
  d.querySelector('.destino label[data-d="add"]').click(); await sleep(700);
  ok(!d.querySelector('#btnConfirmImport').disabled, 'importação liberada após reabertura');
  d.querySelector('#btnConfirmImport').click(); await sleep(900);
  ok(num('Total de pedidos') === 126, 'reimportar o mesmo relatório não duplica pedidos', num('Total de pedidos'));
  d.querySelector('[data-view="concil"]').click(); await sleep(80);
  ok(d.querySelectorAll('#impList .imp-row').length === 4, 'as 4 importações permanecem no histórico', d.querySelectorAll('#impList .imp-row').length);
  const aud = txt('#audList');
  ok(/Romaneio fechado/.test(aud) && /Romaneio reaberto/.test(aud) && /Romaneio criado/.test(aud),
    'auditoria mantém criação, fechamento e reabertura');

  console.log('\n=== TESTE 10 — exportar o romaneio consolidado ===');
  let saved = null, blobParts = null;
  w.HTMLAnchorElement.prototype.click = function () { saved = this.download; };
  const OB = w.Blob; w.Blob = function (p, o) { blobParts = p; return new OB(p, o); };
  d.querySelector('#btnExport').click(); await sleep(600);
  ok(!!saved, 'arquivo gerado', saved);
  const out = XLSX.read(Buffer.from(blobParts[0]), { type: 'buffer' });
  ok(out.SheetNames.join(',') === 'Romaneio,Resumo,Importações,Auditoria', 'quatro abas', out.SheetNames.join(','));
  const aoa = XLSX.utils.sheet_to_json(out.Sheets['Romaneio'], { header: 1, defval: '' });
  ok(aoa.length - 1 >= 126, 'aba Romaneio traz o consolidado (126 pedidos), não só a última importação', aoa.length - 1);
  const resumo = {}; XLSX.utils.sheet_to_json(out.Sheets['Resumo'], { header: 1, defval: '' }).forEach(r => { if (r[0]) resumo[r[0]] = r[1]; });
  console.log('  resumo:', JSON.stringify(resumo));
  ok(resumo['Total de pedidos'] === 126 && resumo['Total embalado'] === 2, 'números consolidados no resumo');
  ok(resumo['Quantidade de importações ativas'] === 4, 'resumo traz a quantidade de importações', resumo['Quantidade de importações']);
  ok(!!resumo['Primeira importação'] && !!resumo['Última importação'], 'resumo traz primeira e última importação');
  ok(resumo['Status do romaneio'] === 'ABERTO' && String(resumo['Reaberturas']) === '1', 'resumo traz status e reaberturas');
  ok(resumo['Tentativas de bipagem após o fechamento'] === 1, 'resumo contabiliza a bipagem bloqueada', resumo['Tentativas de bipagem após o fechamento']);
  const imps = XLSX.utils.sheet_to_json(out.Sheets['Importações'], { header: 1, defval: '' });
  ok(imps.length === 5 && imps[1][4] === 85 && imps[2][5] === 27, 'aba Importações com as 4 linhas e os números certos', JSON.stringify(imps[2]));
  const auditoria = XLSX.utils.sheet_to_json(out.Sheets['Auditoria'], { header: 1, defval: '' }).map(r => r[2]).join('|');
  ok(/Romaneio criado/.test(auditoria) && /Romaneio fechado/.test(auditoria) && /Romaneio reaberto/.test(auditoria) && /Tentativa de bipagem/.test(auditoria),
    'aba Auditoria com criação, importações, fechamento, reabertura e tentativa bloqueada');

  console.log('\n' + (fails === 0 ? 'TESTES OBRIGATÓRIOS: TODOS PASSARAM' : 'TESTES OBRIGATÓRIOS: ' + fails + ' FALHA(S)') + '\n');
  process.exit(fails ? 1 : 0);
})().catch(e => { console.error(e); process.exit(1); });
