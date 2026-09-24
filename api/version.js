export default function handler(req,res){
  res.setHeader("Cache-Control","no-store");
  res.status(200).json({
    service:"mavuri-api-test",
    serviceVersion:"2026.09.24.06",
    activeResolver:"/api/resolve6",
    resolverVersion:"2026.09.24.30",
    status:"active",
    purpose:"serviço interno do resolver usado pelo Mavuri Flow",
    note:"Endpoints históricos foram removidos. O fluxo principal usa apenas /api/resolve6; o resolver aplica timeout nas chamadas externas, limite básico por IP, validação estrita da URL, validação do destino após redirects e segredo server-to-server."
  });
}
