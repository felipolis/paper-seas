/**
 * Matte cardstock material (papertrails' paper, render/materials.js there): purely diffuse (MeshLambertMaterial)
 * extended with
 *   - a printed face (map) and a plain kraft back face (gl_FrontFacing), like a real die-cut card;
 *   - papertrails' card fibre in object space (so the paper sticks to a folding card), projected on the plane the
 *     surface faces: tooth, mottling and a broad soft mottle on the albedo, multiplied after the print so ink never
 *     hides the fibre, and the fibre's relief plus broad creases on the normal;
 *   - a per-sheet tone, a touch warmer or cooler from sheet to sheet;
 *   - on request (pencilPlan), papertrails' folded print: a card or a model lying flat fades toward a pencil plan far
 *     from the page focus (setPageFocus);
 *   - paper lighting: wrap diffuse (soft terminator, wider for point lights) and a warm glow of thin card lit from
 *     behind;
 *   - an anti-aliased die cut (the painted card's transparent area is cut away, shadows included).
 */
import * as THREE from 'three';
import { PALETTE } from '../config/palette';
import { PAPER } from '../config/view';
import { cardFibre } from '../art/paper-maps';
import { SHADOW, SHADOW_GLOBALS } from './shadows';
import { glowLike } from './glow';

/** papertrails' cardstock with its card maps (config/render.js `lights.paper` there, the `asset*` values). */
const CARDSTOCK = {
  /** World units per tile of the card maps. */
  tile: 2.0,
  /** Albedo swing of the tooth, of the 0.15-0.3 unit mottling, and of the broad mottle relative to the mottling. */
  tooth: 0.36,
  cloud: 0.085,
  broad: 1.2,
  /** Weight and frequency of the fine octave. */
  fine: 0.45,
  fineFrequency: 3.73,
  /** Normal strength of the fibre, and of the broad low-relief creases and their frequency relative to the tile. */
  relief: 1.25,
  crumple: 0.9,
  crumpleScale: 0.27,
  /** Per-sheet tone variation (+-). */
  toneVary: 0.065,
  /** Wrap diffuse of point lights (papertrails' `lantern.wrap`): their pool on the card is wide and soft. */
  pointWrap: 0.55,
  /** Alpha threshold of the die cut, and the coverage below which a pixel is dropped (with alpha-to-coverage). */
  cut: 0.4,
  coverageFloor: 0.04,
};

/**
 * papertrails' unpainted book (config/world.js `book` there): the colour far from the traveller is a pale cream wash
 * (`fadedInk` of the way) with pencil lines, and a card lying flat comes up with the distance, keeping 1 - printFade of
 * its colour beyond printFar.
 */
const BOOK = {
  cream: new THREE.Color('#efe0c2'),
  fadedInk: 0.8,
  printNear: 6.8,
  printFar: 9.6,
  printFade: 0.75,
};

/** papertrails' `uTrav`: the traveller (on foot) or the ship, round which the book is painted. */
const pageFocus = { value: new THREE.Vector2() };

/** Where the book is painted round, every frame. */
export function setPageFocus(x: number, z: number): void {
  pageFocus.value.set(x, z);
}

/** Per-instance attribute of a pencil-plan material (pencilPlan): 1 = the card lies flat, 0 = it stands. */
export const PAPER_FLAT_ATTRIBUTE = 'aPaperFlat';

/**
 * papertrails' folded print (every piece of its folded tiles, cards, houses and hills alike, is printed flat on the
 * page and fades): what the material draws fades toward a pencil plan, as it lies flat, with its distance from the
 * page focus. per 'instance': instanced cards, each one's flatness in PAPER_FLAT_ATTRIBUTE (a mesh without it is never
 * faded); per 'object': one model per material (paperCopy), its flatness set with setPaperFlat.
 */
export function pencilPlan(mat: THREE.Material, per: 'instance' | 'object' = 'instance'): void {
  if (mat.defines?.PAPER_PENCIL !== undefined) return;
  mat.defines = { ...mat.defines, PAPER_PENCIL: '', ...(per === 'object' ? { PAPER_PENCIL_OBJECT: '' } : {}) };
  mat.needsUpdate = true;
}

