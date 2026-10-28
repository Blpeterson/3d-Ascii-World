"use strict";

const canvas = document.querySelector("#screen");
const ctx = canvas.getContext("2d");
const startPanel = document.querySelector("#start");
const playButton = document.querySelector("#play");
const hint = document.querySelector("#hint");

const CELL_W = 8;
const CELL_H = 13;
const HORIZONTAL_FOV = Math.PI / 2.5;
const VIEW_DISTANCE = 58;
const BLOCK = 18;
const ROAD = 5;
const PLAYER_RADIUS = 0.28;
const LOOK_LIMIT = Math.PI / 2;

let cols = 120;
let rows = 50;
let chars = [];
let colors = [];
let depthBuffer = [];
let objectDepth = [];
let sceneDepth = [];
let screenYawOffsets = [];
let screenPitchOffsets = [];
let screenXScales = [];
let screenYScales = [];
let rayAngles = [];
let rayCosines = [];
let raySines = [];
let projectionFocalRows = 45;
let baseProjectionFocalRows = 45;
const tileCache = new Map();
let running = false;
let lastTime = performance.now();
let fps = 60;
const keys = new Set();

const player = { x: 2.5, y: 2.5, z: 0, vz: 0, angle: 0, facing: 0, pitch: 0, onGround: true };
const car = { x: 8, y: 2.5, angle: 0, speed: 0, steer: 0, occupied: false };
const helicopter = { x: 2.5, y: 5, z: .08, angle: Math.PI/2, speed: 0, vz: 0, occupied: false, rotorAngle: 0, rotorPower: 0 };
const view = { x: player.x, y: player.y, z: 0, angle: player.angle, pitch: 0 };
let cameraMode = "first";
let orbitYaw = 0;
let orbitPitch = .08;
const peers=new Map();
let multiplayerSocket=null;
let multiplayerStatus="CONNECTING";
let localPeerId=null;
let localStyle=0;
let spawnAssigned=false;
let lastNetworkSend=0;

const playerStyles=[
  { shirt:"#66dc80",shirtDark:"#4eaf64",pants:"#3f9254",shoe:"#b8f7c4",skin:"#c8ffd5",truck:"#56c96f",truckDark:"#489d5b",heli:"#e7b95b",heliDark:"#bd8b39" },
  { shirt:"#66aee8",shirtDark:"#407cae",pants:"#334d86",shoe:"#c2dcff",skin:"#ffe0bd",truck:"#559fe4",truckDark:"#3971a8",heli:"#ef765f",heliDark:"#ad4b3d" },
  { shirt:"#d37ae8",shirtDark:"#9a50af",pants:"#643b86",shoe:"#f1c8ff",skin:"#d8a980",truck:"#bc6cda",truckDark:"#82469d",heli:"#70c8d5",heliDark:"#3d8995" },
  { shirt:"#e6a958",shirtDark:"#a87135",pants:"#75562f",shoe:"#ffe0a3",skin:"#f2c39f",truck:"#db8f3f",truckDark:"#985e2a",heli:"#82d56a",heliDark:"#4c9840" },
  { shirt:"#e96f91",shirtDark:"#aa4765",pants:"#71384a",shoe:"#ffd0dc",skin:"#8f654f",truck:"#da547b",truckDark:"#983a55",heli:"#9c8ce8",heliDark:"#6657ad" },
  { shirt:"#70d9cc",shirtDark:"#43998f",pants:"#315f62",shoe:"#bdfff6",skin:"#efc7a6",truck:"#46b9ad",truckDark:"#2e8078",heli:"#e6cf59",heliDark:"#a49334" }
];

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
  sceneDepth = new Array(cols * rows).fill(Infinity);
  screenYawOffsets = new Float32Array(cols);
  screenPitchOffsets = new Float32Array(rows);
  screenXScales = new Float32Array(cols);
  screenYScales = new Float32Array(rows);
  rayAngles = new Float64Array(cols);
  rayCosines = new Float64Array(cols);
  raySines = new Float64Array(cols);
  // A rectilinear pinhole projection spaces screen columns evenly on the
  // camera plane, not evenly by angle. This keeps straight building edges
  // straight instead of bowing them into a cylindrical/fisheye curve.
  const horizontalFocalCols=(cols*.5)/Math.tan(HORIZONTAL_FOV*.5);
  baseProjectionFocalRows=horizontalFocalCols*(CELL_W/CELL_H);
  projectionFocalRows=baseProjectionFocalRows;
  const maxScreenX=Math.tan(HORIZONTAL_FOV*.5);
  for (let x=0;x<cols;x++) {
    screenXScales[x]=((x+.5)/cols*2-1)*maxScreenX;
    screenYawOffsets[x]=Math.atan(screenXScales[x]);
  }
  for (let y=0;y<rows;y++) {
    screenYScales[y]=(rows*.5-(y+.5))/projectionFocalRows;
    screenPitchOffsets[y]=Math.atan(screenYScales[y]);
  }
}

function floorMod(n, d) { return ((n % d) + d) % d; }

// Each 18-block strip is deterministically split into four neighborhoods.
// Distributing six extra blocks over four 3-block bases produces districts
// that are always at least 3x3 blocks and vary naturally in size.
function neighborhoodBand(block, salt) {
  const chunk=Math.floor(block/18), local=floorMod(block,18);
  const sizes=[3,3,3,3];
  for (let extra=0;extra<6;extra++) sizes[Math.floor(hash(chunk,salt,120+extra)*4)]++;
  let start=0;
  for (let i=0;i<4;i++) {
    if (local<start+sizes[i]) return { id:chunk*4+i, size:sizes[i], offset:local-start };
    start+=sizes[i];
  }
  return { id:chunk*4+3, size:sizes[3], offset:0 };
}

function neighborhoodAt(blockX,blockY) {
  const xBand=neighborhoodBand(blockX,17);
  const yBand=neighborhoodBand(blockY,43);
  const typeRoll=hash(xBand.id,yBand.id,140);
  return { type:typeRoll<.36?"LOW-RISE":typeRoll<.7?"MIXED":"SKYSCRAPER", xBand, yBand };
}

