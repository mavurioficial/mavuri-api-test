let accessToken = "";

const resultado = document.getElementById("resultado");

function mostrar(titulo, dados) {
  resultado.textContent =
    titulo + "\n\n" +
    JSON.stringify(dados, null, 2);
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

      const response = await fetch(
        "https://api.mercadolibre.com/users/me",
        {
          headers: {
            "Authorization": "Bearer " + token
          }
        }
      );

      const data = await response.json();

      if (!response.ok) {
        throw {
          status: response.status,
          data: data
        };
      }

      mostrar(
        "AUTENTICAÇÃO FUNCIONANDO!",
        data
      );

    } catch (erro) {

      mostrar(
        "ERRO AO TESTAR TOKEN",
        erro
      );

    }

  });


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

      const response = await fetch(url);

      const data = await response.json();

      if (!response.ok) {
        throw {
          status: response.status,
          data: data
        };
      }

      const produtos = data.results.map(item => ({
        id: item.id,
        titulo: item.title,
        preco: item.price,
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

      mostrar(
        "ERRO AO BUSCAR PRODUTOS",
        erro
      );

    }

  });


document
  .getElementById("testarCategorias")
  .addEventListener("click", async () => {

    resultado.textContent =
      "Consultando categorias...";

    try {

      const response = await fetch(
        "https://api.mercadolibre.com/sites/MLB/categories"
      );

      const data = await response.json();

      if (!response.ok) {
        throw {
          status: response.status,
          data: data
        };
      }

      mostrar(
        "CATEGORIAS DO MERCADO LIVRE",
        data
      );

    } catch (erro) {

      mostrar(
        "ERRO AO CONSULTAR CATEGORIAS",
        erro
      );

    }

  });
