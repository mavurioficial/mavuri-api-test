const APP_LOGIC = "2026.08.28.04";
const HUB_URL = "https://lista.mercadolivre.com.br/_Container_aff-hub-v2-mixed-topics-mlb";

function preview(text, size = 1200) {
  return text.length > size ? text.slice(0, size) + "..." : text;
}

function extractSummary(data) {
  const cards = data?.polycard_client_model?.polycards;
  if (!Array.isArray(cards)) return null;

  return cards.slice(0, 10).map((card) => {
    const components = Array.isArray(card.components) ? card.components : [];
    const title = components.find((c) => c.id === "title")?.title?.text || null;
    const price = components.find((c) => c.id === "price")?.price || {};
    const commission = components.find((c) => c.id === "affiliates_commission_chip");
    const commissionText = commission?.chip?.label?.text || commission?.chip?.pill?.text || null;
    const imageId = card?.pictures?.pictures?.[0]?.id || null;

    return {
      id: card?.metadata?.id || null,
      type: card?.metadata?.type || null,
      title,
      current_price: price?.current_price?.value ?? null,
      previous_price: price?.previous_price?.value ?? null,
      discount: price?.discount_label?.text || null,
      commission: commissionText,
      extra_commission: card?.metadata?.extra_commission || null,
      brand_commission: card?.metadata?.brand_commission || null,
      url: card?.metadata?.url || null,
      image_id: imageId
    };
  });
}

export default async function handler(req, res) {
  res.setHeader("Cache-Control", "no-store");

  try {
    const response = await fetch(HUB_URL, {
      method: "GET",
      headers: {
        Accept: "application/json,text/plain,*/*",
        "User-Agent": "Mavuri-API-Test/2026.08.28.04"
      }
    });

    const contentType = response.headers.get("content-type") || null;
    const text = await response.text();
    let json = null;
    let parseError = null;

    try {
      json = JSON.parse(text);
    } catch (error) {
      parseError = error?.message || String(error);
    }

    const cards = json?.polycard_client_model?.polycards;

    res.status(response.status).json({
      app_logic: APP_LOGIC,
      probe: "affiliate_hub_container",
      url: HUB_URL,
      status: response.status,
      ok: response.ok,
      content_type: contentType,
      response_length: text.length,
      json_parsed: Boolean(json),
      parse_error: parseError,
      card_count: Array.isArray(cards) ? cards.length : null,
      summary: extractSummary(json),
      response_preview: json ? null : preview(text),
      notes: "Teste isolado do container de afiliados encontrado na resposta real do Mercado Livre. A aplicação principal não foi alterada."
    });
  } catch (error) {
    res.status(500).json({
      app_logic: APP_LOGIC,
      probe: "affiliate_hub_container",
      url: HUB_URL,
      error: error?.message || String(error)
    });
  }
}
