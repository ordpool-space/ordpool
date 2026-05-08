// HACK -- Ordpool artifact image previews: WebGL shader pair, replaces upstream's
// inline ones in block-overview-graph.component.ts. `offset` is widened from vec2
// to vec4 (.xy = corner, .z = isTexture flag, .w = packed slot integer). Fragment
// shader has a tristate branch on vIsTexture: >1.5 atlas, >0.5 procedural spinner,
// else flat colour. Atlas size + slot quantum match OrdpoolInscriptionAtlas
// (1024 px / 32 px). vCoord MUST be highp -- mediump rounded UVs to the wrong
// texel for 1024+px atlases.

export const ordpoolVertexShaderSrc = `
varying lowp vec4 vColor;
varying lowp float vIsTexture;
varying highp vec2 vCoord;
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
varying highp vec2 vCoord;
varying mediump vec2 vCorner;

uniform sampler2D uSampler;
uniform highp float now;

float ordpoolSpinnerIntensity(vec2 vc, float t) {
  vec2 p = vc - 0.5;
  float dist = length(p);
  float ring = smoothstep(0.45, 0.42, dist) * (1.0 - smoothstep(0.30, 0.33, dist));
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
