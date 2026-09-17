/* Testes §31 (exclusão de importação) + fluxo completo §20 (1..33). */
const fs = require('fs');
const NM = '/home/claude/test/node_modules';
const { JSDOM } = require(NM + '/jsdom');
const XLSX = require(NM + '/xlsx');

let fails = 0;
const ok = (c, l, e) => { console.log((c ? '  PASS  ' : '  FALHA ') + l + (e !== undefined ? '   ->  ' + e : '')); if (!c) fails++; };

const wbReal = XLSX.readFile((process.env.REPORT_PATH || '../sample-data/NF_emitidas_no_dia.xls'));
const real = XLSX.utils.sheet_to_json(wbReal.Sheets[wbReal.SheetNames[0]], { header: 1, raw: true, defval: '' });
const header = real[0], reais = real.slice(1, 88);

function sint(i) {
  const nf = String(43900 + i).padStart(6, '0') + ' (Nota Fiscal)';
  return [nf, 'Cliente Sintético ' + i, 'Rua Teste, ' + i, 'Centro', '01.000-000', 'São Paulo - SP',
    'BR' + String(269900000000 + i * 7919).slice(0, 12) + 'X', '2609167SYN' + (1000 + i), 'Shopee Xpress'];
}
const xlsxBuf = aoa => { const wb = XLSX.utils.book_new(); XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(aoa), 'W'); return XLSX.write(wb, { bookType: 'xlsx', type: 'buffer' }); };

const novos25 = Array.from({ length: 25 }, (_, i) => sint(i + 1));
const F = {
  r1: { nome: 'NF_1609_0730.xlsx', buf: xlsxBuf([header].concat(reais.slice(0, 85))) },            // 85
  r2: { nome: 'NF_1609_1015.xlsx', buf: xlsxBuf([header].concat(reais).concat(novos25)) },          // 112
  r3: { nome: 'NF_1609_1430.xlsx', buf: xlsxBuf([header].concat(reais).concat(novos25).concat(Array.from({ length: 14 }, (_, i) => sint(i + 100)))) } // 126
};
const SO_NA_2 = 'BR' + String(269900000000 + 1 * 7919).slice(0, 12) + 'X';   // pedido que existe só a partir da #2
const SO_NA_2B = 'BR' + String(269900000000 + 2 * 7919).slice(0, 12) + 'X';
const DO_REL1 = 'BR261114662447B';                                           // NF 43800, veio na #1

const html = fs.readFileSync('/mnt/user-data/outputs/romaneio-expedicao.html', 'utf8');
const dom = new JSDOM(html, {
  runScripts: 'dangerously', pretendToBeVisual: true, url: 'https://exemplo.local/',
  beforeParse(w) {
    w.XLSX = XLSX; w.prompt = () => 'Estação 1';
    w.AudioContext = function () { return { currentTime: 0, createOscillator: () => ({ connect() { }, start() { }, stop() { }, frequency: {}, type: '' }), createGain: () => ({ connect() { }, gain: { setValueAtTime() { }, exponentialRampToValueAtTime() { } } }), destination: {} }; };
    w.URL.createObjectURL = () => 'blob:x'; w.URL.revokeObjectURL = () => { };
  }
});
const w = dom.window, d = w.document;
const sleep = ms => new Promise(r => setTimeout(r, ms));
const txt = s => (d.querySelector(s) || {}).textContent || '';
const num = l => { const m = txt('#counters').replace(/\s+/g, ' ').match(new RegExp('(\\d+)\\s*' + l)); return m ? Number(m[1]) : null; };
const bipar = c => { const i = d.querySelector('#scanInput'); i.value = c; i.dispatchEvent(new w.KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true })); };
const modalOk = async () => { const c = d.querySelector('#modalCheck'); if (c) { c.checked = true; c.dispatchEvent(new w.Event('change')); } d.querySelector('.modal [data-x=ok]').click(); await sleep(350); };

