const API_BASE = "https://mavuri-api-test.vercel.app/api/meli";
const DIAGNOSTIC_API_BASE = "https://mavuri-api-test.vercel.app/api/diagnostic";
const VERSION_API = "https://mavuri-api-test.vercel.app/api/version";
const APP_VERSION = "2026.08.28.03";
let accessToken = "";
const resultado = document.getElementById("resultado");
const versao = document.getElementById("versao");

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
  try { return JSON.parse(texto); }
  catch { return { resposta_texto: texto }; }
}

async function chamarUrl(url, options = {}) {
  const response = await fetch(url, { cache: "no-store", ...options });
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

async function chamarApi(path, options = {}) {
  return chamarUrl(API_BASE + path, options);
}

async function carregarVersaoApi() {
  try {
    const data = await chamarUrl(VERSION_API);
    versao.textContent = `APP ${APP_VERSION} · API ${data.version || "?"}`;
  } catch {
    versao.textContent = `APP ${APP_VERSION} · API indisponível`;
  }
}

document.getElementById("salvarToken").addEventListener("click", () => {
  accessToken = document.getElementById("token").value.trim();
  if (!accessToken) {
    resultado.textContent = "ERRO: informe o Access Token.";
    return;
  }
  resultado.textContent = "TOKEN CARREGADO NESTA SESSÃO.\n\nPróximo passo: clique em TESTAR /users/me para validar o token antes de buscar produtos.";
});

document.getElementById("testarUsuario").addEventListener("click", async () => {
  const token = obterToken();
  if (!token) {
    resultado.textContent = "ERRO: informe primeiro o Access Token.";
    return;
  }
  resultado.textContent = "Validando o Access Token pelo backend...";
  try {
    mostrar("AUTENTICAÇÃO FUNCIONANDO!", await chamarApi("?action=me", { headers: headersComToken() }));
  } catch (erro) {
    mostrarErro("TOKEN NÃO VALIDADO", erro);
  }
});

document.getElementById("buscarProdutos").addEventListener("click", async () => {
  const busca = document.getElementById("busca").value.trim();
  if (!busca) {
    resultado.textContent = "Digite algo para pesquisar.";
    return;
  }
  if (!obterToken()) {
    resultado.textContent = "INFORME E VALIDE O ACCESS TOKEN PRIMEIRO.\n\nO teste isolado confirmou que a busca pública da API do Mercado Livre está respondendo HTTP 403 a partir do backend Vercel. Agora vamos testar a rota autenticada.";
    return;
  }
  resultado.textContent = "Buscando com token autenticado e verificando anúncios reais e preços...";
  try {
    const data = await chamarApi("?action=search&q=" + encodeURIComponent(busca) + "&limit=20", { headers: headersComToken() });
    const produtos = (data.results || []).map(item => ({
      id: item.id,
      catalog_product_id: item.catalog_product_id || null,
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
    mostrar("RESULTADO DA BUSCA AUTENTICADA — APP " + APP_VERSION, {
      fonte_busca: data.search_source || null,
      total: data.paging,
      produtos
    });
  } catch (erro) {
    if (erro?.status === 401 || erro?.status === 403) {
      mostrar("BUSCA BLOQUEADA — DIAGNÓSTICO NECESSÁRIO", {
        status: erro.status,
        explicacao: "A busca pública já foi confirmada como bloqueada por HTTP 403. Agora precisamos verificar se este Access Token está válido e se possui acesso às rotas de busca.",
        resposta: erro.data || null,
        proximo_passo: "Clique em DIAGNOSTICAR BUSCA e envie o resultado."
      });
      return;
    }
    mostrarErro("ERRO AO BUSCAR PRODUTOS", erro);
  }
});

document.getElementById("diagnosticarBusca").addEventListener("click", async () => {
  const busca = document.getElementById("busca").value.trim() || "tv";
  resultado.textContent = "Executando diagnóstico v2026.08.28.03: busca autenticada, detalhes do catálogo, children_ids e buy_box_winner...";
  try {
    const data = await chamarUrl(DIAGNOSTIC_API_BASE + "?q=" + encodeURIComponent(busca), { headers: headersComToken() });
    mostrar("DIAGNÓSTICO COMPLETO + CATÁLOGO/CHILDREN/BUY BOX — APP " + APP_VERSION, data);
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

carregarVersaoApi();
