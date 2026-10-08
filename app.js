import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';
import { Reflector } from 'three/addons/objects/Reflector.js';

const WORLDS = {
  m9dy: { name: 'M9DY', number: '01', color: '#c4d384', ink: '#233e2e', url: null, screenArtwork: './assets/m9dy-screen.jpg', coverArtwork: './assets/m9dy-cover.jpg', artworkBackground: '#000000', glow: '#ff7300' },
  fire: { name: '無名火', number: '02', color: '#eeb35e', ink: '#9f3b22', url: null, screenArtwork: './assets/fire-screen.jpg', coverArtwork: './assets/fire-cover.jpg', artworkBackground: '#041149', glow: '#355dff' },
  untitled: { name: 'Untitled Design Agency', number: '03', color: '#bac9ec', ink: '#283c66', url: null, screenArtwork: './assets/untitled-screen.jpg', coverArtwork: './assets/untitled-cover.jpg', artworkBackground: '#fafafa', glow: '#fff4ee' },
};
const keys = Object.keys(WORLDS);
const canvas = document.querySelector('#scene');
const loading = document.querySelector('#loading');
const reduceMotion = matchMedia('(prefers-reduced-motion: reduce)');
const dialog = document.querySelector('#world-dialog');
const hint = document.querySelector('#drop-hint');
let nightEnabled=false, nightBlend=0, screenPower=0, screenOnAt=Infinity;
let composer, bloom, reflector, floor, hemisphere, keyLight, fillLight, screenLight, bezelLight;
const dayBackground=new THREE.Color('#f5f5f2'),nightBackground=new THREE.Color('#030509');
const dayFloor=new THREE.Color('#f5f5ef'),nightFloor=new THREE.Color('#252b35');
const screenTint=new THREE.Color();
let selected = 'm9dy', installed = null, hovered = null, dragging = null;
let soundEnabled = false, audioContext, announcementTimer, insertionTimer;
let renderer, scene, camera, controls, screenMaterial, screenTexture, screenCanvas, ledMaterial;
let slotRing, slotCollider, tv, consoleModel, controller, rack, cable, resetTarget;
const avPorts = [1.13, 1.48, 1.83];
let transitionStarted = -100, bootUntil = 0, lastScreenPaint = -100, lastFrame = 0;
let pointerStart = null, resetCamera = false, readyFrames = 0, active = true, orbiting = false, orbitSettles = 0;
const cards = [], actionMeshes = [], modelObjects = [], tableShadows = [], rackHomes = new Map();
const clock = new THREE.Clock();
const pointer = new THREE.Vector2(), raycaster = new THREE.Raycaster();
const dragPlane = new THREE.Plane(), rayPoint = new THREE.Vector3();
const slot = new THREE.Vector3();
const insertedPosition = new THREE.Vector3();
const defaultCamera = new THREE.Vector3(), defaultTarget = new THREE.Vector3();
const screenFocus = new THREE.Vector3(), screenCorners = [], focusOffset = new THREE.Vector3(), focusTarget = new THREE.Vector3();
let focusProbe, zoomFocusProgress=0, pendingTVTap=null;
const temp = new THREE.Vector3();
const M = {};
const artworks = new Map();

