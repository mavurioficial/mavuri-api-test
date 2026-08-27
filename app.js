const API_BASE = "https://mavuri-api-test.vercel.app/api/meli";
const APP_VERSION = "2026.08.27.04";
let accessToken = "";
const resultado = document.getElementById("resultado");

function mostrar(titulo, dados) {
  resultado.textContent = titulo + "\n\n" + JSON.stringify(dados, null, 2);
}

function mostrarErro(titulo, erro) {
  console.error(titulo, erro);
  mostrar(titulo, {
    nome: erro?.name || "Erro desconhecido",
    mensagem: erro?.message || String(erro),
    status: erro?.status || null,
    dados: erro?.data || null
  });
}

function obterToken() {
  if (!accessToken) accessToken = document.getElementById("token").value.trim();
  return accessToken;
}

function headersComToken() {
  const token = obterToken();
  return token ? { Authorization: "Bearer " + token } : {};
}

async function lerResposta(response) {
  const texto = await response.text();
  try {
    return JSON.parse(texto);
  } catch {
    return { resposta_texto: texto };
  }
}

async function chamarApi(path, options = {}) {
  const response = await fetch(API_BASE + path, { cache: "no-store", ...options });
  const data = await lerResposta(response);

  if (!response.ok) {
    const erro = new Error(data?.message || "A API retornou HTTP " + response.status);
    erro.name = "Erro da API";
    erro.status = response.status;
    erro.data = data;
    throw erro;
  }

  return data;
}

document.getElementById("salvarToken").addEventListener("click", () => {
  accessToken = document.getElementById("token").value.trim();

  if (!accessToken) {
    resultado.textContent = "ERRO: informe o Access Token.";
    return;
  }

  resultado.textContent = "TOKEN CARREGADO NESTA SESSÃO.\n\nAgora teste /users/me ou faça uma busca autenticada.";
});

document.getElementById("testarUsuario").addEventListener("click", async () => {
  const token = obterToken();

  if (!token) {
    resultado.textContent = "ERRO: informe primeiro o Access Token.";
    return;
  }

  resultado.textContent = "Consultando usuário autenticado pelo backend...";

  try {
    mostrar("AUTENTICAÇÃO FUNCIONANDO!", await chamarApi("?action=me", { headers: headersComToken() }));
  } catch (erro) {
    mostrarErro("ERRO AO TESTAR TOKEN", erro);
  }
});

document.getElementById("buscarProdutos").addEventListener("click", async () => {
  const busca = document.getElementById("busca").value.trim();
  if (!busca) {
    resultado.textContent = "Digite algo para pesquisar.";
    return;
  }
  resultado.textContent = "Buscando produtos e enriquecendo preços pelo backend...";
  try {
    const data = await chamarApi("?action=search&q=" + encodeURIComponent(busca) + "&limit=20", { headers: headersComToken() });
    const produtos = (data.results || []).map(item => ({
      id: item.id,
      titulo: item.title,
      preco: item.price,
      moeda: item.currency_id,
      preco_original: item.original_price,
      desconto: item.original_price && item.price ? Math.round((1 - item.price / item.original_price) * 100) + "%" : null,
      fonte_preco: item.price_source || null,
      link: item.permalink,
      imagem: item.thumbnail,
      frete_gratis: item.shipping?.free_shipping || false
    }));
    mostrar("RESULTADO DA BUSCA — APP " + APP_VERSION, {
      fonte_busca: data.search_source || null,
      total: data.paging,
      produtos
    });
  } catch (erro) {
    mostrarErro("ERRO AO BUSCAR PRODUTOS", erro);
  }
});

document.getElementById("diagnosticarBusca").addEventListener("click", async () => {
  const busca = document.getElementById("busca").value.trim() || "tv";
  resultado.textContent = "Comparando busca pública, autenticada e catálogo...";
  try {
    const data = await chamarApi("?action=diagnostic&q=" + encodeURIComponent(busca), { headers: headersComToken() });
    mostrar("DIAGNÓSTICO COMPARATIVO DA BUSCA — APP " + APP_VERSION, data);
  } catch (erro) {
    mostrarErro("ERRO NO DIAGNÓSTICO", erro);
  }
});

document.getElementById("testarCategorias").addEventListener("click", async () => {
  resultado.textContent = "Consultando categorias pelo backend...";
  try {
    mostrar("CATEGORIAS DO MERCADO LIVRE", await chamarApi("?action=categories", { headers: headersComToken() }));
  } catch (erro) {
    mostrarErro("ERRO AO CONSULTAR CATEGORIAS", erro);
  }
});
