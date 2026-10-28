"use strict";

const canvas = document.querySelector("#screen");
const ctx = canvas.getContext("2d");
const startPanel = document.querySelector("#start");
const playButton = document.querySelector("#play");
const hint = document.querySelector("#hint");

const CELL_W = 8;
const CELL_H = 13;
const FOV = Math.PI / 2.5;
const VIEW_DISTANCE = 58;
const BLOCK = 18;
const ROAD = 5;
const PLAYER_RADIUS = 0.28;

let cols = 120;
let rows = 50;
let chars = [];
let colors = [];
let depthBuffer = [];
let objectDepth = [];
let running = false;
let lastTime = performance.now();
let fps = 60;
const keys = new Set();

const player = { x: 2.5, y: 2.5, z: 0, vz: 0, angle: 0, facing: 0, pitch: 0, onGround: true };
const car = { x: 8, y: 2.5, angle: 0, speed: 0, steer: 0, occupied: false };
const view = { x: player.x, y: player.y, z: 0, angle: player.angle, pitch: 0 };
let cameraMode = "first";

const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const fract = v => v - Math.floor(v);
function hash(x, y, salt = 0) {
  return fract(Math.sin(x * 127.1 + y * 311.7 + salt * 91.19) * 43758.5453123);
}

function resize() {
  const dpr = Math.min(devicePixelRatio || 1, 1.5);
  canvas.width = Math.floor(innerWidth * dpr);
  canvas.height = Math.floor(innerHeight * dpr);
  cols = Math.max(70, Math.floor(canvas.width / (CELL_W * dpr)));
  rows = Math.max(32, Math.floor(canvas.height / (CELL_H * dpr)));
  ctx.font = `${Math.floor(CELL_H * dpr)}px Consolas, monospace`;
  ctx.textBaseline = "top";
  chars = new Array(cols * rows).fill(" ");
  colors = new Array(cols * rows).fill("#000");
  depthBuffer = new Array(cols).fill(VIEW_DISTANCE);
  objectDepth = new Array(cols * rows).fill(Infinity);
}

function floorMod(n, d) { return ((n % d) + d) % d; }

function tileAt(x, y) {
  const tx = Math.floor(x);
  const ty = Math.floor(y);
  const lx = floorMod(tx, BLOCK);
  const ly = floorMod(ty, BLOCK);
  const bx = Math.floor(tx / BLOCK);
  const by = Math.floor(ty / BLOCK);

  if (lx < ROAD || ly < ROAD) {
    const centerX = lx === 2;
    const centerY = ly === 2;
    return { solid: false, road: true, mark: centerX || centerY, height: 0, style: 0 };
  }

  // Alleys split many blocks and make the city permeable on foot.
  const alleyX = lx === 11 && hash(bx, by, 4) > .34;
  const alleyY = ly === 11 && hash(bx, by, 5) > .34;
  if (alleyX || alleyY) return { solid: false, road: false, mark: false, height: 0, style: 0 };

  // Courtyards and small parks provide variation between towers.
  const lot = (lx < 11 ? 0 : 1) + (ly < 11 ? 0 : 2);
  const density = hash(bx * 2 + lot, by * 2 - lot, 1);
  if (density < .15) return { solid: false, road: false, park: true, mark: false, height: 0, style: 0 };

  const margin = density > .78 ? 1 : 2;
  const cellX = lx < 11 ? lx - ROAD : lx - 12;
  const cellY = ly < 11 ? ly - ROAD : ly - 12;
  const cellW = lx < 11 ? 6 : 6;
  const cellH = ly < 11 ? 6 : 6;
  const solid = cellX >= margin && cellX < cellW && cellY >= margin && cellY < cellH;
  const height = 2.2 + Math.floor(hash(bx, by, lot + 10) * 8) * .7;
  return { solid, road: false, mark: false, height, style: Math.floor(hash(bx, by, lot + 30) * 4) };
}

function collides(x, y, radius = PLAYER_RADIUS) {
  const pts = [[-radius,-radius],[radius,-radius],[-radius,radius],[radius,radius]];
  return pts.some(([dx, dy]) => tileAt(x + dx, y + dy).solid);
}