/** Each material's flatness (its uPaperFlat), for a pencil plan per object. */
const objectFlat = new WeakMap<THREE.Material, THREE.IUniform<number>>();

function flatUniform(mat: THREE.Material): THREE.IUniform<number> {
  let u = objectFlat.get(mat);
  if (!u) objectFlat.set(mat, (u = { value: 0 }));
  return u;
}

/** How flat the model a pencil-plan 'object' material draws lies now: 0 standing .. 1 flat. */
export function setPaperFlat(mat: THREE.Material, flat: number): void {
  flatUniform(mat).value = flat;
}

/**
 * A copy of a paper material that compiles to the same program (a clone keeps neither the shader hooks nor the
 * defines), glows at night as its source does and has its own flatness (setPaperFlat).
 */
export function paperCopy<M extends THREE.Material>(mat: M): M {
  const copy = mat.clone() as M;
  copy.onBeforeCompile = mat.onBeforeCompile;
  copy.customProgramCacheKey = mat.customProgramCacheKey;
  copy.defines = { ...mat.defines };
  glowLike(copy, mat);
  return copy;
}

/** The `fibre` option at which a card gets papertrails' cardstock. */
const FIBRE_DEFAULT = 0.18;
/** The `fibreScale` option at which one tile of the card maps covers CARDSTOCK.tile world units. */
const FIBRE_SCALE_DEFAULT = 1.3;

export interface PaperOptions {
  map?: THREE.Texture | null;
  color?: THREE.ColorRepresentation;
  /** Colour of the unprinted back face. null = the back shows the print too. */
  back?: THREE.ColorRepresentation | null;
  /** Fibre strength: 0.18 = papertrails' cardstock, 0 = no fibre at all (albedo or relief). */
  fibre?: number;
  /** Fibre frequency: 1.3 = papertrails' tile of the card maps. */
  fibreScale?: number;
  /** Normal relief of the fibre (multiplier on papertrails' strength). */
  relief?: number;
  /** Per-sheet tone variation (papertrails' `vary`). */
  vary?: boolean;
  alphaTest?: number;
  transparent?: boolean;
  opacity?: number;
  emissive?: THREE.ColorRepresentation;
  emissiveIntensity?: number;
  side?: THREE.Side;
  /** papertrails' cardstock: the colour is in the vertices (one white material for every printed card). */
  vertexColors?: boolean;
}

type PaperLighting = Record<'uPaperWrap' | 'uPaperPointWrap' | 'uPaperTrans', THREE.IUniform<number>> &
  Record<'uPaperTransTint' | 'uPaperShadowLeak', THREE.IUniform<THREE.Color>>;

/** Shared paper lighting uniforms (one object: tweak once, every card follows; the day / night look writes them). */
export const paperLighting: PaperLighting = {
  uPaperWrap: { value: PAPER.wrap },
  uPaperPointWrap: { value: CARDSTOCK.pointWrap },
  uPaperTrans: { value: PAPER.translucency },
  uPaperTransTint: { value: new THREE.Color(PAPER.translucencyTint) },
  /** The warm light leaking into the key's shadow (bounced off the cream page). */
  uPaperShadowLeak: { value: new THREE.Color(PAPER.shadowLeak) },
};

/**
 * Lambert direct lighting with wrap diffuse and back-lit translucency (papertrails' `RE_Direct_Paper`): in the key
 * light's shadow a warm light leaks in instead of the stock grey, and thin card glows from behind only where it is lit
 * through (a card shaded by another card does not), from the lit fractions the PCSS left (render/shadows.ts).
 */
