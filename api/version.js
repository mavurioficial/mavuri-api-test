export default function handler(req, res) {
  res.status(200).json({
    service: 'mavuri-api-test',
    version: '2026.08.27.03',
    build: 'meli-enrichment-check',
    deployed_from: 'main'
  });
}
