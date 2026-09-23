const ALLOWED_ORIGINS=new Set(['https://mavurioficial.github.io','https://mavuri-api-test.vercel.app']);
const RESOLVER_VERSION='2026.09.23.06';
function cors(req,res){const o=req.headers.origin||'';if(ALLOWED_ORIGINS.has(o)){res.setHeader('Access-Control-Allow-Origin',o);res.setHeader('Vary','Origin')}res.setHeader('Access-Control-Allow-Methods','GET,OPTIONS');res.setHeader('Access-Control-Allow-Headers','Content-Type')}
function clean(v){return String(v||'').replace(/\\u002F/gi,'/').replace(/\\\//g,'/').replace(/&amp;/g,'&').trim()}
function ml(v){try{const h=new URL(v).hostname.toLowerCase();return h==='mercadolivre.com.br'||h.endsWith('.mercadolivre.com.br')||h==='meli.la'}catch{return false}}
function productUrl(v){return ml(v)&&/(?:\/p\/MLB\d+|\/up\/MLB[A-Z0-9_-]*\d+)/i.test(String(v||''))}
function productId(v){const s=String(v||'');return s.match(/(?:item_id(?:%3A|:|=)|wid(?:%3A|:|=))(MLB\d+)/i)?.[1]?.toUpperCase()||s.match(/\/p\/(MLB\d+)/i)?.[1]?.toUpperCase()||s.match(/(?:^|[^A-Z])((?:MLB)\d{6,})(?:[^0-9]|$)/i)?.[1]?.toUpperCase()||''}
function unwrap(v){try{const u=new URL(v);if(!/\/gz\/account-verification/i.test(u.pathname))return null;const go=clean(u.searchParams.get('go'));return productUrl(go)?go:null}catch{return null}}
function first(...a){for(const v of a.flat(Infinity)){const s=String(v??'').trim();if(s)return s}return ''}
function number(v){if(v===null||v===undefined||v==='')return null;if(typeof v==='number')return Number.isFinite(v)?v:null;const n=Number(String(v).replace(/[^0-9,.-]/g,'').replace(/\.(?=\d{3}(?:\D|$))/g,'').replace(',','.'));return Number.isFinite(n)?n:null}
function norm(v){return String(v||'').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g,'').replace(/[^a-z0-9]+/g,' ').trim()}
function score(a,b){const x=new Set(norm(a).split(' ').filter(Boolean)),y=new Set(norm(b).split(' ').filter(Boolean));if(!x.size||!y.size)return 0;let n=0;for(const w of x)if(y.has(w))n++;return n/Math.max(x.size,y.size)}
function meta(html,names){for(const name of names){const e=name.replace(/[.*+?^${}()|[\]\\]/g,'\\$&');for(const p of [new RegExp(`<meta[^>]+(?:property|name)=[\"']${e}[\"'][^>]+content=[\"']([^\"']*)[\"'][^>]*>`,'i'),new RegExp(`<meta[^>]+content=[\"']([^\"']*)[\"'][^>]+(?:property|name)=[\"']${e}[\"'][^>]*>`,'i')]){const m=String(html||'').match(p);if(m?.[1])return m[1].replace(/&quot;/g,'"').replace(/&amp;/g,'&').trim()}}return ''}
function jsonBlocks(html){const out=[];const s=String(html||'');for(const m of s.matchAll(/<script[^>]+type=[\"']application\/(?:ld\+json|json)[\"'][^>]*>([\s\S]*?)<\/script>/gi)){try{out.push(JSON.parse(m[1].trim()))}catch{}}return out}
function walk(v,fn,seen=new Set()){if(!v||typeof v!=='object'||seen.has(v))return;seen.add(v);fn(v);if(Array.isArray(v))for(const x of v)walk(x,fn,seen);else for(const x of Object.values(v))walk(x,fn,seen)}
function findProductUrl(html,base){
  const source=String(html||'').replace(/\\\//g,'/').replace(/\\u002F/gi,'/');
  const patterns=[
    new RegExp("https?://[^\"'<>\\s]+?/(?:p/MLB\\d+|up/MLB[A-Z0-9_-]*\\d+)[^\"'<>\\s]*","gi"),
    new RegExp("(?:href|data-href|data-url|url)=[\"']([^\"']*/(?:p/MLB\\d+|up/MLB[A-Z0-9_-]*\\d+)[^\"']*)[\"']","gi")
  ];
  for(const pattern of patterns){
    for(const match of source.matchAll(pattern)){
      try{
        const raw=clean(match[1]||match[0]).replace(/\\\\/g,'');
        const url=new URL(raw,base).toString();
        if(productUrl(url)) return url;
      }catch{}
    }
  }
  const ids=[...source.matchAll(/\bMLB\d{6,}\b/gi)].map(m=>m[0].toUpperCase());
  const id=[...new Set(ids)][0];
  return id ? 'https://www.mercadolivre.com.br/p/'+id : null;
}
async function get(url,headers={}){try{const r=await fetch(url,{redirect:'follow',cache:'no-store',headers});return r}catch{return null}}
async function json(url){try{const r=await get(url,{accept:'application/json','accept-language':'pt-BR,pt;q=0.9','user-agent':'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/126 Safari/537.36'});if(!r||!r.ok)return null;return await r.json()}catch{return null}}
function pageProduct(html,id,url){
  const objs=jsonBlocks(html),p=objs.flatMap(x=>Array.isArray(x)?x:Array.isArray(x?.['@graph'])?x['@graph']:[x]).find(x=>x?.['@type']==='Product'||Array.isArray(x?.['@type'])&&x['@type'].includes('Product'))||{},o=Array.isArray(p.offers)?p.offers[0]:(p.offers||{});
  const slug=String(new URL(url).pathname.split('/').filter(Boolean)[0]||'').replace(/[-_]+/g,' ').trim();
  const genericPrice=html.match(/R\\$\\s*([0-9]{1,3}(?:\\.[0-9]{3})*,[0-9]{2})/i)?.[1]||html.match(/([0-9]{1,3}(?:\\.[0-9]{3})*,[0-9]{2})/i)?.[1]||null;
  return{id,url,title:first(p.name,meta(html,['og:title','twitter:title']).replace(/\\s*\\|\\s*Mercado Livre.*$/i,''),slug.replace(/\\bUp\\b/i,'')),category:'',image:first(Array.isArray(p.image)?p.image[0]:p.image,meta(html,['og:image','twitter:image'])),price:number(o.price)??number(meta(html,['product:price:amount','og:price:amount']))??number(genericPrice),previousPrice:null,installments:null,installmentAmount:null,currency:first(o.priceCurrency,meta(html,['product:price:currency','og:price:currency']),'BRL'),source:'page-html'}}
function searchObjectData(html,query){const candidates=[];for(const b of jsonBlocks(html))walk(b,node=>{const title=first(node.title,node.name,node.productName,node.itemName);if(!title)return;const permalink=first(node.permalink,node.url,node.link,node.item?.permalink,node.product?.permalink);const price=number(node.price,node.current_price,node.currentPrice,node.sale_price,node.salePrice,node.item?.price,node.product?.price,node.offers?.price,Array.isArray(node.offers)?node.offers[0]?.price:null);if(price!==null||permalink)candidates.push({title,permalink,price,previousPrice:number(node.original_price,node.originalPrice,node.list_price,node.regular_price,node.item?.original_price,node.offers?.highPrice),installments:number(node.installments?.quantity,node.installments_count,node.installmentQuantity,node.item?.installments?.quantity),installmentAmount:number(node.installments?.amount,node.installment_amount,node.item?.installments?.amount),image:first(node.thumbnail,node.secure_thumbnail,node.image,node.picture,node.item?.thumbnail,node.product?.pictures?.[0]?.url),category:first(node.category_id,node.categoryId,node.item?.category_id),score:score(query,title)})});candidates.sort((a,b)=>b.score-a.score);return candidates[0]&&candidates[0].score>=0.72?candidates[0]:null}
async function enrich(product,id,query,authorization){
  // Prefer the user's authenticated Mercado Livre connection through Supabase.
  // This reuses the same token/refresh infrastructure already used by the offers function.
  if(authorization){
    try{
      const u=new URL('https://otikoxnfotyjgphrdudn.supabase.co/functions/v1/offers');
      u.searchParams.set('action','item');
      u.searchParams.set('id',id);
      const r=await fetch(u.toString(),{headers:{accept:'application/json',authorization}});
      if(r.ok){
        const item=await r.json();
        product.itemId=first(item.id,id).toUpperCase();
        product.title=first(product.title,item.title);
        product.category=first(product.category,item.category_id);
        product.price=number(item.price)??product.price;
        product.previousPrice=number(item.original_price)??product.previousPrice;
        product.currency=first(item.currency_id,product.currency,'BRL');
        product.image=first(product.image,item.secure_thumbnail,item.thumbnail,item.pictures?.[0]?.url);
        product.installments=number(item.installments?.quantity)??product.installments;
        product.installmentAmount=number(item.installments?.amount)??product.installmentAmount;
        product.source='mercadolivre-authenticated-item';
      }
    }catch{}
  }
  const catalog=await json(`https://api.mercadolibre.com/products/${encodeURIComponent(id)}`);
  if(catalog){
    product.title=first(product.title,catalog.name,catalog.family_name);
    product.category=first(product.category,catalog.category_id,catalog.domain_id);
    product.image=first(product.image,catalog.pictures?.[0]?.secure_url,catalog.pictures?.[0]?.url);
    const w=catalog.buy_box_winner;
    if(w?.item_id){product.itemId=String(w.item_id).toUpperCase();product.price=number(w.price)??product.price;product.previousPrice=number(w.original_price)??product.previousPrice;product.currency=first(w.currency_id,product.currency,'BRL')}
  }
  if((!product.itemId || product.price === null || product.price <= 0) && query){
    const search=await json(`https://api.mercadolibre.com/sites/MLB/search?q=${encodeURIComponent(query)}&limit=20`);
    const results=Array.isArray(search?.results)?search.results:[];
    const exactCatalog=results.find(x=>String(x?.catalog_product_id||'').toUpperCase()===String(id||'').toUpperCase());
    const ranked=results.map(x=>({...x,_score:score(query,x?.title||'')})).sort((a,b)=>b._score-a._score);
    const exactTitle=ranked.find(x=>x._score>=0.72);
    const candidate=exactCatalog||exactTitle;
    if(candidate){
      product.itemId=first(candidate.id,candidate.item_id,product.itemId).toUpperCase();
      product.title=first(product.title,candidate.title);
      product.category=first(product.category,candidate.category_id);
      product.price=number(candidate.price)??product.price;
      product.previousPrice=number(candidate.original_price)??product.previousPrice;
      product.currency=first(candidate.currency_id,product.currency,'BRL');
      product.image=first(product.image,candidate.thumbnail,candidate.secure_thumbnail);
      product.installments=number(candidate.installments?.quantity)??product.installments;
      product.installmentAmount=number(candidate.installments?.amount)??product.installmentAmount;
      product.source='mercadolivre-api-search';
    }
  }
  if(product.itemId){
    const item=await json(`https://api.mercadolibre.com/items/${encodeURIComponent(product.itemId)}`);
    if(item){product.title=first(product.title,item.title);product.category=first(product.category,item.category_id);product.price=number(item.price)??product.price;product.previousPrice=number(item.original_price)??product.previousPrice;product.currency=first(item.currency_id,product.currency,'BRL');product.image=first(product.image,item.secure_thumbnail,item.thumbnail);product.installments=number(item.installments?.quantity)??product.installments;product.installmentAmount=number(item.installments?.amount)??product.installmentAmount}
  }
  if(!product.itemId&&query){const u='https://lista.mercadolivre.com.br/'+encodeURIComponent(query.replace(/\s+/g,'-'));const r=await get(u,{'user-agent':'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/126 Safari/537.36','accept-language':'pt-BR,pt;q=0.9'});if(r?.ok){const h=await r.text(),found=searchObjectData(h,query);if(found){product.title=first(product.title,found.title);product.price=number(found.price)??product.price;product.previousPrice=number(found.previousPrice)??product.previousPrice;product.installments=number(found.installments)??product.installments;product.installmentAmount=number(found.installmentAmount)??product.installmentAmount;product.image=first(product.image,found.image);product.category=first(product.category,found.category);product.productSearchUrl=u;product.source='mercadolivre-search-html-exact-title'}}}
    if(product.itemId){const sale=await json(`https://api.mercadolibre.com/items/${encodeURIComponent(product.itemId)}/sale_price?context=channel_marketplace`);if(sale){product.price=number(sale.amount)??product.price;product.previousPrice=number(sale.regular_amount)??product.previousPrice}}
  product.discount=product.price&&product.previousPrice&&product.previousPrice>product.price?Math.round((product.previousPrice-product.price)/product.previousPrice*100):null;return product;
}
export default async function handler(req,res){cors(req,res);if(req.method==='OPTIONS')return res.status(204).end();if(req.method!=='GET')return res.status(405).json({message:'Método não permitido.'});const affiliateUrl=clean(req.query?.url);if(!affiliateUrl)return res.status(400).json({message:'Informe o parâmetro url.'});let parsed;try{parsed=new URL(affiliateUrl)}catch{return res.status(400).json({message:'URL inválida.'})}if(!ml(parsed.toString()))return res.status(400).json({message:'Somente links do Mercado Livre e meli.la são aceitos.'});try{const firstResponse=await get(parsed.toString(),{'user-agent':'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/126 Safari/537.36','accept-language':'pt-BR,pt;q=0.9'});const socialUrl=firstResponse?.url||parsed.toString();const firstHtml=await firstResponse?.text();const located=findProductUrl(socialUrl,socialUrl)||findProductUrl(firstHtml,socialUrl);if(!located)return res.status(200).json({ok:false,affiliateUrl:parsed.toString(),socialUrl,productUrl:null,productId:null,resolverVersion:RESOLVER_VERSION,message:'Anúncio não localizado.'});const productResponse=await get(located,{'user-agent':'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/126 Safari/537.36','accept-language':'pt-BR,pt;q=0.9'});const redirected=productResponse?.url||located,verification=unwrap(redirected),finalUrl=verification|| (productUrl(redirected)?redirected:located),id=productId(finalUrl)||productId(located);let html='';try{html=await productResponse.text()}catch{}const product=pageProduct(html,id,finalUrl);const slugQuery=String(new URL(finalUrl).pathname.split('/').filter(Boolean)[0]||'').replace(/[-_]+/g,' ').trim();let query=slugQuery||id||'';const authorization=req.headers.authorization||'';const debug=req.query?.debug==='1';let debugInfo=null;if(debug){const upper=String(firstHtml||'').toUpperCase();const markerIndex=upper.indexOf(String(id||'').toUpperCase());const window=markerIndex>=0?String(firstHtml).slice(Math.max(0,markerIndex-2500),Math.min(String(firstHtml).length,markerIndex+9000)):String(firstHtml||'').slice(0,12000);debugInfo={firstHtmlLength:String(firstHtml||'').length,markerIndex,moneyMatches:[...window.matchAll(/(?:R\\$|data-andes-money-amount-fraction|aria-label=)[^<]{0,180}/gi)].slice(0,30).map(m=>m[0]),globalMoneyMatches:[...String(firstHtml||'').matchAll(/R\\$[^<]{0,100}/gi)].slice(0,50).map(m=>m[0])}};await enrich(product,id,query,authorization);product.id=id;product.url=finalUrl;const has=Boolean(product.title||product.price!==null||product.image);return res.status(200).json({ok:true,affiliateUrl:parsed.toString(),socialUrl,productUrl:finalUrl,productId:id,product,resolverVersion:RESOLVER_VERSION,verificationBypassed:Boolean(verification),catalogEnrichment:true,itemId:product.itemId||null,message:has?'Anúncio real localizado e dados preenchidos.':'Anúncio real localizado, mas os dados ainda não foram encontrados.',debug:debugInfo})}catch(e){return res.status(502).json({ok:false,affiliateUrl:parsed.toString(),resolverVersion:RESOLVER_VERSION,message:'Erro ao resolver anúncio.',error:String(e?.message||e)})}}