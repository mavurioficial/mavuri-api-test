export default function handler(req, res) {
  res.status(200).json({
    service: "mavuri-api-test",
    version: "2026.08.28.04",
    build: "affiliate-hub-container-probe",
    deployed_from: "main",
    public_search_status: "blocked-403-confirmed",
    authenticated_products_search_status: "working-200-confirmed",
    next_test: "probe the real affiliate hub container that returned product cards with price, discount, commission and affiliate links"
  });
}
