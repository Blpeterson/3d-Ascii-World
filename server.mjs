import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { extname, join, normalize } from "node:path";
import { fileURLToPath } from "node:url";
import { createHash, randomUUID } from "node:crypto";
import { networkInterfaces } from "node:os";

const root=fileURLToPath(new URL(".",import.meta.url));
const port=Number(process.env.PORT)||8000;
const host=process.env.HOST||"0.0.0.0";
const types={ ".html":"text/html", ".js":"text/javascript", ".css":"text/css" };
const clients=new Map();
const latestStates=new Map();
let nextSpawn=0;

function frame(payload,opcode=1) {
  const body=Buffer.isBuffer(payload)?payload:Buffer.from(payload);
  let header;
  if (body.length<126) { header=Buffer.alloc(2); header[1]=body.length; }
  else if (body.length<65536) { header=Buffer.alloc(4); header[1]=126; header.writeUInt16BE(body.length,2); }
  else { header=Buffer.alloc(10); header[1]=127; header.writeBigUInt64BE(BigInt(body.length),2); }
  header[0]=0x80|opcode;
  return Buffer.concat([header,body]);
}

function send(socket,message) {
  if (!socket.destroyed&&socket.writable) socket.write(frame(JSON.stringify(message)));
}

function broadcast(message,except=null) {
  const packet=frame(JSON.stringify(message));
  for (const socket of clients.keys()) if (socket!==except&&!socket.destroyed&&socket.writable) socket.write(packet);
}

function disconnect(socket) {
  const client=clients.get(socket);
  if (!client) return;
  clients.delete(socket); latestStates.delete(client.id);
  broadcast({type:"leave",id:client.id});
}

function receive(socket,chunk) {
  const client=clients.get(socket);
  if (!client) return;
  client.buffer=Buffer.concat([client.buffer,chunk]);
  while (client.buffer.length>=2) {
    const first=client.buffer[0], second=client.buffer[1];
    let length=second&0x7f, offset=2;
    if (length===126) { if (client.buffer.length<4) return; length=client.buffer.readUInt16BE(2); offset=4; }
    else if (length===127) {
      if (client.buffer.length<10) return;
      const wide=client.buffer.readBigUInt64BE(2);
      if (wide>65536n) { socket.destroy(); return; }
      length=Number(wide); offset=10;
    }
    const masked=(second&0x80)!==0;
    if (!masked||length>65536) { socket.destroy(); return; }
    if (client.buffer.length<offset+4+length) return;
    const mask=client.buffer.subarray(offset,offset+4); offset+=4;
    const payload=Buffer.from(client.buffer.subarray(offset,offset+length));
    client.buffer=client.buffer.subarray(offset+length);
    for (let i=0;i<payload.length;i++) payload[i]^=mask[i&3];
    const opcode=first&0x0f;
    if (opcode===8) { socket.end(frame("",8)); return; }
    if (opcode===9) { socket.write(frame(payload,10)); continue; }
    if (opcode!==1) continue;
    try {
      const message=JSON.parse(payload.toString("utf8"));
      if (message?.type!=="state"||typeof message.state!=="object") continue;
      const state={type:"state",id:client.id,state:message.state};
      latestStates.set(client.id,state); broadcast(state,socket);
    } catch { /* Ignore malformed client packets. */ }
  }
}

const server=createServer(async (request,response) => {
  try {
    const requested=request.url==="/"?"index.html":decodeURIComponent(request.url.split("?")[0].slice(1));
    const path=normalize(join(root,requested));
    if (!path.startsWith(root)) throw new Error("Invalid path");
    const body=await readFile(path);
    response.writeHead(200,{"Content-Type":`${types[extname(path)]||"application/octet-stream"}; charset=utf-8`,"Cache-Control":"no-store"});
    response.end(body);
  } catch { response.writeHead(404); response.end("Not found"); }
});

server.on("upgrade",(request,socket) => {
  if (request.url!=="/ws"||request.headers.upgrade?.toLowerCase()!=="websocket"||!request.headers["sec-websocket-key"]) { socket.destroy(); return; }
  const accept=createHash("sha1").update(request.headers["sec-websocket-key"]+"258EAFA5-E914-47DA-95CA-C5AB0DC85B11").digest("base64");
  socket.write("HTTP/1.1 101 Switching Protocols\r\nUpgrade: websocket\r\nConnection: Upgrade\r\nSec-WebSocket-Accept: "+accept+"\r\n\r\n");
  socket.setNoDelay(true);
  const id=randomUUID().slice(0,8);
  const client={id,spawnIndex:nextSpawn++,buffer:Buffer.alloc(0)};
  clients.set(socket,client);
  send(socket,{type:"welcome",id,spawnIndex:client.spawnIndex,peers:[...latestStates.values()]});
  socket.on("data",chunk=>receive(socket,chunk));
  socket.on("close",()=>disconnect(socket));
  socket.on("error",()=>disconnect(socket));
});

server.listen(port,host,() => {
  console.log(`ENDLESS//CITY local: http://127.0.0.1:${port}`);
  for (const addresses of Object.values(networkInterfaces())) for (const address of addresses||[]) {
    if (address.family==="IPv4"&&!address.internal) console.log(`ENDLESS//CITY LAN:   http://${address.address}:${port}`);
  }
});
