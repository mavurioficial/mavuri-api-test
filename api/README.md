# Mavuri API — resolver interno

Este repositório mantém apenas a infraestrutura necessária para o resolver que continua sendo usado pelo Mavuri Flow.

## Componentes ativos

- `/api/resolve6` — resolver de links `meli.la`/Mercado Livre usado pelo Supabase `affiliate-resolver`.
- `/api/version` — health/version endpoint.

A página raiz é apenas informativa. Não existe mais um formulário de teste no navegador porque `/api/resolve6` exige autenticação server-to-server.

## Segurança

O resolver:
- exige `MAVURI_RESOLVER_SECRET` em produção;
- aceita apenas URLs HTTPS permitidas;
- valida o domínio após redirects;
- aplica timeout nas chamadas externas;
- aplica limite básico por IP;
- não recebe o token do Mercado Livre do usuário no endpoint.

Não versionar tokens, client secrets ou outras credenciais neste repositório.

## Arquitetura atual

```
Mavuri Flow
   |
   v
Supabase affiliate-resolver
   |
   | x-mavuri-resolver-secret
   v
Vercel /api/resolve6
   |
   +--> meli.la / Mercado Livre
   +--> dados públicos do anúncio
```

## Histórico removido

Foram retirados os endpoints que não possuem dependência no fluxo atual: `resolve3`, `resolve7`, `meli`, `meli2`, `debug`, `diagnostic`, `affiliates` e `freight`, além da antiga página OAuth.

O fluxo principal continua usando somente `/api/resolve6`.
