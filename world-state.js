'use strict';
const fs=require('node:fs'),path=require('node:path'),zlib=require('node:zlib');
// Map 5's original .bin is a zlib-compressed AMF3 dynamic object of navigation cells.
function readTiles(file){
 const b=zlib.inflateSync(fs.readFileSync(file));let at=0;const strings=[];
 function u29(){let n=0;for(let i=0;i<3;i++){const v=b[at++];n=(n<<7)|(v&127);if(!(v&128))return n;}return(n<<8)|b[at++];}
 function str(){const h=u29();if(!(h&1))return strings[h>>1];const len=h>>1;if(!len)return '';const s=b.toString('utf8',at,at+len);at+=len;strings.push(s);return s;}
 if(b[at++]!==10||u29()!==11||str()!=='')throw Error('Unsupported original map navigation format');
 const cells=Object.create(null);let key;
 while((key=str())!==''){if(!/^\d+_\d+$/.test(key)||b[at++]!==4)throw Error('Invalid navigation cell');cells[key]=u29();}
 if(at!==b.length)throw Error('Trailing navigation data');return cells;
}
const file=path.resolve(__dirname,'../res/animation/maps/5/5-4d472f1b82.bin');
const tiles=readTiles(file);
function cell(x,y){let cx=x%500,cy=y%500;if(cx>=250){cx-=250;cy=cy>=250?cy-250:cy+250;}return tiles[cx+'_'+cy]||0;}
// L4.getStartPoint treats getWalkable()==true as an obstacle; this map stores blocked cells.
function valid(x,y){return Number.isInteger(x)&&Number.isInteger(y)&&x>=0&&y>=0&&x<1500&&y<1500&&cell(x,y)===0;}
function spawn(){
 // Development spawn: choose the walkable cell nearest the map centre, with a free 3x3 neighbourhood.
 let p;
 for(let radius=0;radius<250&&!p;radius++)for(let dx=-radius;dx<=radius&&!p;dx++)for(let dy=-radius;dy<=radius&&!p;dy++){
  const x=750+dx,y=750+dy;if([-1,0,1].every(ax=>[-1,0,1].every(ay=>valid(x+ax,y+ay))))p=[x,y];
 }
 if(!p)throw Error('No validated development spawn');return {mapId:5,x:p[0],y:p[1],source:path.basename(file)};
}
module.exports={readTiles,cell,valid,spawn};
