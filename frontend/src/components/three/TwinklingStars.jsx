import React, { useMemo, useRef } from 'react';
import { useFrame } from '@react-three/fiber';

const vertexShader = `
  uniform float time;
  uniform float pixelRatio;
  attribute vec4 sparkle;
  varying float brightness;
  varying float glint;

  void main() {
    float period = sparkle.x;
    float tick = (time + sparkle.y) / period;
    float jitter = fract(sin((floor(tick) + sparkle.y) * 91.73) * 4375.13);
    float elapsed = (fract(tick) - (0.13 + jitter * 0.53)) * period;
    float pulse = smoothstep(0.0, 0.14, elapsed) * (1.0 - smoothstep(0.14, sparkle.z, elapsed));
    brightness = 0.24 + sparkle.w * 0.36 + pulse * 0.73;
    glint = pulse;
    gl_PointSize = (1.45 + sparkle.w * 1.55 + pulse * 4.3) * pixelRatio;
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  }
`;

const fragmentShader = `
  varying float brightness;
  varying float glint;

  void main() {
    vec2 point = gl_PointCoord * 2.0 - 1.0;
    float distanceFromCenter = length(point);
    float angle = atan(point.y, point.x + 0.0001);
    float outline = 0.24 + 0.75 * pow(abs(cos(angle * 2.0)), 8.0);
    float flare = 1.0 - smoothstep(outline * 0.62, outline, distanceFromCenter);
    float star = mix(1.0 - smoothstep(0.12, 1.0, distanceFromCenter), flare, smoothstep(0.12, 0.55, glint));
    float opacity = star * brightness;
    gl_FragColor = vec4(0.84, 0.91, 1.0, min(opacity, 1.0));
    #include <tonemapping_fragment>
    #include <colorspace_fragment>
  }
`;

export default function TwinklingStars({ animate }) {
  const material = useRef();
  const { positions, intervals } = useMemo(() => {
    const count = 1400;
    const positions = new Float32Array(count * 3);
    const intervals = new Float32Array(count * 4);
    for (let i = 0; i < count; i++) {
      const height = Math.random() * 2 - 1;
      const azimuth = Math.random() * Math.PI * 2;
      const radius = 60 + Math.random() * 30;
      const horizontal = radius * Math.sqrt(1 - height ** 2);
      positions.set([horizontal * Math.cos(azimuth), radius * height, horizontal * Math.sin(azimuth)], i * 3);
      intervals.set([3 + Math.random() * 11, Math.random() * 16, .45 + Math.random() * .48, Math.random()], i * 4);
    }
    return { positions, intervals };
  }, []);
  const uniforms = useMemo(() => ({ time: { value: 0 }, pixelRatio: { value: 1 } }), []);

  useFrame(({ clock, gl }) => {
    if (!material.current) return;
    material.current.uniforms.time.value = animate ? clock.elapsedTime : 0;
    material.current.uniforms.pixelRatio.value = gl.getPixelRatio();
  });

  return (
    <points>
      <bufferGeometry>
        <bufferAttribute attach="attributes-position" args={[positions, 3]} />
        <bufferAttribute attach="attributes-sparkle" args={[intervals, 4]} />
      </bufferGeometry>
      <shaderMaterial ref={material} uniforms={uniforms} vertexShader={vertexShader}
        fragmentShader={fragmentShader} transparent depthWrite={false} />
    </points>
  );
}
