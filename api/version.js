export default function handler(req, res) {
  res.status(200).json({
    service: "mavuri-api-test",
    version: "2026.08.28.05",
    build: "affiliate-hub-browser-vs-server-probe",
    deployed_from: "main",
    public_search_status: "blocked-403-confirmed",
    authenticated_products_search_status: "working-200-confirmed",
    affiliate_hub_server_status: "blocked-by-suspicious-traffic-html-confirmed",
    next_test: "compare the same affiliate hub URL from the user's browser versus the Vercel backend, without sending the access token to the hub endpoint"
  });
}