function truckCollides(x, y, angle) {
  const probes = [];
  for (const forward of [-1.58,-.8,0,.8,1.58]) for (const side of [-.68,.68]) probes.push([forward,side]);
  return probes.some(([forward,side]) => {
    const px=x+Math.cos(angle)*forward+Math.cos(angle+Math.PI/2)*side;
    const py=y+Math.sin(angle)*forward+Math.sin(angle+Math.PI/2)*side;
    return tileAt(px,py).solid;
  });
}

function put(x, y, ch, color) {
  x = Math.floor(x); y = Math.floor(y);
  if (x < 0 || x >= cols || y < 0 || y >= rows) return;
  const i = y * cols + x;
  chars[i] = ch;
  colors[i] = color;
}

function castRayFrom(originX, originY, angle) {
  const dx = Math.cos(angle), dy = Math.sin(angle);
  let mapX = Math.floor(originX), mapY = Math.floor(originY);
  const deltaX = Math.abs(1 / (dx || .00001));
  const deltaY = Math.abs(1 / (dy || .00001));
  const stepX = dx < 0 ? -1 : 1;
  const stepY = dy < 0 ? -1 : 1;
  let sideX = dx < 0 ? (originX - mapX) * deltaX : (mapX + 1 - originX) * deltaX;
  let sideY = dy < 0 ? (originY - mapY) * deltaY : (mapY + 1 - originY) * deltaY;
  let side = 0;
  let tile = null;
  let dist = 0;

  while (dist < VIEW_DISTANCE) {
    if (sideX < sideY) { sideX += deltaX; mapX += stepX; side = 0; }
    else { sideY += deltaY; mapY += stepY; side = 1; }
    tile = tileAt(mapX + .5, mapY + .5);
    dist = side === 0 ? sideX - deltaX : sideY - deltaY;
    if (tile.solid) break;
  }
  if (!tile?.solid) return { dist: VIEW_DISTANCE, tile: { height: 0, style: 0 }, side: 0, wallX: 0 };
  const wallX = side === 0 ? originY + dist * dy : originX + dist * dx;
  return { dist, tile, side, wallX: fract(wallX) };
}

function castRay(angle) { return castRayFrom(view.x, view.y, angle); }

function castRayLayers(angle, maxLayers = 10) {
  const originX=view.x, originY=view.y;
  const dx=Math.cos(angle), dy=Math.sin(angle);
  let mapX=Math.floor(originX), mapY=Math.floor(originY);
  const deltaX=Math.abs(1/(dx||.00001)), deltaY=Math.abs(1/(dy||.00001));
  const stepX=dx<0?-1:1, stepY=dy<0?-1:1;
  let sideX=dx<0?(originX-mapX)*deltaX:(mapX+1-originX)*deltaX;
  let sideY=dy<0?(originY-mapY)*deltaY:(mapY+1-originY)*deltaY;
  let distance=0, insideSolid=false;
  const layers=[];
  while (distance<VIEW_DISTANCE && layers.length<maxLayers) {
    let side;
    if (sideX<sideY) { sideX+=deltaX; mapX+=stepX; side=0; distance=sideX-deltaX; }
    else { sideY+=deltaY; mapY+=stepY; side=1; distance=sideY-deltaY; }
    const tile=tileAt(mapX+.5,mapY+.5);
    if (tile.solid && !insideSolid) {
      const wallX=side===0?originY+distance*dy:originX+distance*dx;
      layers.push({ dist:distance,tile,side,wallX:fract(wallX) });
    }
    insideSolid=tile.solid;
  }
  return layers;
}