const PAPER_LAMBERT = THREE.ShaderChunk.lights_lambert_pars_fragment.replace(
  'float dotNL = saturate( dot( geometryNormal, directLight.direction ) );\n\tvec3 irradiance = dotNL * directLight.color;',
  `float nl = dot( geometryNormal, directLight.direction );
	float wrap = mix( uPaperWrap, uPaperPointWrap, gPaperPoint );
	float dotNL = saturate( ( nl + wrap ) / ( 1.0 + wrap ) );
	vec3 lightC = directLight.color;
	vec3 lightOpen = directLight.color;
	float litThin = 1.0;
	#if defined( USE_SHADOWMAP ) && defined( SHADOWMAP_TYPE_BASIC )
	if ( gShadowSet ) {
		lightOpen = directLight.color / mix( ${SHADOW.stockLeak.toFixed(4)}, 1.0, gShadowLit );
		lightC = lightOpen * mix( uPaperShadowLeak, vec3( 1.0 ), gShadowLit );
		litThin = gShadowLitThin;
		gShadowSet = false;
	}
	#endif
	vec3 irradiance = dotNL * lightC;
	// thin card lit from behind glows warm through the fibres
	irradiance += saturate( ( - nl + 0.1 ) / 1.1 ) * uPaperTrans * uPaperTransTint * lightOpen * litThin;`,
);
if (PAPER_LAMBERT === THREE.ShaderChunk.lights_lambert_pars_fragment) {
  console.warn('paper-material: Lambert chunk changed, paper lighting not applied');
}

/** papertrails' `patchLightsBegin`: the lighting knows which kind of light it is adding (point lights wrap wider). */
const PAPER_LIGHTS_BEGIN = THREE.ShaderChunk.lights_fragment_begin
  .replace('getPointLightInfo( pointLight, geometryPosition, directLight );', '$&\n\t\tgPaperPoint = 1.0;')
  .replace('getSpotLightInfo( spotLight, geometryPosition, directLight );', '$&\n\t\tgPaperPoint = 0.0;')
  .replace('getDirectionalLightInfo( directionalLight, directLight );', '$&\n\t\tgPaperPoint = 0.0;');
if (PAPER_LIGHTS_BEGIN.split('gPaperPoint').length !== 4) {
  console.warn('paper-material: lights chunk changed, point lights get the key wrap');
}

export function createPaperMaterial(o: PaperOptions = {}): THREE.MeshLambertMaterial {
  const fibre = o.fibre ?? FIBRE_DEFAULT;
  const mat = new THREE.MeshLambertMaterial({
    map: o.map ?? null,
    color: o.color ?? '#ffffff',
    side: o.side ?? THREE.DoubleSide,
    alphaTest: o.map ? (o.alphaTest ?? CARDSTOCK.cut) : 0,
    transparent: o.transparent ?? false,
    opacity: o.opacity ?? 1,
    emissive: o.emissive ?? '#000000',
    emissiveIntensity: o.emissiveIntensity ?? 1,
    vertexColors: o.vertexColors ?? false,
  });
  // the die cut is anti-aliased on the multisampled scene target
  mat.alphaToCoverage = mat.alphaTest > 0 && !mat.transparent;
  mat.defines = {};
  if (fibre === 0) mat.defines.PAPER_NO_FIBRE = '';
  if (o.vary === false) mat.defines.PAPER_NO_VARY = '';
  const back = o.back === undefined ? PALETTE.kraft : o.back;
  const uniforms = {
    ...paperLighting,
    uPaperBack: { value: new THREE.Color(back ?? '#ffffff') },
    uPaperBackOn: { value: back === null ? 0 : 1 },
    uPaperFibreTex: { value: cardFibre() },
    uPaperFibreAmt: { value: fibre / FIBRE_DEFAULT },
    uPaperFibreScale: { value: (o.fibreScale ?? FIBRE_SCALE_DEFAULT) / FIBRE_SCALE_DEFAULT / CARDSTOCK.tile },
    uPaperRelief: { value: CARDSTOCK.relief * (o.relief ?? 1) },
    uPageFocus: pageFocus,
  };
  // (a function, not an arrow: called on each copy of the material too (paperCopy), with its own flatness)
  mat.onBeforeCompile = function (this: THREE.Material, shader) {
    Object.assign(shader.uniforms, uniforms, { uPaperFlat: flatUniform(this) });
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', VERT_COMMON)
      .replace('#include <project_vertex>', VERT_PROJECT);
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', FRAG_COMMON)
      .replace('#include <lights_lambert_pars_fragment>', PAPER_LAMBERT)
      .replace('#include <map_fragment>', FRAG_MAP)
      .replace('#include <color_fragment>', FRAG_FIBRE)
      .replace('#include <alphatest_fragment>', FRAG_CUT)
      .replace('#include <normal_fragment_maps>', FRAG_NORMAL)
      .replace('#include <lights_fragment_begin>', PAPER_LIGHTS_BEGIN);
  };
  mat.customProgramCacheKey = () => 'paper-v7';
  return mat;
}

