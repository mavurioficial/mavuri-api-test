import { chromium } from 'playwright-core';

const BB_API='https://api.browserbase.com/v1';
const PROJECT_ID=process.env.BROWSERBASE_PROJECT_ID||'';
const API_KEY=process.env.BROWSERBASE_API_KEY||'';

const json=(res,body,status=200)=>{
  res.statusCode=status;
  res.setHeader('content-type','application/json; charset=utf-8');
  res.setHeader('cache-control','no-store');
  res.setHeader('access-control-allow-origin','*');
  res.setHeader('access-control-allow-methods','GET,OPTIONS');
  res.setHeader('access-control-allow-headers','content-type');
  res.end(JSON.stringify(body));
};

async function bb(path,options={}) {
  const response=await fetch(BB_API+path,{...options,headers:{accept:'application/json','content-type':'application/json','x-bb-api-key':API_KEY,...(options.headers||{})}});
  const text=await response.text(); let data={}; try{data=JSON.parse(text)}catch{data={raw:text.slice(0,1000)}}
  if(!response.ok) throw new Error(`Browserbase ${response.status}: ${JSON.stringify(data)}`);
  return data;
}

async function findActiveContext(){
  const listed=await bb('/sessions');
  const sessions=Array.isArray(listed)?listed:(listed.sessions||listed.data||[]);
  const candidates=sessions
    .filter(s=>s?.projectId===PROJECT_ID && s?.contextId && !['COMPLETED','ERROR','TIMED_OUT','REQUEST_RELEASE'].includes(String(s.status||'').toUpperCase()))
    .sort((a,b)=>new Date(b.createdAt||0)-new Date(a.createdAt||0));
  if(!candidates.length) throw new Error('Nenhuma sessão Browserbase ativa com Context encontrado. Mantenha a sessão de login aberta e tente novamente.');
  return candidates[0];
}

function compactCard(card){
  const components=Object.values(card?.components||{});
  const title=components.find(c=>c?.type==='title')?.title?.text||null;
  const price=components.find(c=>c?.type==='price')?.price||null;
  const pictureId=card?.pictures?.pictures?.[0]?.id||null;
  const url=card?.metadata?.url?('https://'+card.metadata.url):null;
  return {id:card?.metadata?.id||card?.id||null,title,price_current:price?.current_price?.value??null,price_previous:price?.previous_price?.value??null,image:pictureId?(`https://http2.mlstatic.com/D_NQ_NP_2X_${pictureId}-O.jpg`):null,url};
}

export default async function handler(req,res){
  if(req.method==='OPTIONS') return res.statusCode=204, res.end();
  if(req.method!=='GET') return json(res,{error:'Método não permitido.'},405);
  if(!API_KEY||!PROJECT_ID) return json(res,{error:'Browserbase ainda não configurado.',required_env:['BROWSERBASE_API_KEY','BROWSERBASE_PROJECT_ID']},503);
  let browser;
  try{
    const requestedSessionId=String(req.query?.session_id||'').trim();
    const sourceSession=requestedSessionId ? {id:requestedSessionId,contextId:null} : await findActiveContext();
    const session=await bb(`/sessions/${encodeURIComponent(sourceSession.id)}`);
    const contextId=sourceSession.contextId || session.contextId || null;
    if(!session.connectUrl) throw new Error('Browserbase não retornou connectUrl para a sessão autenticada.');
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
    return json(res,{ok:result.status===200,session_id:sourceSession.id,source_context_id:contextId,page:pageInfo,hub_search_status:result.status,product_count:cards.length,products:cards.map(compactCard).filter(p=>p.title||p.url).slice(0,20),response_keys:result.payload?Object.keys(result.payload):[],note:result.status===401?'Sessão não autenticada ou Context sem login.':result.status===403?'Mercado Livre recusou a chamada interna do Hub.':result.status===200?'POC conseguiu consultar o Hub autenticado.':'Status inesperado no Hub.'});
  }catch(error){return json(res,{ok:false,error:'Falha na POC de descoberta.',details:error.message},502)}
  finally{try{await browser?.close()}catch{}}
}
