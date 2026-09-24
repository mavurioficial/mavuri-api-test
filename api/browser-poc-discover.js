import { chromium } from 'playwright-core';

const BB_API='https://api.browserbase.com/v1';
const PROJECT_ID=process.env.BROWSERBASE_PROJECT_ID||'';
const API_KEY=process.env.BROWSERBASE_API_KEY||'';
const CONTEXT_ID=process.env.MAVURI_BROWSERBASE_CONTEXT_ID||'';

const json=(body,status=200)=>new Response(JSON.stringify(body),{status,headers:{'content-type':'application/json; charset=utf-8','cache-control':'no-store','access-control-allow-origin':'*','access-control-allow-methods':'GET,OPTIONS','access-control-allow-headers':'content-type'}});

async function bb(path,options={}) {
  const response=await fetch(BB_API+path,{...options,headers:{accept:'application/json','content-type':'application/json','x-bb-api-key':API_KEY,...(options.headers||{})}});
  const text=await response.text(); let data={}; try{data=JSON.parse(text)}catch{data={raw:text.slice(0,1000)}}
  if(!response.ok) throw new Error(`Browserbase ${response.status}: ${JSON.stringify(data)}`);
  return data;
}

function compactCard(card){
  const components=Object.values(card?.components||{});
  const title=components.find(c=>c?.type==='title')?.title?.text||null;
  const price=components.find(c=>c?.type==='price')?.price||null;
  const pictureId=card?.pictures?.pictures?.[0]?.id||null;
  const url=card?.metadata?.url?('https://'+card.metadata.url):null;
  return {id:card?.metadata?.id||card?.id||null,title,price_current:price?.current_price?.value??null,price_previous:price?.previous_price?.value??null,image:pictureId?(`https://http2.mlstatic.com/D_NQ_NP_2X_${pictureId}-O.jpg`):null,url};
}

export default async function handler(req){
  if(req.method==='OPTIONS') return new Response(null,{status:204});
  if(req.method!=='GET') return json({error:'Método não permitido.'},405);
  if(!API_KEY||!PROJECT_ID||!CONTEXT_ID) return json({error:'Browserbase/Context ainda não configurado.',required_env:['BROWSERBASE_API_KEY','BROWSERBASE_PROJECT_ID','MAVURI_BROWSERBASE_CONTEXT_ID']},503);
  let browser;
  try{
    const session=await bb('/sessions',{method:'POST',body:JSON.stringify({projectId:PROJECT_ID,browserSettings:{context:{id:CONTEXT_ID,persist:true}},keepAlive:true})});
    browser=await chromium.connectOverCDP(session.connectUrl);
    const context=browser.contexts()[0];
    const page=context.pages()[0]||await context.newPage();
    await page.goto('https://www.mercadolivre.com.br/afiliados/hub?is_affiliate=true#menu-user',{waitUntil:'domcontentloaded',timeout:45000});
    await page.waitForTimeout(2500);
    const pageInfo={url:page.url(),title:await page.title()};
    const result=await page.evaluate(async()=>{
      const response=await fetch('/affiliate-program/api/hub/search?is_affiliate=true&device=desktop',{method:'POST',headers:{accept:'application/json','content-type':'application/json'},credentials:'include',body:JSON.stringify({search:'',sort:'relevance',filters:[],offset:0})});
      const text=await response.text(); let payload=null; try{payload=JSON.parse(text)}catch{}
      return {status:response.status,payload,raw:payload?null:text.slice(0,2000)};
    });
    const cards=result.payload?.polycard_client_model?.polycards||[];
    return json({ok:result.status===200,session_id:session.id,context_id:CONTEXT_ID,page:pageInfo,hub_search_status:result.status,product_count:cards.length,products:cards.map(compactCard).filter(p=>p.title||p.url).slice(0,20),response_keys:result.payload?Object.keys(result.payload):[],note:result.status===401?'Sessão não autenticada ou Context sem login.':result.status===403?'Mercado Livre recusou a chamada interna do Hub.':result.status===200?'POC conseguiu consultar o Hub autenticado.':'Status inesperado no Hub.'});
  }catch(error){return json({ok:false,error:'Falha na POC de descoberta.',details:error.message},502)}
  finally{try{await browser?.close()}catch{}}
}
