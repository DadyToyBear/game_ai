import {
  ACESFilmicToneMapping, BufferGeometry, CanvasTexture, Color, DirectionalLight, HemisphereLight,
  LineBasicMaterial, LineLoop, LineSegments, Mesh, MeshBasicMaterial, PerspectiveCamera, PlaneGeometry,
  Scene, ShaderMaterial, SRGBColorSpace, Vector3, WebGLRenderer,
} from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { fitDistance } from './framing.js';

export const CAMERA_FOV = 33;
const ANGLES = { quarter: 0.30, front: 0, side: Math.PI / 2, back: Math.PI };

export function makeRenderer(options = {}) {
  const config = { alpha: true, antialias: true, ...options };
  let renderer;
  try { renderer = new WebGLRenderer(config); }
  catch (error) {
    if (!config.antialias) throw error;
    renderer = new WebGLRenderer({ ...config, antialias: false });
  }
  renderer.outputColorSpace = SRGBColorSpace;
  renderer.toneMapping = ACESFilmicToneMapping;
  renderer.toneMappingExposure = 0.97;
  renderer.setClearColor(0x000000, 0);
  return renderer;
}

export function litScene() {
  const scene = new Scene();
  scene.add(new HemisphereLight(0xfff4e8, 0x8b919f, 1.26));
  for (const [color, intensity, position] of [
    [0xffe4c9, 1.62, [-3, 5, 4]],
    [0xbccffe, 0.52, [4, 2, 2]],
    [0xffb47a, 1.08, [2, 4, -3]],
  ]) {
    const light = new DirectionalLight(color, intensity);
    light.position.set(...position);
    scene.add(light);
  }
  return scene;
}

function makeShadow() {
  const bitmap = document.createElement('canvas');
  bitmap.width = bitmap.height = 96;
  const ctx = bitmap.getContext('2d');
  const gradient = ctx.createRadialGradient(48, 48, 3, 48, 48, 46);
  gradient.addColorStop(0, '#070607d9');
  gradient.addColorStop(0.50, '#08060995');
  gradient.addColorStop(1, '#08060900');
  ctx.fillStyle = gradient;
  ctx.fillRect(0, 0, 96, 96);
  const texture = new CanvasTexture(bitmap);
  const shadow = new Mesh(new PlaneGeometry(2.4, 2.05), new MeshBasicMaterial({ map: texture, transparent: true, depthWrite: false, toneMapped: false }));
  shadow.rotation.x = -Math.PI / 2;
  shadow.position.y = -0.014;
  return shadow;
}

function addFloor(scene) {
  const grid = new Mesh(new PlaneGeometry(21, 21), new ShaderMaterial({
    transparent: true,
    depthWrite: false,
    uniforms: { ink: { value: new Color(0x977b73) } },
    vertexShader: `
      varying vec2 floorPosition;
      void main() {
        floorPosition = position.xy;
        gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
      }`,
    fragmentShader: `
      uniform vec3 ink;
      varying vec2 floorPosition;
      void main() {
        vec2 cell = floorPosition * 2.0;
        vec2 pixel = max(fwidth(cell), vec2(0.0001));
        vec2 mark = abs(fract(cell + 0.5) - 0.5) / pixel;
        float line = 1.0 - smoothstep(0.05, 1.0, min(mark.x, mark.y));
        float falloff = 1.0 - smoothstep(2.9, 9.5, length(floorPosition));
        float horizon = 1.0 - smoothstep(0.20, 0.67, max(pixel.x, pixel.y));
        gl_FragColor = vec4(ink, line * falloff * horizon * 0.22);
        #include <colorspace_fragment>
      }`,
  }));
  grid.rotation.x = -Math.PI / 2;
  grid.position.y = -0.04;
  scene.add(grid);
  const ink = new LineBasicMaterial({ color: 0x9d6a51, transparent: true, opacity: 0.63, depthWrite: false, toneMapped: false });
  for (const radius of [1.22, 1.37]) {
    const points = Array.from({ length: 96 }, (_, index) => {
      const angle = index * Math.PI / 48;
      return new Vector3(radius * Math.cos(angle), -0.025, radius * Math.sin(angle));
    });
    const line = new LineLoop(new BufferGeometry().setFromPoints(points), ink);
    scene.add(line);
  }
  const ticks = [];
  for (let index = 0; index < 32; index++) {
    const angle = index * Math.PI / 16;
    const outer = index % 8 === 0 ? 1.52 : 1.42;
    for (const radius of [1.36, outer]) ticks.push(new Vector3(radius * Math.cos(angle), -0.025, radius * Math.sin(angle)));
  }
  scene.add(new LineSegments(new BufferGeometry().setFromPoints(ticks), ink), makeShadow());
}

