document.getElementById("testar").addEventListener("click", async () => {

  const resultado = document.getElementById("resultado");

  resultado.textContent = "Consultando a API do Mercado Livre...";

  try {

    const response = await fetch(
      "https://api.mercadolibre.com/sites/MLB/categories"
    );

    if (!response.ok) {
      throw new Error(
        `Erro HTTP: ${response.status}`
      );
    }

    const data = await response.json();

    resultado.textContent =
      JSON.stringify(data, null, 2);

  } catch (erro) {

    resultado.textContent =
      "ERRO AO CONSULTAR API:\n\n" + erro.message;

  }

});
