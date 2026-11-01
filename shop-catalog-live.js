'use strict';
const fs=require('node:fs');
const path=require('node:path');
const root=path.resolve(__dirname,'../res/release/config');
const filename=fs.readdirSync(root).find(name=>/^t_s_shop-[a-f0-9]+\.json$/i.test(name));
if(!filename)throw Error('Catalogo t_s_shop original ausente');
const original=JSON.parse(fs.readFileSync(path.join(root,filename),'utf8')).t_s_shop;
if(!Array.isArray(original))throw Error('Catalogo t_s_shop invalido');
async function liveCatalog(pool){
 const [rows]=await pool.query(`SELECT s.*,COALESCE(c.enabled,1) AS admin_enabled
   FROM t_s_shop s LEFT JOIN shop_product_controls c ON c.good_id=s.Id`);
 const goods=new Map(original.map(row=>[Number(row.Id),row]));
 for(const row of rows){
   const id=Number(row.Id),enabled=Number(row.admin_enabled);
   if(enabled!==1){goods.delete(id);continue;}
   delete row.admin_enabled;
   goods.set(id,{...(goods.get(id)||{}),...row});
 }
 return {t_s_shop:[...goods.values()].sort((a,b)=>Number(a.Id)-Number(b.Id))};
}
module.exports={liveCatalog,filename};