export function createStudio(surface, onInvalidate, onOrbit, onContextStatus = () => {}) {
  const renderer = makeRenderer({ powerPreference: 'default' });
  const canvas = renderer.domElement;
  canvas.setAttribute('aria-hidden', 'true');
  surface.append(canvas);
  const scene = litScene();
  addFloor(scene);
  const camera = new PerspectiveCamera(CAMERA_FOV, 1, 0.05, 100);
  camera.position.set(1.4, 2.15, 5.2);
  const orbit = new OrbitControls(camera, canvas);
  orbit.target.set(0, 1, 0);
  orbit.enableDamping = true;
  orbit.dampingFactor = 0.13;
  orbit.enablePan = false;
  orbit.minPolarAngle = 0.17;
  orbit.maxPolarAngle = Math.PI * 0.5 - 0.025;
  orbit.minDistance = 0.55;
  orbit.maxDistance = 16;
  let actor;
  let dirty = true;
  let directed = false;
  let contextLost = false;

  function invalidate() {
    dirty = true;
    onInvalidate();
  }

  orbit.addEventListener('change', () => {
    invalidate();
    if (!directed) onOrbit();
  });
  directed = true;
  orbit.update();
  directed = false;

  function resize() {
    if (contextLost || surface.clientWidth < 1 || surface.clientHeight < 1) return;
    camera.aspect = surface.clientWidth / surface.clientHeight;
    camera.updateProjectionMatrix();
    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 1.65));
    renderer.setSize(surface.clientWidth, surface.clientHeight, false);
    invalidate();
  }

  new ResizeObserver(resize).observe(surface);
  canvas.addEventListener('webglcontextlost', (event) => {
    event.preventDefault();
    contextLost = true;
    onContextStatus(false);
  });
  canvas.addEventListener('webglcontextrestored', () => {
    contextLost = false;
    resize();
    onContextStatus(true);
  });

  return {
    setActor(next) {
      if (actor) scene.remove(actor);
      actor = next;
      if (actor) scene.add(actor);
      invalidate();
    },
    frame(bounds, angle = 'quarter') {
      const yaw = ANGLES[angle] ?? ANGLES.quarter;
      const direction = angle === 'custom'
        ? camera.position.clone().sub(orbit.target).normalize()
        : new Vector3(Math.sin(yaw), 0.145, Math.cos(yaw)).normalize();
      const aspect = Math.min(1, camera.aspect);
      const { center, distance } = fitDistance(bounds, direction, camera.fov, aspect);
      if (!Number.isFinite(distance) || distance <= 0) return;
      orbit.minDistance = distance * 0.26;
      orbit.maxDistance = Math.max(16, distance * 4);
      camera.near = Math.max(0.015, distance * 0.008);
      camera.far = Math.max(100, distance * 12);
      camera.updateProjectionMatrix();
      directed = true;
      const damping = orbit.enableDamping;
      orbit.enableDamping = false;
      orbit.update(); // discard any leftover inertia before snapping to the preset
      orbit.target.copy(center);
      camera.position.copy(center).addScaledVector(direction, distance);
      orbit.update();
      orbit.enableDamping = damping;
      directed = false;
      invalidate();
    },
    snapshotCamera() { return camera.clone(); },
    invalidate,
    draw() {
      if (contextLost) return;
      orbit.update();
      if (dirty) {
        renderer.render(scene, camera);
        dirty = false;
      }
    },
  };
}
