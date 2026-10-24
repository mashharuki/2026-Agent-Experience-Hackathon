import type { Pressure } from "sailing-sim";
import * as THREE from "three";

import { Reflector } from "three/addons/objects/Reflector.js";
import { type WaveEnvironment, waveGLSL } from "./wave-field";
export function createOcean() {
  const mirror = new Reflector(new THREE.PlaneGeometry(1, 1), {
    textureWidth: 512,
    textureHeight: 512,
    clipBias: 0.003,
    multisample: 0,
  });
  mirror.rotation.x = -Math.PI / 2;
  mirror.updateMatrixWorld();
  const mirrorMaterial = mirror.material as THREE.ShaderMaterial;
  const meshes = [64, 128, 256].map(
    (n) => new THREE.PlaneGeometry(700, 700, n, n),
  );
  let reflectionFrame = 0;
  const material = new THREE.ShaderMaterial({
    uniforms: {
      uTime: { value: 0 },
      uWaveEnv: { value: new THREE.Vector2(0, 1) },
      uReflection: { value: mirror.getRenderTarget().texture },
      uReflectionMatrix: { value: new THREE.Matrix4() },
      uReflect: { value: 0 },
      uDetail: { value: 1 },
      uWind: { value: 5 },
      uSun: { value: new THREE.Vector3(-0.65, 0.43, -0.62).normalize() },
      uPatches: {
        value: Array.from({ length: 3 }, () => new THREE.Vector4(0, 0, 0, 0)),
      },
    },
    vertexShader: `
      uniform float uTime;
      varying vec3 vWorld;
      varying vec4 vMirror;
      uniform mat4 uReflectionMatrix;
      ${waveGLSL}
      void main() {
        vec3 p = position;
        vec4 world = modelMatrix * vec4(p,1.);
        world.y += heightAt(world.xz);
        vWorld = world.xyz;
        vMirror = uReflectionMatrix * vec4(world.x,0.,world.z,1.);
        gl_Position = projectionMatrix * viewMatrix * world;
      }`,
    fragmentShader: `
      uniform float uTime;
      uniform float uWind;
      uniform vec3 uSun;
      uniform vec4 uPatches[3];
      uniform sampler2D uReflection;
      uniform float uReflect;
      uniform float uDetail;
      varying vec4 vMirror;
      varying vec3 vWorld;
      ${waveGLSL}
      float hash(vec2 p) { return fract(sin(dot(p,vec2(127.1,311.7)))*43758.5453); }
      float noise(vec2 p) {
        vec2 i=floor(p),f=fract(p); f=f*f*(3.-2.*f);
        return mix(mix(hash(i),hash(i+vec2(1,0)),f.x),mix(hash(i+vec2(0,1)),hash(i+vec2(1,1)),f.x),f.y);
      }
      void main() {
        vec2 p=vWorld.xz;
        float gust=0.;
        for(int i=0;i<3;i++) {
          vec4 gustArea=uPatches[i];
          float d=distance(p,gustArea.xy)/max(.01,gustArea.z);
          gust+=max(0.,1.-d*d)*gustArea.w;
        }
        float dx=(heightAt(p+vec2(.12,0))-heightAt(p-vec2(.12,0)))/.24;
        float dz=(heightAt(p+vec2(0,.12))-heightAt(p-vec2(0,.12)))/.24;
        vec2 q=p+vec2(noise(p*.19),noise(p*.17+7.))*3.;
        vec2 ripple=vec2(
          sin(q.x*3.7+q.y*2.1-uTime*3.2)+sin(q.x*8.1-q.y*3.2+uTime*2.),
          cos(q.y*4.3-q.x*1.8-uTime*2.7)+sin(q.y*7.4+q.x*5.1-uTime*3.1));
        float dist=distance(cameraPosition,vWorld);
        float detail=(1.-smoothstep(35.,160.,dist))*uDetail;
        vec3 normal=normalize(vec3(-dx-ripple.x*.035*detail*(1.+gust*.7),1.,-dz-ripple.y*.035*detail*(1.+gust*.7)));
        vec3 eye=normalize(cameraPosition-vWorld);
        vec3 reflected=reflect(-eye,normal);
        float fresnel=.035+.965*pow(1.-max(0.,dot(eye,normal)),4.);
        vec3 sky=mix(vec3(.55,.76,.85),vec3(.22,.46,.65),clamp(reflected.y,0.,1.));
        float skyCloud=noise(reflected.xz/max(.15,reflected.y)*2.3);
        sky=mix(sky,vec3(.8,.87,.9),smoothstep(.55,.85,skyCloud)*.3);
        vec2 mirrorUv=vMirror.xy/max(vMirror.w,.001)+normal.xz*.006;
        float inMirror=step(0.,mirrorUv.x)*step(mirrorUv.x,1.)*step(0.,mirrorUv.y)*step(mirrorUv.y,1.);
        sky=mix(sky,texture2D(uReflection,clamp(mirrorUv,0.,1.)).rgb,uReflect*inMirror*.75);
        float sun=pow(max(0.,dot(reflected,uSun)),180.);
        float glitter=pow(max(0.,dot(normal,normalize(uSun+eye))),120.);
        float swell=heightAt(p);
        vec3 water=mix(vec3(.012,.095,.14),vec3(.025,.24,.29),clamp(.5+swell*1.3,0.,1.));
        water*=1.-min(.28,gust*.1);
        vec3 color=mix(water,sky,fresnel*.78)+vec3(1.,.88,.65)*(sun*2.+glitter*.6);
        float foam=smoothstep(.22,.3,swell)*noise(p*3.+uTime*.3)*(.14+max(0.,uWind-5.)*.025);
        color=mix(color,vec3(.78,.9,.91),foam*detail);
        float haze=1.-exp(-dist*.0008);
        color=mix(color,vec3(.54,.73,.8),haze);
        gl_FragColor=vec4(color,1.);
        #include <tonemapping_fragment>
        #include <colorspace_fragment>
      }`,
  });
  const group = new THREE.Group();
  const near = new THREE.Mesh(meshes[2], material);
  near.rotation.x = -Math.PI / 2;
  group.add(near);
  const far = new THREE.Mesh(
    new THREE.PlaneGeometry(18000, 18000, 16, 16),
    material,
  );
  far.rotation.x = -Math.PI / 2;
  far.position.y = -0.65;
  group.add(far);
  return {
    group,
    setQuality(quality: string) {
      near.geometry =
        meshes[quality === "high" ? 2 : quality === "standard" ? 1 : 0];
      material.uniforms.uDetail.value = quality === "economy" ? 0.45 : 1;
      material.uniforms.uReflect.value = 0;
    },
    reflect(
      renderer: THREE.WebGLRenderer,
      scene: THREE.Scene,
      camera: THREE.Camera,
      quality: string,
    ) {
      if (quality !== "high" || reflectionFrame++ % 3 !== 0) return;
      group.visible = false;
      try {
        mirror.onBeforeRender(
          renderer,
          scene,
          camera,
          mirror.geometry,
          mirror.material as THREE.Material,
          null as unknown as THREE.Group,
        );
        material.uniforms.uReflectionMatrix.value
          .copy(mirrorMaterial.uniforms.textureMatrix.value)
          .multiply(new THREE.Matrix4().copy(mirror.matrixWorld).invert());
        material.uniforms.uReflect.value = 1;
      } finally {
        group.visible = true;
      }
    },
    dispose() {
      mirror.dispose();
      mirror.geometry.dispose();
      for (const mesh of meshes) mesh.dispose();
    },
    update(
      time: number,
      windSpeed: number,
      patches: Pressure[],
      x: number,
      z: number,
      environment: WaveEnvironment,
    ) {
      material.uniforms.uWaveEnv.value.set(
        environment.angle,
        environment.amplitude,
      );
      material.uniforms.uTime.value = time;
      material.uniforms.uWind.value = windSpeed;
      // Keep the dense mesh near the player without resetting world-space waves.
      near.position.set(Math.round(x / 50) * 50, 0, Math.round(z / 50) * 50);
      material.uniforms.uPatches.value.forEach(
        (value: THREE.Vector4, i: number) => {
          const patch = patches[i];
          value.set(
            patch?.x ?? 0,
            -(patch?.y ?? 0),
            patch?.radius ?? 0,
            patch?.extraSpeed ?? 0,
          );
        },
      );
    },
  };
}

