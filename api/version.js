export default function handler(req,res){
  res.setHeader("Cache-Control","no-store");
  res.status(200).json({
    service:"mavuri-api-test",
    serviceVersion:"2026.09.24.01",
    activeResolver:"/api/resolve6",
    resolverVersion:"2026.09.23.27",
    status:"active",
    purpose:"laboratório isolado do resolver usado pelo Mavuri Flow",
    note:"Endpoints históricos de busca, diagnóstico, frete e resolvers anteriores foram removidos após confirmação de que o fluxo principal usa apenas /api/resolve6."
  });
}