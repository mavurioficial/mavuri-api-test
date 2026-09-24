export default function handler(req,res){
  res.setHeader("Cache-Control","no-store");
  res.status(200).json({
    service:"mavuri-api-test",
    serviceVersion:"2026.09.24.03",
    activeResolver:"/api/resolve6",
    resolverVersion:"2026.09.24.29",
    status:"active",
    purpose:"laboratório isolado do resolver usado pelo Mavuri Flow",
    note:"Endpoints históricos foram removidos. O fluxo principal usa apenas /api/resolve6; o resolver agora aplica timeout nas chamadas externas e não depende de provedor externo opcional."
  });
}