function tileAt(x, y) {
  const tx = Math.floor(x);
  const ty = Math.floor(y);
  const cacheKey=`${tx},${ty}`;
  const cached=tileCache.get(cacheKey);
  if (cached) return cached;
  if (tileCache.size>24000) tileCache.clear();
  const lx = floorMod(tx, BLOCK);
  const ly = floorMod(ty, BLOCK);
  const bx = Math.floor(tx / BLOCK);
  const by = Math.floor(ty / BLOCK);
  const neighborhood=neighborhoodAt(bx,by);

  if (lx < ROAD || ly < ROAD) {
    const centerX = lx === 2;
    const centerY = ly === 2;
    const tile={ solid: false, road: true, mark: centerX || centerY, height: 0, style: 0 };
    tileCache.set(cacheKey,tile); return tile;
  }

  // Alleys split many blocks and make the city permeable on foot.
  const alleyX = lx === 11 && hash(bx, by, 4) > .34;
  const alleyY = ly === 11 && hash(bx, by, 5) > .34;
  if (alleyX || alleyY) {
    const tile={ solid: false, road: false, mark: false, height: 0, style: 0 };
    tileCache.set(cacheKey,tile); return tile;
  }

  // Courtyards and small parks provide variation between towers.
  const lot = (lx < 11 ? 0 : 1) + (ly < 11 ? 0 : 2);
  const density = hash(bx * 2 + lot, by * 2 - lot, 1);
  if (density < .15) {
    const tile={ solid: false, road: false, park: true, mark: false, height: 0, style: 0 };
    tileCache.set(cacheKey,tile); return tile;
  }

  const margin = density > .78 ? 1 : 2;
  const cellX = lx < 11 ? lx - ROAD : lx - 12;
  const cellY = ly < 11 ? ly - ROAD : ly - 12;
  const cellW = lx < 11 ? 6 : 6;
  const cellH = ly < 11 ? 6 : 6;
  const solid = cellX >= margin && cellX < cellW && cellY >= margin && cellY < cellH;
  const heightSeed=hash(bx,by,lot+10);
  const accent=hash(bx,by,lot+70);
  let height;
  if (neighborhood.type==="LOW-RISE") {
    height=4.4+Math.floor(heightSeed*4)*.7;
    if (accent>.91) height+=4+Math.floor(hash(bx,by,lot+71)*5);
  } else if (neighborhood.type==="MIXED") {
    height=heightSeed<.2?4.4+Math.floor(heightSeed*10):5.2+Math.floor(heightSeed*9)*.9;
    if (accent>.86) height+=3+Math.floor(hash(bx,by,lot+71)*5);
  } else {
    height=heightSeed<.16?5.2+Math.floor(heightSeed*18):9+Math.floor(heightSeed*12)*1.15;
    if (accent>.72) height+=5+Math.floor(hash(bx,by,lot+71)*9);
  }
  height=Math.max(4.4,height);
  const tile={ solid, road: false, mark: false, height, style: Math.floor(hash(bx, by, lot + 30) * 4) };
  tileCache.set(cacheKey,tile); return tile;
}

function collides(x, y, radius = PLAYER_RADIUS) {
  const pts = [[-radius,-radius],[radius,-radius],[-radius,radius],[radius,radius]];
  return pts.some(([dx, dy]) => tileAt(x + dx, y + dy).solid);
}

function walkingSurfaceHeight(x,y) {
  const tile=tileAt(x,y);
  return tile.solid?tile.height:0;
}

