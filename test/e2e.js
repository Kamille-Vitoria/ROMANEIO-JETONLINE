const fs = require('fs');
const path = '/home/claude/test/node_modules';
const { JSDOM } = require(path + '/jsdom');
const XLSX = require(path + '/xlsx');

const html = fs.readFileSync('/mnt/user-data/outputs/romaneio-expedicao.html', 'utf8');
const dom = new JSDOM(html, {
  runScripts: 'dangerously', pretendToBeVisual: true, url: 'https://exemplo.local/',
  beforeParse(w) {
    w.XLSX = XLSX;
    w.prompt = () => 'Expedição 1';
    w.AudioContext = function () { return { currentTime: 0, createOscillator: () => ({ connect(){}, start(){}, stop(){}, frequency:{}, type:'' }), createGain: () => ({ connect(){}, gain:{ setValueAtTime(){}, exponentialRampToValueAtTime(){} } }), destination: {} }; };
    w.URL.createObjectURL = () => 'blob:x'; w.URL.revokeObjectURL = () => {};
  }
});
const w = dom.window, d = w.document;
const sleep = ms => new Promise(r => setTimeout(r, ms));
let fails = 0;
const ok = (c, label, extra) => { console.log((c ? '  PASS  ' : '  FALHA ') + label + (extra !== undefined ? '   ->  ' + extra : '')); if (!c) fails++; };
const txt = sel => (d.querySelector(sel) || {}).textContent || '';

function bipar(code) {
  const inp = d.querySelector('#scanInput');
  inp.value = code;
  const ev = new w.KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true });
  inp.dispatchEvent(ev);
}