export function createSky() {
  const material = new THREE.ShaderMaterial({
    side: THREE.BackSide,
    depthWrite: false,
    vertexShader: `varying vec3 vDirection;
      void main(){vDirection=position; gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.);}`,
    fragmentShader: `
      varying vec3 vDirection;
      float hash(vec2 p){return fract(sin(dot(p,vec2(127.1,311.7)))*43758.5453);}
      float noise(vec2 p){vec2 i=floor(p),f=fract(p);f=f*f*(3.-2.*f);return mix(mix(hash(i),hash(i+vec2(1,0)),f.x),mix(hash(i+vec2(0,1)),hash(i+vec2(1,1)),f.x),f.y);}
      void main(){
        vec3 d=normalize(vDirection);
        vec3 sun=normalize(vec3(-.65,.43,-.62));
        vec3 color=mix(vec3(.64,.8,.86),vec3(.12,.38,.64),pow(max(0.,d.y),.45));
        float alignment=max(0.,dot(d,sun));
        color+=vec3(1.,.87,.66)*pow(alignment,500.)*3.;
        color+=vec3(.3,.23,.12)*pow(alignment,14.);
        vec2 p=d.xz/max(.12,d.y)*2.;
        float cloud=noise(p)+noise(p*2.1)*.45+noise(p*4.2)*.2;
        float coverage=smoothstep(.78,1.18,cloud)*smoothstep(.06,.23,d.y);
        color=mix(color,vec3(.9,.93,.92),coverage*.72);
        gl_FragColor=vec4(color,1.);
        #include <tonemapping_fragment>
        #include <colorspace_fragment>
      }`,
  });
  return new THREE.Mesh(new THREE.SphereGeometry(8500, 32, 20), material);
}
