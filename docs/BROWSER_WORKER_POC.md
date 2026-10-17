# Mavuri Browser Worker — POC

Branch: `poc/browser-worker-2026-09-24`

Objetivo:
1. Criar um Context persistente no Browserbase.
2. Criar uma sessão remota.
3. Permitir login manual no Mercado Livre pelo Live View.
4. Reutilizar o Context em uma nova sessão.
5. Abrir a Central de Afiliados.
6. Testar a chamada interna `/affiliate-program/api/hub/search`.
7. Extrair uma amostra dos produtos.

Variáveis:
- `BROWSERBASE_API_KEY`
- `BROWSERBASE_PROJECT_ID`
- `MAVURI_BROWSERBASE_CONTEXT_ID` (preenchida depois da primeira chamada)

Endpoints:
- `/api/browser-poc-start`
- `/api/browser-poc-discover`

Cookies do Mercado Livre não são armazenados pelo Mavuri/Supabase.
