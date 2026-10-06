import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';

const WORLDS = {
  m9dy: { name: 'M9DY', number: '01', color: '#c4d384', ink: '#233e2e', url: null },
  fire: { name: '無名火', number: '02', color: '#eeb35e', ink: '#9f3b22', url: null },
  untitled: { name: 'Untitled Design Agency', number: '03', color: '#bac9ec', ink: '#283c66', url: null },
};
const keys = Object.keys(WORLDS);
const canvas = document.querySelector('#scene');
const loading = document.querySelector('#loading');
const reduceMotion = matchMedia('(prefers-reduced-motion: reduce)');
const dialog = document.querySelector('#world-dialog');
const hint = document.querySelector('#drop-hint');
let selected = 'm9dy', installed = null, hovered = null, dragging = null;
let soundEnabled = false, audioContext, announcementTimer, insertionTimer;
let renderer, scene, camera, controls, screenMaterial, screenTexture, screenCanvas, ledMaterial;
let slotRing, slotCollider, tv, consoleModel, controller, rack, cable, resetTarget;
let transitionStarted = -100, bootUntil = 0, lastScreenPaint = -100, lastFrame = 0;
let pointerStart = null, resetCamera = false, readyFrames = 0, active = true, orbiting = false, orbitSettles = 0;
const cards = [], actionMeshes = [], modelObjects = [], tableShadows = [], rackHomes = new Map();
const clock = new THREE.Clock();
const pointer = new THREE.Vector2(), raycaster = new THREE.Raycaster();
const dragPlane = new THREE.Plane(), rayPoint = new THREE.Vector3();
const slot = new THREE.Vector3();
const insertedPosition = new THREE.Vector3();
const defaultCamera = new THREE.Vector3(), defaultTarget = new THREE.Vector3();
const temp = new THREE.Vector3();
const M = {};

