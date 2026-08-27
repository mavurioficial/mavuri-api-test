const MeliApi = "https://api.mercadolibre.com";

function send(res, status, data) {
  res.status(status).json(data);
}

async function lerResposta(response) {
  const texto = await response.text();
  try {
    return JSON.parse(texto);
  } catch {
    return {
      message: texto || `Resposta HTTP ${response.status}`,
      raw_response: texto
    };
  }
}

function montarHeaders(req, incluirToken = false) {
  const headers = {
    Accept: "application/json"
  };

  // O token só é necessário nas rotas autenticadas. Enviá-lo para a busca
  // pública pode fazer a API do Mercado Livre rejeitar a chamada com 403.
  if (incluirToken && req.headers.authorization) {
    headers.Authorization = req.headers.authorization;
  }

  return headers;
}

export default async function handler(req, res) {
  try {
    const action = String(req.query?.action || "").toLowerCase();

    if (action === "me") {
      if (!req.headers.authorization) {
        return send(res, 401, {
          message: "Access Token não informado."
        });
      }

      const response = await fetch(`${MeliApi}/users/me`, {
        headers: montarHeaders(req, true)
      });
      const data = await lerResposta(response);
      return send(res, response.status, data);
    }

    if (action === "search") {
      const q = String(req.query?.q || "").trim();
      const requestedLimit = Number.parseInt(req.query?.limit || "20", 10);
      const limit = Math.min(
        Math.max(Number.isFinite(requestedLimit) ? requestedLimit : 20, 1),
        50
      );

      if (!q) {
        return send(res, 400, {
          message: "Informe o parâmetro q para buscar produtos."
        });
      }

      const url = new URL(`${MeliApi}/sites/MLB/search`);
      url.searchParams.set("q", q);
      url.searchParams.set("limit", String(limit));

      // A busca de produtos é pública. Não repassamos o token do usuário,
      // pois ele já foi validado separadamente em /users/me e pode causar 403.
      const response = await fetch(url, {
        headers: montarHeaders(req, false)
      });
      const data = await lerResposta(response);
      return send(res, response.status, data);
    }

    if (action === "categories") {
      const response = await fetch(`${MeliApi}/sites/MLB/categories`, {
        headers: montarHeaders(req, false)
      });

      const data = await lerResposta(response);
      return send(res, response.status, data);
    }

    return send(res, 400, {
      message: "Ação inválida.",
      actions: ["me", "search", "categories"]
    });
  } catch (error) {
    console.error("Erro no proxy Mercado Livre:", error);

    return send(res, 500, {
      message: "Erro interno ao consultar a API do Mercado Livre.",
      error: error instanceof Error ? error.message : String(error)
    });
  }
}
