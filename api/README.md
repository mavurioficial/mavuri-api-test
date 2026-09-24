# Mavuri API — laboratório do resolver

Este repositório deixou de ser um conjunto de protótipos da API do Mercado Livre e agora mantém apenas a infraestrutura necessária para o resolver histórico que continua sendo usado pelo Mavuri Flow.

## Componente ativo

- `/api/resolve6` — resolver de links `meli.la`/Mercado Livre usado pelo Supabase `affiliate-resolver`.
- `/api/version` — health/version endpoint do laboratório.
- `index.html` + `app.js` — página simples para testes manuais do resolver.

O Mavuri principal não depende dos antigos endpoints de busca, diagnóstico, frete ou versões anteriores do resolver.

## Segurança

O resolver aceita apenas URLs de entrada nos domínios do Mercado Livre/`meli.la` e valida também o domínio após redirects antes de continuar o processamento. Isso evita que um link aceito inicialmente redirecione o backend para um destino externo.

Não versionar tokens, client secrets ou outras credenciais neste repositório.

## Arquitetura atual

```
Mavuri Flow
   |
   v
Supabase affiliate-resolver
   |
   v
Vercel /api/resolve6
   |
   +--> meli.la / Mercado Livre
   +--> dados públicos do anúncio
   +--> APIs públicas/autenticadas quando disponíveis
```

## Histórico removido

Foram retirados os endpoints que não possuem dependência no fluxo atual: `resolve3`, `resolve7`, `meli`, `meli2`, `debug`, `diagnostic`, `affiliates` e `freight`, além da antiga página OAuth. A remoção foi feita depois de verificar o tráfego recente da implantação: nos últimos 7 dias, o Vercel registrou chamadas para `/api/resolve6`, `/api/version` e uma chamada isolada de `/api/resolve7` durante a investigação; não houve tráfego observado nos demais endpoints.

A página raiz continua propositalmente simples para permitir testes sem expor token do Mercado Livre.
