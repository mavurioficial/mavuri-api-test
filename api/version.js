export default function handler(req, res) {
  res.status(200).json({
    service: "mavuri-api-test",
    version: "2026.08.28.02",
    build: "isolated-authenticated-search-payload-inspection",
    deployed_from: "main",
    public_search_status: "blocked-403-confirmed",
    authenticated_products_search_status: "working-200-confirmed",
    next_test: "inspect raw authenticated product payload before building normalized search"
  });
}
