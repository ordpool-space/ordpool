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
  - The fragment shader has a two-way branch: sample the atlas when
    `vIsTexture > 0.5`, fall back to the flat colour otherwise. The atlas
    sample is composited over the colour using the texture's own alpha,
    so transparent pixels in the inscription show the underlying tx tint.

  Atlas size and slot quantum match `OrdpoolInscriptionAtlas` (1024 px /
  32 px). The numeric constants in the shader match `packSlot()`'s
  encoding: 512 = atlasSize / quantum / 2, 262144 = 512^2.
*/

export const ordpoolVertexShaderSrc = `
varying lowp vec4 vColor;
varying lowp float vIsTexture;
varying mediump vec2 vCoord;

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
  float spriteX = mod(offset.w, 512.0) * 32.0;
  float spriteY = mod(floor(offset.w / 512.0), 512.0) * 32.0;
  float pxSize = floor(offset.w / 262144.0) * 32.0;
  spriteY = atlasSize - spriteY - pxSize;
  vCoord = (vec2(spriteX, spriteY) + corner * pxSize) / atlasSize;
}
`;

export const ordpoolFragmentShaderSrc = `
varying lowp vec4 vColor;
varying lowp float vIsTexture;
varying mediump vec2 vCoord;

uniform sampler2D uSampler;

void main() {
  if (vIsTexture > 0.5) {
    vec4 tex = texture2D(uSampler, vCoord);
    gl_FragColor.rgb = tex.rgb * tex.a + vColor.rgb * (1.0 - tex.a);
    gl_FragColor.a = vColor.a;
  } else {
    gl_FragColor = vColor;
  }
  gl_FragColor.rgb *= gl_FragColor.a;
}
`;
