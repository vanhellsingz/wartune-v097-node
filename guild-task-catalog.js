'use strict';
const fs=require('node:fs'),path=require('node:path');
const root=path.resolve(__dirname,'../res/release/config');
function load(prefix){const file=fs.readdirSync(root).find(name=>name.startsWith(prefix+'-')&&name.endsWith('.json'));return JSON.parse(fs.readFileSync(path.join(root,file),'utf8'))[prefix];}
const tasks=load('t_s_consortiatask');
const rewards=load('t_s_consortiataskreward');
module.exports={tasks,rewards};
