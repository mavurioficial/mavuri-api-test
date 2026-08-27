const MeliApi = "https://api.mercadolibre.com";

function send(res, status, data) {
  res.status(status).json(data);
}

export default async function handler(req, res) {
  try {
    const action = String(req.query?.action || "").toLowerCase();

    if (action === "me") {
      const authorization = req.headers.authorization;

      if (!authorization) {
        return send(res, 401, {
          message: "Access Token não informado."
        });
      }

      const response = await fetch(`${MeliApi}/users/me`, {
        headers: {
          Authorization: authorization
        }
      });

      const data = await response.json();
      return send(res, response.status, data);
    }

    if (action === "search") {
      const q = String(req.query?.q || "").trim();

      const requestedLimit = Number.parseInt(
        req.query?.limit || "20",
        10
      );

      const limit = Math.min(
        Math.max(
          Number.isFinite(requestedLimit) ? requestedLimit : 20,
          1
        ),
        50
      );

      if (!q) {
        return send(res, 400, {
          message: "Informe o parâmetro q para buscar produtos."
        });
      }

      const url = new URL(
        `${MeliApi}/sites/MLB/search`
      );

      url.searchParams.set("q", q);
      url.searchParams.set("limit", String(limit));

      const response = await fetch(url);
      const data = await response.json();

      return send(res, response.status, data);
    }

    if (action === "categories") {
      const response = await fetch(
        `${MeliApi}/sites/MLB/categories`
      );

      const data = await response.json();

      return send(res, response.status, data);
    }

    return send(res, 400, {
      message: "Ação inválida.",
      actions: ["me", "search", "categories"]
    });

  } catch (error) {
    console.error(
      "Erro no proxy Mercado Livre:",
      error
    );

    return send(res, 500, {
      message:
        "Erro interno ao consultar a API do Mercado Livre.",
      error:
        error instanceof Error
          ? error.message
          : String(error)
    });
  }
}