const f = (v: number) => v.toFixed(4);

const VERT_COMMON = /* glsl */ `#include <common>
varying vec3 vPaperPos;
varying vec3 vPaperNrm;
varying float vPaperTone;
#ifdef PAPER_PENCIL
#ifdef PAPER_PENCIL_OBJECT
uniform float uPaperFlat;
#else
attribute float ${PAPER_FLAT_ATTRIBUTE};
#endif
varying float vPaperFlat;
varying vec2 vPaperW;
#endif
float paperHash( vec2 p ) { return fract( sin( dot( p, vec2( 127.1, 311.7 ) ) ) * 43758.5453 ); }
float paperVNoise( vec2 p ) {
  vec2 i = floor( p ), f = fract( p );
  f = f * f * ( 3.0 - 2.0 * f );
  return mix( mix( paperHash( i ), paperHash( i + vec2( 1.0, 0.0 ) ), f.x ), mix( paperHash( i + vec2( 0.0, 1.0 ) ), paperHash( i + vec2( 1.0, 1.0 ) ), f.x ), f.y );
}`;

const VERT_PROJECT = /* glsl */ `#include <project_vertex>
{
  mat4 paperM = modelMatrix;
  float paperId = 0.0;
  #ifdef USE_INSTANCING
    paperM = paperM * instanceMatrix;
    paperId = float( gl_InstanceID );
  #endif
  // world-scaled object coordinates (so the grain has the same size on every card, instanced or not)
  vPaperPos = transformed * vec3( length( paperM[0].xyz ), length( paperM[1].xyz ), length( paperM[2].xyz ) );
  vPaperNrm = objectNormal;
  // per-sheet tone: smooth in the sheet's origin (so a moving sheet never flickers) + a hash of the instance id
  vec3 paperO = paperM[3].xyz;
  float paperTn = paperVNoise( paperO.xz * 1.13 + paperO.y * 2.71 );
  paperTn = fract( paperTn + paperHash( vec2( paperId, 3.7 ) ) * step( 0.5, paperId ) );
  vPaperTone = paperTn * 2.0 - 1.0;
  #ifdef PAPER_PENCIL
    #ifdef PAPER_PENCIL_OBJECT
      vPaperFlat = uPaperFlat;
    #else
      vPaperFlat = ${PAPER_FLAT_ATTRIBUTE};
    #endif
    vPaperW = ( paperM * vec4( transformed, 1.0 ) ).xz;
  #endif
}`;