(async () => {
  await sleep(6200);   // aguarda a resolução do armazenamento
  // identificação do operador (obrigatória para bipar, importar e excluir)
  d.querySelector('[data-view="oper"]').click();
  d.querySelector('#novoOperador').value = 'João Operador';
  d.querySelector('#btnAddOperador').click();
  await sleep(150);
  d.querySelector('[data-view="import"]').click();
  console.log('\n=== A. CARGA DA INTERFACE ===');
  ok(!!d.querySelector('#scanInput'), 'tela de bipagem presente');
  ok(txt('#viewTitle') === 'Importar romaneio', 'abre em "Importar romaneio"', txt('#viewTitle'));

  console.log('\n=== B. IMPORTAÇÃO DO ARQUIVO REAL ===');
  const buf = fs.readFileSync((process.env.REPORT_PATH || '../sample-data/NF_emitidas_no_dia.xls'));
  const file = new w.File([new Uint8Array(buf)], 'NF_emitidas_no_dia.xls');
  const inputFile = d.querySelector('#file');
  Object.defineProperty(inputFile, 'files', { value: [file], configurable: true });
  inputFile.dispatchEvent(new w.Event('change'));
  await sleep(1200);

  ok(!!d.querySelector('#btnConfirmImport'), 'prévia da importação renderizada');
  const linhasPrevia = d.querySelectorAll('#importResult tbody tr').length;
  ok(linhasPrevia === 87, 'prévia lista 87 pedidos', linhasPrevia);

  d.querySelector('.destino label[data-d="novo"]').click();   // escolher destino: novo romaneio
  await sleep(50);
  ok(!d.querySelector('#btnConfirmImport').disabled, 'botão liberado após escolher o destino');
  d.querySelector('#btnConfirmImport').click();
  await sleep(900);

  ok(txt('#viewTitle') === 'Expedição / Bipagem', 'vai direto para a bipagem após importar', txt('#viewTitle'));
  ok(txt('#counters').indexOf('87') !== -1, 'total de pedidos = 87 no painel');
  ok(/Dados salvos apenas neste navegador/.test(txt('#storePill')), 'modo de armazenamento sinalizado', txt('#storePill').trim());

  console.log('\n=== C. BIPAGENS ===');
  bipar('BR2693282575605'); await sleep(60);
  ok(/PEDIDO BIPADO COM SUCESSO/.test(txt('#verdict')), 'etiqueta Shopee: confirmado');
  ok(/43824/.test(txt('#verdict')), 'NF 43824 exibida em destaque');
  ok(/Edna Aparecida Pereira/.test(txt('#verdict')), 'cliente exibido');
  ok(d.querySelector('#scanInput').value === '', 'campo limpo automaticamente');
  ok(d.activeElement === d.querySelector('#scanInput'), 'foco permanece no campo de leitura');

  bipar('48025137359'); await sleep(60);
  ok(/PEDIDO BIPADO COM SUCESSO/.test(txt('#verdict')) && /43831/.test(txt('#verdict')), 'barcode Mercado Livre: confirmado NF 43831');

  bipar('48025363095'); await sleep(60);
  ok(/43830/.test(txt('#verdict')), 'envio Flex: confirmado NF 43830');

  bipar('2609165MR44BTA'); await sleep(60);
  ok(/DUPLICADO/.test(txt('#verdict')), 'pedido já bipado por outro identificador: duplicado');
  ok(/Primeira bipagem/.test(txt('#verdict')), 'mostra horário da primeira bipagem');

  bipar('BR266332430005N'); await sleep(60);
  ok(/NÃO ENCONTRADO/.test(txt('#verdict')), 'etiqueta de outro dia: não encontrado');

  bipar('  br261114662447b  '); await sleep(60);
  ok(/BIPADO COM SUCESSO/.test(txt('#verdict')) && /43800/.test(txt('#verdict')), 'tolera espaços e minúsculas do leitor');

  const counters = txt('#counters').replace(/\s+/g, ' ');
  console.log('  painel:', counters);
  const num = label => { const m = counters.match(new RegExp('(\\d+)\\s*' + label)); return m ? Number(m[1]) : null; };
  ok(num('Bipados') === 4, 'contador de bipados = 4', num('Bipados'));
  ok(num('Pendentes') === 83, 'pendentes = 83', num('Pendentes'));
  ok(num('Duplicados') === 1, 'duplicados = 1', num('Duplicados'));
  ok(num('Não encontrados') === 1, 'não encontrados = 1', num('Não encontrados'));
  ok(txt('#pctTxt') === '4.6%', 'percentual 4/87 = 4.6%', txt('#pctTxt'));
  ok(d.querySelector('#bar').style.width === '4.6%', 'barra de progresso acompanha', d.querySelector('#bar').style.width);
  ok(d.querySelectorAll('#feed .feed-item').length === 6, 'feed com as 6 bipagens', d.querySelectorAll('#feed .feed-item').length);
  ok(d.querySelectorAll('#ocorrencias .feed-item').length === 2, 'ocorrências: 1 duplicado + 1 fora do romaneio', d.querySelectorAll('#ocorrencias .feed-item').length);

  console.log('\n=== D. CONCILIAÇÃO E FILTROS ===');
  d.querySelector('[data-view="concil"]').click();
  await sleep(80);
  const linhas = () => d.querySelectorAll('#tblConcil tbody tr').length;
  ok(linhas() === 88, 'tabela: 87 pedidos + 1 fora do romaneio', linhas());
  d.querySelector('#fStatus').value = 'EMBALADO';
  d.querySelector('#fStatus').dispatchEvent(new w.Event('change'));
  ok(linhas() === 4, 'filtro Embalado -> 4', linhas());
  d.querySelector('#fStatus').value = 'DUPLICADO';
  d.querySelector('#fStatus').dispatchEvent(new w.Event('change'));
  ok(linhas() === 1, 'filtro Com duplicidade -> 1', linhas());
  d.querySelector('#fStatus').value = 'NAO_PERTENCE';
  d.querySelector('#fStatus').dispatchEvent(new w.Event('change'));
  ok(linhas() === 1 && /BR266332430005N/.test(txt('#tblConcil')), 'filtro Fora do romaneio -> 1');
  d.querySelector('#btnLimparF').click();
  d.querySelector('#fTexto').value = 'Edna';
  d.querySelector('#fTexto').dispatchEvent(new w.Event('input'));
  ok(linhas() === 1, 'busca por nome do cliente', linhas());
  d.querySelector('#fTexto').value = '43831';
  d.querySelector('#fTexto').dispatchEvent(new w.Event('input'));
  ok(linhas() === 1, 'busca por NF', linhas());
  d.querySelector('#btnLimparF').click();
  d.querySelector('#fTransp').value = 'MERCADO LIVRE';
  d.querySelector('#fTransp').dispatchEvent(new w.Event('change'));
  ok(linhas() === 28, 'filtro por transportadora Mercado Livre -> 28', linhas());
  d.querySelector('#btnLimparF').click();

  console.log('\n=== E. EXPORTAÇÃO ===');
  let saved = null;
  w.HTMLAnchorElement.prototype.click = function () { saved = this.download; };
  const origBlob = w.Blob;
  let blobParts = null;
  w.Blob = function (parts, opts) { blobParts = parts; return new origBlob(parts, opts); };
  d.querySelector('#btnExport').click();
  await sleep(400);
  ok(!!saved && /\.xlsx$/.test(saved), 'arquivo .xlsx gerado', saved);
  const wbOut = XLSX.read(Buffer.from(blobParts[0]), { type: 'buffer' });
  ok(wbOut.SheetNames.join(',') === 'Romaneio,Resumo,Importações,Auditoria', 'abas: Romaneio, Resumo, Importações, Auditoria', wbOut.SheetNames.join(','));
  const aoa = XLSX.utils.sheet_to_json(wbOut.Sheets['Romaneio'], { header: 1, defval: '' });
  ok(aoa.length === 89, 'planilha com 88 linhas + cabeçalho', aoa.length);
  ok(aoa[0].join('|').indexOf('PLP') !== -1 && aoa[0].indexOf('Série') !== -1, 'cabeçalhos exigidos presentes');
  const res = XLSX.utils.sheet_to_json(wbOut.Sheets['Resumo'], { header: 1, defval: '' });
  const map = {}; res.forEach(r => { if (r[0]) map[r[0]] = r[1]; });
  console.log('  resumo exportado:', JSON.stringify(map));
  ok(map['Total de pedidos'] === 87 && map['Total embalado'] === 4 && map['Total pendente'] === 83, 'números do resumo conferem');
  ok(map['Percentual de conclusão'] === '4.6%', 'percentual no resumo', map['Percentual de conclusão']);

  console.log('\n=== F. PERSISTÊNCIA E HISTÓRICO ===');
  const idx = JSON.parse(w.localStorage.getItem('rom.index'));
  ok(idx.length === 1 && idx[0].totalPedidos === 87, 'romaneio gravado no armazenamento');
  const bip = JSON.parse(w.localStorage.getItem('rom.' + idx[0].id + '.bip'));
  const totalEv = Object.values(bip).reduce((a, x) => a + x.length, 0);
  ok(totalEv === 6, 'as 6 bipagens foram persistidas (nenhuma descartada)', totalEv);
  d.querySelector('[data-view="hist"]').click();
  await sleep(50);
  ok(d.querySelectorAll('#tblHist tbody tr').length === 1, 'romaneio aparece no histórico');
  ok(/87/.test(txt('#tblHist')), 'histórico mostra a quantidade de pedidos');

  console.log('\n=== G. IMPORTAÇÃO DUPLICADA ===');
  d.querySelector('[data-view="import"]').click();
  const file2 = new w.File([new Uint8Array(buf)], 'NF_emitidas_no_dia.xls');
  Object.defineProperty(inputFile, 'files', { value: [file2], configurable: true });
  inputFile.dispatchEvent(new w.Event('change'));
  await sleep(1200);
  ok(/já foi importado/.test(txt('#importResult')), 'alerta de arquivo já importado exibido');
  ok(!!d.querySelector('.destino label[data-d="add"]'), 'oferece adicionar ao romaneio existente');
  ok(d.querySelector('#btnConfirmImport').disabled, 'nada é importado antes de escolher o destino');

  console.log('\n' + (fails === 0 ? 'E2E: TODOS OS TESTES PASSARAM' : 'E2E: ' + fails + ' FALHA(S)') + '\n');
  process.exit(fails ? 1 : 0);
})().catch(e => { console.error(e); process.exit(1); });