function walkingBlocked(x,y,feetZ,radius=PLAYER_RADIUS) {
  const pts=[[-radius,-radius],[radius,-radius],[-radius,radius],[radius,radius]];
  return pts.some(([dx,dy]) => {
    const tile=tileAt(x+dx,y+dy);
    return tile.solid&&tile.height>feetZ+.32;
  });
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

function helicopterSurfaceHeight(x,y) {
  let surface=0;
  for (const [forward,side] of [[0,0],[-1.15,-.62],[-1.15,.62],[1.15,-.62],[1.15,.62]]) {
    const px=x+Math.cos(helicopter.angle)*forward+Math.cos(helicopter.angle+Math.PI/2)*side;
    const py=y+Math.sin(helicopter.angle)*forward+Math.sin(helicopter.angle+Math.PI/2)*side;
    const tile=tileAt(px,py);
    if (tile.solid) surface=Math.max(surface,tile.height);
  }
  return surface+.08;
}

function helicopterBlocked(x,y,z) {
  return helicopterSurfaceHeight(x,y)>z+.12;
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

function castRayLayers(angle, maxLayers = 10, dx = Math.cos(angle), dy = Math.sin(angle)) {
  const originX=view.x, originY=view.y;
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

function projectWorldHeight(worldZ, horizontalDepth) {
  const focal=projectionFocalRows;
  const relativeZ=worldZ-view.z;
  const cp=Math.cos(view.pitch), sp=Math.sin(view.pitch);
  const forward=horizontalDepth*cp+relativeZ*sp;
  const vertical=relativeZ*cp-horizontalDepth*sp;
  if (forward<=.04) return vertical>0?-rows*2:rows*3;
  return rows*.5-(vertical/forward)*focal;
}

function unprojectScreenHeight(screenY,horizontalDepth) {
  const focal=projectionFocalRows;
  const k=(rows*.5-screenY)/focal;
  const cp=Math.cos(view.pitch), sp=Math.sin(view.pitch);
  const denominator=cp-k*sp;
  if (Math.abs(denominator)<.0001) return denominator<0?-Infinity:Infinity;
  return view.z+horizontalDepth*(k*cp+sp)/denominator;
}

function cameraBlocked(x,y,z) {
  if (z<.24) return true;
  const tile=tileAt(x,y);
  return tile.solid&&z<tile.height+.18;
}

function castRoofRay(angle,pitch,dx=Math.cos(angle),dy=Math.sin(angle)) {
  const slope=Math.tan(pitch);
  if (slope>=-.002) return null;
  const originX=view.x, originY=view.y;
  let mapX=Math.floor(originX), mapY=Math.floor(originY);
  const deltaX=Math.abs(1/(dx||.00001)), deltaY=Math.abs(1/(dy||.00001));
  const stepX=dx<0?-1:1, stepY=dy<0?-1:1;
  let sideX=dx<0?(originX-mapX)*deltaX:(mapX+1-originX)*deltaX;
  let sideY=dy<0?(originY-mapY)*deltaY:(mapY+1-originY)*deltaY;
  let entry=0;
  while (entry<VIEW_DISTANCE) {
    if (sideX<sideY) { entry=sideX; sideX+=deltaX; mapX+=stepX; }
    else { entry=sideY; sideY+=deltaY; mapY+=stepY; }
    const exit=Math.min(sideX,sideY);
    const tile=tileAt(mapX+.5,mapY+.5);
    if (tile.solid&&view.z>tile.height+.02) {
      const roofDistance=(tile.height-view.z)/slope;
      if (roofDistance>=entry-.01&&roofDistance<=exit+.01) return { dist:roofDistance,tile };
    }
  }
  return null;
}

function renderWorld() {
  updateView();
  // A conventional pinhole view makes nearby vertical walls appear to
  // collapse toward the edge when looking almost straight up. Gradually
  // widen only the vertical FOV in that range so towers retain their height
  // and presence without changing the normal horizontal-looking view.
  const upwardLook=clamp((view.pitch-Math.PI*.2)/(Math.PI*.3),0,1);
  const upwardBlend=upwardLook*upwardLook*(3-2*upwardLook);
  projectionFocalRows=baseProjectionFocalRows*(1-upwardBlend*.38);
  for (let y=0;y<rows;y++) {
    screenYScales[y]=(rows*.5-(y+.5))/projectionFocalRows;
    screenPitchOffsets[y]=Math.atan(screenYScales[y]);
  }
  chars.fill(" ");
  colors.fill("#07140b");
  objectDepth.fill(Infinity);
  sceneDepth.fill(Infinity);
  const focal=projectionFocalRows;
  const horizon=rows*.5+Math.tan(view.pitch)*focal;
  const yawCos=Math.cos(view.angle), yawSin=Math.sin(view.angle);
  const pitchCos=Math.cos(view.pitch), pitchSin=Math.sin(view.pitch);
  const forwardX=pitchCos*yawCos, forwardY=pitchCos*yawSin, forwardZ=pitchSin;
  const rightX=-yawSin, rightY=yawCos;
  const upX=-pitchSin*yawCos, upY=-pitchSin*yawSin, upZ=pitchCos;
  for (let x=0;x<cols;x++) {
    const angle=view.angle+screenYawOffsets[x];
    rayAngles[x]=angle;
    rayCosines[x]=Math.cos(angle);
    raySines[x]=Math.sin(angle);
  }

  // Sky, distant haze, road and sidewalk are all character fields.
  for (let y = 0; y < rows; y++) {
    const screenY=screenYScales[y];
    const baseX=forwardX+upX*screenY;
    const baseY=forwardY+upY*screenY;
    const rayZ=forwardZ+upZ*screenY;
    for (let x = 0; x < cols; x++) {
      if (rayZ>=-.0001) {
        const star = hash(x, y, 90) > .996 && y < horizon * .65;
        put(x, y, star ? "." : " ", star ? "#7ba384" : "#061109");
      } else {
        const rayX=baseX+rightX*screenXScales[x];
        const rayY=baseY+rightY*screenXScales[x];
        let distance=view.z/-rayZ;
        const horizontalDistance=distance*Math.hypot(rayX,rayY);
        if (horizontalDistance>VIEW_DISTANCE*1.5) distance*=VIEW_DISTANCE*1.5/horizontalDistance;
        const wx=view.x+rayX*distance;
        const wy=view.y+rayY*distance;
        const t = tileAt(wx, wy);
        let ch = t.road ? (t.mark ? ":" : ".") : t.park ? "'" : ",";
        if (hash(Math.floor(wx * 2), Math.floor(wy * 2), 8) > .88) ch = t.road ? "·" : ";";
        put(x, y, ch, t.road ? "#35513d" : t.park ? "#386a3d" : "#46574a");
      }
    }
  }

  for (let x = 0; x < cols; x++) {
    const rayAngle=rayAngles[x];
    const layers=castRayLayers(rayAngle,10,rayCosines[x],raySines[x]);
    const correction=Math.cos(screenYawOffsets[x]);
    depthBuffer[x]=layers.length?layers[0].dist*correction:VIEW_DISTANCE;
    for (let layerIndex=layers.length-1; layerIndex>=0; layerIndex--) {
      const ray=layers[layerIndex];
      const corrected=ray.dist*correction;
      const bottom=projectWorldHeight(0,corrected);
      const top=projectWorldHeight(ray.tile.height,corrected);
      const wallHeight=Math.max(1,bottom-top);
      const fog=clamp(1-corrected/VIEW_DISTANCE,0,1);
      const sideDim=ray.side?.72:1;
      const light=Math.floor(48+176*fog*sideDim);
      const style=ray.tile.style;
      const ramp=wallRamps[style];
      const palette=buildingPalettes[style];
      const shadeIndex=clamp(Math.floor(corrected/7),0,ramp.length-1);
      const rgb=palette.wall.map(component=>Math.min(255,Math.floor(light*component)));
      const wallColor=`rgb(${rgb[0]},${rgb[1]},${rgb[2]})`;
      for (let y=Math.max(0,Math.floor(top)); y<Math.min(rows,Math.ceil(bottom)); y++) {
        const worldZ=clamp(unprojectScreenHeight(y+.5,corrected),0,ray.tile.height);
        const windowBand=Math.floor(worldZ*2.1)%2===0;
        const windowColumn=Math.floor(ray.wallX*8)%3===1;
        const lit=windowBand&&windowColumn&&corrected<34&&hash(Math.floor(ray.wallX*20),Math.floor(worldZ*6),style)>.47;
        const ch=lit?(style%2?"[]"[x%2]:"¤"):ramp[shadeIndex];
        const index=y*cols+x;
        if (corrected<sceneDepth[index]) {
          sceneDepth[index]=corrected;
          put(x,y,ch,lit?palette.window:wallColor);
        }
      }
    }
  }

  // Downward camera rays can strike horizontal rooftops before the ground.
  // Per-cell depth keeps roofs behind nearer walls and in front of farther towers.
  if (view.z>2.15) {
    const roofChars=["^","~",":","="];
    for (let y=0; y<rows; y+=2) {
      const sampleY=Math.min(rows-1,y+1);
      const screenY=screenYScales[sampleY];
      const baseX=forwardX+upX*screenY;
      const baseY=forwardY+upY*screenY;
      const rayZ=forwardZ+upZ*screenY;
      if (rayZ>=-.0001) continue;
      for (let x=0; x<cols; x+=2) {
        const sampleX=Math.min(cols-1,x+1);
        const rayX=baseX+rightX*screenXScales[sampleX];
        const rayY=baseY+rightY*screenXScales[sampleX];
        const horizontalLength=Math.hypot(rayX,rayY);
        if (horizontalLength<.0001) continue;
        const rayYaw=Math.atan2(rayY,rayX);
        const rayPitch=Math.atan2(rayZ,horizontalLength);
        const roof=castRoofRay(rayYaw,rayPitch,rayX/horizontalLength,rayY/horizontalLength);
        if (!roof) continue;
        const corrected=roof.dist*Math.cos(rayYaw-view.angle);
        const style=roof.tile.style;
        const palette=buildingPalettes[style];
        const light=clamp(155-corrected*2,65,155);
        const rgb=palette.wall.map(component=>Math.min(255,Math.floor(light*component)));
        const color=`rgb(${rgb[0]},${rgb[1]},${rgb[2]})`;
        for (let yy=y;yy<Math.min(rows,y+2);yy++) for (let xx=x;xx<Math.min(cols,x+2);xx++) {
          const index=yy*cols+xx;
          if (corrected>=sceneDepth[index]) continue;
          sceneDepth[index]=corrected;
          put(xx,yy,roofChars[style],color);
        }
      }
    }
  }

  renderDynamicModels();
  if (car.occupied && cameraMode === "first") renderCockpit();
  if (helicopter.occupied && cameraMode === "first") renderHelicopterCockpit();
  renderHud();
  paint();
}

function updateView() {
  if (cameraMode === "first") {
    view.x=player.x;
    view.y=player.y;
    view.z=helicopter.occupied?helicopter.z+1.18:car.occupied?1.08:player.z+1.48;
    view.angle=player.angle;
    view.pitch=player.pitch;
    return;
  }

  const targetX=player.x, targetY=player.y;
  const targetZ=helicopter.occupied?helicopter.z+1.05:car.occupied?1.08:player.z+1.55;
  const followDistance=helicopter.occupied?13:car.occupied?11.5:8.5;
  const pitch=clamp(orbitPitch,-2.4,.55);
  const minimumDistance=helicopter.occupied?2.3:car.occupied?1.8:.6;
  const maximumHeight=targetZ+followDistance*2.5;

  // This is a game-style camera boom, not a spherical orbit: horizontal
  // distance stays constant while pitch changes camera height. Probe every
  // point along that boom and shorten only when geometry blocks it.
  let chosen=helicopter.occupied?1.6:car.occupied?1.15:.35;
  for (let d=minimumDistance; d<=followDistance; d+=.25) {
    const cx=targetX-Math.cos(orbitYaw)*d;
    const cy=targetY-Math.sin(orbitYaw)*d;
    const cz=clamp(targetZ-pitch*d,.28,maximumHeight);
    if (cameraBlocked(cx,cy,cz)) break;
    chosen=d;
  }

  const horizontalDistance=Math.max(.2,chosen);
  view.x=targetX-Math.cos(orbitYaw)*horizontalDistance;
  view.y=targetY-Math.sin(orbitYaw)*horizontalDistance;
  view.z=clamp(targetZ-pitch*chosen,.28,maximumHeight);
  view.angle=Math.atan2(targetY-view.y,targetX-view.x);
  view.pitch=Math.atan2(targetZ-view.z,horizontalDistance);
}

function offsetBox(baseX, baseY, angle, forward, side, spec) {
  return {
    ...spec, angle,
    x: baseX + Math.cos(angle) * forward + Math.cos(angle + Math.PI/2) * side,
    y: baseY + Math.sin(angle) * forward + Math.sin(angle + Math.PI/2) * side
  };
}

function truckBoxes(source=car,styleIndex=localStyle) {
  const a = source.angle, x = source.x, y = source.y;
  const style=playerStyles[styleIndex%playerStyles.length];
  const body = { color: style.truck, chars: ["@", "%"] };
  return [
    offsetBox(x,y,a, 0,0, { length:3.25,width:1.42,z0:.28,z1:1.02,...body }),
    offsetBox(x,y,a,-.78,0, { length:1.42,width:1.34,z0:.78,z1:1.42,color:style.truckDark,chars:["#","%"] }),
    offsetBox(x,y,a, .67,0, { length:1.2,width:1.32,z0:.77,z1:1.73,color:style.truck,chars:["@","#"] }),
    offsetBox(x,y,a, .69,0, { length:1.22,width:1.35,z0:1.22,z1:1.61,color:"#b9ffd0",chars:["=","+"] }),
    offsetBox(x,y,a, 1.47,0, { length:.32,width:1.38,z0:.4,z1:.82,color:"#78dd8c",chars:["%","#"] }),
    offsetBox(x,y,a,-1.48,0, { length:.22,width:1.48,z0:.34,z1:.62,color:"#8cf0a0",chars:["=","-"] }),
    ...[-1.05,.98].flatMap(f => [-.72,.72].map(s => offsetBox(x,y,a,f,s, {
      length:.55,width:.3,z0:.05,z1:.62,color:"#263e2b",chars:["O","0"]
    })))
  ];
}

function helicopterBoxes(source=helicopter,styleIndex=localStyle) {
  const a=source.angle, x=source.x, y=source.y, z=source.z;
  const style=playerStyles[styleIndex%playerStyles.length];
  const body={ color:style.heli, chars:["@","#"] };
  const rotorA=a+source.rotorAngle;
  const tailX=x-Math.cos(a)*2.45, tailY=y-Math.sin(a)*2.45;
  const tailHorizontal=.1+Math.abs(Math.cos(source.rotorAngle))*1.3;
  const tailVertical=.06+Math.abs(Math.sin(source.rotorAngle))*.68;
  const tailCenter=z+1.15;
  return [
    offsetBox(x,y,a,.15,0,{length:2.65,width:1.45,z0:z+.32,z1:z+1.38,...body}),
    offsetBox(x,y,a,.83,0,{length:1.05,width:1.34,z0:z+.73,z1:z+1.58,color:"#b9edf0",chars:["=","+"]}),
    offsetBox(x,y,a,-1.75,0,{length:2.45,width:.36,z0:z+.72,z1:z+1.08,color:style.heliDark,chars:["#","+"]}),
    offsetBox(x,y,a,-2.82,0,{length:.25,width:1.15,z0:z+.72,z1:z+1.62,color:style.heli,chars:["%","#"]}),
    offsetBox(x,y,a,0,-.72,{length:2.2,width:.12,z0:z+.06,z1:z+.18,color:"#d7d1a5",chars:["=","-"]}),
    offsetBox(x,y,a,0,.72,{length:2.2,width:.12,z0:z+.06,z1:z+.18,color:"#d7d1a5",chars:["=","-"]}),
    offsetBox(x,y,a,-.45,-.72,{length:.12,width:.12,z0:z+.12,z1:z+.55,color:"#a9935d",chars:["|","|"]}),
    offsetBox(x,y,a,-.45,.72,{length:.12,width:.12,z0:z+.12,z1:z+.55,color:"#a9935d",chars:["|","|"]}),
    offsetBox(x,y,rotorA,0,0,{length:6.7,width:.1,z0:z+1.68,z1:z+1.76,color:"#efffc9",chars:["=","-"]}),
    offsetBox(x,y,rotorA+Math.PI/2,0,0,{length:6.7,width:.1,z0:z+1.67,z1:z+1.75,color:"#d7e8b6",chars:["=","-"]}),
    offsetBox(tailX,tailY,a+Math.PI/2,0,0,{length:tailHorizontal,width:.08,z0:tailCenter-.045,z1:tailCenter+.045,color:"#f6d279",chars:["+","-"]}),
    offsetBox(tailX,tailY,a+Math.PI/2,0,0,{length:.09,width:.09,z0:tailCenter-tailVertical,z1:tailCenter+tailVertical,color:"#f6d279",chars:["|","|"]})
  ];
}

function personBoxes(source=player,local=true,scale=.8,styleIndex=localStyle) {
  const style=playerStyles[styleIndex%playerStyles.length];
  const a = source.facing;
  const moving = local&&(keys.has("KeyW") || keys.has("KeyS") || keys.has("KeyA") || keys.has("KeyD"));
  const phase = moving ? Math.sin(performance.now() * .012) : 0;
  const x = source.x, y = source.y, lift = source.z;
  const box=(forward,side,spec)=>offsetBox(x,y,a,forward*scale,side*scale,{
    ...spec,length:spec.length*scale,width:spec.width*scale,
    z0:lift+(spec.z0-lift)*scale,z1:lift+(spec.z1-lift)*scale
  });
  return [
    box(0,0,{ length:.52,width:.58,z0:1.45+lift,z1:2.02+lift,color:style.skin,chars:["@","%"] }),
    box(0,0,{ length:.38,width:.68,z0:.78+lift,z1:1.47+lift,color:style.shirt,chars:["%","#"] }),
    box(0,0,{ length:.4,width:.56,z0:.62+lift,z1:.84+lift,color:style.shirtDark,chars:["#","*"] }),
    box(.03,-.43,{ length:.28,width:.18,z0:.68+lift,z1:1.4+lift,color:style.shirt,chars:["%","#"] }),
    box(.03,.43,{ length:.28,width:.18,z0:.68+lift,z1:1.4+lift,color:style.shirt,chars:["%","#"] }),
    box(phase*.13,-.18,{ length:.3,width:.22,z0:.08+lift,z1:.68+lift,color:style.pants,chars:["#","*"] }),
    box(-phase*.13,.18,{ length:.3,width:.22,z0:.08+lift,z1:.68+lift,color:style.pants,chars:["#","*"] }),
    box(.13+phase*.13,-.18,{ length:.48,width:.27,z0:.02+lift,z1:.18+lift,color:style.shoe,chars:["=","-"] }),
    box(.13-phase*.13,.18,{ length:.48,width:.27,z0:.02+lift,z1:.18+lift,color:style.shoe,chars:["=","-"] })
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

function renderDynamicModels() {
  const boxes = [];
  if (!car.occupied || cameraMode === "third") boxes.push(...truckBoxes(car,localStyle));
  if (!helicopter.occupied || cameraMode === "third") boxes.push(...helicopterBoxes(helicopter,localStyle));
  if (!car.occupied && !helicopter.occupied && cameraMode === "third") boxes.push(...personBoxes(player,true,.8,localStyle));
  for (const peer of peers.values()) {
    boxes.push(...truckBoxes(peer.car,peer.style));
    boxes.push(...helicopterBoxes(peer.helicopter,peer.style));
    let avatar={...peer.player};
    let scale=.8;
    if (peer.helicopter.occupied) {
      avatar={x:peer.helicopter.x+Math.cos(peer.helicopter.angle)*.25,y:peer.helicopter.y+Math.sin(peer.helicopter.angle)*.25,z:peer.helicopter.z+.45,facing:peer.helicopter.angle};
      scale=.56;
    } else if (peer.car.occupied) {
      avatar={x:peer.car.x+Math.cos(peer.car.angle)*.38,y:peer.car.y+Math.sin(peer.car.angle)*.38,z:.48,facing:peer.car.angle};
      scale=.56;
    }
    // Remote people are deliberately present in both local camera modes,
    // including when seated in one of their synchronized vehicles.
    boxes.push(...personBoxes(avatar,false,scale,peer.style));
  }
  if (!boxes.length) return;

  for (let x=0; x<cols; x++) {
    const rayAngle=rayAngles[x];
    const dirX=rayCosines[x], dirY=raySines[x];
    const correction=Math.cos(screenYawOffsets[x]);
    for (const box of boxes) {
      const hit=rayOrientedBox(view.x,view.y,dirX,dirY,box);
      if (!hit) continue;
      const depth=hit.distance*correction;
      if (depth<=.08 || depth>=VIEW_DISTANCE) continue;
      const top=Math.floor(projectWorldHeight(box.z1,depth));
      const bottom=Math.ceil(projectWorldHeight(box.z0,depth));
      const fog=clamp(1-depth/VIEW_DISTANCE,.25,1);
      const color=box.color;
      const ch=box.chars[hit.axis];
      for (let y=Math.max(0,top); y<Math.min(rows,bottom); y++) {
        const index=y*cols+x;
        if (depth<objectDepth[index]&&depth<sceneDepth[index]) {
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

function renderHelicopterCockpit() {
  const left=Math.floor(cols*.07), right=Math.ceil(cols*.93), dashY=rows-11;
  const frame="#d3a850", glass="#86d9c8", instrument="#dfff83";
  // Wide bubble windshield with roof frame and side pillars.
  for (let x=left+5;x<=right-5;x++) put(x,3,x%3?"═":"─",frame);
  for (let y=4;y<dashY;y++) {
    const inset=Math.floor((y-4)*.18);
    put(left+inset,y,"\\",frame);
    put(right-inset,y,"/",frame);
  }
  const center=Math.floor(cols/2);
  put(center,3,"┬",frame);
  for (let y=4;y<dashY-1;y++) put(center,y,"│",y%4===0?frame:"#6d815f");
  for (let x=left+Math.floor((dashY-4)*.18);x<=right-Math.floor((dashY-4)*.18);x++) put(x,dashY,"_",frame);

  const surface=helicopterSurfaceHeight(helicopter.x,helicopter.y)-.08;
  const altitude=Math.max(0,helicopter.z-surface);
  const rotor=Math.round(helicopter.rotorPower*100);
  const heading=((helicopter.angle*180/Math.PI)%360+360)%360;
  const panel=` ROTOR ${String(rotor).padStart(3,"0")}%   ALT ${altitude.toFixed(1)}   HDG ${String(Math.round(heading)).padStart(3,"0")} `;
  for (let x=center-25;x<=center+25;x++) put(x,dashY+1,"#","#5e492c");
  [...panel].forEach((ch,i)=>put(center-Math.floor(panel.length/2)+i,dashY+2,ch,instrument));

  // Artificial horizon and collective/cyclic controls.
  const gauge=[" .--------. ","|    +     |","|----------|","|    v     |"," '--------' "];
  gauge.forEach((line,gy)=>[...line].forEach((ch,gx)=>ch!==" "&&put(center+gx-6,dashY+4+gy,ch,ch==="-"?glass:"#ddb866")));
  const collective=keys.has("Space")?"UP":keys.has("ControlLeft")||keys.has("ControlRight")?"DN":"HOLD";
  const status=`COLLECTIVE ${collective}`;
  [...status].forEach((ch,i)=>put(left+12+i,rows-3,ch,instrument));
  const cyclic="  /|\\  ";
  [...cyclic].forEach((ch,i)=>put(right-20+i,rows-4,ch,"#e6ce8a"));
}

function renderHud() {
  const mode = helicopter.occupied ? "FLYING" : car.occupied ? "DRIVING" : "ON FOOT";
  const camera = cameraMode === "first" ? "1ST PERSON" : "3RD PERSON";
  const speed = helicopter.occupied ? `  ${String(Math.round(Math.abs(helicopter.speed) * 18)).padStart(3,"0")} KM/H` : car.occupied ? `  ${String(Math.round(Math.abs(car.speed) * 18)).padStart(3,"0")} KM/H` : "";
  const zoneX = Math.floor(player.x / BLOCK), zoneY = Math.floor(player.y / BLOCK);
  const neighborhood=neighborhoodAt(zoneX,zoneY);
  const online=multiplayerStatus==="ONLINE"?`ONLINE ${peers.size+1}`:multiplayerStatus;
  const top = ` ENDLESS//CITY   ${mode}  ${camera}${speed}  ${online} `;
  [...top].forEach((ch, i) => put(2+i, 1, ch, "#8aff9f"));
  const pos = ` ${neighborhood.type} DISTRICT  BLOCK ${zoneX >= 0 ? "+" : ""}${zoneX}:${zoneY >= 0 ? "+" : ""}${zoneY}  ALT ${player.z.toFixed(1)} `;
  [...pos].forEach((ch, i) => put(2+i, 2, ch, "#579b65"));
  put(cols/2, rows/2, "+", "#caffd4");
  const mapX = cols - 15, mapY = 2;
  for (let my=-4;my<=4;my++) for(let mx=-6;mx<=6;mx++) {
    const t = tileAt(player.x + mx*.8, player.y + my*.8);
    put(mapX+mx, mapY+my+4, t.solid?"#":t.road?".":"·", t.solid?"#477b52":"#78bc85");
  }
  put(mapX, mapY+4, helicopter.occupied?"H":car.occupied?"V":"@", "#e6ff81");
  const help = helicopter.occupied ? "W/S FLY  A/D YAW  SPACE RISE  CTRL DESCEND  E EXIT  V VIEW" : car.occupied ? "W/S THROTTLE  A/D STEER  SPACE BRAKE  E EXIT  V VIEW" : "WASD MOVE  SHIFT SPRINT  SPACE JUMP  E VEHICLE  V VIEW";
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
  if (!walkingBlocked(nx, player.y,player.z)) player.x = nx;
  const ny = player.y + dy;
  if (!walkingBlocked(player.x, ny,player.z)) player.y = ny;
}

function update(dt) {
  dt = Math.min(dt, .05);
  if (helicopter.occupied) updateHelicopter(dt);
  else if (car.occupied) updateCar(dt);
  else {
    updateWalking(dt);
    player.vz -= 12 * dt;
    player.z += player.vz * dt;
    const surface=walkingSurfaceHeight(player.x,player.y);
    if (player.z <= surface) { player.z = surface; player.vz = 0; player.onGround = true; }
    else player.onGround=false;
    helicopter.rotorPower=Math.max(0,helicopter.rotorPower-dt*.16);
    helicopter.rotorAngle+=dt*(2+helicopter.rotorPower*24);
  }

  const nearCar = !car.occupied&&!helicopter.occupied&&Math.hypot(player.x-car.x, player.y-car.y) < 2.1;
  const nearHeli = !car.occupied&&!helicopter.occupied&&Math.hypot(player.x-helicopter.x, player.y-helicopter.y) < 2.7&&Math.abs(player.z-helicopter.z)<1.5;
  const heliSurface=helicopterSurfaceHeight(helicopter.x,helicopter.y)-.08;
  if (helicopter.occupied&&helicopter.z>heliSurface+.16) hint.textContent="LAND BEFORE EXITING";
  else hint.textContent = nearHeli ? "[ E ] ENTER HELICOPTER" : nearCar ? "[ E ] ENTER TRUCK" : "";
}

function updateWalking(dt) {
  const speed = keys.has("ShiftLeft") || keys.has("ShiftRight") ? 5.2 : 3.25;
  let forward = (keys.has("KeyW") ? 1 : 0) - (keys.has("KeyS") ? 1 : 0);
  let strafe = (keys.has("KeyD") ? 1 : 0) - (keys.has("KeyA") ? 1 : 0);
  if (forward && strafe) { forward *= .707; strafe *= .707; }
  const movementAngle=cameraMode==="third"?orbitYaw:player.angle;
  const moveX = Math.cos(movementAngle)*forward + Math.cos(movementAngle+Math.PI/2)*strafe;
  const moveY = Math.sin(movementAngle)*forward + Math.sin(movementAngle+Math.PI/2)*strafe;
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
  if (cameraMode === "first") {
    player.angle += Math.atan2(Math.sin(car.angle-player.angle),Math.cos(car.angle-player.angle))*dt*7;
  }
}

function updateHelicopter(dt) {
  helicopter.rotorPower+=(1-helicopter.rotorPower)*Math.min(1,dt*1.8);
  helicopter.rotorAngle+=dt*(5+helicopter.rotorPower*28);
  const yawInput=(keys.has("KeyD")?1:0)-(keys.has("KeyA")?1:0);
  helicopter.angle+=yawInput*1.25*dt;
  const throttle=(keys.has("KeyW")?1:0)-(keys.has("KeyS")?1:0);
  helicopter.speed+=throttle*5.2*dt;
  helicopter.speed*=Math.pow(.48,dt);
  helicopter.speed=clamp(helicopter.speed,-3.4,8.2);
  const dx=Math.cos(helicopter.angle)*helicopter.speed*dt;
  const dy=Math.sin(helicopter.angle)*helicopter.speed*dt;
  if (!helicopterBlocked(helicopter.x+dx,helicopter.y+dy,helicopter.z)) {
    helicopter.x+=dx; helicopter.y+=dy;
  } else helicopter.speed*=.15;

  const collective=(keys.has("Space")?1:0)-((keys.has("ControlLeft")||keys.has("ControlRight"))?1:0);
  helicopter.vz+=collective*7.5*dt;
  helicopter.vz*=Math.pow(collective? .42:.18,dt);
  helicopter.vz=clamp(helicopter.vz,-5,5);
  helicopter.z=Math.min(55,helicopter.z+helicopter.vz*dt);
  const surface=helicopterSurfaceHeight(helicopter.x,helicopter.y);
  if (helicopter.z<=surface) { helicopter.z=surface; helicopter.vz=Math.max(0,helicopter.vz); }
  player.x=helicopter.x; player.y=helicopter.y; player.z=helicopter.z; player.facing=helicopter.angle;
  if (cameraMode==="first") player.angle+=Math.atan2(Math.sin(helicopter.angle-player.angle),Math.cos(helicopter.angle-player.angle))*dt*4.5;
}

function toggleVehicle() {
  if (helicopter.occupied) {
    const surface=helicopterSurfaceHeight(helicopter.x,helicopter.y)-.08;
    if (helicopter.z>surface+.16) return;
    for (const [a,d] of [[Math.PI/2,1.45],[-Math.PI/2,1.45],[Math.PI,1.65],[0,1.65],[0,0]]) {
      const ex=helicopter.x+Math.cos(helicopter.angle+a)*d;
      const ey=helicopter.y+Math.sin(helicopter.angle+a)*d;
      const exitSurface=walkingSurfaceHeight(ex,ey);
      if (Math.abs(exitSurface-surface)<.35&&!walkingBlocked(ex,ey,exitSurface)) {
        player.x=ex; player.y=ey; player.z=exitSurface; player.vz=0; player.onGround=true;
        helicopter.occupied=false; helicopter.speed=0; return;
      }
    }
    return;
  }
  if (car.occupied) {
    const exits = [Math.PI/2, -Math.PI/2, Math.PI];
    for (const a of exits) {
      const ex = car.x + Math.cos(car.angle+a)*1.2, ey = car.y + Math.sin(car.angle+a)*1.2;
      if (!collides(ex,ey)) { player.x=ex; player.y=ey; car.occupied=false; car.speed=0; return; }
    }
  } else if (Math.hypot(player.x-helicopter.x, player.y-helicopter.y) < 2.7&&Math.abs(player.z-helicopter.z)<1.5) {
    helicopter.occupied=true; player.x=helicopter.x; player.y=helicopter.y; player.z=helicopter.z; player.angle=helicopter.angle; player.facing=helicopter.angle;
  } else if (Math.hypot(player.x-car.x, player.y-car.y) < 2.1) {
    car.occupied = true; player.x=car.x; player.y=car.y; player.angle=car.angle; player.facing=car.angle;
  }
}

function networkNumber(value,fallback,min=-10000,max=10000) {
  const number=Number(value);
  return Number.isFinite(number)?clamp(number,min,max):fallback;
}

function acceptPeerState(id,state) {
  if (!id||id===localPeerId||!state) return;
  const old=peers.get(id);
  peers.set(id,{
    style:Math.floor(networkNumber(state.style,old?.style||0,0,playerStyles.length-1)),
    player:{
      x:networkNumber(state.player?.x,old?.player.x||0),y:networkNumber(state.player?.y,old?.player.y||0),
      z:networkNumber(state.player?.z,old?.player.z||0,0,80),facing:networkNumber(state.player?.facing,old?.player.facing||0,-1000,1000)
    },
    car:{
      x:networkNumber(state.car?.x,old?.car.x||0),y:networkNumber(state.car?.y,old?.car.y||0),
      angle:networkNumber(state.car?.angle,old?.car.angle||0,-1000,1000),occupied:Boolean(state.car?.occupied)
    },
    helicopter:{
      x:networkNumber(state.helicopter?.x,old?.helicopter.x||0),y:networkNumber(state.helicopter?.y,old?.helicopter.y||0),
      z:networkNumber(state.helicopter?.z,old?.helicopter.z||.08,0,80),angle:networkNumber(state.helicopter?.angle,old?.helicopter.angle||0,-1000,1000),
      rotorAngle:networkNumber(state.helicopter?.rotorAngle,old?.helicopter.rotorAngle||0,-100000,100000),occupied:Boolean(state.helicopter?.occupied)
    }
  });
}

function assignNetworkSpawn(index) {
  if (spawnAssigned) return;
  spawnAssigned=true;
  localStyle=index%playerStyles.length;
  const lane=index%3, row=Math.floor(index/3);
  const spawnX=1+lane*1.45, spawnY=2.5+row*12;
  player.x=spawnX; player.y=spawnY; player.z=0; player.vz=0;
  car.x=spawnX; car.y=spawnY+6; car.angle=Math.PI/2; car.speed=0;
  helicopter.x=spawnX; helicopter.y=spawnY+2.5; helicopter.z=.08; helicopter.angle=Math.PI/2;
}

function localNetworkState() {
  return {
    style:localStyle,
    player:{x:player.x,y:player.y,z:player.z,facing:player.facing},
    car:{x:car.x,y:car.y,angle:car.angle,occupied:car.occupied},
    helicopter:{x:helicopter.x,y:helicopter.y,z:helicopter.z,angle:helicopter.angle,rotorAngle:helicopter.rotorAngle,occupied:helicopter.occupied}
  };
}

function connectMultiplayer() {
  if (!window.WebSocket||multiplayerSocket?.readyState===WebSocket.OPEN||multiplayerSocket?.readyState===WebSocket.CONNECTING) return;
  multiplayerStatus="CONNECTING";
  const protocol=location.protocol==="https:"?"wss:":"ws:";
  multiplayerSocket=new WebSocket(`${protocol}//${location.host}/ws`);
  multiplayerSocket.addEventListener("open",()=>{ multiplayerStatus="ONLINE"; });
  multiplayerSocket.addEventListener("message",event=>{
    try {
      const message=JSON.parse(event.data);
      if (message.type==="welcome") {
        localPeerId=message.id; assignNetworkSpawn(Math.max(0,Math.floor(message.spawnIndex||0)));
        for (const peer of message.peers||[]) acceptPeerState(peer.id,peer.state);
      } else if (message.type==="state") acceptPeerState(message.id,message.state);
      else if (message.type==="leave") peers.delete(message.id);
    } catch { /* Ignore malformed network messages. */ }
  });
  multiplayerSocket.addEventListener("close",()=>{
    multiplayerStatus="OFFLINE"; peers.clear(); multiplayerSocket=null;
    setTimeout(connectMultiplayer,2000);
  });
  multiplayerSocket.addEventListener("error",()=>{ multiplayerStatus="OFFLINE"; });
}

function sendNetworkState(now) {
  if (!multiplayerSocket||multiplayerSocket.readyState!==WebSocket.OPEN||now-lastNetworkSend<80) return;
  lastNetworkSend=now;
  multiplayerSocket.send(JSON.stringify({type:"state",state:localNetworkState()}));
}

function loop(now) {
  const dt = (now-lastTime)/1000; lastTime=now;
  fps = fps*.9 + (1/Math.max(.001,dt))*.1;
  if (running) update(dt);
  sendNetworkState(now);
  renderWorld();
  requestAnimationFrame(loop);
}

addEventListener("resize", resize);
addEventListener("keydown", e => {
  keys.add(e.code);
  if (["Space","ArrowUp","ArrowDown"].includes(e.code)) e.preventDefault();
  if (e.code === "Space" && !car.occupied && !helicopter.occupied && player.onGround) { player.vz=5.2; player.onGround=false; }
  if (e.code === "KeyE" && !e.repeat) toggleVehicle();
  if (e.code === "KeyV" && !e.repeat) {
    cameraMode = cameraMode === "first" ? "third" : "first";
    if (cameraMode === "third") {
      orbitYaw=player.angle;
      orbitPitch=clamp(player.pitch,-.55,.22);
    } else if (car.occupied||helicopter.occupied) {
      player.angle=car.angle;
      if (helicopter.occupied) player.angle=helicopter.angle;
    } else {
      player.angle=orbitYaw;
      player.pitch=clamp(orbitPitch,-LOOK_LIMIT,LOOK_LIMIT);
    }
  }
});
addEventListener("keyup", e => keys.delete(e.code));
addEventListener("mousemove", e => {
  if (document.pointerLockElement !== canvas || !running) return;
  if (cameraMode === "third") {
    orbitYaw += e.movementX * .0026;
    orbitPitch = clamp(orbitPitch - e.movementY * .0026, -2.4, .55);
  } else {
    player.angle += e.movementX * .0022;
    player.pitch = clamp(player.pitch - e.movementY * .0022, -LOOK_LIMIT, LOOK_LIMIT);
  }
});
canvas.addEventListener("click", () => running && canvas.requestPointerLock());
playButton.addEventListener("click", () => {
  startPanel.classList.add("hidden"); running=true; lastTime=performance.now(); canvas.requestPointerLock();
});
document.addEventListener("pointerlockchange", () => {
  if (running && document.pointerLockElement !== canvas) { startPanel.classList.remove("hidden"); playButton.textContent="RETURN TO CITY"; running=false; keys.clear(); }
});

resize();
connectMultiplayer();
requestAnimationFrame(loop);