const FRAG_COMMON = /* glsl */ `#include <common>
${SHADOW_GLOBALS}
varying vec3 vPaperPos;
varying vec3 vPaperNrm;
varying float vPaperTone;
uniform vec3 uPaperBack;
uniform float uPaperBackOn;
uniform sampler2D uPaperFibreTex;
uniform float uPaperFibreAmt;
uniform float uPaperFibreScale;
uniform float uPaperRelief;
uniform float uPaperWrap;
uniform float uPaperPointWrap;
uniform float uPaperTrans;
uniform vec3 uPaperTransTint;
uniform vec3 uPaperShadowLeak;
uniform vec2 uPageFocus;
#ifdef PAPER_PENCIL
varying float vPaperFlat;
varying vec2 vPaperW;
#endif
float gPaperPoint = 0.0;
vec2 paperUv;
vec4 paperF1;
vec4 paperF2;
vec4 paperF3;
float pageHash( vec2 p ) { vec3 p3 = fract( vec3( p.xyx ) * 0.1031 ); p3 += dot( p3, p3.yzx + 33.33 ); return fract( ( p3.x + p3.y ) * p3.z ); }
float pageNoise( vec2 p ) {
  vec2 i = floor( p ), f = fract( p );
  vec2 u = f * f * ( 3.0 - 2.0 * f );
  return mix( mix( pageHash( i ), pageHash( i + vec2( 1.0, 0.0 ) ), u.x ), mix( pageHash( i + vec2( 0.0, 1.0 ) ), pageHash( i + vec2( 1.0, 1.0 ) ), u.x ), u.y );
}
// papertrails' unpainted book: a pale cream wash of the colour, pencil outlines from the colour's own luma gradient and
// a little hatching in its dark areas (wq: world xz, wpx: world units per pixel; fpk = 1 on a folded card's print,
// which washes paler and greyer)
vec3 pageUnpainted( vec3 pr, vec2 wq, float wpx, float fpk ) {
  float lum = dot( pr, vec3( 0.3, 0.59, 0.11 ) );
  float line = smoothstep( 0.5, 2.6, length( vec2( dFdx( lum ), dFdy( lum ) ) ) / max( wpx, 1e-5 ) );
  float hatch = smoothstep( 0.35, 0.9, sin( ( wq.x - wq.y ) * 125.6637 + 2.0 * pageNoise( wq * 2.0 ) ) ) * ( 1.0 - smoothstep( 0.3, 0.52, lum ) ) * ( 1.0 - smoothstep( 0.012, 0.03, wpx ) );
  vec3 wash = mix( vec3( ${f(BOOK.cream.r)}, ${f(BOOK.cream.g)}, ${f(BOOK.cream.b)} ), mix( pr, vec3( lum ) * vec3( 1.04, 1.0, 0.93 ), 0.5 + 0.25 * fpk ), ${f(BOOK.fadedInk)} * ( 0.72 - 0.2 * fpk ) );
  return mix( wash, vec3( 0.34, 0.29, 0.25 ), clamp( 0.5 * line + 0.2 * hatch, 0.0, 0.6 ) * ${f(BOOK.fadedInk)} );
}`;

const FRAG_MAP = /* glsl */ `#include <map_fragment>
if ( !gl_FrontFacing && uPaperBackOn > 0.5 ) diffuseColor.rgb = uPaperBack;`;

/** The fibre and the sheet's tone, after the print and the vertex colour (papertrails' FRAG_FIBRE). */
const FRAG_FIBRE = /* glsl */ `#include <color_fragment>
#ifdef PAPER_TINT
{
  // papertrails' biome tint (world/book.js biomeTint, render/biome-tint.ts): the biome's colour transform, sparing the
  // teal of water (keepWater) and the very dark printed pieces (posts, trunks, ink)
  vec3 c = diffuseColor.rgb;
  vec3 t = max( vec3( dot( PAPER_TINT_R.xyz, c ) + PAPER_TINT_R.w, dot( PAPER_TINT_G.xyz, c ) + PAPER_TINT_G.w, dot( PAPER_TINT_B.xyz, c ) + PAPER_TINT_B.w ), 0.0 );
  float dk = 1.0 - smoothstep( 0.05, 0.2, dot( c, vec3( 0.2126, 0.7152, 0.0722 ) ) );
  diffuseColor.rgb = mix( t, c, max( smoothstep( 0.03, 0.14, min( c.g, c.b ) - c.r ) * PAPER_TINT_KEEP, dk * 0.85 ) );
}
#endif
#ifdef PAPER_PENCIL
{
  // a card lying flat comes up with the distance: full colour near the focus, a pencil plan farther out
  float wpx = max( fwidth( vPaperW.x ), fwidth( vPaperW.y ) );
  float ink = mix( 1.0, 1.0 - ${f(BOOK.printFade)} * smoothstep( ${f(BOOK.printNear)}, ${f(BOOK.printFar)}, distance( vPaperW, uPageFocus ) ), vPaperFlat );
  diffuseColor.rgb = mix( pageUnpainted( diffuseColor.rgb, vPaperW, wpx, vPaperFlat ), diffuseColor.rgb, ink * ink * ( 3.0 - 2.0 * ink ) );
}
#endif
#ifndef PAPER_NO_FIBRE
{
  // the fibre lies on the plane the surface faces most
  vec3 an = abs( vPaperNrm );
  paperUv = ( an.y >= max( an.x, an.z ) ) ? vPaperPos.xz : ( ( an.x > an.z ) ? vPaperPos.zy : vPaperPos.xy );
  paperUv *= uPaperFibreScale;
  paperF1 = texture2D( uPaperFibreTex, paperUv, -0.6 );
  paperF2 = texture2D( uPaperFibreTex, paperUv * ${f(CARDSTOCK.fineFrequency)} + vec2( 0.37, 0.61 ), -0.4 );
  // crumple: the same sheet sampled coarse and blurred = broad low-relief creases (and a broad soft mottle, so a large
  // sheet never reads as a flat fill)
  paperF3 = texture2D( uPaperFibreTex, paperUv.yx * ${f(CARDSTOCK.crumpleScale)} + vec2( 0.13, 0.71 ), 1.6 );
  float tooth = ( paperF1.b - 0.5 ) + ( paperF2.b - 0.5 ) * ${f(CARDSTOCK.fine)};
  float cloud = ( paperF1.a - 0.5 ) + ( paperF3.a - 0.5 ) * ${f(CARDSTOCK.broad)};
  // (6.25 undoes the packing: the detail and the cloud are stored at 0.16 of their swing)
  diffuseColor.rgb *= max( 0.0, 1.0 + ( tooth * ${f(CARDSTOCK.tooth)} + cloud * ${f(CARDSTOCK.cloud)} ) * 6.25 * uPaperFibreAmt );
}
#endif
#ifndef PAPER_NO_VARY
diffuseColor.rgb *= ( 1.0 + vPaperTone * ${f(CARDSTOCK.toneVary)} ) * vec3( 1.0 + vPaperTone * ${f(CARDSTOCK.toneVary * 0.35)}, 1.0, 1.0 - vPaperTone * ${f(CARDSTOCK.toneVary * 0.5)} );
#endif`;

