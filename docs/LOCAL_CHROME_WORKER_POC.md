# Mavuri Local Chrome Worker — POC

Esta POC testa a descoberta da Central de Afiliados usando um Chrome real no computador do usuário.

## Objetivo

Usar uma sessão normal do Chrome, com login manual no Mercado Livre, e então consultar a API interna da Central de Afiliados a partir da própria página autenticada.

O worker não envia senha, cookies, CSRF ou tokens para o Mavuri.

## Pré-requisitos

- Windows com Google Chrome.
- Node.js 24.
- Acesso ao repositório.
- Login normal no Mercado Livre.

## Execução

Abra um terminal dentro de `api/`:

```powershell
npm install
npm run browser:worker
```

O worker cria um perfil separado:

`%LOCALAPPDATA%\\MavuriChromeProfile`

e inicia o Chrome com uma porta CDP local.

Na primeira execução:

1. O Chrome dedicado será aberto.
2. O Mercado Livre será carregado.
3. Faça login normalmente.
4. Entre/aguarde a Central de Afiliados.
5. O worker detectará a sessão autenticada.
6. O worker executará o `/affiliate-program/api/hub/search`.
7. O terminal exibirá os primeiros produtos encontrados.

## Segurança

Não copie para o chat:

- senha;
- cookies;
- `x-csrf-token`;
- access token;
- refresh token;
- URL de sessão do Browserbase.

A sessão fica no perfil local do Chrome.

## Observação

Esta é uma POC técnica para validar o acesso à Central de Afiliados usando uma sessão web autenticada. O endpoint da Central é interno/não documentado pelo Mercado Livre; portanto, o resultado da POC não deve ser tratado como uma API oficial estável.

O objetivo imediato é verificar se a sessão real do Chrome consegue retornar HTTP 200 e os produtos da Central sem depender do Browserbase.