const wallRamps = ["@%#*+=-:.", "MWN$ox+=-.", "#HAXx+=-.", "8B0Ool:-."];
const buildingPalettes = [
  { wall:[.42,1,.57], window:"#d9ff89" },
  { wall:[.36,.76,1], window:"#a8f4ff" },
  { wall:[1,.66,.32], window:"#ffe39a" },
  { wall:[.82,.48,1], window:"#f1b5ff" }
];
function renderWorld() {
  updateView();
  chars.fill(" ");
  colors.fill("#07140b");
  objectDepth.fill(Infinity);
  const horizon = rows * .48 + view.pitch * rows + view.z * 1.5;

  // Sky, distant haze, road and sidewalk are all character fields.
  for (let y = 0; y < rows; y++) {
    const below = y - horizon;
    for (let x = 0; x < cols; x++) {
      if (below < 0) {
        const star = hash(x, y, 90) > .996 && y < horizon * .65;
        put(x, y, star ? "." : " ", star ? "#7ba384" : "#061109");
      } else {
        const perspective = rows / Math.max(1, below);
        const lateral = (x - cols / 2) / cols;
        const wx = view.x + Math.cos(view.angle) * perspective + Math.cos(view.angle + Math.PI / 2) * lateral * perspective * 2.4;
        const wy = view.y + Math.sin(view.angle) * perspective + Math.sin(view.angle + Math.PI / 2) * lateral * perspective * 2.4;
        const t = tileAt(wx, wy);
        let ch = t.road ? (t.mark ? ":" : ".") : t.park ? "'" : ",";
        if (hash(Math.floor(wx * 2), Math.floor(wy * 2), 8) > .88) ch = t.road ? "·" : ";";
        put(x, y, ch, t.road ? "#35513d" : t.park ? "#386a3d" : "#46574a");
      }
    }
  }

  for (let x = 0; x < cols; x++) {
    const rayAngle = view.angle - FOV / 2 + (x / cols) * FOV;
    const layers=castRayLayers(rayAngle);
    const correction=Math.cos(rayAngle-view.angle);
    depthBuffer[x]=layers.length?layers[0].dist*correction:VIEW_DISTANCE;
    for (let layerIndex=layers.length-1; layerIndex>=0; layerIndex--) {
      const ray=layers[layerIndex];
      const corrected=ray.dist*correction;
      const wallHeight=Math.min(rows*2,rows*ray.tile.height/Math.max(.15,corrected));
      const bottom=horizon+rows*.42/Math.max(.2,corrected)+view.z*1.5;
      const top=bottom-wallHeight;
      const fog=clamp(1-corrected/VIEW_DISTANCE,0,1);
      const sideDim=ray.side?.72:1;
      const light=Math.floor(48+176*fog*sideDim);
      const style=ray.tile.style;
      const ramp=wallRamps[style];
      const palette=buildingPalettes[style];
      const shadeIndex=clamp(Math.floor(corrected/7),0,ramp.length-1);
      for (let y=Math.max(0,Math.floor(top)); y<Math.min(rows,Math.ceil(bottom)); y++) {
        const relY=(y-top)/Math.max(1,wallHeight);
        const windowBand=Math.floor(relY*ray.tile.height*2.1)%2===0;
        const windowColumn=Math.floor(ray.wallX*8)%3===1;
        const lit=windowBand&&windowColumn&&corrected<34&&hash(Math.floor(ray.wallX*20),Math.floor(relY*30),style)>.47;
        const ch=lit?(style%2?"[]"[x%2]:"¤"):ramp[shadeIndex];
        const rgb=palette.wall.map(component=>Math.min(255,Math.floor(light*component)));
        put(x,y,ch,lit?palette.window:`rgb(${rgb[0]},${rgb[1]},${rgb[2]})`);
      }
    }
  }

  renderDynamicModels(horizon);
  if (car.occupied && cameraMode === "first") renderCockpit();
  renderHud();
  paint();
}

function updateView() {
  view.angle = player.angle;
  view.pitch = player.pitch;
  view.z = player.z;
  if (cameraMode === "first") { view.x = player.x; view.y = player.y; return; }

  const followDistance = car.occupied ? 11.5 : 8.5;
  const lift = car.occupied ? 2.05 : 1.35;
  view.z = player.z + lift;
  // Pull the camera toward the subject if a building is behind them.
  let chosen = .45;
  for (let d = .45; d <= followDistance; d += .2) {
    const cx = player.x - Math.cos(player.angle) * d;
    const cy = player.y - Math.sin(player.angle) * d;
    if (collides(cx, cy, .16)) break;
    chosen = d;
  }
  view.x = player.x - Math.cos(player.angle) * chosen;
  view.y = player.y - Math.sin(player.angle) * chosen;
}

function offsetBox(baseX, baseY, angle, forward, side, spec) {
  return {
    ...spec, angle,
    x: baseX + Math.cos(angle) * forward + Math.cos(angle + Math.PI/2) * side,
    y: baseY + Math.sin(angle) * forward + Math.sin(angle + Math.PI/2) * side
  };
}

