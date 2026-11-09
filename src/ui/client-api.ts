export async function api<T>(path:string,method='GET',data?:unknown):Promise<T>{
  const response=await fetch('/api/'+path,{method,credentials:'same-origin',...(data===undefined?{}:{headers:{'Content-Type':'application/json'},body:JSON.stringify(data)})})
  const result=await response.json()
  if(!response.ok)throw new Error(result.error||'Opération impossible. Réessayez.')
  return result
}
