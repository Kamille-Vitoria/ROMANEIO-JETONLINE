/* =====================================================================
   MOTOR DE ROMANEIO E CONCILIAÇÃO DE EXPEDIÇÃO
   Módulo puro (sem DOM). Usado pelo app e pelos testes em Node.
   ===================================================================== */
(function (root, factory) {
  var api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.Engine = api;
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  /* ---------------------------------------------------------------
     1. NORMALIZAÇÃO
     --------------------------------------------------------------- */

  function stripAccents(s) {
    return String(s == null ? '' : s)
      .normalize('NFD').replace(/[\u0300-\u036f]/g, '');
  }

  function normHeader(s) {
    return stripAccents(s).toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
  }

  // Normalização de um código lido/armazenado: maiúsculas, sem espaços,
  // sem caracteres de controle do leitor, sem pontuação de separação.
  function normCode(v) {
    if (v == null) return '';
    if (typeof v === 'number') {
      v = Number.isInteger(v) ? String(v) : String(v).replace(/\.0+$/, '');
    }
    return String(v)
      .replace(/[\u0000-\u001f\u007f]/g, '')
      .trim()
      .toUpperCase()
      .replace(/\s+/g, '')
      .replace(/[.\-\/]/g, '');
  }

  function digitsOnly(v) { return String(v == null ? '' : v).replace(/\D/g, ''); }
  function stripZeros(v) { var d = digitsOnly(v).replace(/^0+/, ''); return d || (digitsOnly(v) ? '0' : ''); }

  /* ---------------------------------------------------------------
     2. RECONHECIMENTO DE IDENTIFICADORES
     Tipos:
       nf      número da Nota Fiscal (sem zeros à esquerda)
       chave   chave de acesso NFe (44 dígitos)
       rastreio código de rastreamento (BR..., MEL..., AA000000000BR)
       envio   nº de envio/shipment do Mercado Livre (dígitos)
       venda   nº de venda do marketplace (>=14 dígitos)
       pedido  nº do pedido da loja / marketplace
       spx     código de retirada Shopee (SPX...)
       plp     PLP dos Correios (numérico curto em coluna PLP)
     --------------------------------------------------------------- */

  var RE = {
    chave:        /^\d{44}$/,
    mel:          /^MEL(\d{8,})FMX[A-Z0-9]*$/,
    brTrack:      /^BR[0-9A-Z]{13}$/,
    brPlusSpx:    /^(BR[0-9A-Z]{13})(SPX[A-Z0-9]{4,})$/,
    spx:          /^SPX[A-Z0-9]{4,}$/,
    correios:     /^[A-Z]{2}\d{9}BR$/,
    numeric:      /^\d+$/,
    pedidoMkt:    /^[0-9]{4,8}[A-Z0-9]{4,14}$/   // 2609165MR44BTA, 26091664C6ST32
  };

  // Decompõe a chave de acesso da NFe (layout oficial de 44 posições)
  function parseChave(c) {
    if (!RE.chave.test(c)) return null;
    return {
      chave: c,
      cUF: c.slice(0, 2),
      aamm: c.slice(2, 6),
      cnpj: c.slice(6, 20),
      modelo: c.slice(20, 22),
      serie: stripZeros(c.slice(22, 25)) || '0',
      nf: stripZeros(c.slice(25, 34)),
      tpEmis: c.slice(34, 35),
      cNF: c.slice(35, 43),
      dv: c.slice(43, 44)
    };
  }

  // Identificadores derivados de um valor vindo do RELATÓRIO.
  // fieldHint: 'nf' | 'etiqueta' | 'pedido' | 'livre'
  function identifiersFrom(value, fieldHint) {
    var c = normCode(value);
    var out = [];
    if (!c) return out;
    var push = function (type, val) {
      val = normCode(val);
      if (val) out.push({ type: type, value: val });
    };
    var m;

    if (fieldHint === 'nf') {
      push('nf', stripZeros(c));
      return out;
    }

    if (RE.chave.test(c)) {
      var k = parseChave(c);
      push('chave', c);
      push('nf', k.nf);
      return out;
    }
    if ((m = c.match(RE.mel))) {            // MEL48025137359FMXDF01
      push('rastreio', c);
      push('envio', stripZeros(m[1]));
      return out;
    }
    if ((m = c.match(RE.brPlusSpx))) {      // BR...SPXLM16887854 (retirada)
      push('rastreio', m[1]);
      push('rastreio', c);
      push('spx', m[2]);
      return out;
    }
    if (RE.brTrack.test(c) || RE.correios.test(c)) {
      push('rastreio', c);
      return out;
    }
    if (RE.spx.test(c)) { push('spx', c); return out; }

    if (RE.numeric.test(c)) {
      if (fieldHint === 'etiqueta') {
        // Mercado Envios Flex traz apenas o nº do envio na coluna Etiqueta
        push('envio', stripZeros(c));
        push('rastreio', c);
      } else if (c.length >= 14) {
        push('venda', stripZeros(c));
      } else if (c.length >= 8) {
        push('envio', stripZeros(c));
      } else {
        push('plp', stripZeros(c));
      }
      return out;
    }

    // Alfanumérico: pedido da loja / marketplace
    push('pedido', c);
    return out;
  }

  // Identificadores candidatos de um código BIPADO (leitor de código de barras)
  function scanCandidates(raw) {
    var c = normCode(raw);
    var out = [];
    var seen = {};
    var push = function (type, val) {
      val = normCode(val);
      if (!val) return;
      var k = type + ':' + val;
      if (seen[k]) return;
      seen[k] = 1;
      out.push({ type: type, value: val });
    };
    if (!c) return { code: c, keys: out, chave: null };

    var chaveInfo = null;
    var m;

    if (RE.chave.test(c)) {
      chaveInfo = parseChave(c);
      push('chave', c);
      push('nf', chaveInfo.nf);
    } else if ((m = c.match(RE.mel))) {
      push('rastreio', c);
      push('envio', stripZeros(m[1]));
      push('rastreio', stripZeros(m[1]));     // etiqueta Flex guarda só os dígitos
    } else if ((m = c.match(RE.brPlusSpx))) {
      push('rastreio', c);
      push('rastreio', m[1]);
      push('spx', m[2]);
    } else if (RE.brTrack.test(c) || RE.correios.test(c)) {
      push('rastreio', c);
    } else if (RE.spx.test(c)) {
      push('spx', c);
    } else if (RE.numeric.test(c)) {
      if (c.length >= 14) {
        push('venda', stripZeros(c));
        push('pedido', c);
      } else if (c.length >= 8) {
        // nº de envio ML (etiqueta de agência traz só o envio no código de barras)
        push('envio', stripZeros(c));
        push('rastreio', c);
      } else {
        push('nf', stripZeros(c));
        push('plp', stripZeros(c));
      }
    } else if (RE.pedidoMkt.test(c)) {
      push('pedido', c);
    } else {
      push('pedido', c);
      push('rastreio', c);
    }

    // Rede de segurança: comparação bruta contra qualquer identificador
    push('ANY', c);
    var d = digitsOnly(c);
    if (d && d !== c) push('ANY', d);

    return { code: c, keys: out, chave: chaveInfo };
  }

  /* ---------------------------------------------------------------
     3. LEITURA DO RELATÓRIO (matriz de células -> pedidos)
     --------------------------------------------------------------- */

  var COLUMN_MAP = [
    { field: 'nf',        syn: ['numero', 'n', 'nf', 'numero nf', 'nota', 'nota fiscal', 'numero da nota', 'num nota', 'doc'] },
    { field: 'serie',     syn: ['serie'] },
    { field: 'cliente',   syn: ['destinatario', 'cliente', 'nome', 'nome do cliente', 'comprador'] },
    { field: 'endereco',  syn: ['endereco', 'logradouro'] },
    { field: 'bairro',    syn: ['bairro'] },
    { field: 'cep',       syn: ['cep'] },
    { field: 'cidade',    syn: ['cidade', 'municipio', 'cidade uf'] },
    { field: 'etiqueta',  syn: ['etiqueta', 'codigo etiqueta', 'codigo da etiqueta', 'rastreio', 'rastreamento', 'codigo de rastreio', 'objeto'] },
    { field: 'pedido',    syn: ['n plp', 'no plp', 'plp', 'pedido', 'n pedido', 'numero do pedido', 'pedido loja', 'codigo do pedido'] },
    { field: 'servico',   syn: ['servico', 'servico de entrega', 'modalidade', 'transportadora', 'tipo de envio'] },
    { field: 'emissao',   syn: ['emissao', 'data de emissao', 'data emissao', 'data'] }
  ];

  function detectHeader(matrix) {
    var best = { row: -1, score: 0, map: {} };
    var limit = Math.min(matrix.length, 30);
    for (var r = 0; r < limit; r++) {
      var row = matrix[r] || [];
      var map = {}, score = 0, used = {};
      for (var c = 0; c < row.length; c++) {
        var h = normHeader(row[c]);
        if (!h) continue;
        for (var i = 0; i < COLUMN_MAP.length; i++) {
          var def = COLUMN_MAP[i];
          if (used[def.field]) continue;
          if (def.syn.indexOf(h) !== -1) { map[def.field] = c; used[def.field] = 1; score++; break; }
        }
      }
      if (score > best.score) best = { row: r, score: score, map: map };
    }
    return best;
  }

  function isFooterRow(row, map) {
    var joined = row.map(function (v) { return String(v == null ? '' : v).trim(); }).join('').trim();
    if (!joined) return true;
    if (/^quantidade\s*:/i.test(stripAccents(joined))) return true;
    var nf = map.nf != null ? String(row[map.nf] == null ? '' : row[map.nf]).trim() : '';
    var et = map.etiqueta != null ? String(row[map.etiqueta] == null ? '' : row[map.etiqueta]).trim() : '';
    return !nf && !et;
  }

  function carrierOf(etiquetaIds, servico) {
    var s = stripAccents(String(servico || '')).toLowerCase();
    var types = etiquetaIds.map(function (k) { return k.type; });
    var raw = etiquetaIds.length ? etiquetaIds[0].value : '';
    if (/^MEL/.test(raw) || types.indexOf('envio') !== -1) return 'MERCADO LIVRE';
    if (/^BR/.test(raw) || types.indexOf('spx') !== -1) return 'SHOPEE';
    if (RE.correios.test(raw)) return 'CORREIOS';
    if (/mercado|flex|agencia|prioritario|expresso|normal/.test(s)) return 'MERCADO LIVRE';
    if (/shopee|entrega direta|retirada pelo comprador|xpress/.test(s)) return 'SHOPEE';
    if (/correios|sedex|pac/.test(s)) return 'CORREIOS';
    return 'OUTRA';
  }

  // matrix: array de arrays (SheetJS sheet_to_json header:1)
  function parseMatrix(matrix) {
    var det = detectHeader(matrix);
    var warnings = [];
    if (det.score < 2) {
      return { ok: false, error: 'Não foi possível identificar o cabeçalho do relatório. Colunas mínimas esperadas: número da NF e etiqueta.', orders: [], warnings: warnings, map: {}, headerRow: -1 };
    }
    var map = det.map;
    if (map.nf == null) warnings.push('Coluna de NF não identificada — a conciliação usará apenas etiqueta/pedido.');
    if (map.etiqueta == null) warnings.push('Coluna de etiqueta não identificada — a bipagem dependerá da NF/pedido.');

    var headers = (matrix[det.row] || []).map(function (v) { return String(v == null ? '' : v).trim(); });
    var orders = [];
    var seq = 0;

    for (var r = det.row + 1; r < matrix.length; r++) {
      var row = matrix[r] || [];
      if (isFooterRow(row, map)) continue;
      var get = function (f) {
        return map[f] != null ? (row[map[f]] == null ? '' : row[map[f]]) : '';
      };

      var nfRaw = String(get('nf')).trim();
      var nf = stripZeros(nfRaw);
      var etiquetaRaw = get('etiqueta');
      var pedidoRaw = get('pedido');
      var servico = String(get('servico')).trim();

      var keys = [];
      var add = function (arr) { keys = keys.concat(arr); };
      if (nf) add(identifiersFrom(nf, 'nf'));
      var etIds = identifiersFrom(etiquetaRaw, 'etiqueta');
      add(etIds);
      add(identifiersFrom(pedidoRaw, 'pedido'));

      // chaves genéricas (rede de segurança)
      [nfRaw, nf, etiquetaRaw, pedidoRaw].forEach(function (v) {
        var c = normCode(v);
        if (c) keys.push({ type: 'ANY', value: c });
        var d = digitsOnly(c);
        if (d && d !== c) keys.push({ type: 'ANY', value: d });
      });

      // dedup
      var seen = {}, uniq = [];
      keys.forEach(function (k) {
        var kk = k.type + ':' + k.value;
        if (!seen[kk]) { seen[kk] = 1; uniq.push(k); }
      });

      seq++;
      var rawObj = {};
      headers.forEach(function (h, i) { if (h) rawObj[h] = row[i] == null ? '' : row[i]; });

      var etNorm = normCode(etiquetaRaw);
      var envio = uniq.filter(function (k) { return k.type === 'envio'; })[0];
      var rastreio = uniq.filter(function (k) { return k.type === 'rastreio'; })[0];

      orders.push({
        id: 'P' + String(seq).padStart(4, '0'),
        seq: seq,
        linha: r + 1,
        nf: nf,
        nfRaw: nfRaw,
        serie: String(get('serie')).trim(),
        cliente: String(get('cliente')).trim(),
        endereco: String(get('endereco')).trim(),
        bairro: String(get('bairro')).trim(),
        cep: String(get('cep')).trim(),
        cidade: String(get('cidade')).trim(),
        etiqueta: etNorm,
        etiquetaRaw: typeof etiquetaRaw === 'number' ? String(etiquetaRaw) : String(etiquetaRaw).trim(),
        rastreio: rastreio ? rastreio.value : '',
        envio: envio ? envio.value : '',
        pedido: normCode(pedidoRaw),
        emissao: String(get('emissao')).trim(),
        servico: servico,
        transportadora: carrierOf(etIds, servico),
        keys: uniq,
        raw: rawObj
      });
    }

    // Colisões de chave entre pedidos diferentes => risco de ambiguidade
    var idx = buildIndex(orders);
    var colisoes = [];
    Object.keys(idx).forEach(function (k) {
      if (idx[k].length > 1 && k.indexOf('ANY:') !== 0) {
        colisoes.push({ chave: k, pedidos: idx[k].slice() });
      }
    });
    if (colisoes.length) {
      warnings.push(colisoes.length + ' identificador(es) aparecem em mais de um pedido — bipagens nesses códigos exigirão conferência manual.');
    }

    return {
      ok: true, orders: orders, warnings: warnings, map: map,
      headerRow: det.row, headers: headers, colisoes: colisoes
    };
  }

  /* ---------------------------------------------------------------
     4. ÍNDICE E RESOLUÇÃO DA BIPAGEM
     --------------------------------------------------------------- */

  function buildIndex(orders) {
    var idx = {};
    orders.forEach(function (o) {
      o.keys.forEach(function (k) {
        var kk = k.type + ':' + k.value;
        if (!idx[kk]) idx[kk] = [];
        if (idx[kk].indexOf(o.id) === -1) idx[kk].push(o.id);
      });
    });
    return idx;
  }

  // Resolve um código bipado contra o índice.
  // Retorna { status, orderId, matchedBy, candidatos, code, chave }
  function resolveScan(raw, orders, idx) {
    var sc = scanCandidates(raw);
    if (!sc.code) return { status: 'INVALIDO', code: '', candidatos: [], matchedBy: '', chave: null };

    var hits = {};       // orderId -> tipo de chave que casou
    var ordered = [];
    // Ordem de prioridade dos tipos (mais específico primeiro)
    var priority = ['chave', 'rastreio', 'spx', 'envio', 'venda', 'pedido', 'nf', 'plp', 'ANY'];
    var byPriority = sc.keys.slice().sort(function (a, b) {
      return priority.indexOf(a.type) - priority.indexOf(b.type);
    });

    for (var i = 0; i < byPriority.length; i++) {
      var k = byPriority[i];
      var list = idx[k.type + ':' + k.value];
      if (!list || !list.length) continue;
      for (var j = 0; j < list.length; j++) {
        if (!hits[list[j]]) {
          hits[list[j]] = k.type + ':' + k.value;
          ordered.push(list[j]);
        }
      }
      // Casou em um tipo específico e sem ambiguidade: encerra
      if (ordered.length === 1 && k.type !== 'ANY') break;
    }

    if (ordered.length === 0) {
      return { status: 'NAO_ENCONTRADO', code: sc.code, candidatos: [], matchedBy: '', chave: sc.chave };
    }
    if (ordered.length > 1) {
      return {
        status: 'AMBIGUO', code: sc.code, candidatos: ordered,
        matchedBy: hits[ordered[0]], chave: sc.chave
      };
    }
    return {
      status: 'OK', code: sc.code, orderId: ordered[0],
      matchedBy: hits[ordered[0]], candidatos: ordered, chave: sc.chave
    };
  }

  /* ---------------------------------------------------------------
     4b. MESCLAGEM INCREMENTAL DE IMPORTAÇÕES
     Um romaneio é o conjunto consolidado do dia; cada relatório é
     apenas uma fotografia. Nada é substituído: pedidos já existentes
     permanecem como estão (inclusive o que já foi bipado) e apenas os
     inéditos entram.
     --------------------------------------------------------------- */

  // Procura, no índice do romaneio, o pedido que o registro recebido representa.
  // Retorna { tipo:'novo'|'existente'|'conflito', ids:[], via:'' }
  function localizarNoRomaneio(order, idx) {
    var hits = {}, ordem = [];
    (order.keys || []).forEach(function (k) {
      if (k.type === 'ANY') return;              // comparação bruta não decide identidade
      var list = idx[k.type + ':' + k.value];
      if (!list) return;
      list.forEach(function (id) {
        if (!hits[id]) { hits[id] = k.type + ':' + k.value; ordem.push(id); }
      });
    });
    if (ordem.length === 0) return { tipo: 'novo', ids: [], via: '' };
    if (ordem.length === 1) return { tipo: 'existente', ids: ordem, via: hits[ordem[0]] };
    return { tipo: 'conflito', ids: ordem, via: hits[ordem[0]] };
  }

  function indexarPedido(idx, o) {
    o.keys.forEach(function (k) {
      var kk = k.type + ':' + k.value;
      if (!idx[kk]) idx[kk] = [];
      if (idx[kk].indexOf(o.id) === -1) idx[kk].push(o.id);
    });
  }

  // existentes: pedidos já consolidados no romaneio
  // recebidos: pedidos lidos do novo relatório
  // opts.imp: nº da importação; opts.ts: carimbo; opts.forcarNovos: ids de conflito que o
  // usuário confirmou manualmente que são pedidos distintos.
  function mergeOrders(existentes, recebidos, opts) {
    opts = opts || {};
    var idx = buildIndex(existentes);
    var merged = existentes.slice();
    var novos = [], jaExistentes = [], conflitos = [];
    // A sequência considera TODOS os pedidos já existentes, inclusive os
    // desativados por exclusão de importação: reaproveitar um id criaria
    // dois pedidos com a mesma identidade e contaria bipagem em dobro.
    var maxSeq = existentes.reduce(function (m, o) { return Math.max(m, o.seq || 0); }, opts.seqBase || 0);
    var forcar = {};
    (opts.forcarNovos || []).forEach(function (k) { forcar[k] = 1; });

    function adicionar(o, motivo) {
      maxSeq++;
      var novo = {};
      Object.keys(o).forEach(function (k) { novo[k] = o[k]; });
      novo.id = 'P' + String(maxSeq).padStart(4, '0');
      novo.seq = maxSeq;
      novo.imp = opts.imp || 1;
      novo.imps = [opts.imp || 1];
      novo.ativo = true;
      novo.entrouEm = opts.ts || new Date().toISOString();
      if (motivo) novo.obsImportacao = motivo;
      merged.push(novo);
      indexarPedido(idx, novo);
      novos.push(novo);
      return novo;
    }

    // Um pedido que reaparece em um novo relatório passa a ter DUAS origens.
    // Isso é o que permite, ao excluir uma importação, saber se ele sobrevive.
    function registrarOrigem(orderId) {
      for (var i = 0; i < merged.length; i++) {
        if (merged[i].id !== orderId) continue;
        var c = {};
        Object.keys(merged[i]).forEach(function (k) { c[k] = merged[i][k]; });
        c.imps = (c.imps || [c.imp || 1]).slice();
        if (c.imps.indexOf(opts.imp) === -1) c.imps.push(opts.imp);
        merged[i] = c;
        return c;
      }
      return null;
    }

    recebidos.forEach(function (o, i) {
      var chaveOrigem = o.nf || o.etiqueta || ('linha' + i);
      var r = localizarNoRomaneio(o, idx);
      if (r.tipo === 'novo') { adicionar(o, null); return; }
      if (r.tipo === 'existente') {
        registrarOrigem(r.ids[0]);
        jaExistentes.push({ recebido: o, orderId: r.ids[0], via: r.via });
        return;
      }
      // conflito: identificadores apontam para mais de um pedido do romaneio
      if (forcar[chaveOrigem]) {
        adicionar(o, 'Adicionado após conferência manual (conflito de identificadores)');
        conflitos.push({ recebido: o, candidatos: r.ids, resolvido: 'adicionado' });
      } else {
        conflitos.push({ recebido: o, candidatos: r.ids, resolvido: 'pendente' });
      }
    });

    return {
      merged: merged, novos: novos, jaExistentes: jaExistentes, conflitos: conflitos,
      resumo: {
        encontrados: recebidos.length,
        novos: novos.length,
        jaExistentes: jaExistentes.length,
        conflitos: conflitos.filter(function (c) { return c.resolvido === 'pendente'; }).length,
        totalDepois: merged.length
      }
    };
  }

  /* ---------------------------------------------------------------
     4c. EXCLUSÃO LÓGICA DE IMPORTAÇÃO E RECÁLCULO DO CONJUNTO ATIVO
     Nada é apagado: a importação vira EXCLUÍDA e o romaneio é recomposto
     apenas com as importações que continuam ATIVAS.
     --------------------------------------------------------------- */

  function bipagensAtivasPorPedido(events) {
    var m = {};
    (events || []).forEach(function (e) {
      if (e.excluida) return;
      if (e.status !== 'OK' || !e.orderId) return;
      (m[e.orderId] = m[e.orderId] || []).push(e);
    });
    return m;
  }

  // impsAtivas: array de números de importação que continuam ativas
  // Devolve os pedidos com `ativo` recalculado e a contabilidade da operação.
  function recalcularAtivos(orders, impsAtivas, events) {
    var ativas = {};
    (impsAtivas || []).forEach(function (n) { ativas[n] = 1; });
    var bip = bipagensAtivasPorPedido(events);
    var removidos = [], mantidos = [], revisao = [];

    var novos = orders.map(function (o) {
      var c = {};
      Object.keys(o).forEach(function (k) { c[k] = o[k]; });
      var origens = (c.imps && c.imps.length) ? c.imps : [c.imp || 1];
      var origensVivas = origens.filter(function (n) { return ativas[n]; });
      var temBipagem = !!(bip[c.id] && bip[c.id].length);

      if (origensVivas.length) {
        c.ativo = true;
        if (c.semOrigem) { c.semOrigem = false; }     // voltou a ter origem válida
        mantidos.push(c);
      } else if (temBipagem) {
        // Já foi bipado: a bipagem NUNCA é apagada. O pedido fica no romaneio
        // marcado para revisão.
        c.ativo = true;
        c.semOrigem = true;
        c.revisao = 'Pedido bipado cuja importação de origem foi excluída.';
        revisao.push(c);
      } else {
        c.ativo = false;
        c.semOrigem = true;
        removidos.push(c);
      }
      return c;
    });

    return {
      orders: novos,
      ativos: novos.filter(function (o) { return o.ativo !== false; }),
      removidos: removidos, mantidos: mantidos, revisao: revisao
    };
  }

  // Prévia do impacto de excluir uma importação, antes de confirmar.
  function previaExclusaoImportacao(orders, numero, impsAtivasDepois, events) {
    var bip = bipagensAtivasPorPedido(events);
    var daImportacao = orders.filter(function (o) {
      if (o.ativo === false) return false;
      var origens = (o.imps && o.imps.length) ? o.imps : [o.imp || 1];
      return origens.indexOf(numero) !== -1;
    });
    var ativas = {};
    (impsAtivasDepois || []).forEach(function (n) { ativas[n] = 1; });

    var permanecem = [], sairiam = [], bipados = [];
    daImportacao.forEach(function (o) {
      var origens = (o.imps && o.imps.length) ? o.imps : [o.imp || 1];
      var outra = origens.some(function (n) { return n !== numero && ativas[n]; });
      var temBip = !!(bip[o.id] && bip[o.id].length);
      if (temBip) bipados.push(o);
      if (outra) permanecem.push(o);
      else if (!temBip) sairiam.push(o);
    });

    return {
      doArquivo: daImportacao.length,
      permanecem: permanecem.length,
      sairiam: sairiam.length,
      bipados: bipados.length,
      naoBipados: daImportacao.length - bipados.length,
      paraRevisao: bipados.filter(function (o) {
        var origens = (o.imps && o.imps.length) ? o.imps : [o.imp || 1];
        return !origens.some(function (n) { return n !== numero && ativas[n]; });
      }).length
    };
  }

  /* ---------------------------------------------------------------
     5. CONCILIAÇÃO (estado derivado dos eventos, nunca sobrescrito)
     --------------------------------------------------------------- */

  var STATUS = {
    EMBALADO: 'EMBALADO',
    PENDENTE: 'PENDENTE',
    DUPLICADO: 'DUPLICADO',
    NAO_PERTENCE: 'NAO_PERTENCE',
    AMBIGUO: 'AMBIGUO'
  };

  function sortEvents(events) {
    return events.slice().sort(function (a, b) {
      if (a.ts === b.ts) return String(a.id) < String(b.id) ? -1 : 1;
      return a.ts < b.ts ? -1 : 1;
    });
  }

  // events: [{id, ts, code, orderId|null, status:'OK'|'AMBIGUO'|'NAO_ENCONTRADO', matchedBy, estacao, chave}]
  function reconcile(orders, events) {
    var evs = sortEvents(events || []);
    var byOrder = {};
    orders.forEach(function (o) {
      byOrder[o.id] = { order: o, status: STATUS.PENDENTE, primeira: null, bipagens: [], duplicadas: [] };
    });

    var naoEncontrados = [];   // por código
    var ambiguos = [];
    var bloqueadas = [];       // tentativas de bipagem com o romaneio fechado
    var excluidas = [];        // bipagens excluídas logicamente (histórico preservado)
    var naoEncIndex = {};

    evs.forEach(function (e) {
      if (e.excluida) {
        // Continua no histórico e na auditoria, mas não é bipagem válida.
        excluidas.push(e);
        return;
      }
      if (e.status === 'BLOQUEADO') {
        // Registrada para auditoria, jamais contada como embalagem.
        bloqueadas.push(e);
        return;
      }
      if (e.status === 'OK' && e.orderId && byOrder[e.orderId]) {
        var slot = byOrder[e.orderId];
        slot.bipagens.push(e);
        if (!slot.primeira) {
          slot.primeira = e;
          slot.status = STATUS.EMBALADO;     // confirmado; nunca é revertido
        } else {
          slot.duplicadas.push(e);
          // status permanece EMBALADO; a duplicidade é sinalizada à parte
        }
      } else if (e.status === 'AMBIGUO') {
        ambiguos.push(e);
      } else {
        if (!naoEncIndex[e.code]) {
          naoEncIndex[e.code] = { code: e.code, tentativas: [], primeira: e };
          naoEncontrados.push(naoEncIndex[e.code]);
        }
        naoEncIndex[e.code].tentativas.push(e);
      }
    });

    var linhas = orders.map(function (o) {
      var s = byOrder[o.id];
      return {
        order: o,
        status: s.status,
        temDuplicidade: s.duplicadas.length > 0,
        revisao: o.revisao || '',
        primeira: s.primeira,
        bipagens: s.bipagens,
        duplicadas: s.duplicadas
      };
    });

    var totalPedidos = orders.length;
    var embalados = linhas.filter(function (l) { return l.status === STATUS.EMBALADO; }).length;
    var pendentes = totalPedidos - embalados;
    var duplicados = linhas.filter(function (l) { return l.temDuplicidade; }).length;
    var tentativasDuplicadas = linhas.reduce(function (a, l) { return a + l.duplicadas.length; }, 0);

    return {
      linhas: linhas,
      naoEncontrados: naoEncontrados,
      ambiguos: ambiguos,
      bloqueadas: bloqueadas,
      excluidas: excluidas,
      revisao: linhas.filter(function (l) { return l.revisao; }),
      resumo: {
        bloqueadas: bloqueadas.length,
        bipagensExcluidas: excluidas.length,
        pedidosEmRevisao: linhas.filter(function (l) { return l.revisao; }).length,
        totalPedidos: totalPedidos,
        embalados: embalados,
        pendentes: pendentes,
        pedidosComDuplicidade: duplicados,
        tentativasDuplicadas: tentativasDuplicadas,
        naoPertencentes: naoEncontrados.length,
        ambiguos: ambiguos.length,
        totalBipagens: evs.length - bloqueadas.length,
        percentual: totalPedidos ? Math.round((embalados / totalPedidos) * 1000) / 10 : 0
      }
    };
  }

  /* ---------------------------------------------------------------
     6. LINHAS PARA EXPORTAÇÃO
     --------------------------------------------------------------- */

  var EXPORT_HEADERS = ['Status', 'Data da bipagem', 'Hora da bipagem', 'NF', 'Série', 'Pedido',
    'Cliente', 'Código da etiqueta', 'Código de rastreamento', 'PLP', 'Serviço', 'Transportadora',
    'Data da emissão', 'Código bipado', 'Casou por', 'Estação', 'Duplicidades', 'Operador',
    'Situação de duplicidade', 'Importações de origem', 'Observação'];

  function fmtDate(ts) { if (!ts) return ''; var d = new Date(ts); return isNaN(d) ? '' : d.toLocaleDateString('pt-BR'); }
  function fmtTime(ts) { if (!ts) return ''; var d = new Date(ts); return isNaN(d) ? '' : d.toLocaleTimeString('pt-BR', { hour12: false }); }

  function exportRows(rec, romaneio) {
    var rows = [EXPORT_HEADERS];
    var dataRef = romaneio && romaneio.dataReferencia ? romaneio.dataReferencia : '';

    rec.linhas.forEach(function (l) {
      var o = l.order, p = l.primeira;
      var obs = [];
      if (l.temDuplicidade) obs.push(l.duplicadas.length + ' tentativa(s) de bipagem duplicada');
      if (l.status === 'PENDENTE') obs.push('Não bipado até o fechamento');
      if (l.revisao) obs.push(l.revisao);
      rows.push([
        l.status === 'EMBALADO' ? (l.temDuplicidade ? 'EMBALADO (COM DUPLICIDADE)' : 'EMBALADO') : 'PENDENTE',
        p ? fmtDate(p.ts) : '',
        p ? fmtTime(p.ts) : '',
        o.nf, (p && p.serie) ? p.serie : o.serie, o.pedido, o.cliente,
        o.etiquetaRaw, o.rastreio, o.envio || (o.pedido && /^\d+$/.test(o.pedido) ? o.pedido : ''),
        o.servico, o.transportadora, o.emissao || dataRef,
        p ? p.code : '', p ? p.matchedBy : '', p ? (p.estacao || '') : '',
        l.duplicadas.length, p ? (p.operador || '') : '',
        l.temDuplicidade ? ('Bipado ' + (l.duplicadas.length + 1) + 'x; contado uma vez') : '',
        ((o.imps && o.imps.length) ? o.imps : [o.imp || 1]).join(', '),
        obs.join(' | ')
      ]);
    });

    rec.naoEncontrados.forEach(function (n) {
      var e = n.primeira;
      rows.push(['NÃO PERTENCENTE AO ROMANEIO', fmtDate(e.ts), fmtTime(e.ts), '', '', '', '', '', '', '', '', '', dataRef,
        n.code, '', e.estacao || '', n.tentativas.length - 1, e.operador || '', '', '',
        'Código bipado sem correspondência no romaneio (' + n.tentativas.length + ' tentativa(s))']);
    });

    rec.ambiguos.forEach(function (e) {
      rows.push(['AMBÍGUO - CONFERÊNCIA MANUAL', fmtDate(e.ts), fmtTime(e.ts), '', '', '', '', '', '', '', '', '', dataRef,
        e.code, '', e.estacao || '', '', e.operador || '', '', '',
        'Código compatível com mais de um pedido: ' + (e.candidatos || []).join(', ')]);
    });

    return rows;
  }

  function fmtDT(ts) { return ts ? (fmtDate(ts) + ' ' + fmtTime(ts)) : ''; }

  function resumoRows(rec, romaneio, importacoes) {
    var r = rec.resumo;
    var imps = importacoes || (romaneio && romaneio.importacoes) || [];
    var rom = romaneio || {};
    var primeira = imps.length ? imps[0] : null;
    var ultima = imps.length ? imps[imps.length - 1] : null;
    return [
      ['RESUMO DO ROMANEIO', ''],
      ['Romaneio', rom.nome || rom.id || ''],
      ['Data do romaneio', rom.dataReferencia || ''],
      ['Status do romaneio', rom.status === 'FECHADO' ? 'FECHADO' : 'ABERTO'],
      ['', ''],
      ['Total de pedidos', r.totalPedidos],
      ['Total embalado', r.embalados],
      ['Total pendente', r.pendentes],
      ['Total duplicado (pedidos)', r.pedidosComDuplicidade],
      ['Tentativas duplicadas', r.tentativasDuplicadas],
      ['Total não pertencente ao romaneio', r.naoPertencentes],
      ['Total ambíguo (conferência manual)', r.ambiguos],
      ['Tentativas de bipagem após o fechamento', r.bloqueadas || 0],
      ['Total de bipagens registradas', r.totalBipagens],
      ['Percentual de conclusão', r.percentual + '%'],
      ['', ''],
      ['Quantidade de importações ativas', imps.filter(function(i){ return i.status !== 'EXCLUIDA'; }).length],
      ['Importações excluídas', imps.filter(function(i){ return i.status === 'EXCLUIDA'; }).length],
      ['Bipagens excluídas', r.bipagensExcluidas || 0],
      ['Pedidos marcados para revisão', r.pedidosEmRevisao || 0],
      ['Primeira importação', primeira ? fmtDT(primeira.ts) + ' · ' + (primeira.arquivo || '') : ''],
      ['Última importação', ultima ? fmtDT(ultima.ts) + ' · ' + (ultima.arquivo || '') : ''],
      ['Criado em', fmtDT(rom.criadoEm)],
      ['Fechado em', rom.fechadoEm ? fmtDT(rom.fechadoEm) + (rom.fechadoPor ? ' · ' + rom.fechadoPor : '') : '—'],
      ['Reaberturas', rom.reaberturas || 0]
    ];
  }

  var IMPORT_HEADERS = ['Nº da importação', 'Data', 'Hora', 'Nome do arquivo',
    'Pedidos encontrados', 'Pedidos novos', 'Pedidos já existentes', 'Conflitos',
    'Operador', 'Status', 'Excluída em', 'Excluída por'];

  function importacoesRows(importacoes) {
    var rows = [IMPORT_HEADERS];
    (importacoes || []).forEach(function (i) {
      rows.push([i.numero, fmtDate(i.ts), fmtTime(i.ts), i.arquivo || '',
        i.encontrados, i.novos, i.jaExistentes, i.conflitos, i.usuario || i.operador || '',
        i.status === 'EXCLUIDA' ? 'EXCLUÍDA' : 'ATIVA',
        i.excluidaEm ? fmtDT(i.excluidaEm) : '', i.excluidaPor || '']);
    });
    return rows;
  }

  var AUDIT_HEADERS = ['Data', 'Hora', 'Evento', 'Detalhe', 'Operador', 'Estação',
    'Romaneio', 'Pedido', 'NF', 'Situação anterior', 'Situação nova'];

  var AUDIT_LABEL = {
    CRIACAO: 'Romaneio criado',
    IMPORTACAO: 'Importação de relatório',
    FECHAMENTO: 'Romaneio fechado',
    REABERTURA: 'Romaneio reaberto',
    BIPAGEM_BLOQUEADA: 'Tentativa de bipagem com romaneio fechado',
    CONFLITO: 'Conflito de pedido na importação',
    EXPORTACAO: 'Romaneio exportado',
    EXCLUSAO_IMPORTACAO: 'Importação excluída',
    EXCLUSAO_BIPAGEM: 'Bipagem excluída',
    EXCLUSAO_ROMANEIO: 'Romaneio excluído',
    BIPAGEM: 'Bipagem registrada',
    BIPAGEM_DUPLICADA: 'Bipagem duplicada',
    BIPAGEM_NAO_ENCONTRADA: 'Código fora do romaneio',
    BIPAGEM_ANTERIOR: 'Pedido já bipado em romaneio anterior',
    REVISAO: 'Pedido marcado para revisão',
    OPERADOR: 'Cadastro de operadores'
  };

  function auditoriaRows(eventos, rec) {
    var rows = [AUDIT_HEADERS];
    var lista = (eventos || []).slice();
    // tentativas de bipagem bloqueadas também entram na auditoria exportada
    if (rec && rec.bloqueadas) {
      rec.bloqueadas.forEach(function (b) {
        if (lista.some(function (a) { return a.ref === b.id; })) return;
        lista.push({ ts: b.ts, tipo: 'BIPAGEM_BLOQUEADA', detalhe: 'Código bipado: ' + b.code,
          usuario: b.usuario || '', estacao: b.estacao || '', ref: b.id });
      });
    }
    lista.sort(function (a, b) { return a.ts < b.ts ? -1 : a.ts > b.ts ? 1 : 0; });
    lista.forEach(function (a) {
      rows.push([fmtDate(a.ts), fmtTime(a.ts), AUDIT_LABEL[a.tipo] || a.tipo,
        a.detalhe || '', a.usuario || '', a.estacao || '', a.romaneio || '',
        a.pedido || '', a.nf || '', a.antes || '', a.depois || '']);
    });
    return rows;
  }

  /* --------------------------------------------------------------- */

  return {
    stripAccents: stripAccents, normHeader: normHeader, normCode: normCode,
    digitsOnly: digitsOnly, stripZeros: stripZeros,
    parseChave: parseChave, identifiersFrom: identifiersFrom, scanCandidates: scanCandidates,
    detectHeader: detectHeader, parseMatrix: parseMatrix, buildIndex: buildIndex,
    resolveScan: resolveScan, reconcile: reconcile, carrierOf: carrierOf,
    exportRows: exportRows, resumoRows: resumoRows,
    mergeOrders: mergeOrders, localizarNoRomaneio: localizarNoRomaneio,
    recalcularAtivos: recalcularAtivos, previaExclusaoImportacao: previaExclusaoImportacao,
    bipagensAtivasPorPedido: bipagensAtivasPorPedido,
    importacoesRows: importacoesRows, auditoriaRows: auditoriaRows,
    EXPORT_HEADERS: EXPORT_HEADERS, IMPORT_HEADERS: IMPORT_HEADERS,
    AUDIT_HEADERS: AUDIT_HEADERS, AUDIT_LABEL: AUDIT_LABEL, STATUS: STATUS, RE: RE
  };
});