function truckBoxes() {
  const a = car.angle, x = car.x, y = car.y;
  const body = { color: "#56c96f", chars: ["@", "%"] };
  return [
    offsetBox(x,y,a, 0,0, { length:3.25,width:1.42,z0:.28,z1:1.02,...body }),
    offsetBox(x,y,a,-.78,0, { length:1.42,width:1.34,z0:.78,z1:1.42,color:"#489d5b",chars:["#","%"] }),
    offsetBox(x,y,a, .67,0, { length:1.2,width:1.32,z0:.77,z1:1.73,color:"#70e78a",chars:["@","#"] }),
    offsetBox(x,y,a, .69,0, { length:1.22,width:1.35,z0:1.22,z1:1.61,color:"#b9ffd0",chars:["=","+"] }),
    offsetBox(x,y,a, 1.47,0, { length:.32,width:1.38,z0:.4,z1:.82,color:"#78dd8c",chars:["%","#"] }),
    offsetBox(x,y,a,-1.48,0, { length:.22,width:1.48,z0:.34,z1:.62,color:"#8cf0a0",chars:["=","-"] }),
    ...[-1.05,.98].flatMap(f => [-.72,.72].map(s => offsetBox(x,y,a,f,s, {
      length:.55,width:.3,z0:.05,z1:.62,color:"#263e2b",chars:["O","0"]
    })))
  ];
}

function personBoxes() {
  const a = player.facing;
  const moving = keys.has("KeyW") || keys.has("KeyS") || keys.has("KeyA") || keys.has("KeyD");
  const phase = moving ? Math.sin(performance.now() * .012) : 0;
  const x = player.x, y = player.y, lift = player.z;
  return [
    offsetBox(x,y,a,0,0,{ length:.52,width:.58,z0:1.45+lift,z1:2.02+lift,color:"#c8ffd5",chars:["@","%"] }),
    offsetBox(x,y,a,0,0,{ length:.38,width:.68,z0:.78+lift,z1:1.47+lift,color:"#66dc80",chars:["%","#"] }),
    offsetBox(x,y,a,0,0,{ length:.4,width:.56,z0:.62+lift,z1:.84+lift,color:"#4eaf64",chars:["#","*"] }),
    offsetBox(x,y,a,.03,-.43,{ length:.28,width:.18,z0:.68+lift,z1:1.4+lift,color:"#7be391",chars:["%","#"] }),
    offsetBox(x,y,a,.03,.43,{ length:.28,width:.18,z0:.68+lift,z1:1.4+lift,color:"#7be391",chars:["%","#"] }),
    offsetBox(x,y,a,phase*.13,-.18,{ length:.3,width:.22,z0:.08+lift,z1:.68+lift,color:"#3f9254",chars:["#","*"] }),
    offsetBox(x,y,a,-phase*.13,.18,{ length:.3,width:.22,z0:.08+lift,z1:.68+lift,color:"#3f9254",chars:["#","*"] }),
    offsetBox(x,y,a,.13+phase*.13,-.18,{ length:.48,width:.27,z0:.02+lift,z1:.18+lift,color:"#b8f7c4",chars:["=","-"] }),
    offsetBox(x,y,a,.13-phase*.13,.18,{ length:.48,width:.27,z0:.02+lift,z1:.18+lift,color:"#b8f7c4",chars:["=","-"] })
  ];
}

function rayOrientedBox(originX, originY, dirX, dirY, box) {
  const c = Math.cos(box.angle), s = Math.sin(box.angle);
  const dx = originX-box.x, dy = originY-box.y;
  const ox = dx*c + dy*s, oy = -dx*s + dy*c;
  const rx = dirX*c + dirY*s, ry = -dirX*s + dirY*c;
  let near = -Infinity, far = Infinity, axis = 0;
  for (const [o,d,half,a] of [[ox,rx,box.length/2,0],[oy,ry,box.width/2,1]]) {
    if (Math.abs(d) < 1e-6) { if (Math.abs(o)>half) return null; continue; }
    let t1=(-half-o)/d, t2=(half-o)/d;
    if (t1>t2) [t1,t2]=[t2,t1];
    if (t1>near) { near=t1; axis=a; }
    far=Math.min(far,t2);
    if (near>far) return null;
  }
  if (far < 0) return null;
  return { distance: near>0 ? near : far, axis };
}