function announce(message) {
  clearTimeout(announcementTimer);
  announcementTimer = setTimeout(() => { document.querySelector('#announcement').textContent = message; }, 130);
}
function tone(index, boot = false) {
  if (!soundEnabled) return;
  try {
    audioContext ??= new (window.AudioContext || window.webkitAudioContext)();
    audioContext.resume();
    const start = audioContext.currentTime;
    (boot ? [1, 1.25, 1.5, 2] : [1, 1.5]).forEach((ratio, i) => {
      const oscillator = audioContext.createOscillator(), gain = audioContext.createGain();
      oscillator.type = 'triangle'; oscillator.frequency.value = [330, 392, 494][index] * ratio;
      gain.gain.setValueAtTime(0, start + i * .075);
      gain.gain.linearRampToValueAtTime(.028, start + i * .075 + .01);
      gain.gain.exponentialRampToValueAtTime(.001, start + i * .075 + .15);
      oscillator.connect(gain).connect(audioContext.destination);
      oscillator.start(start + i * .075); oscillator.stop(start + i * .075 + .16);
    });
  } catch { /* The scene also operates silently. */ }
}
function roundedCanvas(ctx, x, y, w, h, radius, fill) {
  ctx.beginPath(); ctx.roundRect(x, y, w, h, radius); ctx.fillStyle = fill; ctx.fill();
}
function textureFromCanvas(c) {
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = Math.min(renderer.capabilities.getMaxAnisotropy(), 8); return t;
}
function textTexture(text, { color = '#4d5046', background = null, size = 60, width = 1024, height = 256, weight = 700, font = 'Arial', align = 'center' } = {}) {
  const c = document.createElement('canvas'); c.width = width; c.height = height;
  const ctx = c.getContext('2d'); if (background) { ctx.fillStyle = background; ctx.fillRect(0, 0, width, height); }
  ctx.fillStyle = color; ctx.font = `${weight} ${size}px ${font}`; ctx.textAlign = align; ctx.textBaseline = 'middle';
  const lines = text.split('\n'); lines.forEach((line, i) => ctx.fillText(line, align === 'left' ? 20 : width / 2, height / 2 + (i - (lines.length - 1) / 2) * size * 1.13));
  return textureFromCanvas(c);
}
function label(parent, text, width, height, pos, options = {}, top = false) {
  const map = textTexture(text, options);
  const mesh = new THREE.Mesh(new THREE.PlaneGeometry(width, height), new THREE.MeshStandardMaterial({ map, transparent: true, roughness: .85, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -1 }));
  mesh.position.set(...pos); if (top) mesh.rotation.x = -Math.PI / 2; parent.add(mesh); return mesh;
}
function box(parent, w, h, d, radius, material, x = 0, y = 0, z = 0, segments = 2) {
  const mesh = new THREE.Mesh(new RoundedBoxGeometry(w, h, d, segments, Math.min(radius, w / 2, h / 2, d / 2)), material);
  mesh.position.set(x, y, z); mesh.castShadow = true; mesh.receiveShadow = true; parent.add(mesh); return mesh;
}
function cylinder(parent, radius, height, material, x, y, z, front = false, segments = 24) {
  const mesh = new THREE.Mesh(new THREE.CylinderGeometry(radius, radius, height, segments), material);
  mesh.position.set(x, y, z); if (front) mesh.rotation.x = Math.PI / 2;
  mesh.castShadow = true; mesh.receiveShadow = true; parent.add(mesh); return mesh;
}
function plasticGrain() {
  const c = document.createElement('canvas'); c.width = c.height = 256;
  const ctx = c.getContext('2d'), pixels = ctx.createImageData(256, 256); let seed = 37;
  for (let i = 0; i < pixels.data.length; i += 4) {
    seed = (seed * 1664525 + 1013904223) >>> 0; const n = 116 + (seed >>> 27);
    pixels.data[i] = pixels.data[i + 1] = pixels.data[i + 2] = n; pixels.data[i + 3] = 255;
  }
  ctx.putImageData(pixels, 0, 0); const texture = new THREE.CanvasTexture(c);
  texture.wrapS = texture.wrapT = THREE.RepeatWrapping; texture.repeat.set(9, 9); return texture;
}
function contactShadow(x, z, w, d, opacity = .2) {
  const c = document.createElement('canvas'); c.width = c.height = 128; const ctx = c.getContext('2d');
  const gradient = ctx.createRadialGradient(64, 64, 9, 64, 64, 63); gradient.addColorStop(0, 'rgba(25,28,21,.65)'); gradient.addColorStop(.4, 'rgba(25,28,21,.3)'); gradient.addColorStop(1, 'rgba(25,28,21,0)');
  ctx.fillStyle = gradient; ctx.fillRect(0, 0, 128, 128);
  const mesh = new THREE.Mesh(new THREE.PlaneGeometry(w, d), new THREE.MeshBasicMaterial({ map: new THREE.CanvasTexture(c), transparent: true, opacity, depthWrite: false }));
  mesh.rotation.x = -Math.PI / 2; mesh.position.set(x, .018, z); scene.add(mesh); return mesh;
}
function createCRT() {
  const g = new THREE.Group();
  box(g, 4.8, 4.1, 2.7, .24, M.tv, 0, 2.23, 0);
  box(g, 4.68, 4.03, .22, .14, M.tvFront, 0, 2.23, 1.36);
  box(g, 4.11, 3.13, .16, .16, M.darkPlastic, -.04, 2.6, 1.51);
  box(g, 3.97, 2.99, .075, .15, M.black, -.04, 2.61, 1.6);
  const geometry = new THREE.PlaneGeometry(3.83, 2.85, 48, 36);
  const positions = geometry.attributes.position;
  for (let i = 0; i < positions.count; i++) {
    const x = positions.getX(i) / 1.915, y = positions.getY(i) / 1.425;
    positions.setZ(i, .13 * (1 - x * x) * (1 - y * y));
  }
  geometry.computeVertexNormals();
  screenCanvas = document.createElement('canvas'); screenCanvas.width = 1024; screenCanvas.height = 768;
  screenTexture = textureFromCanvas(screenCanvas);
  screenMaterial = new THREE.ShaderMaterial({ uniforms: { uMap: { value: screenTexture }, uTime: { value: 0 }, uSwitch: { value: 0 } },
    vertexShader: `varying vec2 vUv; void main(){vUv=uv;gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.);}`,
    fragmentShader: `uniform sampler2D uMap;uniform float uTime;uniform float uSwitch;varying vec2 vUv;
      float noise(vec2 p){return fract(sin(dot(p,vec2(12.9898,78.233)))*43758.5453);}
      void main(){vec2 q=abs(vUv-.5)-vec2(.458,.455);float edge=length(max(q,0.))+min(max(q.x,q.y),0.)-.039;if(edge>0.)discard;
      vec2 uv=vUv;uv.x+=uSwitch*.012*sin(uv.y*87.+uTime*43.);vec3 col=texture2D(uMap,uv).rgb;
      col*=.96+.04*sin(vUv.y*720.);float vignette=1.-.38*pow(length((vUv-.5)*1.36),2.);col*=vignette;
      float glare=exp(-length((vUv-vec2(.2,.83))*vec2(3.,2.))*3.)*.045;col+=vec3(glare);
      float snow=noise(floor(vUv*vec2(550.,400.))+floor(uTime*32.));col=mix(col,vec3(snow),uSwitch*.85);
      gl_FragColor=vec4(col,1.);#include <tonemapping_fragment>\n#include <colorspace_fragment>}`.replace(';#include',';\n#include'), toneMapped: false });
  const display = new THREE.Mesh(geometry, screenMaterial); display.position.set(-.04, 2.61, 1.665); g.add(display);
  const holeGeo = new THREE.CylinderGeometry(.014, .014, .018, 6);
  const holes = new THREE.InstancedMesh(holeGeo, M.speaker, 160); const dummy = new THREE.Object3D(); let index = 0;
  for (const side of [-1, 1]) for (let col = 0; col < 16; col++) for (let row = 0; row < 5; row++) {
    dummy.position.set(side * 1.76 + (col - 7.5) * .053, .49 + row * .063, 1.484); dummy.rotation.x = Math.PI / 2; dummy.updateMatrix(); holes.setMatrixAt(index++, dummy.matrix);
  }
  g.add(holes);
  for (let i = 0; i < 6; i++) cylinder(g, .042, .029, M.darkPlastic, -.87 + i * .25, .59, 1.505, true);
  cylinder(g, .097, .025, M.tv, .9, .59, 1.515, true);
  cylinder(g, .018, .035, new THREE.MeshStandardMaterial({ color: '#a74a33', emissive: '#7c2416', emissiveIntensity: .2 }), .65, .59, 1.505, true);
  label(g, 'STEREO  •  COLOR MONITOR', 1.35, .08, [0, .82, 1.491], { size: 35, color: '#5e6157' });
  label(g, 'AV  ·  1', .27, .05, [-.89, .41, 1.493], { size: 45 });
  box(g, 3.55, .19, 1.95, .08, M.darkPlastic, 0, .12, .1);
  for (let i = 0; i < 13; i++) box(g, .018, .65, .025, .008, M.vent, 2.404, 2.02, -.65 + i * .09);
  return g;
}
function createConsole() {
  const g = new THREE.Group();
  box(g, 3.85, .81, 3.03, .2, M.shell, 0, .53, 0);
  box(g, 3.65, .12, 2.88, .06, M.shellLight, 0, .96, -.025);
  box(g, 3.12, .038, 1.91, .019, M.panel, 0, 1.04, -.37);
  box(g, 2.45, .028, .31, .014, M.trim, 0, 1.068, -.83);
  box(g, 2.29, .035, .155, .015, M.black, 0, 1.078, -.83);
  box(g, 2.22, .022, .049, .009, M.darkPlastic, 0, 1.1, -.77);
  const powerBase = box(g, .58, .054, .58, .027, M.trim, -1.04, 1.077, .21);
  box(g, .44, .065, .25, .028, M.darkPlastic, -1.04, 1.125, .12);
  label(g, 'POWER', .33, .1, [-1.04, 1.116, .4], { size: 70, color: '#4e5148' }, true);
  const eject = box(g, 1.02, .08, .58, .04, M.button, 0, 1.107, .24); eject.userData.action = 'eject'; actionMeshes.push(eject);
  label(g, 'EJECT', .48, .12, [0, 1.151, .33], { size: 60, color: '#d0d2c8' }, true);
  box(g, .57, .061, .58, .03, M.trim, 1.08, 1.082, .21);
  box(g, .45, .044, .46, .022, M.button, 1.08, 1.124, .21);
  label(g, 'RESET', .35, .08, [1.08, 1.149, .29], { size: 65, color: '#dddcd2' }, true);
  label(g, 'Nintendo\nSUPER Famicom', 1.53, .39, [-.89, 1.027, .985], { size: 64, width: 1024, height: 280, align: 'left', color: '#55574d' }, true);
  [[-.07,-.08,'#3b82ab'],[.07,-.08,'#ce4f3d'],[-.07,.06,'#479664'],[.07,.06,'#ddb534']].forEach(([dx,dz,color]) => {
    const logo = cylinder(g, .074, .009, new THREE.MeshStandardMaterial({color,roughness:.55}), 1.29 + dx, 1.033, -.98 + dz); logo.scale.x = 1.1;
  });
  box(g, 3.2, .36, .045, .022, M.shellLight, 0, .5, 1.516);
  box(g, .86, .3, .04, .019, M.trim, -.94, .49, 1.548);
  box(g, .75, .245, .055, .026, M.black, -.94, .49, 1.574);
  box(g, .68, .29, .32, .055, M.plug, -.94, .49, 1.736);
  for (let i = 0; i < 5; i++) box(g, .035, .16, .23, .01, M.plugDetail, -.94 + (i - 2) * .09, .49, 1.75);
  label(g, 'Nintendo', .39, .07, [-.94, .647, 1.745], { size: 65, color:'#575953' }, true);
  box(g, .82, .26, .05, .024, M.trim, .82, .49, 1.549);
  box(g, .72, .196, .055, .027, M.black, .82, .49, 1.578);
  for (let i = 0; i < 7; i++) {
    const x = .82 - .27 + i * .082 + (i > 3 ? .035 : 0);
    cylinder(g, .023, .012, M.portHole, x, .49, 1.61, true, 14);
  }
  label(g, '1', .11, .12, [-1.5,.49,1.551], { size: 160,color:'#797d6f' });
  label(g, '2', .11, .12, [1.47,.49,1.551], { size: 160,color:'#797d6f' });
  cylinder(g, .055, .025, M.shell, 0, .49, 1.558, true);
  ledMaterial = new THREE.MeshStandardMaterial({ color:'#59291e',emissive:'#dc3f19',emissiveIntensity:0 });
  box(g, .13, .017, .035, .009, ledMaterial, 0, 1.032, .93);
  for (const x of [-1.4,1.4]) for(const z of [-1,1]) cylinder(g,.13,.06,M.rubber,x,.093,z);
  return g;
}
function createController() {
  const g=new THREE.Group();
  const shape=new THREE.Shape();
  shape.moveTo(-.65,.47);shape.bezierCurveTo(-1.7,.84,-1.83,-.72,-.76,-.67);shape.bezierCurveTo(-.2,-.48,.2,-.48,.76,-.67);shape.bezierCurveTo(1.83,-.72,1.7,.84,.65,.47);shape.bezierCurveTo(.2,.34,-.2,.34,-.65,.47);
  const geom=new THREE.ExtrudeGeometry(shape,{depth:.2,bevelEnabled:true,bevelSegments:4,steps:1,bevelSize:.08,bevelThickness:.07,curveSegments:24});
  const body=new THREE.Mesh(geom,M.shellLight);body.rotation.x=-Math.PI/2;body.position.y=.14;body.castShadow=true;body.receiveShadow=true;g.add(body);
  cylinder(g,.405,.03,M.panel,-.85,.43,.025,false,48);
  box(g,.205,.115,.66,.025,M.dpad,-.85,.491,.025);
  box(g,.66,.117,.205,.025,M.dpad,-.85,.493,.025);
  cylinder(g,.065,.005,M.darkPlastic,-.85,.554,.025);
  const buttonPositions=[ [.83,-.27,'#436ba6','X'],[.55,.01,'#2f9365','Y'],[.85,.29,'#e8ba31','B'],[1.14,.01,'#d7463c','A'] ];
  buttonPositions.forEach(([x,z,color,text])=>{
    cylinder(g,.165,.025,M.trim,x,.436,z); cylinder(g,.14,.085,new THREE.MeshPhysicalMaterial({color,roughness:.31,clearcoat:.45}),x,.482,z);
    label(g,text,.09,.095,[x+(text==='Y'?-.22:.18),.453,z+.1],{size:100,color:'#eeeede'},true);
  });
  for(let i=0;i<2;i++){
    const btn=box(g,.11,.07,.27,.034,M.dpad,-.22+i*.34,.455,.08);btn.rotation.y=-.52;
    label(g,i?'START':'SELECT',.24,.07,[-.22+i*.34,.449,.3],{size:70,color:'#4a4e43'},true);
  }
  label(g,'Nintendo\nSUPER FAMICOM',1.1,.24,[-.1,.436,-.29],{size:70,width:1024,height:256,color:'#555a4c'},true);
  box(g,.35,.075,.09,.035,M.button,-.98,.33,-.55);box(g,.35,.075,.09,.035,M.button,.98,.33,-.55);
  return g;
}
function cartridgeLabel(key) {
  const world=WORLDS[key],c=document.createElement('canvas');c.width=1024;c.height=410;const ctx=c.getContext('2d');
  roundedCanvas(ctx,0,0,1024,410,24,world.color);
  let seed=81;for(let i=0;i<5000;i++){seed=(seed*16807)%2147483647;ctx.fillStyle=`rgba(40,45,29,${.008+(seed%20)/1500})`;ctx.fillRect(seed%1024,(seed>>9)%410,1,1);}
  ctx.fillStyle=world.ink;ctx.font='bold 22px Arial';ctx.fillText('SUPER FAMICOM',35,42);ctx.font='18px monospace';ctx.textAlign='right';ctx.fillText('16 BIT / '+world.number,986,42);ctx.textAlign='left';
  ctx.globalAlpha=.16;ctx.strokeStyle=world.ink;ctx.lineWidth=4;
  if(key==='m9dy'){for(let r=55;r<240;r+=28){ctx.beginPath();ctx.arc(818,243,r,0,Math.PI*2);ctx.stroke();}}
  if(key==='fire'){ctx.font='900 390px "Noto Sans TC",sans-serif';ctx.fillText('火',600,385);}
  if(key==='untitled'){ctx.font='360px Arial';ctx.fillText('✳',695,373);}
  ctx.globalAlpha=1;ctx.fillStyle=world.ink;
  if(key==='m9dy'){ctx.font='bold 200px "Space Grotesk",Arial';ctx.fillText('M9DY',32,275);}
  if(key==='fire'){ctx.font='900 184px "Noto Sans TC",sans-serif';ctx.fillText('無名火',32,275);}
  if(key==='untitled'){ctx.font='174px Georgia';ctx.fillText('Untitled',32,252);ctx.font='34px "Space Grotesk",Arial';ctx.fillText('Design Agency',42,308);}
  ctx.font='18px monospace';ctx.fillText(key==='untitled'?'IDEAS AT PLAY.':'ORIGINAL WORLD / '+world.number,39,379);
  ctx.strokeStyle='rgba(50,55,40,.2)';ctx.lineWidth=2;ctx.strokeRect(13,12,998,386);return textureFromCanvas(c);
}
function createCartridge(key,index) {
  const g=new THREE.Group();g.userData={kind:'cartridge',key,index,target:new THREE.Vector3(),targetRotation:new THREE.Euler(),mode:'rack'};
  box(g,2.25,1.5,.29,.08,M.cart,0,0,0,4);
  box(g,2.11,1.37,.022,.011,M.cartFace,0,.015,.149);
  const labelMap=cartridgeLabel(key);g.userData.labelMap=labelMap;
  const printed=new THREE.Mesh(new THREE.PlaneGeometry(1.91,.765),new THREE.MeshStandardMaterial({map:labelMap,transparent:true,roughness:.57,metalness:0,polygonOffset:true,polygonOffsetFactor:-1}));
  printed.position.set(0,.255,.163);g.add(printed);
  box(g,1.51,.155,.021,.01,M.trim,0,-.305,.164);
  box(g,1.39,.099,.024,.012,M.vent,0,-.306,.18);
  for(let i=0;i<4;i++)box(g,1.31,.008,.012,.004,M.cart,-.005,-.34+i*.022,.195);
  for(const x of [-.96,.96]){
    cylinder(g,.047,.011,M.metal,x,-.584,.169,true,20);
    box(g,.054,.009,.008,.003,M.speaker,x,-.584,.18);box(g,.009,.054,.008,.003,M.speaker,x,-.584,.18);
  }
  for(const side of [-1,1])for(let i=0;i<4;i++)box(g,.03,.034,.17,.008,M.trim,side*1.126,.48-i*.145,.02);
  box(g,.008,1.38,.012,.004,M.trim,.962,.01,.168);
  box(g,1.69,.057,.19,.025,M.darkPlastic,0,-.759,0);
  for(let i=0;i<8;i++)box(g,.028,.029,.011,.005,M.gold,-.49+i*.14,-.795,.04);
  const hit=new THREE.Mesh(new THREE.BoxGeometry(2.3,1.85,.37),new THREE.MeshBasicMaterial({visible:false}));hit.position.y=-.1;hit.userData.card=g;g.add(hit);g.userData.hit=hit;
  return g;
}
function createRack() {
  const g=new THREE.Group();
  box(g,2.62,.14,2.65,.06,M.rack,0,.12,0);
  for(let i=0;i<3;i++)box(g,2.33,.1,.25,.04,M.rack,0,.235+i*.13,.8-i*.79);
  for(let i=0;i<4;i++){
    const wall=box(g,2.55,.5,.045,.022,M.rack,0,.41,-1.17+i*.78);wall.rotation.x=-.11;
  }
  box(g,.045,.4,2.56,.02,M.rack,-1.285,.37,0);box(g,.045,.4,2.56,.02,M.rack,1.285,.37,0);
  for(const x of [-1.03,1.03])for(const z of [-1.02,1.02])cylinder(g,.07,.045,M.rubber,x,.028,z);
  return g;
}
function drawScreen(time, force=false) {
  if(!force && time-lastScreenPaint<(reduceMotion.matches?60:.055))return;
  lastScreenPaint=time;const ctx=screenCanvas.getContext('2d'),playing=installed===selected;
  ctx.clearRect(0,0,1024,768);
  if(selected==='m9dy'){
    const gradient=ctx.createRadialGradient(512,410,30,512,410,720);gradient.addColorStop(0,'#274832');gradient.addColorStop(1,'#07160e');ctx.fillStyle=gradient;ctx.fillRect(0,0,1024,768);
    ctx.strokeStyle='rgba(177,215,124,.14)';ctx.lineWidth=2;
    for(let i=0;i<4;i++){ctx.beginPath();ctx.ellipse(512,388,235+i*31,200,Math.sin(time*.22+i)*.4,0,Math.PI*2);ctx.stroke();}
    ctx.fillStyle='#d6efa3';ctx.font='bold 211px "Space Grotesk",Arial';ctx.textAlign='center';ctx.fillText('M9DY',510,458);
    ctx.font='18px monospace';ctx.fillText('PLAY BY YOUR OWN RULES',512,236);ctx.font='16px monospace';ctx.fillText('YOUR NEXT WORLD STARTS HERE.',512,535);
  }else if(selected==='fire'){
    const gradient=ctx.createRadialGradient(560,710,40,512,400,750);gradient.addColorStop(0,'#783010');gradient.addColorStop(1,'#1e0c05');ctx.fillStyle=gradient;ctx.fillRect(0,0,1024,768);
    ctx.fillStyle='rgba(215,93,31,.16)';ctx.font='900 535px "Noto Sans TC",sans-serif';ctx.textAlign='center';ctx.fillText('火',808,735+Math.sin(time)*12);
    ctx.shadowColor='#bf441b';ctx.shadowBlur=15;ctx.fillStyle='#ffc27c';ctx.font='900 187px "Noto Sans TC",sans-serif';ctx.fillText('無名火',518,465);ctx.shadowBlur=0;
    ctx.font='18px monospace';ctx.fillText('KEEP THE FIRE ALIVE',512,236);ctx.font='16px monospace';ctx.fillText('A SPARK. A WORLD. A NEW BEGINNING.',512,548);
  }else{
    ctx.fillStyle='#b8c6eb';ctx.fillRect(0,0,1024,768);ctx.strokeStyle='rgba(28,55,110,.08)';ctx.lineWidth=1;
    for(let x=0;x<1024;x+=90){ctx.beginPath();ctx.moveTo(x,0);ctx.lineTo(x,768);ctx.stroke();}for(let y=0;y<768;y+=90){ctx.beginPath();ctx.moveTo(0,y);ctx.lineTo(1024,y);ctx.stroke();}
    ctx.save();ctx.translate(793,521);ctx.rotate(reduceMotion.matches?0:time*.1);ctx.fillStyle='#eaffaa';ctx.textAlign='center';ctx.font='370px Arial';ctx.fillText('✳',0,115);ctx.restore();
    ctx.fillStyle='#263763';ctx.textAlign='left';ctx.font='174px Georgia';ctx.fillText('Untitled',105,418);ctx.font='45px "Space Grotesk",Arial';ctx.fillText('Design Agency',115,485);
    ctx.textAlign='center';ctx.font='16px monospace';ctx.fillText('AN OPEN CANVAS FOR WHAT’S NEXT',512,236);ctx.fillText('GOOD THINGS START UNTITLED.',512,609);
  }
  const ink=selected==='untitled'?'#2d416e':selected==='fire'?'#d89b63':'#a4c785';ctx.fillStyle=ink;ctx.font='17px monospace';ctx.textAlign='left';ctx.fillText('▪ AV 1',68,76);ctx.textAlign='right';ctx.fillText('WORLD '+WORLDS[selected].number,953,76);
  ctx.textAlign='left';ctx.font='15px monospace';ctx.fillText(playing?'● NOW PLAYING':'○ PREVIEW / DRAG TO PLAY',68,707);ctx.textAlign='right';ctx.fillText('16-BIT / 60 Hz',953,707);
  if(time<bootUntil){ctx.fillStyle='rgba(205,244,170,.04)';ctx.fillRect(0,0,1024,768);}
  screenTexture.needsUpdate=true;
}
function updateUI() {
  canvas.dataset.selected=selected;canvas.dataset.inserted=installed||'';
  document.querySelector('#selected-name').textContent=WORLDS[selected].name;
  document.querySelector('#selected-number').textContent=WORLDS[selected].number;
  document.querySelector('#selection-label').textContent=installed===selected?'NOW PLAYING':'PREVIEW';
  document.querySelector('#eject-button').hidden=!installed;
  document.querySelector('#insert-button').setAttribute('aria-label',`將 ${WORLDS[selected].name} 插入主機`);
  document.querySelectorAll('[data-key]').forEach(b=>b.setAttribute('aria-pressed',String(b.dataset.key===selected)));
  ledMaterial.emissiveIntensity=installed?2.1:0;
  document.querySelector('#scene-caption').style.opacity=installed?'.35':'1';
}
function selectWorld(key,force=false) {
  if(!WORLDS[key])return;const changed=key!==selected;selected=key;
  if(changed||force){transitionStarted=clock.elapsedTime;drawScreen(clock.elapsedTime,true);}
  updateUI();if(changed){tone(keys.indexOf(key));announce(`預覽 ${WORLDS[key].name}，拖到主機插槽即可插入。`);}
}
function homeCard(card) {
  card.userData.mode='rack';card.userData.target.copy(rackHomes.get(card.userData.key).position);card.userData.targetRotation.copy(rackHomes.get(card.userData.key).rotation);
}
function insertCard(key) {
  if(!WORLDS[key])return;clearTimeout(insertionTimer);
  if(installed&&installed!==key)homeCard(cards.find(c=>c.userData.key===installed));
  const card=cards.find(c=>c.userData.key===key);installed=key;card.userData.mode='inserted';
  card.userData.target.copy(insertedPosition);card.userData.targetRotation.set(0,0,0);
  if(!reduceMotion.matches){card.userData.target.y+=.4;insertionTimer=setTimeout(()=>{if(installed===key)card.userData.target.copy(insertedPosition);},190);}
  hovered=null;selectWorld(key,true);bootUntil=clock.elapsedTime+.7;tone(keys.indexOf(key),true);
  announce(`${WORLDS[key].name} 已插入主機。拖回卡帶架或按取出可換帶。`);
}
function ejectCard() {
  if(!installed)return;clearTimeout(insertionTimer);const key=installed;installed=null;
  homeCard(cards.find(c=>c.userData.key===key));selectWorld(selected,true);announce(`${WORLDS[key].name} 已取出。`);
}
function updateCable() {
  if(cable){scene.remove(cable);cable.geometry.dispose();}
  const a=consoleModel.position.clone().add(new THREE.Vector3(-.94,.47,1.93));
  const b=new THREE.Vector3(0,.23,-.62).applyMatrix4(controller.matrixWorld);
  const curve=new THREE.CatmullRomCurve3([a,a.clone().add(new THREE.Vector3(0,-.3,.28)),new THREE.Vector3(a.x-.3,.08,a.z+1.08),new THREE.Vector3(b.x-.5,.07,a.z+.9),new THREE.Vector3(b.x-.9,.12,b.z-.2),b]);
  cable=new THREE.Mesh(new THREE.TubeGeometry(curve,90,.047,10,false),M.cable);cable.castShadow=true;scene.add(cable);
}
function layout() {
  const w=innerWidth,h=innerHeight,portrait=w/h<.85;
  tv.position.set(portrait?-.55:-1.25,0,-1.65);
  consoleModel.position.set(portrait?-.5:-1.18,0,2.03);
  controller.position.set(portrait?-1.8:-4.06,0,portrait?4.95:4.05);controller.rotation.y=portrait?-.17:-.22;
  rack.position.set(portrait?1.5:3.2,0,portrait?4.98:1.04);rack.rotation.y=-.3;
  scene.updateMatrixWorld(true);
  cards.forEach((card,i)=>{
    const local=new THREE.Vector3(0,1.08+i*.13,.8-i*.79);const position=rack.localToWorld(local);
    const rotation=new THREE.Euler(-.055,-.3,0);rackHomes.set(card.userData.key,{position:position.clone(),rotation});
    if(card.userData.mode!=='inserted')homeCard(card);
  });
  slot.copy(consoleModel.position).add(new THREE.Vector3(0,1.105,-.83));insertedPosition.copy(slot).add(new THREE.Vector3(0,.47,0));
  slotRing.position.copy(slot);slotRing.position.y+=.014;slotCollider.position.copy(slot);
  if(installed){const card=cards.find(c=>c.userData.key===installed);card.userData.target.copy(insertedPosition);}
  cards.forEach(c=>{c.position.copy(c.userData.target);c.rotation.copy(c.userData.targetRotation);});
  scene.updateMatrixWorld(true);updateCable();
  camera.aspect=w/h;camera.fov=portrait?38:33;camera.updateProjectionMatrix();
  defaultTarget.set(portrait?.05:0,1.35,portrait?.9:.72);
  controls.minDistance=0;controls.maxDistance=Infinity;const distance=portrait?19.2:(w/h>2?15:15.8);
  defaultCamera.copy(defaultTarget).add(new THREE.Vector3(portrait?3.8:5.8,6.5,14).normalize().multiplyScalar(distance));
  camera.position.copy(defaultCamera);controls.target.copy(defaultTarget);controls.update();
  // Fit real model bounds inside the scene, leaving space for the bottom controls.
  const minViewY=-1+2*(h<550?105:160)/h;
  const corners=[];modelObjects.forEach(o=>{const bounds=new THREE.Box3().setFromObject(o);for(const x of [bounds.min.x,bounds.max.x])for(const y of [bounds.min.y,bounds.max.y])for(const z of [bounds.min.z,bounds.max.z])corners.push(new THREE.Vector3(x,y,z));});
  for(let i=0;i<40;i++){
    camera.updateMatrixWorld();const points=corners.map(p=>p.clone().project(camera));
    if(points.every(p=>Math.abs(p.x)<.94&&p.y<.8&&p.y>minViewY))break;
    camera.position.sub(defaultTarget).multiplyScalar(1.025).add(defaultTarget);controls.update();
  }
  defaultCamera.copy(camera.position);controls.minDistance=camera.position.distanceTo(defaultTarget)*.76;controls.maxDistance=camera.position.distanceTo(defaultTarget)*1.3;
  tableShadows.forEach(({mesh,object})=>mesh.position.set(object.position.x,.018,object.position.z));renderer.shadowMap.needsUpdate=true;renderer.setSize(w,h);renderer.setPixelRatio(Math.min(devicePixelRatio,portrait?1.5:1.65));
}
function screenPoint(v) {
  const p=v.clone().project(camera);const r=canvas.getBoundingClientRect();return{x:r.left+(p.x+1)*r.width/2,y:r.top+(1-p.y)*r.height/2};
}
function pointerRay(e) {const r=canvas.getBoundingClientRect();pointer.set((e.clientX-r.left)/r.width*2-1,-(e.clientY-r.top)/r.height*2+1);raycaster.setFromCamera(pointer,camera);}
function hitCard() {const hit=raycaster.intersectObjects(cards.map(c=>c.userData.hit),false)[0];return hit?.object.userData.card||null;}
function isSlotDrop(e) {
  const p=screenPoint(slot),edge=screenPoint(slot.clone().add(new THREE.Vector3(1.2,0,0)));const tolerance=Math.max(30,Math.abs(edge.x-p.x)*.98);
  return Math.abs(e.clientX-p.x)<tolerance&&Math.abs(e.clientY-p.y)<Math.max(29,tolerance*.55);
}
function showDropHint(valid) {const p=screenPoint(slot);hint.style.left=p.x+'px';hint.style.top=(p.y-12)+'px';hint.textContent=valid?'放開，插入卡帶':'拖到主機插槽';hint.classList.add('is-visible');hint.classList.toggle('is-over',valid);slotRing.material.color.set(valid?'#9fbf5e':'#cad69e');}
function cancelDrag() {
  if(!pointerStart&&!dragging)return;
  if(dragging){const c=dragging.card;if(installed===c.userData.key){c.userData.target.copy(insertedPosition);c.userData.mode='inserted';}else homeCard(c);}
  dragging=null;pointerStart=null;controls.enabled=true;slotRing.visible=false;hint.classList.remove('is-visible','is-over');canvas.classList.remove('is-dragging');announce('已取消拖曳。');
}
function onPointerDown(e) {
  if(e.button!==0||!e.isPrimary)return;pointerRay(e);const card=hitCard();
  if(card){controls.enabled=false;e.stopImmediatePropagation();selectWorld(card.userData.key);pointerStart={x:e.clientX,y:e.clientY,card,id:e.pointerId};canvas.setPointerCapture(e.pointerId);return;}
  if(raycaster.intersectObjects(actionMeshes,false).length){controls.enabled=false;e.stopImmediatePropagation();ejectCard();setTimeout(()=>controls.enabled=true,0);return;}
  if(raycaster.intersectObject(slotCollider,false).length){controls.enabled=false;e.stopImmediatePropagation();insertCard(selected);setTimeout(()=>controls.enabled=true,0);}
}
function onPointerMove(e) {
  pointerRay(e);
  if(pointerStart&&e.pointerId===pointerStart.id){
    if(!dragging&&Math.hypot(e.clientX-pointerStart.x,e.clientY-pointerStart.y)>5){
      const card=pointerStart.card;dragPlane.setFromNormalAndCoplanarPoint(camera.getWorldDirection(new THREE.Vector3()),card.position);
      raycaster.ray.intersectPlane(dragPlane,rayPoint);dragging={card,offset:card.position.clone().sub(rayPoint)};card.userData.mode='drag';canvas.classList.add('is-dragging');slotRing.visible=true;
      announce('拖到主機插槽後放開。按 Escape 可取消。');
    }
    if(dragging){e.preventDefault();if(raycaster.ray.intersectPlane(dragPlane,rayPoint)){dragging.card.position.copy(rayPoint).add(dragging.offset);dragging.card.position.y=Math.max(.8,dragging.card.position.y);dragging.card.rotation.x=0;dragging.card.rotation.y*=.7;}showDropHint(isSlotDrop(e));}
    return;
  }
  if(e.pointerType==='touch')return;
  const card=hitCard();hovered=card?.userData.key||null;
  if(card){canvas.dataset.hover=card.userData.key;selectWorld(card.userData.key);}else delete canvas.dataset.hover;
}
function onPointerUp(e) {
  if(!pointerStart||e.pointerId!==pointerStart.id)return;const started=pointerStart;pointerStart=null;
  if(canvas.hasPointerCapture(e.pointerId))canvas.releasePointerCapture(e.pointerId);
  controls.enabled=true;canvas.classList.remove('is-dragging');hint.classList.remove('is-visible','is-over');slotRing.visible=false;
  if(dragging){
    const card=dragging.card,key=card.userData.key;dragging=null;
    if(isSlotDrop(e)){insertCard(key);return;}
    const rp=screenPoint(rack.position.clone().add(new THREE.Vector3(0,.8,0)));const overRack=Math.hypot(e.clientX-rp.x,e.clientY-rp.y)<Math.max(70,innerWidth*.11);
    if(installed===key){if(overRack)ejectCard();else{card.userData.mode='inserted';card.userData.target.copy(insertedPosition);}}
    else homeCard(card);
    announce(overRack?'卡帶已放回架上。':'未到達插槽，卡帶已返回原位。');
  }else{selectWorld(started.card.userData.key);hovered=started.card.userData.key;}
}
function init() {
  renderer=new THREE.WebGLRenderer({canvas,antialias:true,alpha:false,powerPreference:'high-performance'});
  renderer.outputColorSpace=THREE.SRGBColorSpace;renderer.toneMapping=THREE.ACESFilmicToneMapping;renderer.toneMappingExposure=.88;
  renderer.shadowMap.enabled=true;renderer.shadowMap.type=THREE.PCFSoftShadowMap;renderer.shadowMap.autoUpdate=false;renderer.shadowMap.needsUpdate=true;
  scene=new THREE.Scene();scene.background=new THREE.Color('#f5f5f2');scene.fog=new THREE.Fog('#f5f5f2',27,70);
  camera=new THREE.PerspectiveCamera(33,innerWidth/innerHeight,.1,100);
  controls=new OrbitControls(camera,canvas);controls.enableDamping=true;controls.dampingFactor=.07;controls.enablePan=false;controls.enableZoom=true;controls.minPolarAngle=.75;controls.maxPolarAngle=1.3;controls.minAzimuthAngle=-.48;controls.maxAzimuthAngle=.75;controls.rotateSpeed=.45;controls.addEventListener('start',()=>{orbiting=true;});controls.addEventListener('end',()=>{orbiting=false;orbitSettles=performance.now()+450;});
  const pmrem=new THREE.PMREMGenerator(renderer);const room=new RoomEnvironment();scene.environment=pmrem.fromScene(room,.04).texture;scene.environmentIntensity=.6;room.dispose();pmrem.dispose();
  scene.add(new THREE.HemisphereLight('#ffffff','#b7b5a9',.7));
  const key=new THREE.DirectionalLight('#fff9ed',2.7);key.position.set(-4.5,10,7);key.castShadow=true;key.shadow.mapSize.set(1024,1024);key.shadow.camera.left=-11;key.shadow.camera.right=11;key.shadow.camera.top=10;key.shadow.camera.bottom=-10;key.shadow.camera.far=30;key.shadow.normalBias=.035;key.shadow.bias=-.0002;key.shadow.radius=4;scene.add(key);
  const fill=new THREE.DirectionalLight('#e6edfa',.7);fill.position.set(7,6,-3);scene.add(fill);
  const grain=plasticGrain();const plastic=(color,roughness=.6)=>new THREE.MeshStandardMaterial({color,roughness,bumpMap:grain,bumpScale:.012});
  M.shell=plastic('#a8aba2');M.shellLight=plastic('#bbbbb1');M.panel=plastic('#9a9e96');M.trim=plastic('#777e74');M.button=plastic('#777c73',.5);M.darkPlastic=plastic('#41463e');M.black=plastic('#1c211c');M.tv=plastic('#858b81');M.tvFront=plastic('#999d92');M.vent=new THREE.MeshStandardMaterial({color:'#485144',roughness:.95});M.speaker=new THREE.MeshStandardMaterial({color:'#353c31',roughness:1});M.rubber=plastic('#2b3028',.98);M.cart=plastic('#aaaea4',.58);M.cartFace=plastic('#b8baaf',.61);M.dpad=plastic('#444a41',.72);M.plug=plastic('#30372f',.76);M.plugDetail=plastic('#252c24',.8);M.portHole=new THREE.MeshStandardMaterial({color:'#737767',roughness:.8});M.metal=new THREE.MeshStandardMaterial({color:'#8f9180',metalness:.78,roughness:.37});M.gold=new THREE.MeshStandardMaterial({color:'#bfa35d',metalness:.8,roughness:.44});M.cable=plastic('#242b24',.76);
  M.rack=new THREE.MeshPhysicalMaterial({color:'#6f786a',roughness:.2,metalness:0,transmission:0,transparent:true,opacity:.38,thickness:.1,ior:1.46,depthWrite:false,side:THREE.DoubleSide});
  const floor=new THREE.Mesh(new THREE.PlaneGeometry(150,150),new THREE.MeshStandardMaterial({color:'#f5f5ef',roughness:.93}));floor.rotation.x=-Math.PI/2;floor.receiveShadow=true;scene.add(floor);
  tv=createCRT();consoleModel=createConsole();controller=createController();rack=createRack();[tv,consoleModel,controller,rack].forEach(o=>{scene.add(o);modelObjects.push(o);});
  keys.forEach((key,index)=>{const card=createCartridge(key,index);scene.add(card);cards.push(card);});
  slotRing=new THREE.Mesh(new THREE.TorusGeometry(1.11,.021,10,72),new THREE.MeshBasicMaterial({color:'#bdd58b',transparent:true,opacity:.9,depthTest:false}));slotRing.rotation.x=-Math.PI/2;slotRing.scale.y=.21;slotRing.visible=false;slotRing.renderOrder=99;scene.add(slotRing);
  slotCollider=new THREE.Mesh(new THREE.BoxGeometry(2.6,.1,.58),new THREE.MeshBasicMaterial({visible:false}));scene.add(slotCollider);
  layout();tableShadows.push({mesh:contactShadow(tv.position.x,tv.position.z,5.6,3.6,.44),object:tv},{mesh:contactShadow(consoleModel.position.x,consoleModel.position.z,4.5,3.5,.3),object:consoleModel});
  updateUI();drawScreen(0,true);
  canvas.addEventListener('pointerdown',onPointerDown,true);canvas.addEventListener('pointermove',onPointerMove);canvas.addEventListener('pointerup',onPointerUp);canvas.addEventListener('pointercancel',cancelDrag);
  canvas.addEventListener('pointerleave',()=>{if(!dragging&&!pointerStart){hovered=null;delete canvas.dataset.hover;if(installed)selectWorld(installed);}});
  canvas.addEventListener('webglcontextlost',e=>{e.preventDefault();cancelDrag();active=false;document.querySelector('#fallback').hidden=false;});
  window.addEventListener('resize',()=>{cancelDrag();layout();});window.addEventListener('blur',cancelDrag);
  document.addEventListener('visibilitychange',()=>{active=!document.hidden;});
  document.fonts.ready.then(()=>{drawScreen(clock.elapsedTime,true);cards.forEach(card=>{const old=card.userData.labelMap;const tex=cartridgeLabel(card.userData.key);const mesh=card.children.find(m=>m.material?.map===old);if(mesh){mesh.material.map=tex;mesh.material.needsUpdate=true;}card.userData.labelMap=tex;old.dispose();});});
  window.__deskDebug=()=>({selected,installed,dragging:dragging?.card.userData.key||null,webgl:renderer.capabilities.isWebGL2,drawCalls:renderer.info.render.calls,triangles:renderer.info.render.triangles,slot:screenPoint(slot),rack:screenPoint(rack.position.clone().add(new THREE.Vector3(0,.8,0))),cards:cards.map(c=>({key:c.userData.key,mode:c.userData.mode,point:screenPoint(c.localToWorld(new THREE.Vector3(0,.66,.21))),position:c.position.toArray()}))});
  requestAnimationFrame(render);
}
function render(now) {
  requestAnimationFrame(render);if(!active)return;
  const elapsed=clock.getElapsedTime();const dt=Math.min((now-lastFrame)/1000,.18);
  const busy=dragging||pointerStart||resetCamera||orbiting||now<orbitSettles||cards.some(c=>c.position.distanceToSquared(c.userData.target)>.0001);
  if(now-lastFrame<(busy?30:80))return;lastFrame=now;
  if(resetCamera){const resetAlpha=reduceMotion.matches?1:1-Math.exp(-dt*11);camera.position.lerp(defaultCamera,resetAlpha);controls.target.lerp(defaultTarget,resetAlpha);if(camera.position.distanceTo(defaultCamera)<.015){camera.position.copy(defaultCamera);controls.target.copy(defaultTarget);resetCamera=false;}}
  controls.update();
  cards.forEach(card=>{
    if(dragging?.card===card){renderer.shadowMap.needsUpdate=true;return;}
    temp.copy(card.userData.target);if(card.userData.mode==='rack'&&hovered===card.userData.key){temp.y+=.48;temp.z+=.07;}
    if(card.position.distanceToSquared(temp)>.00001)renderer.shadowMap.needsUpdate=true;const alpha=reduceMotion.matches?1:1-Math.exp(-dt*12);card.position.lerp(temp,alpha);
    card.rotation.x=THREE.MathUtils.damp(card.rotation.x,card.userData.targetRotation.x,12,dt);card.rotation.y=THREE.MathUtils.damp(card.rotation.y,card.userData.targetRotation.y,12,dt);
  });
  screenMaterial.uniforms.uTime.value=reduceMotion.matches?0:elapsed;screenMaterial.uniforms.uSwitch.value=reduceMotion.matches?0:Math.max(0,1-(elapsed-transitionStarted)/.4);
  drawScreen(elapsed);renderer.render(scene,camera);
  if(readyFrames<3&&++readyFrames===3){loading.classList.add('is-ready');canvas.dataset.ready='true';}
}

