export default function handler(req,res){
  res.setHeader("Cache-Control","no-store");
  res.status(200).json({
    service:"mavuri-api-test",
    serviceVersion:"2026.09.24.05",
    activeResolver:"/api/resolve6",
    resolverVersion:"2026.09.24.30",
    status:"active",
    purpose:"laboratório isolado do resolver usado pelo Mavuri Flow",
    note:"Endpoints históricos foram removidos. O fluxo principal usa apenas /api/resolve6; o resolver aplica timeout nas chamadas externas, limite básico por IP, validação estrita da URL e não depende de provedor externo opcional e exige segredo server-to-server para chamadas ao endpoint."
  });
}