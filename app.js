let accessToken = "";

const resultado = document.getElementById("resultado");

function mostrar(titulo, dados) {
  resultado.textContent =
    titulo + "\n\n" +
    JSON.stringify(dados, null, 2);
}

function mostrarErro(titulo, erro) {
  console.error(titulo, erro);

  const detalhes = {
    nome: erro?.name || "Erro desconhecido",
    mensagem: erro?.message || String(erro),
    status: erro?.status || null,
    dados: erro?.data || null,
    stack: erro?.stack || null
  };

  mostrar(titulo, detalhes);
}

function obterToken() {
  if (!accessToken) {
    accessToken = document
      .getElementById("token")
      .value
      .trim();
  }

  return accessToken;
}

async function lerResposta(response) {
  const texto = await response.text();

  try {
    return JSON.parse(texto);
  } catch {
    return {
      resposta_texto: texto
    };
  }
}


/* =========================================
   USAR TOKEN
========================================= */

document
  .getElementById("salvarToken")
  .addEventListener("click", () => {

    accessToken = document
      .getElementById("token")
      .value
      .trim();

    if (!accessToken) {
      resultado.textContent =
        "ERRO: informe o Access Token.";
      return;
    }

    resultado.textContent =
      "TOKEN CARREGADO COM SUCESSO.\n\n" +
      "Agora clique em TESTAR /users/me.";
  });


/* =========================================
   TESTAR USUÁRIO AUTENTICADO
========================================= */

document
  .getElementById("testarUsuario")
  .addEventListener("click", async () => {

    const token = obterToken();

    if (!token) {
      resultado.textContent =
        "ERRO: informe primeiro o Access Token.";
      return;
    }

    resultado.textContent =
      "Consultando usuário autenticado...";

    try {

      console.log("Iniciando teste /users/me");

      const response = await fetch(
        "https://api.mercadolibre.com/users/me",
        {
          method: "GET",
          headers: {
            "Authorization": "Bearer " + token,
            "Accept": "application/json"
          }
        }
      );

      const data = await lerResposta(response);

      console.log("Status:", response.status);
      console.log("Resposta:", data);

      if (!response.ok) {
        throw {
          name: "Erro da API",
          message: "A API retornou HTTP " + response.status,
          status: response.status,
          data: data
        };
      }

      mostrar(
        "AUTENTICAÇÃO FUNCIONANDO!",
        data
      );

    } catch (erro) {

      mostrarErro(
        "ERRO AO TESTAR TOKEN",
        erro
      );

    }

  });


/* =========================================
   BUSCAR PRODUTOS
========================================= */

document
  .getElementById("buscarProdutos")
  .addEventListener("click", async () => {

    const busca = document
      .getElementById("busca")
      .value
      .trim();

    if (!busca) {
      resultado.textContent =
        "Digite algo para pesquisar.";
      return;
    }

    resultado.textContent =
      "Buscando produtos...";

    try {

      const url =
        "https://api.mercadolibre.com/sites/MLB/search?q=" +
        encodeURIComponent(busca) +
        "&limit=20";

      console.log("URL:", url);

      const response = await fetch(url, {
        method: "GET",
        headers: {
          "Accept": "application/json"
        }
      });

      const data = await lerResposta(response);

      if (!response.ok) {
        throw {
          name: "Erro da API",
          message: "A API retornou HTTP " + response.status,
          status: response.status,
          data: data
        };
      }

      const produtos = data.results.map(item => ({
        id: item.id,
        titulo: item.title,
        preco: item.price,
        moeda: item.currency_id,
        preco_original: item.original_price,
        desconto: item.original_price
          ? Math.round(
              (1 - item.price / item.original_price) * 100
            ) + "%"
          : null,
        link: item.permalink,
        imagem: item.thumbnail,
        frete_gratis: item.shipping
          ? item.shipping.free_shipping
          : false
      }));

      mostrar(
        "RESULTADO DA BUSCA",
        {
          total: data.paging,
          produtos: produtos
        }
      );

    } catch (erro) {

      mostrarErro(
        "ERRO AO BUSCAR PRODUTOS",
        erro
      );

    }

  });


/* =========================================
   TESTAR CATEGORIAS
========================================= */

document
  .getElementById("testarCategorias")
  .addEventListener("click", async () => {

    resultado.textContent =
      "Consultando categorias...";

    try {

      const response = await fetch(
        "https://api.mercadolibre.com/sites/MLB/categories",
        {
          method: "GET",
          headers: {
            "Accept": "application/json"
          }
        }
      );

      const data = await lerResposta(response);

      if (!response.ok) {
        throw {
          name: "Erro da API",
          message: "A API retornou HTTP " + response.status,
          status: response.status,
          data: data
        };
      }

      mostrar(
        "CATEGORIAS DO MERCADO LIVRE",
        data
      );

    } catch (erro) {

      mostrarErro(
        "ERRO AO CONSULTAR CATEGORIAS",
        erro
      );

    }

  });
