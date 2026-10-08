import http from 'node:http';
import { readFile } from 'node:fs/promises';
import { resolve, extname } from 'node:path';
import { Rooms, RoomError } from './rooms.mjs';
const root = resolve(import.meta.dirname, '..');
const port = Number(process.env.PORT || 3000);
const mime = { '.html': 'text/html; charset=utf-8', '.css': 'text/css', '.js': 'text/javascript', '.png': 'image/png', '.jpg': 'image/jpeg' };
const rooms = new Rooms();
function json(res,status,data){res.writeHead(status,{'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store','X-Content-Type-Options':'nosniff'});res.end(JSON.stringify(data));}
async function body(req) {
  if(!req.headers['content-type']?.startsWith('application/json'))throw new RoomError('JSON形式で送信してください。',415);
  let input='';for await(const chunk of req){input+=chunk;if(input.length>4096)throw new RoomError('リクエストが大きすぎます。',413);}
  try{const value=JSON.parse(input);if(!value||typeof value!=='object'||Array.isArray(value))throw new Error();return value;}catch{throw new RoomError('リクエストが無効です。');}
}
http.createServer(async (req, res) => {
  try {
    const pathname = decodeURIComponent(new URL(req.url, 'http://localhost').pathname);
    if(pathname.startsWith('/api/')) {
      if(req.method==='POST' && pathname==='/api/rooms'){json(res,201,rooms.create(await body(req)));return;}
      if(req.method==='POST' && pathname==='/api/join'){json(res,200,rooms.join(await body(req)));return;}
      const match=pathname.match(/^\/api\/rooms\/([A-Fa-f0-9]{6})(?:\/(action))?$/);
      if(!match)throw new RoomError('APIが見つかりません。',404);
      const token=req.headers.authorization?.replace(/^Bearer /,'');
      if(req.method==='GET' && !match[2]){json(res,200,rooms.snapshot(match[1],token));return;}
      if(req.method==='POST' && match[2]){json(res,200,rooms.command(match[1],token,await body(req)));return;}
      throw new RoomError('このメソッドは使用できません。',405);
    }
    const file = resolve(root, '.' + (pathname === '/' ? '/index.html' : pathname));
    if (!file.startsWith(root + '/') || !['/index.html', '/src/', '/images/'].some(p => pathname === p || (p.endsWith('/') && pathname.startsWith(p))) && pathname !== '/') { res.writeHead(404); res.end('Not found'); return; }
    const contents = await readFile(file);
    res.writeHead(200, { 'Content-Type': mime[extname(file)] || 'application/octet-stream', 'X-Content-Type-Options': 'nosniff', 'Cache-Control': extname(file)==='.png'?'public, max-age=3600':'no-cache' }); res.end(contents);
  } catch(e) { if(req.url.startsWith('/api/'))json(res,e.status||500,{error:e instanceof RoomError?e.message:'サーバーでエラーが発生しました。'});else{res.writeHead(404); res.end('Not found');} }
}).listen(port, '0.0.0.0', () => console.log(`Seven Vice: http://localhost:${port}`));
