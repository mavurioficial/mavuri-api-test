export default function handler(req, res) {
  res.status(200).json({
    service: "mavuri-api-test",
    version: "2026.08.28.01",
    build: "isolated-authenticated-search-test",
    deployed_from: "main",
    public_search_status: "blocked-403-confirmed",
    next_test: "validate authenticated search with Mercado Livre access token"
  });
}