// Fit the complete artwork without stretching or trimming brand text.
function drawArtwork(ctx, image, width, height, background) {
  const scale = Math.min(width / image.naturalWidth, height / image.naturalHeight);
  const w = image.naturalWidth * scale, h = image.naturalHeight * scale;
  ctx.fillStyle = background;
  ctx.fillRect(0, 0, width, height);
  ctx.drawImage(image, (width - w) / 2, (height - h) / 2, w, h);
}
function refreshCartridgeLabel(card) {
  const old = card.userData.labelMap;
  const mesh = card.children.find(child => child.material?.map === old);
  if (!mesh) return;
  const texture = cartridgeLabel(card.userData.key);
  mesh.material.map = texture;
  mesh.material.needsUpdate = true;
  card.userData.labelMap = texture;
  old.dispose();
}
async function loadWorldArtworks() {
  await Promise.all(keys.flatMap(key => ['screenArtwork', 'coverArtwork'].map(async type => {
    const path = WORLDS[key][type], image = new Image();
    image.src = new URL(path, import.meta.url).href;
    try {
      await image.decode();
      artworks.set(path, image);
      if (type === 'coverArtwork') {
        const card = cards.find(card => card.userData.key === key);
        if (card) refreshCartridgeLabel(card);
      } else if (installed === key) {
        drawScreen(clock.elapsedTime, true);
      }
    } catch {
      console.warn(`${key} ${type} could not load; using the original artwork.`);
    }
  })));
}


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
  screenMaterial = new THREE.ShaderMaterial({ uniforms: { uMap: { value: screenTexture }, uTime: { value: 0 }, uSwitch: { value: 0 }, uPower: { value: 0 }, uNight: { value: 0 }, uBrightness: { value: 1 } },
    vertexShader: `varying vec2 vUv; void main(){vUv=uv;gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.);}`,
    fragmentShader: `uniform sampler2D uMap;uniform float uTime;uniform float uSwitch;uniform float uPower;uniform float uNight;uniform float uBrightness;varying vec2 vUv;
      float noise(vec2 p){return fract(sin(dot(p,vec2(12.9898,78.233)))*43758.5453);}
      void main(){vec2 q=abs(vUv-.5)-vec2(.458,.455);float edge=length(max(q,0.))+min(max(q.x,q.y),0.)-.039;if(edge>0.)discard;
      vec2 uv=vUv;uv.x+=uSwitch*.012*sin(uv.y*87.+uTime*43.);vec3 col=texture2D(uMap,uv).rgb;
      col*=.96+.04*sin(vUv.y*720.);float vignette=1.-.38*pow(length((vUv-.5)*1.36),2.);col*=vignette;
      float glare=exp(-length((vUv-vec2(.2,.83))*vec2(3.,2.))*3.)*.045;col+=vec3(glare);
      float snow=noise(floor(vUv*vec2(550.,400.))+floor(uTime*32.));col=mix(col,vec3(snow),uSwitch*.85);
      vec3 glass=vec3(.012,.018,.019)+vec3(.012)*exp(-length((vUv-vec2(.18,.88))*vec2(2.,2.))*2.);glass*=1.-uNight*.85;col=mix(glass,col*uBrightness,uPower);gl_FragColor=vec4(col,1.);#include <tonemapping_fragment>\n#include <colorspace_fragment>}`.replace(';#include',';\n#include'), toneMapped: false });
  const display = new THREE.Mesh(geometry, screenMaterial); display.position.set(-.04, 2.61, 1.665); display.userData.action='explore';actionMeshes.push(display);g.add(display);
  const holeGeo = new THREE.CylinderGeometry(.014, .014, .018, 6);
  const holes = new THREE.InstancedMesh(holeGeo, M.speaker, 80); const dummy = new THREE.Object3D(); let index = 0;
  for (const side of [-1]) for (let col = 0; col < 16; col++) for (let row = 0; row < 5; row++) {
    dummy.position.set(side * 1.76 + (col - 7.5) * .053, .49 + row * .063, 1.484); dummy.rotation.x = Math.PI / 2; dummy.updateMatrix(); holes.setMatrixAt(index++, dummy.matrix);
  }
  g.add(holes);
  for (let i = 0; i < 6; i++) cylinder(g, .042, .029, M.darkPlastic, -.87 + i * .25, .59, 1.505, true);
  cylinder(g, .097, .025, M.tv, .59, .59, 1.515, true);
  cylinder(g, .018, .035, new THREE.MeshStandardMaterial({ color: '#a74a33', emissive: '#7c2416', emissiveIntensity: .2 }), .34, .59, 1.505, true);
  // Front composite AV sockets and molded RCA plugs, connected by the cable loom.
  box(g, 1.09, .28, .024, .012, M.darkPlastic, 1.48, .59, 1.485);
  avPorts.forEach((x, i) => {
    const color = ['#d6ac45', '#dddcd1', '#b94e3e'][i];
    const sleeve = new THREE.MeshStandardMaterial({ color, roughness: .53 });
    cylinder(g, .087, .045, M.metal, x, .59, 1.52, true);
    cylinder(g, .07, .16, sleeve, x, .59, 1.61, true);
    cylinder(g, .048, .16, M.plug, x, .59, 1.75, true);
    for (let j = 0; j < 3; j++) cylinder(g, .053, .018, M.plugDetail, x, .59, 1.72 + j * .04, true);
  });
  label(g, 'VIDEO   L   R', .96, .065, [1.48, .37, 1.495], { size: 48 });
  box(g, .21, .2, .16, .045, M.plug, -.9, .46, -1.4);
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
  box(g, .53, .23, .13, .045, M.darkPlastic, .86, .52, -1.55);
  box(g, .4, .18, .28, .04, M.plug, .86, .52, -1.68);
  label(g, 'AV MULTI OUT', .76, .11, [.86, 1.028, -1.23], { size: 56 }, true);
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
  const artwork = artworks.get(world.coverArtwork);
  if (artwork) {
    ctx.save();ctx.beginPath();ctx.roundRect(0,0,c.width,c.height,24);ctx.clip();
    drawArtwork(ctx,artwork,c.width,c.height,world.artworkBackground);
    ctx.restore();return textureFromCanvas(c);
  }
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
  if(!installed&&!force)return;
  if(!force && time-lastScreenPaint<(reduceMotion.matches?60:.055))return;
  lastScreenPaint=time;const ctx=screenCanvas.getContext('2d'),screenKey=installed,playing=!!installed;
  ctx.clearRect(0,0,1024,768);
  if(!screenKey){ctx.fillStyle='#030605';ctx.fillRect(0,0,1024,768);screenTexture.needsUpdate=true;return;}
  const world=WORLDS[screenKey],artwork=artworks.get(world.screenArtwork);
  if(artwork){
    drawArtwork(ctx,artwork,screenCanvas.width,screenCanvas.height,world.artworkBackground);
    screenTexture.needsUpdate=true;return;
  }
  if(screenKey==='m9dy'){
    const gradient=ctx.createRadialGradient(512,410,30,512,410,720);gradient.addColorStop(0,'#274832');gradient.addColorStop(1,'#07160e');ctx.fillStyle=gradient;ctx.fillRect(0,0,1024,768);
    ctx.strokeStyle='rgba(177,215,124,.14)';ctx.lineWidth=2;
    for(let i=0;i<4;i++){ctx.beginPath();ctx.ellipse(512,388,235+i*31,200,Math.sin(time*.22+i)*.4,0,Math.PI*2);ctx.stroke();}
    ctx.fillStyle='#d6efa3';ctx.font='bold 211px "Space Grotesk",Arial';ctx.textAlign='center';ctx.fillText('M9DY',510,458);
    ctx.font='18px monospace';ctx.fillText('PLAY BY YOUR OWN RULES',512,236);ctx.font='16px monospace';ctx.fillText('YOUR NEXT WORLD STARTS HERE.',512,535);
  }else if(screenKey==='fire'){
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
  const ink=screenKey==='untitled'?'#2d416e':screenKey==='fire'?'#d89b63':'#a4c785';ctx.fillStyle=ink;ctx.font='17px monospace';ctx.textAlign='left';ctx.fillText('▪ AV 1',68,76);ctx.textAlign='right';ctx.fillText('WORLD '+WORLDS[screenKey].number,953,76);
  ctx.textAlign='left';ctx.font='15px monospace';ctx.fillText(playing?'● NOW PLAYING':'○ PREVIEW / DRAG TO PLAY',68,707);ctx.textAlign='right';ctx.fillText('16-BIT / 60 Hz',953,707);
  if(time<bootUntil){ctx.fillStyle='rgba(205,244,170,.04)';ctx.fillRect(0,0,1024,768);}
  screenTexture.needsUpdate=true;
}
function updateUI() {
  canvas.dataset.selected=selected;canvas.dataset.inserted=installed||'';
  document.querySelector('#eject-button').hidden=!installed;
  document.querySelector('#explore-button').hidden=!installed;
  document.querySelector('#insert-button').setAttribute('aria-label',`將 ${WORLDS[selected].name} 插入主機`);
  document.querySelectorAll('[data-key]').forEach(b=>b.setAttribute('aria-pressed',String(b.dataset.key===selected)));
  ledMaterial.color.set(installed?'#398d49':'#892b20');
  ledMaterial.emissive.set(installed?'#48f66a':'#e33822');
  ledMaterial.emissiveIntensity=installed?1.8:.45;
}
function selectWorld(key,force=false) {
  if(!WORLDS[key])return;const changed=key!==selected;selected=key;
  if(force){transitionStarted=clock.elapsedTime;drawScreen(clock.elapsedTime,true);}
  updateUI();if(changed){tone(keys.indexOf(key));announce(`已選擇 ${WORLDS[key].name}，拖到主機插槽即可開機。`);}
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
  screenOnAt=clock.elapsedTime+(reduceMotion.matches?0:.22);hovered=null;selectWorld(key,true);bootUntil=clock.elapsedTime+.7;tone(keys.indexOf(key),true);
  announce(`${WORLDS[key].name} 已插入主機。拖回卡帶架或按取出可換帶。`);
}
function ejectCard() {
  if(!installed)return;clearTimeout(insertionTimer);const key=installed;installed=null;screenOnAt=Infinity;
  homeCard(cards.find(c=>c.userData.key===key));selectWorld(selected,true);announce(`${WORLDS[key].name} 已取出。`);
}
function updateCable(portrait) {
  if(cable){scene.remove(cable);cable.traverse(o=>o.geometry?.dispose());}
  cable=new THREE.Group();cable.name='Connected desk cables';scene.add(cable);
  const point=(model,x,y,z)=>model.localToWorld(new THREE.Vector3(x,y,z));
  const wire=(name,points,radius=.036)=>{
    const curve=new THREE.CatmullRomCurve3(points,false,'centripetal');
    const mesh=new THREE.Mesh(new THREE.TubeGeometry(curve,Math.max(64,points.length*7),radius,8,false),M.cable);
    mesh.name=name;mesh.castShadow=true;mesh.receiveShadow=true;cable.add(mesh);return mesh;
  };
  const a=point(consoleModel,-.94,.47,1.93),b=point(controller,0,.23,-.62);
  wire('Controller lead',portrait?[
    a,a.clone().add(new THREE.Vector3(0,-.22,.18)),
    new THREE.Vector3(b.x+.45,.075,b.z-.45),
    new THREE.Vector3(b.x-.2,.075,b.z-.4),b
  ]:[
    a,a.clone().add(new THREE.Vector3(0,-.24,.34)),
    new THREE.Vector3(a.x-.3,.08,a.z+.71),
    new THREE.Vector3(b.x-.3,.065,a.z+.62),
    new THREE.Vector3(b.x-1.72,.065,b.z+.38),
    new THREE.Vector3(b.x-.65,.1,b.z-.49),b
  ],.045);

  // The three RCA tails merge into one gently coiled composite cable behind the console.
  const junction=point(tv,2.72,.095,2.27);
  avPorts.forEach((x,i)=>{
    const start=point(tv,x,.59,1.83);
    wire('RCA '+['video','left audio','right audio'][i],[start,
      start.clone().add(new THREE.Vector3(.02,0,.12)),
      point(tv,x+.15,.18,2.14+i*.065),
      point(tv,2.15+i*.1,.085,2.5+i*.09),junction],.027);
  });
  const avEnd=point(consoleModel,.86,.52,-1.84);
  const coilCenter=point(tv,portrait?3.15:3.95,.08,portrait?3.95:3.0);
  const coil=[junction];
  for(let i=0;i<=36;i++){
    const angle=Math.PI+i/36*Math.PI*3.65;
    coil.push(new THREE.Vector3(coilCenter.x+Math.cos(angle)*(.86-i*.009),.078+i*.002,coilCenter.z+Math.sin(angle)*(.48-i*.0045)));
  }
  coil.push(point(consoleModel,2.18,.12,-1.92),avEnd.clone().add(new THREE.Vector3(.25,-.26,-.3)),avEnd.clone().add(new THREE.Vector3(0,-.05,-.17)),avEnd);
  wire('Coiled AV cable',coil,.041);

  // A separate power lead sits in relaxed loops behind the television.
  const power=[point(tv,-.9,.46,-1.48),point(tv,-.9,.15,-1.72)];
  for(let i=0;i<=34;i++){
    const angle=.3+i/34*Math.PI*3.45;
    power.push(point(tv,-3+Math.cos(angle)*(.95-i*.005),.065+i*.0012,-1+Math.sin(angle)*.72));
  }
  const end=point(tv,-1.35,.085,-1.81);
  power.push(end);wire('TV power lead',power,.034);
  box(cable,.2,.15,.35,.045,M.plug,end.x,end.y+.03,end.z-.16);
  for(const dx of [-.052,.052])box(cable,.027,.04,.13,.01,M.metal,end.x+dx,end.y+.03,end.z-.39);
}
function layout() {
  const w=innerWidth,h=innerHeight,portrait=w/h<.85;
  tv.position.set(portrait?-.7:-1.15,0,-1.9);
  consoleModel.position.set(portrait?-.5:-1.1,0,portrait?3.1:3.65);
  controller.position.set(portrait?-1.8:-4.8,0,portrait?6.45:4.8);controller.rotation.y=portrait?-.12:.13;
  rack.position.set(portrait?3.3:4.0,0,portrait?.0:-1.0);rack.rotation.y=portrait?-.13:-.18;
  scene.updateMatrixWorld(true);
  cards.forEach((card,i)=>{
    const local=new THREE.Vector3(0,1.08+i*.13,.8-i*.79);const position=rack.localToWorld(local);
    const rotation=new THREE.Euler(-.055,rack.rotation.y,0);rackHomes.set(card.userData.key,{position:position.clone(),rotation});
    if(card.userData.mode!=='inserted')homeCard(card);
  });
  slot.copy(consoleModel.position).add(new THREE.Vector3(0,1.105,-.83));insertedPosition.copy(slot).add(new THREE.Vector3(0,.47,0));
  slotRing.position.copy(slot);slotRing.position.y+=.014;slotCollider.position.copy(slot);
  if(installed){const card=cards.find(c=>c.userData.key===installed);card.userData.target.copy(insertedPosition);}
  cards.forEach(c=>{c.position.copy(c.userData.target);c.rotation.copy(c.userData.targetRotation);});
  scene.updateMatrixWorld(true);updateCable(portrait);
  if(screenLight){screenLight.position.copy(tv.position).add(new THREE.Vector3(-.04,2.5,1.91));screenLight.target.position.copy(consoleModel.position).add(new THREE.Vector3(0,.45,.45));bezelLight.position.copy(tv.position).add(new THREE.Vector3(-.04,2.61,2.1));}
  camera.aspect=w/h;camera.fov=portrait?38:33;camera.zoom=1;camera.updateProjectionMatrix();
  defaultTarget.set(portrait?.0:-.65,portrait?1.7:2.15,portrait?1.35:.8);
  controls.minDistance=0;controls.maxDistance=Infinity;const distance=portrait?21.5:(w/h>2?29:30.5);
  defaultCamera.copy(defaultTarget).add(new THREE.Vector3(portrait?-3.8:-7,portrait?7.6:5.7,17).normalize().multiplyScalar(distance));
  camera.position.copy(defaultCamera);controls.target.copy(defaultTarget);controls.update();
  // Fit real model bounds inside the scene, leaving space for the bottom controls.
  const minViewY=-.86;
  const corners=[];[...modelObjects,cable,...cards].forEach(o=>{const bounds=new THREE.Box3().setFromObject(o);for(const x of [bounds.min.x,bounds.max.x])for(const y of [bounds.min.y,bounds.max.y])for(const z of [bounds.min.z,bounds.max.z])corners.push(new THREE.Vector3(x,y,z));});
  for(let i=0;i<40;i++){
    camera.updateMatrixWorld();const points=corners.map(p=>p.clone().project(camera));
    if(points.every(p=>Math.abs(p.x)<.94&&p.y<.8&&p.y>minViewY))break;
    camera.position.sub(defaultTarget).multiplyScalar(1.025).add(defaultTarget);controls.update();
  }
  // Shrink the previous 0.8 composition by another 30%, retaining the reference viewing angle.
  camera.zoom=.56;camera.updateProjectionMatrix();
  screenFocus.copy(tv.localToWorld(new THREE.Vector3(-.04,2.61,1.73)));
  screenCorners.length=0;
  for(const x of [-1.915,1.915])for(const y of [-1.425,1.425])screenCorners.push(tv.localToWorld(new THREE.Vector3(x-.04,y+2.61,1.665)));
  zoomFocusProgress=0;
  defaultCamera.copy(camera.position);controls.minDistance=camera.position.distanceTo(defaultTarget)*.25;controls.maxDistance=camera.position.distanceTo(defaultTarget)*1.3;
  tableShadows.forEach(({mesh,object})=>mesh.position.set(object.position.x,.018,object.position.z));renderer.shadowMap.needsUpdate=true;renderer.setSize(w,h);renderer.setPixelRatio(Math.min(devicePixelRatio,portrait?1.35:1.5));if(composer){composer.setPixelRatio(Math.min(devicePixelRatio,1.25));composer.setSize(w,h);}
}
function updateZoomFocus() {
  const distance=camera.position.distanceTo(controls.target);
  const initialDistance=defaultCamera.distanceTo(defaultTarget);
  const progress=THREE.MathUtils.clamp((initialDistance-distance)/(initialDistance-controls.minDistance),0,1);
  zoomFocusProgress=THREE.MathUtils.smoothstep(progress,0,1);
  focusOffset.copy(camera.position).sub(controls.target);
  focusTarget.copy(defaultTarget).lerp(screenFocus,zoomFocusProgress);
  controls.target.copy(focusTarget);camera.position.copy(focusTarget).add(focusOffset);

  // Fit the real CRT corners at the closest stop for both wide and portrait screens.
  focusProbe.fov=camera.fov;focusProbe.aspect=camera.aspect;focusProbe.zoom=1;focusProbe.updateProjectionMatrix();
  focusProbe.position.copy(screenFocus).addScaledVector(focusOffset,controls.minDistance/distance);
  focusProbe.lookAt(screenFocus);focusProbe.updateMatrixWorld();
  let extentX=0,extentY=0;
  for(const corner of screenCorners){temp.copy(corner).project(focusProbe);extentX=Math.max(extentX,Math.abs(temp.x));extentY=Math.max(extentY,Math.abs(temp.y));}
  const closeZoom=Math.min(.88/extentX,.84/extentY);
  const zoom=THREE.MathUtils.lerp(.56,closeZoom,zoomFocusProgress);
  if(Math.abs(camera.zoom-zoom)>.000001){camera.zoom=zoom;camera.updateProjectionMatrix();}
  camera.lookAt(controls.target);camera.updateMatrixWorld();
}
function screenPoint(v) {
  const p=v.clone().project(camera);const r=canvas.getBoundingClientRect();return{x:r.left+(p.x+1)*r.width/2,y:r.top+(1-p.y)*r.height/2};
}
function pointerRay(e) {const r=canvas.getBoundingClientRect();pointer.set((e.clientX-r.left)/r.width*2-1,-(e.clientY-r.top)/r.height*2+1);raycaster.setFromCamera(pointer,camera);}
function hitCard() {
  const hit=raycaster.intersectObjects(cards.map(c=>c.userData.hit),false)[0];
  if(!hit)return null;
  // The broad cartridge hit box must not intercept a visible button or the TV in front of it.
  const action=raycaster.intersectObjects(actionMeshes,false)[0];
  if(action&&action.distance<hit.distance)return null;
  return hit.object.userData.card;
}
function isSlotDrop(e) {
  const p=screenPoint(slot),edge=screenPoint(slot.clone().add(new THREE.Vector3(1.2,0,0)));const tolerance=Math.max(30,Math.abs(edge.x-p.x)*.98);
  return Math.abs(e.clientX-p.x)<tolerance&&Math.abs(e.clientY-p.y)<Math.max(29,tolerance*.55);
}
function showDropHint(valid) {const p=screenPoint(slot);hint.style.left=p.x+'px';hint.style.top=(p.y-12)+'px';hint.textContent=valid?'放開，插入卡帶':'拖到主機插槽';hint.classList.add('is-visible');hint.classList.toggle('is-over',valid);slotRing.material.color.set(valid?'#9fbf5e':'#cad69e');}
function cancelDrag() {
  pendingTVTap=null;
  if(!pointerStart&&!dragging)return;
  if(dragging){const c=dragging.card;if(installed===c.userData.key){c.userData.target.copy(insertedPosition);c.userData.mode='inserted';}else homeCard(c);}
  dragging=null;pointerStart=null;controls.enabled=true;slotRing.visible=false;hint.classList.remove('is-visible','is-over');canvas.classList.remove('is-dragging');announce('已取消拖曳。');
}
function onPointerDown(e) {
  if(!e.isPrimary){pendingTVTap=null;return;}
  if(e.button!==0)return;pointerRay(e);const card=hitCard();
  if(card){controls.enabled=false;e.stopImmediatePropagation();selectWorld(card.userData.key);pointerStart={x:e.clientX,y:e.clientY,card,id:e.pointerId};canvas.setPointerCapture(e.pointerId);return;}
  const action=raycaster.intersectObjects(actionMeshes,false)[0]?.object.userData.action;
  if(action==='explore'){pendingTVTap={id:e.pointerId,x:e.clientX,y:e.clientY};return;}
  if(action==='eject'){controls.enabled=false;e.stopImmediatePropagation();ejectCard();setTimeout(()=>controls.enabled=true,0);return;}
  if(raycaster.intersectObject(slotCollider,false).length){controls.enabled=false;e.stopImmediatePropagation();insertCard(selected);setTimeout(()=>controls.enabled=true,0);}
}
function onPointerMove(e) {
  if(pendingTVTap&&Math.hypot(e.clientX-pendingTVTap.x,e.clientY-pendingTVTap.y)>6)pendingTVTap=null;
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
  if(pendingTVTap&&pendingTVTap.id===e.pointerId){const tap=pendingTVTap;pendingTVTap=null;if(installed&&Math.hypot(e.clientX-tap.x,e.clientY-tap.y)<=6)exploreWorld();}
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
function createNightLighting() {
  screenLight=new THREE.SpotLight('#cceba5',0,18,Math.PI*.39,.85,2);
  screenLight.castShadow=true;screenLight.shadow.mapSize.set(512,512);screenLight.shadow.camera.near=.12;
  screenLight.shadow.bias=-.00015;screenLight.shadow.normalBias=.025;screenLight.shadow.radius=4;
  scene.add(screenLight,screenLight.target);
  bezelLight=new THREE.PointLight('#cceba5',0,7,2);scene.add(bezelLight);

  // A real planar reflection, blurred in screen space to suggest a satin surface.
  const mirrorShader={
    uniforms:{...THREE.UniformsUtils.clone(Reflector.ReflectorShader.uniforms),uStrength:{value:0}},
    vertexShader:Reflector.ReflectorShader.vertexShader,
    fragmentShader:`uniform sampler2D tDiffuse;uniform float uStrength;varying vec4 vUv;
      void main(){vec2 uv=vUv.xy/vUv.w;vec2 d=vec2(.0028,.004);
      vec3 col=texture2D(tDiffuse,uv).rgb*.28;
      col+=texture2D(tDiffuse,uv+vec2(d.x,0.)).rgb*.18;
      col+=texture2D(tDiffuse,uv-vec2(d.x,0.)).rgb*.18;
      col+=texture2D(tDiffuse,uv+vec2(0.,d.y)).rgb*.18;
      col+=texture2D(tDiffuse,uv-vec2(0.,d.y)).rgb*.18;
      gl_FragColor=vec4(col,uStrength);
      #include <tonemapping_fragment>
      #include <colorspace_fragment>
      }`
  };
  reflector=new Reflector(new THREE.PlaneGeometry(100,100),{textureWidth:512,textureHeight:512,clipBias:.004,multisample:0,shader:mirrorShader});
  reflector.rotation.x=-Math.PI/2;reflector.position.y=.012;
  reflector.material.transparent=true;reflector.material.depthWrite=false;reflector.material.toneMapped=false;reflector.visible=false;scene.add(reflector);
  composer=new EffectComposer(renderer);composer.addPass(new RenderPass(scene,camera));
  bloom=new UnrealBloomPass(new THREE.Vector2(innerWidth,innerHeight),.48,.65,.72);composer.addPass(bloom);composer.addPass(new OutputPass());
}
function updateLighting(dt,time) {
  const target=Number(nightEnabled),powerTarget=Number(!!installed&&time>=screenOnAt);
  const oldNight=nightBlend,oldPower=screenPower;
  nightBlend=reduceMotion.matches?target:THREE.MathUtils.damp(nightBlend,target,5,dt);
  screenPower=reduceMotion.matches?powerTarget:THREE.MathUtils.damp(screenPower,powerTarget,9,dt);
  if(Math.abs(nightBlend-target)<.001)nightBlend=target;
  if(Math.abs(screenPower-powerTarget)<.001)screenPower=powerTarget;
  scene.background.copy(dayBackground).lerp(nightBackground,nightBlend);scene.fog.color.copy(scene.background);
  scene.environmentIntensity=THREE.MathUtils.lerp(.6,.04,nightBlend);
  hemisphere.intensity=THREE.MathUtils.lerp(.7,.035,nightBlend);
  keyLight.intensity=THREE.MathUtils.lerp(2.7,.14,nightBlend);
  fillLight.intensity=THREE.MathUtils.lerp(.7,.065,nightBlend);
  floor.material.color.copy(dayFloor).lerp(nightFloor,nightBlend);
  screenTint.set(artworks.has(WORLDS[installed]?.screenArtwork)?WORLDS[installed].glow:installed==='fire'?'#ffb46f':installed==='untitled'?'#b5cbff':'#cee6a4');
  screenLight.color.lerp(screenTint,reduceMotion.matches?1:1-Math.exp(-dt*7));bezelLight.color.copy(screenLight.color);
  const flicker=reduceMotion.matches?1:1+Math.sin(time*3.2)*.014;
  const untitled=installed==='untitled',lightGain=untitled?.5:1;
  screenLight.intensity=screenPower*(.12+nightBlend*75)*flicker*lightGain;
  bezelLight.intensity=screenPower*(.035+nightBlend*2.8)*flicker*lightGain;
  screenMaterial.uniforms.uPower.value=screenPower;screenMaterial.uniforms.uNight.value=nightBlend;
  // The pale Untitled artwork needs less emission and bloom than the two dark artworks.
  screenMaterial.uniforms.uBrightness.value=untitled?.651:1+nightBlend*1.15;
  reflector.visible=nightBlend>.01&&screenPower>.01;reflector.material.uniforms.uStrength.value=.22*nightBlend*screenPower;
  bloom.strength=(untitled?.1617:.46)*nightBlend*screenPower;bloom.enabled=nightBlend>.01&&screenPower>.01;
  if(Math.abs(oldNight-nightBlend)>.002||Math.abs(oldPower-screenPower)>.002)renderer.shadowMap.needsUpdate=true;
  canvas.dataset.power=screenPower>.01?'on':'off';
}
function init() {
  renderer=new THREE.WebGLRenderer({canvas,antialias:true,alpha:false,powerPreference:'high-performance'});
  renderer.outputColorSpace=THREE.SRGBColorSpace;renderer.toneMapping=THREE.ACESFilmicToneMapping;renderer.toneMappingExposure=.88;
  renderer.shadowMap.enabled=true;renderer.shadowMap.type=THREE.PCFSoftShadowMap;renderer.shadowMap.autoUpdate=false;renderer.shadowMap.needsUpdate=true;
  scene=new THREE.Scene();scene.background=new THREE.Color('#f5f5f2');scene.fog=new THREE.Fog('#f5f5f2',27,70);
  camera=new THREE.PerspectiveCamera(33,innerWidth/innerHeight,.1,100);focusProbe=new THREE.PerspectiveCamera();
  controls=new OrbitControls(camera,canvas);controls.enableDamping=true;controls.dampingFactor=.07;controls.enablePan=false;controls.enableZoom=true;controls.minPolarAngle=.75;controls.maxPolarAngle=1.3;controls.minAzimuthAngle=-.78;controls.maxAzimuthAngle=.65;controls.rotateSpeed=.45;controls.addEventListener('start',()=>{orbiting=true;});controls.addEventListener('end',()=>{orbiting=false;orbitSettles=performance.now()+450;});
  const pmrem=new THREE.PMREMGenerator(renderer);const room=new RoomEnvironment();scene.environment=pmrem.fromScene(room,.04).texture;scene.environmentIntensity=.6;room.dispose();pmrem.dispose();
  hemisphere=new THREE.HemisphereLight('#ffffff','#b7b5a9',.7);scene.add(hemisphere);
  const key=keyLight=new THREE.DirectionalLight('#fff9ed',2.7);key.position.set(-4.5,10,7);key.castShadow=true;key.shadow.mapSize.set(1024,1024);key.shadow.camera.left=-11;key.shadow.camera.right=11;key.shadow.camera.top=10;key.shadow.camera.bottom=-10;key.shadow.camera.far=30;key.shadow.normalBias=.035;key.shadow.bias=-.0002;key.shadow.radius=4;scene.add(key);
  const fill=fillLight=new THREE.DirectionalLight('#e6edfa',.7);fill.position.set(7,6,-3);scene.add(fill);
  const grain=plasticGrain();const plastic=(color,roughness=.6)=>new THREE.MeshStandardMaterial({color,roughness,bumpMap:grain,bumpScale:.012});
  M.shell=plastic('#a8aba2');M.shellLight=plastic('#bbbbb1');M.panel=plastic('#9a9e96');M.trim=plastic('#777e74');M.button=plastic('#777c73',.5);M.darkPlastic=plastic('#41463e');M.black=plastic('#1c211c');M.tv=plastic('#858b81');M.tvFront=plastic('#999d92');M.vent=new THREE.MeshStandardMaterial({color:'#485144',roughness:.95});M.speaker=new THREE.MeshStandardMaterial({color:'#353c31',roughness:1});M.rubber=plastic('#2b3028',.98);M.cart=plastic('#aaaea4',.58);M.cartFace=plastic('#b8baaf',.61);M.dpad=plastic('#444a41',.72);M.plug=plastic('#30372f',.76);M.plugDetail=plastic('#252c24',.8);M.portHole=new THREE.MeshStandardMaterial({color:'#737767',roughness:.8});M.metal=new THREE.MeshStandardMaterial({color:'#8f9180',metalness:.78,roughness:.37});M.gold=new THREE.MeshStandardMaterial({color:'#bfa35d',metalness:.8,roughness:.44});M.cable=plastic('#242b24',.76);
  M.rack=new THREE.MeshPhysicalMaterial({color:'#6f786a',roughness:.2,metalness:0,transmission:0,transparent:true,opacity:.38,thickness:.1,ior:1.46,depthWrite:false,side:THREE.DoubleSide});
  floor=new THREE.Mesh(new THREE.PlaneGeometry(150,150),new THREE.MeshStandardMaterial({color:'#f5f5ef',roughness:.93}));floor.rotation.x=-Math.PI/2;floor.receiveShadow=true;scene.add(floor);
  tv=createCRT();consoleModel=createConsole();controller=createController();rack=createRack();[tv,consoleModel,controller,rack].forEach(o=>{scene.add(o);modelObjects.push(o);});
  keys.forEach((key,index)=>{const card=createCartridge(key,index);scene.add(card);cards.push(card);});
  slotRing=new THREE.Mesh(new THREE.TorusGeometry(1.11,.021,10,72),new THREE.MeshBasicMaterial({color:'#bdd58b',transparent:true,opacity:.9,depthTest:false}));slotRing.rotation.x=-Math.PI/2;slotRing.scale.y=.21;slotRing.visible=false;slotRing.renderOrder=99;scene.add(slotRing);
  slotCollider=new THREE.Mesh(new THREE.BoxGeometry(2.6,.1,.58),new THREE.MeshBasicMaterial({visible:false}));scene.add(slotCollider);
  createNightLighting();layout();tableShadows.push({mesh:contactShadow(tv.position.x,tv.position.z,5.6,3.6,.44),object:tv},{mesh:contactShadow(consoleModel.position.x,consoleModel.position.z,4.5,3.5,.3),object:consoleModel});
  updateUI();drawScreen(0,true);
  canvas.addEventListener('pointerdown',onPointerDown,true);canvas.addEventListener('pointermove',onPointerMove);canvas.addEventListener('pointerup',onPointerUp);canvas.addEventListener('pointercancel',cancelDrag);
  canvas.addEventListener('pointerleave',()=>{if(!dragging&&!pointerStart){hovered=null;delete canvas.dataset.hover;if(installed)selectWorld(installed);}});
  canvas.addEventListener('webglcontextlost',e=>{e.preventDefault();cancelDrag();active=false;document.querySelector('#fallback').hidden=false;});
  window.addEventListener('resize',()=>{cancelDrag();layout();});window.addEventListener('blur',cancelDrag);
  document.addEventListener('visibilitychange',()=>{active=!document.hidden;});
  document.fonts.ready.then(()=>{drawScreen(clock.elapsedTime,true);cards.forEach(refreshCartridgeLabel);});
  void loadWorldArtworks();
  window.__deskDebug=()=>({selected,installed,dragging:dragging?.card.userData.key||null,webgl:renderer.capabilities.isWebGL2,night:nightEnabled,nightBlend,screenPower,viewZoom:camera.zoom,zoomFocus:zoomFocusProgress,screenCorners:screenCorners.map(screenPoint),cameraDistance:camera.position.distanceTo(controls.target),initialDistance:defaultCamera.distanceTo(defaultTarget),minDistance:controls.minDistance,ledColor:ledMaterial.color.getHexString(),ledEmission:ledMaterial.emissive.getHexString(),screenBrightness:screenMaterial.uniforms.uBrightness.value,bloomStrength:bloom.strength,screenWorld:installed,artworksLoaded:artworks.size,screenArtwork:installed&&artworks.has(WORLDS[installed].screenArtwork)?WORLDS[installed].screenArtwork:null,reflection:reflector.visible,lightIntensity:screenLight.intensity,eject:screenPoint(consoleModel.localToWorld(new THREE.Vector3(0,1.15,.24))),tvScreen:screenPoint(tv.localToWorld(new THREE.Vector3(0,2.61,1.8))),drawCalls:renderer.info.render.calls,triangles:renderer.info.render.triangles,slot:screenPoint(slot),rack:screenPoint(rack.position.clone().add(new THREE.Vector3(0,.8,0))),cables:cable.children.filter(c=>c.isMesh&&c.geometry.type==='TubeGeometry').map(c=>c.name),cards:cards.map(c=>({key:c.userData.key,mode:c.userData.mode,point:screenPoint(c.localToWorld(new THREE.Vector3(0,.66,.21))),position:c.position.toArray()}))});
  requestAnimationFrame(render);
}
function render(now) {
  requestAnimationFrame(render);if(!active)return;
  const elapsed=clock.getElapsedTime();const dt=Math.min((now-lastFrame)/1000,.18);
  const busy=Math.abs(nightBlend-Number(nightEnabled))>.001||Math.abs(screenPower-Number(!!installed))>.001||dragging||pointerStart||resetCamera||orbiting||now<orbitSettles||cards.some(c=>c.position.distanceToSquared(c.userData.target)>.0001);
  if(now-lastFrame<(busy?30:80))return;lastFrame=now;
  if(resetCamera){const resetAlpha=reduceMotion.matches?1:1-Math.exp(-dt*11);camera.position.lerp(defaultCamera,resetAlpha);controls.target.lerp(defaultTarget,resetAlpha);if(camera.position.distanceTo(defaultCamera)<.015){camera.position.copy(defaultCamera);controls.target.copy(defaultTarget);resetCamera=false;}}
  controls.update();updateZoomFocus();
  cards.forEach(card=>{
    if(dragging?.card===card){renderer.shadowMap.needsUpdate=true;return;}
    temp.copy(card.userData.target);if(card.userData.mode==='rack'&&hovered===card.userData.key){temp.y+=.48;temp.z+=.07;}
    if(card.position.distanceToSquared(temp)>.00001)renderer.shadowMap.needsUpdate=true;const alpha=reduceMotion.matches?1:1-Math.exp(-dt*12);card.position.lerp(temp,alpha);
    card.rotation.x=THREE.MathUtils.damp(card.rotation.x,card.userData.targetRotation.x,12,dt);card.rotation.y=THREE.MathUtils.damp(card.rotation.y,card.userData.targetRotation.y,12,dt);
  });
  updateLighting(dt,elapsed);
  screenMaterial.uniforms.uTime.value=reduceMotion.matches?0:elapsed;screenMaterial.uniforms.uSwitch.value=reduceMotion.matches?0:screenPower*Math.max(0,1-(elapsed-transitionStarted)/.4);
  drawScreen(elapsed);if(nightBlend>.001)composer.render(dt);else renderer.render(scene,camera);
  if(readyFrames<3&&++readyFrames===3){loading.classList.add('is-ready');canvas.dataset.ready='true';}
}

document.querySelector('#night-toggle').addEventListener('click',()=>{nightEnabled=!nightEnabled;document.body.classList.toggle('night-mode',nightEnabled);const b=document.querySelector('#night-toggle');b.setAttribute('aria-pressed',String(nightEnabled));b.setAttribute('aria-label',nightEnabled?'關閉夜間模式':'開啟夜間模式');b.title=b.getAttribute('aria-label');document.querySelector('meta[name=theme-color]').content=nightEnabled?'#030509':'#f5f5f2';announce(nightEnabled?'已關燈，開啟夜間模式。':'已開燈，返回日間模式。');});
document.querySelector('#retry-button').addEventListener('click',()=>location.reload());
document.querySelector('#sound-toggle').addEventListener('click',e=>{soundEnabled=!soundEnabled;e.currentTarget.setAttribute('aria-pressed',String(soundEnabled));e.currentTarget.setAttribute('aria-label',soundEnabled?'關閉音效':'開啟音效');e.currentTarget.title=soundEnabled?'關閉音效':'開啟音效';tone(keys.indexOf(selected));});
document.querySelector('#reset-view').addEventListener('click',()=>{cancelDrag();controls.enableDamping=false;controls.update();controls.enableDamping=true;resetCamera=true;announce('視角已重設。');});
document.querySelector('#eject-button').addEventListener('click',ejectCard);document.querySelector('#insert-button').addEventListener('click',()=>insertCard(selected));
document.querySelectorAll('[data-key]').forEach(button=>{button.addEventListener('focus',()=>{hovered=button.dataset.key;selectWorld(button.dataset.key);});button.addEventListener('click',()=>{hovered=button.dataset.key;selectWorld(button.dataset.key);});button.addEventListener('keydown',e=>{if(e.key.toLowerCase()==='i'){e.preventDefault();insertCard(button.dataset.key);}if(['ArrowLeft','ArrowRight'].includes(e.key)){e.preventDefault();const index=keys.indexOf(button.dataset.key);document.querySelector(`[data-key="${keys[(index+(e.key==='ArrowRight'?1:2))%3]}"]`).focus();}});});
document.addEventListener('keydown',e=>{if(e.key==='Escape'&&(dragging||pointerStart)){e.preventDefault();cancelDrag();}});
function exploreWorld(){if(!installed)return;const world=WORLDS[installed];if(world.url){location.assign(world.url);return;}document.querySelector('#dialog-title').textContent=world.name;dialog.showModal();}
document.querySelector('#explore-button').addEventListener('click',exploreWorld);
document.querySelectorAll('.dialog-close,.dialog-back').forEach(b=>b.addEventListener('click',()=>dialog.close()));dialog.addEventListener('click',e=>{const r=dialog.getBoundingClientRect();if(e.clientX<r.left||e.clientX>r.right||e.clientY<r.top||e.clientY>r.bottom)dialog.close();});
try{init();}catch(error){console.error('3D scene could not start:',error);loading.classList.add('is-ready');document.querySelector('#fallback').hidden=false;canvas.dataset.ready='failed';}