function renderDynamicModels(horizon) {
  const boxes = [];
  if (!car.occupied || cameraMode === "third") boxes.push(...truckBoxes());
  if (!car.occupied && cameraMode === "third") boxes.push(...personBoxes());
  if (!boxes.length) return;

  for (let x=0; x<cols; x++) {
    const rayAngle=view.angle-FOV/2+(x/cols)*FOV;
    const dirX=Math.cos(rayAngle), dirY=Math.sin(rayAngle);
    const correction=Math.cos(rayAngle-view.angle);
    for (const box of boxes) {
      const hit=rayOrientedBox(view.x,view.y,dirX,dirY,box);
      if (!hit) continue;
      const depth=hit.distance*correction;
      if (depth<=.08 || depth>=depthBuffer[x]) continue;
      const ground=horizon+rows*.42/depth+view.z*1.5;
      const top=Math.floor(ground-rows*box.z1/depth);
      const bottom=Math.ceil(ground-rows*box.z0/depth);
      const fog=clamp(1-depth/VIEW_DISTANCE,.25,1);
      const color=box.color;
      const ch=box.chars[hit.axis];
      for (let y=Math.max(0,top); y<Math.min(rows,bottom); y++) {
        const index=y*cols+x;
        if (depth<objectDepth[index]) {
          objectDepth[index]=depth;
          put(x,y,ch,color);
        }
      }
    }
  }
}

function renderCockpit() {
  const left = Math.floor(cols * .09), right = Math.ceil(cols * .91);
  const dashY = rows - 10;

  // Windshield surround and A-pillars leave the generated city visible through the glass.
  for (let x = left + 4; x <= right - 4; x++) put(x, 4, "═", "#5ca96d");
  for (let y = 5; y < dashY; y++) {
    const inset = Math.floor((y - 5) * .26);
    put(left + inset, y, "\\", "#5ca96d");
    put(right - inset, y, "/", "#5ca96d");
  }
  for (let x = left + Math.floor((dashY-5)*.26); x <= right - Math.floor((dashY-5)*.26); x++) {
    put(x, dashY, "_", "#78d98c");
    if (x % 2 === 0) put(x, dashY + 1, "#", "#315f3b");
  }

  renderRearViewMirror();

  const speed = String(Math.round(Math.abs(car.speed) * 18)).padStart(3, "0");
  const gear = car.speed < -.1 ? "R" : Math.abs(car.speed) < .1 ? "P" : "D";
  const cluster = `[${gear}]  ${speed} KM/H  RPM ${Math.min(8, Math.floor(Math.abs(car.speed)*.7)+1)}`;
  [...cluster].forEach((ch, i) => put(Math.floor(cols/2-cluster.length/2)+i, dashY+2, ch, ch >= "0" && ch <= "9" ? "#dfff83" : "#68bc78"));

  const cx = Math.floor(cols / 2), wheelY = rows - 7;
  const spoke = car.steer < -.25 ? "/" : car.steer > .25 ? "\\" : "|";
  const wheel = ["   .--------.   ", " .'          '. ", `/------${spoke}------\\`, `|      ${spoke}      |`, " '.__________.' "];
  wheel.forEach((line, y) => [...line].forEach((ch, x) => ch !== " " && put(cx+x-8, wheelY+y, ch, ch === spoke ? "#d8ffe1" : "#65cf7b")));

  const hood = "____/==============================\\____";
  [...hood].forEach((ch, i) => put(cx-Math.floor(hood.length/2)+i, dashY-1, ch, "#3d7c4a"));
}

