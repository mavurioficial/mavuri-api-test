const BB_API = 'https://api.browserbase.com/v1';
const PROJECT_ID = process.env.BROWSERBASE_PROJECT_ID || '';
const API_KEY = process.env.BROWSERBASE_API_KEY || '';
const CONTEXT_ID = process.env.MAVURI_BROWSERBASE_CONTEXT_ID || '';

const json = (res, body, status = 200) => {
  res.statusCode = status;
  res.setHeader('content-type','application/json; charset=utf-8');
  res.setHeader('cache-control','no-store');
  res.setHeader('access-control-allow-origin','*');
  res.setHeader('access-control-allow-methods','GET,OPTIONS');
  res.setHeader('access-control-allow-headers','content-type');
  res.end(JSON.stringify(body));
};

async function bb(path, options = {}) {
  const response = await fetch(BB_API + path, {...options, headers: {'accept':'application/json','content-type':'application/json','x-bb-api-key':API_KEY,...(options.headers || {})}});
  const text = await response.text(); let data = {};
  try { data = JSON.parse(text); } catch { data = { raw:text.slice(0,1000) }; }
  if (!response.ok) throw new Error(`Browserbase ${response.status}: ${JSON.stringify(data)}`);
  return data;
}

export default async function handler(req, res) {
  if (req.method === 'OPTIONS') return res.statusCode = 204, res.end();
  if (req.method !== 'GET') return json(res,{error:'Método não permitido.'},405);
  if (!API_KEY || !PROJECT_ID) return json(res,{error:'Browserbase ainda não configurado.',required_env:['BROWSERBASE_API_KEY','BROWSERBASE_PROJECT_ID']},503);
  try {
    let contextId = CONTEXT_ID || null; let contextCreated = false;
    if (!contextId) {
      const context = await bb('/contexts',{method:'POST',body:JSON.stringify({projectId:PROJECT_ID})});
      contextId = context.id; contextCreated = true;
    }
    const session = await bb('/sessions',{method:'POST',body:JSON.stringify({projectId:PROJECT_ID,browserSettings:{context:{id:contextId,persist:true}},timeout:900,keepAlive:true})});
    const debug = await bb(`/sessions/${encodeURIComponent(session.id)}/debug`);
    return json(res,{ok:true,purpose:'Mavuri Browser Worker POC — login manual',session_id:session.id,context_id:contextId,context_created:contextCreated,live_view_url:debug.debuggerFullscreenUrl || debug.debuggerUrl || null,expires_at:session.expiresAt || null,next_step:'Abra live_view_url, faça login no Mercado Livre e deixe a sessão aberta até o próximo passo.'});
  } catch(error) { return json(res,{error:'Falha ao iniciar Browserbase.',details:error.message},502); }
}