document.querySelector('#retry-button').addEventListener('click',()=>location.reload());
document.querySelector('#sound-toggle').addEventListener('click',e=>{soundEnabled=!soundEnabled;e.currentTarget.setAttribute('aria-pressed',String(soundEnabled));e.currentTarget.setAttribute('aria-label',soundEnabled?'關閉音效':'開啟音效');e.currentTarget.title=soundEnabled?'關閉音效':'開啟音效';tone(keys.indexOf(selected));});
document.querySelector('#reset-view').addEventListener('click',()=>{cancelDrag();controls.enableDamping=false;controls.update();controls.enableDamping=true;resetCamera=true;announce('視角已重設。');});
document.querySelector('#eject-button').addEventListener('click',ejectCard);document.querySelector('#insert-button').addEventListener('click',()=>insertCard(selected));
document.querySelectorAll('[data-key]').forEach(button=>{button.addEventListener('focus',()=>{hovered=button.dataset.key;selectWorld(button.dataset.key);});button.addEventListener('click',()=>{hovered=button.dataset.key;selectWorld(button.dataset.key);});button.addEventListener('keydown',e=>{if(e.key.toLowerCase()==='i'){e.preventDefault();insertCard(button.dataset.key);}if(['ArrowLeft','ArrowRight'].includes(e.key)){e.preventDefault();const index=keys.indexOf(button.dataset.key);document.querySelector(`[data-key="${keys[(index+(e.key==='ArrowRight'?1:2))%3]}"]`).focus();}});});
document.addEventListener('keydown',e=>{if(e.key==='Escape'&&(dragging||pointerStart)){e.preventDefault();cancelDrag();}});
document.querySelector('#explore-button').addEventListener('click',()=>{const world=WORLDS[selected];if(world.url){location.assign(world.url);return;}document.querySelector('#dialog-title').textContent=world.name;dialog.showModal();});
document.querySelectorAll('.dialog-close,.dialog-back').forEach(b=>b.addEventListener('click',()=>dialog.close()));dialog.addEventListener('click',e=>{const r=dialog.getBoundingClientRect();if(e.clientX<r.left||e.clientX>r.right||e.clientY<r.top||e.clientY>r.bottom)dialog.close();});
try{init();}catch(error){console.error('3D scene could not start:',error);loading.classList.add('is-ready');document.querySelector('#fallback').hidden=false;canvas.dataset.ready='failed';}