/**
 * papertrails' anti-aliased die cut: the coverage comes from the alpha gradient around the threshold, and the
 * multisampled scene target turns it into a smooth edge (alpha-to-coverage).
 */
const FRAG_CUT = /* glsl */ `
#ifdef USE_ALPHATEST
  #ifdef ALPHA_TO_COVERAGE
  diffuseColor.a = clamp( ( diffuseColor.a - alphaTest ) / max( fwidth( diffuseColor.a ), 1e-4 ) + 0.5, 0.0, 1.0 );
  if ( diffuseColor.a < ${f(CARDSTOCK.coverageFloor)} ) discard;
  #else
  if ( diffuseColor.a < alphaTest ) discard;
  #endif
#endif`;

/** The fibre's relief, its fine octave and the creases, on a tangent frame from screen derivatives of the fibre uv. */
const FRAG_NORMAL = /* glsl */ `#include <normal_fragment_maps>
#ifndef PAPER_NO_FIBRE
{
  vec2 pn = ( paperF1.rg - 0.5 ) * 2.0 + ( paperF2.rg - 0.5 ) * 2.0 * ${f(CARDSTOCK.fine)};
  // (the creases keep their own strength, whatever the fibre's)
  pn += ( paperF3.gr - 0.5 ) * 2.0 * ${f(CARDSTOCK.crumple)} / max( uPaperRelief, 1e-3 );
  vec3 q0 = dFdx( vViewPosition );
  vec3 q1 = dFdy( vViewPosition );
  vec2 st0 = dFdx( paperUv );
  vec2 st1 = dFdy( paperUv );
  vec3 q1perp = cross( q1, normal );
  vec3 q0perp = cross( normal, q0 );
  vec3 pT = q1perp * st0.x + q0perp * st1.x;
  vec3 pB = q1perp * st0.y + q0perp * st1.y;
  float pdet = max( dot( pT, pT ), dot( pB, pB ) );
  float pscale = ( pdet == 0.0 ) ? 0.0 : inversesqrt( pdet );
  vec3 n = normal + ( pT * pn.x + pB * pn.y ) * pscale * uPaperRelief;
  // (a degenerate frame - a face seen edge-on, a sliver - keeps the surface normal: normalize(0) is NaN)
  normal = dot( n, n ) > 1e-12 ? normalize( n ) : normal;
}
#endif`;