function renderRearViewMirror() {
  const width = clamp(Math.floor(cols * .24), 24, 38);
  const height = 8;
  const x0 = Math.floor((cols - width) / 2), y0 = 2;
  for (let x=0; x<width; x++) { put(x0+x,y0,x===0?"╔":x===width-1?"╗":"═","#8fe9a2"); put(x0+x,y0+height-1,x===0?"╚":x===width-1?"╝":"═","#8fe9a2"); }
  for (let y=1; y<height-1; y++) { put(x0,y0+y,"║","#8fe9a2"); put(x0+width-1,y0+y,"║","#8fe9a2"); }
  for (let mx=1; mx<width-1; mx++) {
    for (let my=1; my<height-1; my++) {
      const roadRow=my===height-2;
      put(x0+mx,y0+my,my<2?" ":roadRow?(mx%5===0?":":"."):".",my<2?"#0b1b0f":roadRow?"#55705b":"#294a31");
    }
    const mirrorFov = Math.PI / 2.15;
    const angle = car.angle + Math.PI - mirrorFov/2 + (mx/(width-1))*mirrorFov;
    const ray = castRayFrom(car.x, car.y, angle);
    if (ray.dist >= VIEW_DISTANCE) continue;
    const corrected = ray.dist * Math.cos(angle-(car.angle+Math.PI));
    const wallHeight = clamp(Math.round(ray.tile.height * 3.5 / Math.max(1, corrected)),1,height-3);
    for (let h=0; h<wallHeight; h++) put(x0+mx,y0+height-3-h,h===wallHeight-1?"#":"@",ray.side?"#4d925d":"#67b978");
  }
  const label = " REAR VIEW ";
  [...label].forEach((ch,i)=>put(Math.floor(cols/2-label.length/2)+i,y0,ch,"#c4ffd0"));
}

function renderHud() {
  const mode = car.occupied ? "DRIVING" : "ON FOOT";
  const camera = cameraMode === "first" ? "1ST PERSON" : "3RD PERSON";
  const speed = car.occupied ? `  ${String(Math.round(Math.abs(car.speed) * 18)).padStart(3,"0")} KM/H` : "";
  const zoneX = Math.floor(player.x / BLOCK), zoneY = Math.floor(player.y / BLOCK);
  const top = ` ENDLESS//CITY   ${mode}  ${camera}${speed} `;
  [...top].forEach((ch, i) => put(2+i, 1, ch, "#8aff9f"));
  const pos = ` BLOCK ${zoneX >= 0 ? "+" : ""}${zoneX}:${zoneY >= 0 ? "+" : ""}${zoneY}  ALT ${player.z.toFixed(1)} `;
  [...pos].forEach((ch, i) => put(2+i, 2, ch, "#579b65"));
  put(cols/2, rows/2, "+", "#caffd4");
  const mapX = cols - 15, mapY = 2;
  for (let my=-4;my<=4;my++) for(let mx=-6;mx<=6;mx++) {
    const t = tileAt(player.x + mx*.8, player.y + my*.8);
    put(mapX+mx, mapY+my+4, t.solid?"#":t.road?".":"·", t.solid?"#477b52":"#78bc85");
  }
  put(mapX, mapY+4, car.occupied?"V":"@", "#e6ff81");
  const help = car.occupied ? "W/S THROTTLE  A/D STEER  SPACE BRAKE  E EXIT  V VIEW" : "WASD MOVE  SHIFT SPRINT  SPACE JUMP  E CAR  V VIEW";
  [...help].forEach((ch,i)=>put(2+i, rows-2, ch, "#4d8158"));
}

function paint() {
  ctx.fillStyle = "#020704";
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  const sx = canvas.width / cols, sy = canvas.height / rows;
  ctx.font = `${Math.ceil(sy * .98)}px Consolas, monospace`;
  for (let y = 0; y < rows; y++) {
    let runColor = colors[y * cols];
    let run = "";
    let runX = 0;
    for (let x = 0; x <= cols; x++) {
      const color = x < cols ? colors[y * cols + x] : "";
      if (color !== runColor) {
        ctx.fillStyle = runColor;
        ctx.fillText(run, runX * sx, y * sy);
        run = ""; runX = x; runColor = color;
      }
      if (x < cols) run += chars[y * cols + x];
    }
  }
  ctx.fillStyle = "rgba(80,255,120,.025)";
  for(let y=0;y<canvas.height;y+=4) ctx.fillRect(0,y,canvas.width,1);
}

function movePlayer(dx, dy) {
  const nx = player.x + dx;
  if (!collides(nx, player.y)) player.x = nx;
  const ny = player.y + dy;
  if (!collides(player.x, ny)) player.y = ny;
}

function update(dt) {
  dt = Math.min(dt, .05);
  if (car.occupied) updateCar(dt);
  else updateWalking(dt);

  player.vz -= 12 * dt;
  player.z += player.vz * dt;
  if (player.z <= 0) { player.z = 0; player.vz = 0; player.onGround = true; }

  const nearCar = !car.occupied && Math.hypot(player.x-car.x, player.y-car.y) < 2.1;
  hint.textContent = nearCar ? "[ E ] ENTER VEHICLE" : "";
}

