export default async function handler(req,res){
  const q=String(req.query?.q||'penteadeira luna com kit luz espelho camarim 7 gavetas');
  const urls=[
    'https://api.mercadolibre.com/sites/MLB/search?q='+encodeURIComponent(q)+'&limit=20',
    'https://lista.mercadolivre.com.br/'+encodeURIComponent(q.replace(/\s+/g,'-'))
  ];
  const out=[];
  for(const url of urls){
    try{
      const r=await fetch(url,{redirect:'follow',headers:{accept:'text/html,application/json','accept-language':'pt-BR,pt;q=0.9','user-agent':'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/153 Safari/537.36'}});
      const text=await r.text();
      out.push({url,status:r.status,final:r.url,contentType:r.headers.get('content-type'),length:text.length,hasItem:text.includes('MLB4986981013'),prices:[...text.matchAll(/R\\$\\s*([0-9]{1,3}(?:\\.[0-9]{3})*,[0-9]{2})/g)].slice(0,10).map(m=>m[1]),snippet:text.slice(0,1000)});
    }catch(e){out.push({url,error:String(e?.message||e)})}
  }
  res.status(200).json(out);
}