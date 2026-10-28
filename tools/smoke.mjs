import { readFile } from "node:fs/promises";
import vm from "node:vm";

const noop=()=>{};
let clock=1000;
const handlers=new Map();
const on=(type,handler)=>handlers.set(type,handler);
const ctx={fillRect:noop,fillText:noop,font:"",textBaseline:"",fillStyle:""};
const canvas={width:960,height:650,getContext:()=>ctx,requestPointerLock:noop,addEventListener:noop};
const panel={classList:{add:noop,remove:noop}};
const button={addEventListener:noop,textContent:""};
const hint={textContent:""};
const document={
  pointerLockElement:null,
  querySelector:selector=>selector==="#screen"?canvas:selector==="#start"?panel:selector==="#play"?button:hint,
  addEventListener:noop
};
const sandbox=vm.createContext({
  console,document,window:{WebSocket:null},location:{protocol:"http:",host:"127.0.0.1:8000"},
  devicePixelRatio:1,innerWidth:960,innerHeight:650,performance:{now:()=>clock},
  requestAnimationFrame:noop,addEventListener:on,setTimeout:noop,Math,Map,Set,Array,
  Float32Array,Float64Array,Infinity,Number,String,Boolean,JSON
});

vm.runInContext(await readFile(new URL("../game.js",import.meta.url),"utf8"),sandbox,{filename:"game.js"});

const accessAudit=vm.runInContext(`(() => {
  let count=0,ladderCount=0,roofSample=null,ladderSample=null;
  const invalid=[];
  for (let by=-2;by<=2;by++) for (let bx=-2;bx<=2;bx++) for (let lot=0;lot<4;lot++) {
    const building=buildingDescriptor(bx,by,lot);
    if (!building.exists) continue;
    count++;
    if (!roofSample) roofSample={x:building.minX+.5,y:building.minY+.5,height:building.height,buildingId:building.key};
    if (!building.hasLadder) continue;
    ladderCount++;
    let x=building.ladderCoord,y=building.ladderCoord;
    if (building.ladderSide==="west") { x=building.minX-.3; y=building.ladderCoord; }
    if (building.ladderSide==="east") { x=building.maxX+.3; y=building.ladderCoord; }
    if (building.ladderSide==="north") { x=building.ladderCoord; y=building.minY-.3; }
    if (building.ladderSide==="south") { x=building.ladderCoord; y=building.maxY+.3; }
    const contact=ladderContactAt(x,y);
    if (contact?.building.key!==building.key) invalid.push(building.key);
    const wallTile=tileAt((building.minX+building.maxX)*.5,(building.minY+building.maxY)*.5);
    if (!wallTile.hasLadder||!ladderStripe(wallTile,building.ladderSide,x,y,building.height*.5)) invalid.push(building.key);
    if (!ladderSample) ladderSample={x,y,height:building.height,nx:contact?.nx,ny:contact?.ny};
  }
  return {count,ladderCount,invalid:[...new Set(invalid)],roofSample,ladderSample};
})()`,sandbox);
if (!accessAudit.count||!accessAudit.ladderCount||accessAudit.invalid.length) throw new Error(`Ladder audit failed: ${JSON.stringify(accessAudit)}`);
sandbox.__ladderSample=accessAudit.ladderSample;
const ladderMotionAudit=vm.runInContext(`(() => {
  player.x=__ladderSample.x; player.y=__ladderSample.y; player.z=1; cameraMode="first";
  player.angle=Math.atan2(__ladderSample.ny,__ladderSample.nx); keys.add("KeyW");
  updateWalking(.1); const climbed=player.z; keys.delete("KeyW");
  updateWalking(.1); return {climbed,lowered:player.z,onLadder:player.onLadder};
})()`,sandbox);
if (ladderMotionAudit.climbed<=1||ladderMotionAudit.lowered>=ladderMotionAudit.climbed||!ladderMotionAudit.onLadder) throw new Error(`Ladder motion audit failed: ${JSON.stringify(ladderMotionAudit)}`);
sandbox.__roofSample=accessAudit.roofSample;
const originRoofHit=vm.runInContext(`(() => {
  view.x=__roofSample.x; view.y=__roofSample.y; view.z=__roofSample.height+10;
  const hit=castRoofRay(0,-1.54,1,0);
  return hit?.tile.buildingId===__roofSample.buildingId;
})()`,sandbox);
if (!originRoofHit) throw new Error("Steep downward origin-tile roof ray was missed.");

const keyEvent=code=>({code,repeat:false,preventDefault:noop});
handlers.get("keydown")(keyEvent("KeyW"));
handlers.get("keyup")(keyEvent("KeyW"));
clock+=180;
handlers.get("keydown")(keyEvent("KeyW"));
const sprintStarted=vm.runInContext("player.sprinting",sandbox);
handlers.get("keydown")(keyEvent("ShiftLeft"));
vm.runInContext("updateWalking(.016)",sandbox);
const crouchAudit=vm.runInContext("({crouching:player.crouching,sprinting:player.sprinting,crouchAmount:player.crouchAmount})",sandbox);
handlers.get("keyup")(keyEvent("ShiftLeft"));
handlers.get("keyup")(keyEvent("KeyW"));
if (!sprintStarted||!crouchAudit.crouching||crouchAudit.sprinting||crouchAudit.crouchAmount<=0) {
  throw new Error(`Movement input audit failed: ${JSON.stringify({sprintStarted,crouchAudit})}`);
}

const cameraModifierAudit=vm.runInContext(`(() => {
  cameraMode="third"; orbitYaw=0; orbitPitch=0; keys.add("KeyC");
  updateVehicleChaseCamera(1,-.2,.1); const held={yaw:orbitYaw,pitch:orbitPitch};
  keys.delete("KeyC"); updateVehicleChaseCamera(1,-.2,.1);
  return {held,released:{yaw:orbitYaw,pitch:orbitPitch}};
})()`,sandbox);
if (cameraModifierAudit.held.yaw!==0||cameraModifierAudit.held.pitch!==0||cameraModifierAudit.released.yaw<=0) {
  throw new Error(`C free-look modifier audit failed: ${JSON.stringify(cameraModifierAudit)}`);
}

const aerialAudit=vm.runInContext(`(() => {
  cameraMode="first"; player.x=2.5; player.y=2.5; player.z=32; player.pitch=-Math.PI/2;
  renderWorld();
  const invalidDepth=sceneDepth.some(value=>Number.isNaN(value));
  const painted=chars.reduce((count,ch)=>count+(ch!==" "),0);
  return {invalidDepth,painted};
})()`,sandbox);
if (aerialAudit.invalidDepth||aerialAudit.painted<100) throw new Error(`Aerial render audit failed: ${JSON.stringify(aerialAudit)}`);

console.log(`Smoke passed: ${accessAudit.count} buildings audited (${accessAudit.ladderCount} ladders); climb/release descent, sprint/sneak, and C free-look verified; ${aerialAudit.painted} aerial cells rendered.`);
