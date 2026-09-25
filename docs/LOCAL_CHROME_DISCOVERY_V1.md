# Mavuri Local Chrome Discovery V1

## O que mudou

A POC anterior provou que um Chrome local autenticado consegue consultar a Central de Afiliados e retornar os produtos.

A Discovery V1 adiciona:

- paginação configurável;
- busca e filtros configuráveis;
- deduplicação por execução;
- estado persistente local para identificar produtos novos/alterados;
- saída JSON estruturada;
- geração de link de afiliado opcional e limitada, sempre executada dentro da sessão autenticada do Chrome;
- modo padrão **dry-run**, sem criação de links.

## Execução

No diretório `api/`:

```powershell
npm install
npm run browser:discover
```

Padrões:

- até 5 páginas;
- 16 produtos por página;
- ordenação `relevance`;
- busca vazia;
- filtros vazios;
- geração de links desativada.

## Configuração

Exemplos:

```powershell
$env:MAVURI_HUB_PAGES="10"
$env:MAVURI_HUB_PAGE_SIZE="16"
$env:MAVURI_HUB_SORT="relevance"
$env:MAVURI_HUB_SEARCH=""
$env:MAVURI_HUB_FILTERS='[]'
npm run browser:discover
```

Para habilitar geração de links durante uma execução controlada:

```powershell
$env:MAVURI_GENERATE_AFFILIATE_LINKS="true"
$env:MAVURI_MAX_NEW_LINKS="10"
npm run browser:discover
```

O mecanismo de geração usa o endpoint interno observado na Central. Ele permanece desativado por padrão porque esse endpoint não é uma API pública documentada.

## Arquivos locais

O worker mantém no perfil dedicado:

- `mavuri-discovery-state.json`: estado de produtos já observados;
- `mavuri-discovery-latest.json`: última coleta completa.

Por padrão:

`%LOCALAPPDATA%\\MavuriChromeProfile`

## Integração com o Mavuri Flow

A ponte de ingestão já foi preparada:

**Chrome Worker → página autenticada do Mavuri → flow-discovery-ingest → flow_offers → regras → delivery jobs → flow-worker → Telegram**

Quando `MAVURI_AUTO_INGEST=true`, o worker abre a aplicação do Mavuri no mesmo perfil dedicado e usa um bridge de `postMessage`. A própria aplicação autenticada chama a Edge Function com a sessão atual. O worker não lê nem transporta JWT, cookie ou senha.

Configuração:

```powershell
$env:MAVURI_AUTO_INGEST="true"
npm run browser:discover
```

Isso exige que o perfil dedicado do Chrome esteja autenticado no Mavuri. É uma configuração única; depois o fluxo pode ser automatizado.

O padrão continua desligado para permitir validar primeiro a coleta em modo seguro.

## Segurança e estabilidade

A Central de Afiliados usa endpoints internos/não documentados. A própria página oficial explica a geração de links e também limita quais páginas podem receber links de recomendação. Portanto, esta integração deve ser tratada como automação de navegador sujeita a mudanças da interface, não como API oficial estável.

A sessão permanece no Chrome local; senha, cookies e tokens não são enviados ao servidor Mavuri.