function updateWalking(dt) {
  const speed = keys.has("ShiftLeft") || keys.has("ShiftRight") ? 5.2 : 3.25;
  let forward = (keys.has("KeyW") ? 1 : 0) - (keys.has("KeyS") ? 1 : 0);
  let strafe = (keys.has("KeyD") ? 1 : 0) - (keys.has("KeyA") ? 1 : 0);
  if (forward && strafe) { forward *= .707; strafe *= .707; }
  const moveX = Math.cos(player.angle)*forward + Math.cos(player.angle+Math.PI/2)*strafe;
  const moveY = Math.sin(player.angle)*forward + Math.sin(player.angle+Math.PI/2)*strafe;
  if (Math.hypot(moveX,moveY)>.01) player.facing=Math.atan2(moveY,moveX);
  movePlayer(moveX*speed*dt, moveY*speed*dt);
}

function updateCar(dt) {
  const throttle = (keys.has("KeyW") ? 1 : 0) - (keys.has("KeyS") ? 1 : 0);
  car.speed += throttle * (car.speed * throttle < 0 ? 12 : 7) * dt;
  car.speed *= Math.pow(keys.has("Space") ? .08 : .72, dt);
  car.speed = clamp(car.speed, -4.2, 10.5);
  if (Math.abs(car.speed) < .025 && !throttle) car.speed = 0;
  const steerInput = (keys.has("KeyD") ? 1 : 0) - (keys.has("KeyA") ? 1 : 0);
  car.steer += (steerInput - car.steer) * Math.min(1, dt * 10);
  car.angle += car.steer * clamp(car.speed / 5, -1, 1) * 1.65 * dt;
  const dx = Math.cos(car.angle) * car.speed * dt;
  const dy = Math.sin(car.angle) * car.speed * dt;
  if (!truckCollides(car.x + dx, car.y + dy, car.angle)) { car.x += dx; car.y += dy; }
  else car.speed *= -.18;
  player.x = car.x; player.y = car.y; player.facing = car.angle;
  player.angle += Math.atan2(Math.sin(car.angle-player.angle),Math.cos(car.angle-player.angle))*dt*7;
}

function toggleCar() {
  if (car.occupied) {
    const exits = [Math.PI/2, -Math.PI/2, Math.PI];
    for (const a of exits) {
      const ex = car.x + Math.cos(car.angle+a)*1.2, ey = car.y + Math.sin(car.angle+a)*1.2;
      if (!collides(ex,ey)) { player.x=ex; player.y=ey; car.occupied=false; car.speed=0; return; }
    }
  } else if (Math.hypot(player.x-car.x, player.y-car.y) < 2.1) {
    car.occupied = true; player.x=car.x; player.y=car.y; player.angle=car.angle; player.facing=car.angle;
  }
}

function loop(now) {
  const dt = (now-lastTime)/1000; lastTime=now;
  fps = fps*.9 + (1/Math.max(.001,dt))*.1;
  if (running) update(dt);
  renderWorld();
  requestAnimationFrame(loop);
}

addEventListener("resize", resize);
addEventListener("keydown", e => {
  keys.add(e.code);
  if (["Space","ArrowUp","ArrowDown"].includes(e.code)) e.preventDefault();
  if (e.code === "Space" && !car.occupied && player.onGround) { player.vz=5.2; player.onGround=false; }
  if (e.code === "KeyE" && !e.repeat) toggleCar();
  if (e.code === "KeyV" && !e.repeat) cameraMode = cameraMode === "first" ? "third" : "first";
});
addEventListener("keyup", e => keys.delete(e.code));
addEventListener("mousemove", e => {
  if (document.pointerLockElement !== canvas || !running) return;
  player.angle += e.movementX * .0022;
  player.pitch = clamp(player.pitch - e.movementY * .0022, -.62, .62);
});
canvas.addEventListener("click", () => running && canvas.requestPointerLock());
playButton.addEventListener("click", () => {
  startPanel.classList.add("hidden"); running=true; lastTime=performance.now(); canvas.requestPointerLock();
});
document.addEventListener("pointerlockchange", () => {
  if (running && document.pointerLockElement !== canvas) { startPanel.classList.remove("hidden"); playButton.textContent="RETURN TO CITY"; running=false; keys.clear(); }
});

resize();
requestAnimationFrame(loop);
