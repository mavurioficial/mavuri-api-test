export default function handler(req, res) {
  res.status(200).json({
    service: "mavuri-api-test",
    version: "2026.08.28.03",
    build: "catalog-children-buy-box-winner-probe",
    deployed_from: "main",
    public_search_status: "blocked-403-confirmed",
    authenticated_products_search_status: "working-200-confirmed",
    next_test: "traverse children_ids and probe buy_box_winner before changing normalized search"
  });
}
