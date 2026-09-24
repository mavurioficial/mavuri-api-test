const result=document.getElementById("resultado");
document.getElementById("testar").addEventListener("click",async()=>{
  const value=document.getElementById("url").value.trim();
  if(!value){result.textContent="Informe um link.";return}
  result.textContent="Resolvendo...";
  try{
    const response=await fetch("/api/resolve6?url="+encodeURIComponent(value),{cache:"no-store"});
    const text=await response.text();
    let data;try{data=JSON.parse(text)}catch{data={raw:text}}
    result.textContent=JSON.stringify({http_status:response.status,...data},null,2);
  }catch(error){
    result.textContent=JSON.stringify({erro:error?.message||String(error)},null,2);
  }
});