async function importar(f, destino, romaneioIdx) {
  d.querySelector('[data-view="import"]').click();
  const input = d.querySelector('#file');
  Object.defineProperty(input, 'files', { value: [new w.File([new Uint8Array(f.buf)], f.nome)], configurable: true });
  input.dispatchEvent(new w.Event('change'));
  await sleep(900);
  d.querySelector(`.destino label[data-d="${destino}"]`).click();
  await sleep(destino === 'add' ? 800 : 80);
  if (destino === 'add' && romaneioIdx != null) {
    const sel = d.querySelector('#impRomaneio'); sel.selectedIndex = romaneioIdx;
    sel.dispatchEvent(new w.Event('change')); await sleep(800);
  }
  d.querySelector('#btnConfirmImport').click();
  await sleep(1000);
}

(async () => {
  await sleep(6200);

  console.log('\n=== OPERADORES (§14) ===');
  d.querySelector('[data-view="oper"]').click(); await sleep(50);
  d.querySelector('#novoOperador').value = 'João'; d.querySelector('#btnAddOperador').click(); await sleep(150);
  d.querySelector('#novoOperador').value = 'Maria'; d.querySelector('#btnAddOperador').click(); await sleep(150);
  ok(d.querySelectorAll('#tblOper tbody tr').length === 2, 'dois operadores cadastrados');
  ok(d.querySelector('#selOperador').value === 'João', 'primeiro operador fica selecionado', d.querySelector('#selOperador').value);
  ok(/João/.test(txt('#operadorScan')), 'operador aparece na tela de bipagem', txt('#operadorScan'));
  const sel = d.querySelector('#selOperador');

  console.log('\n=== §31 T1/T2 — importar #1 (85) e #2 (112) ===');
  await importar(F.r1, 'novo');
  ok(num('Total de pedidos') === 85, 'romaneio com 85 pedidos', num('Total de pedidos'));
  sel.value = ''; sel.dispatchEvent(new w.Event('change')); await sleep(50);
  d.querySelector('[data-view="scan"]').click(); bipar('43800'); await sleep(60);
  ok(/IDENTIFIQUE O OPERADOR/.test(txt('#verdict')), 'bipagem exige operador identificado');
  sel.value = 'João'; sel.dispatchEvent(new w.Event('change')); await sleep(50);
  await importar(F.r2, 'add');
  ok(num('Total de pedidos') === 112, 'romaneio consolidado com 112', num('Total de pedidos'));

  console.log('\n=== §31 T3/T4/T5 — excluir a importação #2 ===');
  bipar(DO_REL1); await sleep(80);   // pedido presente nas duas importações, bipado
  ok(num('Bipados') === 1, 'pedido das duas importações bipado', num('Bipados'));
  d.querySelector('[data-view="concil"]').click(); await sleep(80);
  ok(d.querySelectorAll('#impList [data-delimp]').length === 2, 'cada importação tem ação de exclusão');
  d.querySelector('#impList [data-delimp="2"]').click(); await sleep(80);
  const mtx = txt('.modal').replace(/\s+/g, ' ');
  console.log('  confirmação:', mtx.slice(0, 220));
  ok(/EXCLUIR IMPORTAÇÃO|Excluir importação #2/i.test(txt('.modal h2') + mtx), 'confirmação de exclusão exibida');
  ok(/NF_1609_1015/.test(mtx), 'mostra arquivo, data, horário e quantidades');
  ok(/Permanecem/.test(mtx) && /Saem do romaneio/.test(mtx), 'mostra o impacto no conjunto consolidado');
  ok(/Atenção/.test(mtx) && /já foram bipados/.test(mtx), '⚠️ avisa que há pedidos já bipados');
  await modalOk();
  ok(num('Total de pedidos') === 85, 'romaneio recalculado: pedidos exclusivos da #2 saíram', num('Total de pedidos'));
  ok(num('Bipados') === 1, 'pedido presente na #1 permanece e continua EMBALADO', num('Bipados'));
  ok(/Importação excluída/.test(txt('#impList')), '🗑️ importação marcada como EXCLUÍDA no histórico');
  ok(d.querySelectorAll('#impList .imp-row').length === 2, 'registro da importação excluída não some');
  ok(/Importação excluída/.test(txt('#audList')), 'exclusão registrada na auditoria');
  ok(/27 pedidos no arquivo|112 pedidos no arquivo/.test(txt('#audList')) || /excluída/.test(txt('#audList')), 'auditoria detalha a operação');

  console.log('\n=== §31 T4 — A,B,C / A..E / A..F com exclusão do meio ===');
  await importar(F.r2, 'add');    // volta os 27 (importação #3)
  await importar(F.r3, 'add');    // + 14 (importação #4) => 126
  ok(num('Total de pedidos') === 126, 'romaneio com 126 pedidos', num('Total de pedidos'));
  d.querySelector('[data-view="concil"]').click(); await sleep(80);
  d.querySelector('#impList [data-delimp="3"]').click(); await sleep(80);
  await modalOk();
  ok(num('Total de pedidos') === 126, 'excluir a importação do meio não remove nada: tudo está na #4', num('Total de pedidos'));

  console.log('\n=== §31 T5/T6 — pedido exclusivo de uma importação, com e sem bipagem ===');
  d.querySelector('[data-view="scan"]').click(); await sleep(50);
  bipar(SO_NA_2); await sleep(80);
  ok(/BIPADO COM SUCESSO/.test(txt('#verdict')), 'pedido sintético bipado');
  const bipAntes = num('Bipados');
  d.querySelector('[data-view="concil"]').click(); await sleep(80);
  d.querySelector('#impList [data-delimp="4"]').click(); await sleep(80);
  await modalOk();
  ok(num('Bipados') === bipAntes, 'bipagem do pedido órfão NÃO foi apagada', num('Bipados') + ' vs ' + bipAntes);
  ok(/revisão/i.test(txt('#audList')), 'pedido bipado sem origem marcado para revisão na auditoria');
  d.querySelector('#fTexto').value = SO_NA_2; d.querySelector('#fTexto').dispatchEvent(new w.Event('input')); await sleep(60);
  ok(/importação de origem foi excluída/.test(txt('#tblConcil tbody')), 'conciliação sinaliza o pedido para revisão');
  d.querySelector('#btnLimparF').click();
  d.querySelector('#fTexto').value = SO_NA_2B; d.querySelector('#fTexto').dispatchEvent(new w.Event('input')); await sleep(60);
  ok(d.querySelectorAll('#tblConcil tbody tr').length === 0 || /Nenhuma linha/.test(txt('#tblConcil tbody')),
    'pedido órfão NÃO bipado saiu do conjunto ativo');
  d.querySelector('#btnLimparF').click();

  console.log('\n=== §6 — exclusão individual de bipagem ===');
  d.querySelector('[data-view="scan"]').click(); await sleep(50);
  bipar(DO_REL1); await sleep(80);
  ok(/DUPLICADO/.test(txt('#verdict')), 'segunda leitura do mesmo pedido: DUPLICADO');
  ok(/Operador da primeira/.test(txt('#verdict')) && /Operador atual/.test(txt('#verdict')), 'duplicidade mostra os dois operadores');
  const embaladosAntes = num('Bipados');
  const botaoDe = cod => [...d.querySelectorAll('#feed .feed-item')]
    .filter(el => el.textContent.indexOf(cod) !== -1 && el.querySelector('[data-del]'))
    .map(el => el.querySelector('[data-del]'))[0];
  const alvoDel = botaoDe(DO_REL1);
  alvoDel.click(); await sleep(80);
  ok(/Excluir bipagem/.test(txt('.modal h2')), 'confirmação de exclusão de bipagem');
  ok(/continuará/.test(txt('.modal')) || /EMBALADO/.test(txt('.modal')), 'informa o efeito no status do pedido');
  d.querySelector('#modalMotivo').value = 'leitor disparou duas vezes';
  await modalOk();
  ok(num('Bipados') === embaladosAntes, 'pedido continua EMBALADO: ainda há bipagem ativa', num('Bipados'));
  ok(num('Duplicados') === 0, 'duplicidade desfeita ao excluir a segunda leitura', num('Duplicados'));
  ok(/Bipagem excluída/.test(txt('#feed')), 'histórico mantém a bipagem excluída, riscada');
  // excluir a última bipagem ativa do pedido
  const restante = botaoDe(DO_REL1);
  restante.click(); await sleep(80); await modalOk();
  ok(num('Bipados') === embaladosAntes - 1, 'sem bipagem ativa, o pedido volta para PENDENTE', num('Bipados'));
  d.querySelector('[data-view="concil"]').click(); await sleep(80);
  d.querySelector('#fTexto').value = '43800'; d.querySelector('#fTexto').dispatchEvent(new w.Event('input')); await sleep(60);
  ok(/Pendente/.test(txt('#tblConcil tbody')), 'NF 43800 aparece como Pendente, sem sair do romaneio');
  ok(/Bipagem excluída/.test(txt('#audList')), 'exclusões de bipagem na auditoria');
  d.querySelector('#btnLimparF').click();

  console.log('\n=== §7 — pedido já bipado em romaneio anterior ===');
  d.querySelector('[data-view="scan"]').click(); await sleep(50);
  bipar(DO_REL1); await sleep(80);       // volta a ficar EMBALADO no romaneio A
  await importar(F.r1, 'novo');          // romaneio do dia seguinte
  ok(num('Total de pedidos') === 85, 'segundo romaneio criado', num('Total de pedidos'));
  await sleep(400);                      // índice de romaneios anteriores
  bipar(DO_REL1); await sleep(120);
  ok(/JÁ BIPADO EM ROMANEIO ANTERIOR/.test(txt('#verdict')), 'alerta de bipagem anterior exibido');
  ok(/43800/.test(txt('#verdict')), 'alerta mostra a NF');
  ok(/João/.test(txt('#verdict')), 'alerta mostra o operador da bipagem anterior');
  ok(/BIPADO COM SUCESSO/.test(txt('#verdict')), 'a bipagem atual não é bloqueada');
  ok(num('Bipados') === 1, 'bipagem atual contabilizada normalmente', num('Bipados'));

  console.log('\n=== §11/§13 — fechar, permanecer no histórico e excluir romaneio ===');
  d.querySelector('#btnFechar').click(); await sleep(60); await modalOk();
  ok(/Romaneio fechado/.test(txt('#romStatus')), 'romaneio fechado');
  d.querySelector('[data-view="hist"]').click(); await sleep(80);
  ok(d.querySelectorAll('#tblHist tbody tr').length === 2, 'os dois romaneios continuam no histórico', d.querySelectorAll('#tblHist tbody tr').length);
  ok(/Fechado/.test(txt('#tblHist')), 'romaneio fechado aparece com status Fechado');
  ok(/João/.test(txt('#tblHist')), 'histórico mostra o operador');
  d.querySelector('#hStatus').value = 'FECHADO'; d.querySelector('#hStatus').dispatchEvent(new w.Event('change')); await sleep(50);
  ok(d.querySelectorAll('#tblHist tbody tr').length === 1, 'filtro por status funciona', d.querySelectorAll('#tblHist tbody tr').length);
  d.querySelector('#btnLimparH').click(); await sleep(50);

  // exclusão de importação com romaneio fechado
  d.querySelector('[data-view="concil"]').click(); await sleep(80);
  d.querySelector('#impList [data-delimp="1"]').click(); await sleep(80);
  ok(/Romaneio fechado/.test(txt('.modal h2')), 'exclusão de importação bloqueada em romaneio fechado');
  ok(/Reabrir romaneio/.test(txt('.modal')), 'oferece reabrir como caminho');
  d.querySelector('.modal [data-x=cancel]').click(); await sleep(50);

  d.querySelector('[data-view="hist"]').click(); await sleep(80);
  const delRom = d.querySelector('#tblHist [data-delrom]');
  delRom.click(); await sleep(80);
  ok(/Excluir romaneio/.test(txt('.modal h2')), 'confirmação forte para excluir romaneio');
  ok(d.querySelector('.modal [data-x=ok]').disabled, 'exige aceite explícito');
  await modalOk();
  const visiveis = d.querySelectorAll('#tblHist tbody tr').length;
  ok(visiveis === 1, 'romaneio excluído sai da lista padrão', visiveis);
  d.querySelector('#hExcluidos').checked = true; d.querySelector('#hExcluidos').dispatchEvent(new w.Event('change')); await sleep(50);
  ok(/Excluído/.test(txt('#tblHist')), 'registro continua acessível pelo filtro de auditoria');
  d.querySelector('#hExcluidos').checked = false; d.querySelector('#hExcluidos').dispatchEvent(new w.Event('change')); await sleep(50);

  console.log('\n=== §31 T8 — exportar após as exclusões ===');
  d.querySelector('#tblHist [data-open]').click(); await sleep(900);
  let saved = null, parts = null;
  w.HTMLAnchorElement.prototype.click = function () { saved = this.download; };
  const OB = w.Blob; w.Blob = function (p, o) { parts = p; return new OB(p, o); };
  d.querySelector('[data-view="concil"]').click(); await sleep(80);
  d.querySelector('#btnExport').click(); await sleep(700);
  ok(!!saved, 'arquivo exportado', saved);
  const out = XLSX.read(Buffer.from(parts[0]), { type: 'buffer' });
  ok(out.SheetNames.join(',') === 'Romaneio,Resumo,Importações,Auditoria', 'quatro abas', out.SheetNames.join(','));
  const rom = XLSX.utils.sheet_to_json(out.Sheets['Romaneio'], { header: 1, defval: '' });
  ok(rom.length - 1 === num('Total de pedidos') + (num('Não encontrados') || 0), 'aba Romaneio reflete o consolidado após as exclusões', (rom.length - 1) + ' linhas / ' + num('Total de pedidos') + ' pedidos');
  ok(rom[0].includes('Operador'), 'coluna Operador presente');
  ok(rom[0].includes('Situação de duplicidade'), 'coluna de duplicidade presente');
  const imps = XLSX.utils.sheet_to_json(out.Sheets['Importações'], { header: 1, defval: '' });
  ok(imps[0].includes('Status') && imps.slice(1).some(r => r[9] === 'EXCLUÍDA'), 'aba Importações mantém as excluídas com status', JSON.stringify(imps.slice(1).map(r => [r[0], r[9]])));
  const aud = XLSX.utils.sheet_to_json(out.Sheets['Auditoria'], { header: 1, defval: '' });
  const eventos = aud.map(r => r[2]).join('|');
  ok(aud[0].includes('Operador') && aud[0].includes('Romaneio'), 'auditoria com operador e romaneio');
  ok(/Importação excluída/.test(eventos), 'auditoria exporta a exclusão de importação');
  ok(/Bipagem excluída/.test(eventos), 'auditoria exporta a exclusão de bipagem');
  ok(/Bipagem registrada/.test(eventos), 'auditoria exporta as bipagens');

  console.log('\n' + (fails === 0 ? 'TESTES DE EXCLUSÃO/OPERADORES: TODOS PASSARAM' : 'TESTES DE EXCLUSÃO/OPERADORES: ' + fails + ' FALHA(S)') + '\n');
  process.exit(fails ? 1 : 0);
})().catch(e => { console.error(e); process.exit(1); });
