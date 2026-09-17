[README.md](https://github.com/user-attachments/files/32335456/README.md)
# Romaneio e Conciliação de Expedição — JETONLINE

Sistema web de romaneio e conciliação de expedição para e-commerce: importação
de relatórios de Notas Fiscais, bipagem de etiquetas por leitor de código de
barras, conciliação automática, múltiplas importações por romaneio, fechamento/
reabertura, exclusão lógica (importações, bipagens e romaneios) e exportação
para Excel com trilha de auditoria.

## Estrutura

```
index.html          Aplicativo completo, pronto para abrir no navegador ou publicar
                     (GitHub Pages, qualquer hospedagem estática). Autocontido:
                     não depende de backend.
src/
  engine.js          Motor puro (sem DOM): normalização de identificadores,
                     leitura do relatório, resolução de bipagem, mesclagem
                     incremental de importações, exclusão lógica, conciliação
                     e exportação. Usado tanto pelo app quanto pelos testees.
  app.template.html  Interface, telas, armazenamento e fluxos. Contém o
                     marcador /*__ENGINE__*/ onde o conteúdo de engine.js é
                     injetado para gerar o index.html final.
teste/
  teste.js               testees do motor (identificação de etiquetas, chave de
                         acesso da NFe, ambiguidade).
  e2e.js                Fluxo completo em DOM headless: importar, bipar,
                         conciliar, filtrar, exportar.
  teste-fechamento.js    Múltiplas importações, fechamento e reabertura de
                         romaneio.
  teste-exclusoes.js     Exclusão lógica de importação/bipagem/romaneio,
                         operadores, alerta de pedido já bipado em romaneio
                         anterior.
```

## Como gerar o index.html a partir das fontes

```bash
python3 - <<'PY'
eng = open('src/engine.js').read()
tpl = open('src/app.template.html').read()
open('index.html', 'w').write(tpl.replace('/*__ENGINE__*/', eng))
PY
```

## Como rodar os testees

Os testees usam um relatório de exemplo (.xls) que **não está neste repositório**
porque relatórios reais contêm dados pessoais de clientes (nome, CPF, endereço).
Para rodar localmente, aponte para o seu próprio arquivo no mesmo formato
(colunas: Número, Destinatário, Endereço, Bairro, CEP, Cidade, Etiqueta, Nº PLP,
Serviço):

```bash
cd testee
npm install
REPORT_PATH=/caminho/para/seu-relatorio.xls npm teste
```

## Publicar / hospedar

`index.html` é autocontido (HTML+CSS+JS em um arquivo só, sem build step) e
pode ser publicado como está em qualquer hospedagem estática, por exemplo
GitHub Pages (repositório → Settings → Pages → Deploy from branch → `main` /
pasta raiz).

O armazenamento de romaneios, bipagens e auditoria usa `localStorage` do
navegador quando não há um backend de banco de dados conectado — nesse caso
os dados ficam apenas no navegador de cada estação, sem sincronizar entre
computadores. Para uso com múltiplas estações de expedição sincronizadas em
tempo real, hospede via Claude (artifact publicado), que fornece esse backend.

## Dados sensíveis

Este repositório **não contém** nenhum relatório de NF, etiqueta ou dado de
cliente reais. `.gitignore` bloqueia esses padrões de arquivo por segurança.
Nenhuma credencial, token ou chave de API é usada pelo sistema.
