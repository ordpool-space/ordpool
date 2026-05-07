/*
  WebGL shaders for the block-overview graph, with the ordpool inscription
  image preview pipeline added on top of mempool's existing geometry-only
  renderer.

  Differences from upstream's inline shaders in block-overview-graph.component.ts:

  - `offset` is widened from vec2 to vec4. The original .xy stays the
    per-vertex corner offset (0..1). The new .z is the texture flag
    (0 = flat colour, 1 = atlas slot). The new .w is the packed slot
    integer produced by `packSlot()`: x/32 + (y/32)*512 + (size/32)*262144.
  - The vertex shader decodes the slot back to atlas UVs. The slot's y
    coordinate is flipped to match the un-flipped texImage2D upload of a
    canvas2d (which has top-left origin, while WebGL textures default to
    bottom-left).
  - The fragment shader has a tristate branch on `vIsTexture`:
      `> 1.5` — sample the atlas. The texture is composited over the flat
        colour using the image's own alpha, so transparent pixels in the
        inscription show the underlying tx tint.
      `> 0.5` — render a procedural rotating-arc spinner over the flat
        colour, driven by the existing `now` uniform. No texture asset
        required; arc + ring math runs in ~10 GPU instructions per pixel.
      `else`  — flat colour fallback.

  Atlas size and slot quantum match `OrdpoolInscriptionAtlas` (1024 px /
  32 px). The numeric constants in the shader match `packSlot()`'s
  encoding: 512 = atlasSize / quantum / 2, 262144 = 512^2.
*/

export const ordpoolVertexShaderSrc = `
varying lowp vec4 vColor;
varying lowp float vIsTexture;
varying mediump vec2 vCoord;
varying mediump vec2 vCorner;

attribute vec4 offset;
attribute vec4 posX;
attribute vec4 posY;
attribute vec4 posR;
attribute vec4 colR;
attribute vec4 colG;
attribute vec4 colB;
attribute vec4 colA;

uniform vec2 screenSize;
uniform float now;
uniform float atlasSize;

float smootherstep(float x) {
  x = clamp(x, 0.0, 1.0);
  float ix = 1.0 - x;
  x = x * x;
  return x / (x + ix * ix);
}

float interpolateAttribute(vec4 attr) {
  float d = (now - attr.z) * attr.w;
  float delta = smootherstep(d);
  return mix(attr.x, attr.y, delta);
}

void main() {
  vec4 screenTransform = vec4(2.0 / screenSize.x, 2.0 / screenSize.y, -1.0, -1.0);

  float radius = interpolateAttribute(posR);
  vec2 corner = offset.xy;
  vec2 position = vec2(interpolateAttribute(posX), interpolateAttribute(posY)) + (radius * corner);

  gl_Position = vec4(position * screenTransform.xy + screenTransform.zw, 1.0, 1.0);

  float red = interpolateAttribute(colR);
  float green = interpolateAttribute(colG);
  float blue = interpolateAttribute(colB);
  float alpha = interpolateAttribute(colA);
  vColor = vec4(red, green, blue, alpha);

  vIsTexture = offset.z;
  // Slot-local UV. Interpolates linearly to (0..1, 0..1) across the quad,
  // used by the loading-spinner branch in the fragment shader.
  vCorner = corner;
  float spriteX = mod(offset.w, 512.0) * 32.0;
  float spriteY = mod(floor(offset.w / 512.0), 512.0) * 32.0;
  float pxSize = floor(offset.w / 262144.0) * 32.0;
  spriteY = atlasSize - spriteY - pxSize;
  vCoord = (vec2(spriteX, spriteY) + corner * pxSize) / atlasSize;
}
`;

export const ordpoolFragmentShaderSrc = `
precision mediump float;

varying lowp vec4 vColor;
varying lowp float vIsTexture;
varying mediump vec2 vCoord;
varying mediump vec2 vCorner;

uniform sampler2D uSampler;
uniform float now;

// Procedural rotating-arc spinner drawn in slot-local UV space (vCorner).
// Returns a [0..1] intensity; 1 = full white sweep highlight, 0 = leave the
// underlying color alone. Width and rotation speed are tuned for visibility
// at small (32–64 px) slot sizes without dominating large slots.
float ordpoolSpinnerIntensity(vec2 vc, float t) {
  vec2 p = vc - 0.5;
  float dist = length(p);
  // Annulus between 0.30 and 0.45 of the slot, anti-aliased on both edges.
  float ring = smoothstep(0.45, 0.42, dist) * (1.0 - smoothstep(0.30, 0.33, dist));
  // Rotating sweep: bright at the leading edge of an arc, fading away
  // around the rest of the circle. now is in ms, 0.003 ≈ one rev / 2 s.
  float angle = atan(p.y, p.x);
  float rotation = t * 0.003;
  float arc = mod(angle + rotation, 6.283185);
  float sweep = smoothstep(2.5, 0.0, arc);
  return ring * sweep;
}

void main() {
  vec4 base = vColor;
  if (vIsTexture > 1.5) {
    vec4 tex = texture2D(uSampler, vCoord);
    base.rgb = tex.rgb * tex.a + vColor.rgb * (1.0 - tex.a);
    base.a = vColor.a;
  } else if (vIsTexture > 0.5) {
    float lit = ordpoolSpinnerIntensity(vCorner, now);
    base.rgb = mix(vColor.rgb, vec3(1.0), lit * 0.85);
    base.a = vColor.a;
  }
  gl_FragColor = base;
  gl_FragColor.rgb *= gl_FragColor.a;
}
`;
