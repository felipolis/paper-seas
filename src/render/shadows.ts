/**
 * Soft shadows: three's basic shadow filter is replaced, for every lit material, by a PCSS soft shadow: a blocker
 * search, then a Vogel-disc filter whose width grows with the distance from the blocker (lightSize per unit), so a
 * card's shadow is crisp where it stands on the page and widens away from it.
 * The key light's stock uniforms carry what the filter needs (lights.ts): shadow.radius the world size of the shadow
 * map, shadow.bias the light size; the real depth bias is baked in here.
 *
 * The filter leaves the lit fraction in globals, so the paper's lighting (paper-material.ts) can let a warm light leak
 * into the shadow (light bounced off the cream page) and let thin card glow from behind only where it is truly lit.
 */
import * as THREE from 'three';

export const SHADOW = {
  /** Penumbra width (world) per unit of blocker-to-receiver distance, its least width (texels) and its widest. */
  lightSize: 0.26,
  minPenumbraTexels: 2.4,
  maxPenumbra: 0.55,
  /** Blocker search radius (world), depth bias (world along the light), the card's own thickness (world). */
  searchRadius: 0.3,
  bias: 0.0045,
  sheetThickness: 0.07,
  /** The shadow camera's depth range (lights.ts). */
  near: 1,
  far: 70,
  /** Blocker search and filter taps. */
  taps: [12, 20] as const,
  /** What light non-paper materials keep in the shadow (paper gets a warm colour instead: paper-material.ts). */
  stockLeak: 0.05,
};

const f = (v: number) => v.toFixed(6);

/** The lit fractions the filter leaves, declared ahead of the lighting by materials that read them. */
export const SHADOW_GLOBALS = /* glsl */ `
#if defined( USE_SHADOWMAP ) && defined( SHADOWMAP_TYPE_BASIC )
#define PAPER_SHADOW_GLOBALS
float gShadowLit = 1.0;
float gShadowLitThin = 1.0;
bool gShadowSet = false;
#endif
`;

const PCSS = /* glsl */ `	#else // SHADOWMAP_TYPE_BASIC: the PCSS (render/shadows.ts)

		// (the paper material declares these earlier, before its lighting reads them: SHADOW_GLOBALS)
		#ifndef PAPER_SHADOW_GLOBALS
		float gShadowLit = 1.0;
		float gShadowLitThin = 1.0;
		bool gShadowSet = false;
		#endif

		float paperIGN( vec2 p ) { return fract( 52.9829189 * fract( dot( p, vec2( 0.06711056, 0.00583715 ) ) ) ); }
		vec2 paperVogel( float i, float n, float phi ) {
			float r = sqrt( ( i + 0.5 ) / n );
			float t = i * 2.399963229728653 + phi;
			return vec2( cos( t ), sin( t ) ) * r;
		}

		// ( lit fraction, lit fraction ignoring blockers within one sheet's thickness )
		vec2 paperPCSS( sampler2D shadowMap, vec2 shadowMapSize, float worldPerUv, float lightSize, vec4 shadowCoord ) {
			vec3 sc = shadowCoord.xyz / shadowCoord.w;
			vec3 dx = dFdx( sc );
			vec3 dy = dFdy( sc );
			if ( sc.x <= 0.0 || sc.x >= 1.0 || sc.y <= 0.0 || sc.y >= 1.0 || sc.z >= 1.0 ) return vec2( 1.0 );
			const float range = ${f(SHADOW.far - SHADOW.near)};
			// receiver-plane depth bias: the depth slope across the receiver, so a tap off the centre compares fairly
			float det = dx.x * dy.y - dx.y * dy.x;
			vec2 grad = vec2( 0.0 );
			if ( abs( det ) > 1e-14 ) grad = vec2( dy.y * dx.z - dx.y * dy.z, dx.x * dy.z - dy.x * dx.z ) / det;
			float slope = length( grad ) * range / worldPerUv;
			// (a near-degenerate pixel blows the gradient up: infinite x 0 would be NaN, and a NaN shadow is a black
			// speck the bokeh spreads into a white disc; such a pixel simply gets no slope bias)
			if ( !( slope < 1e6 ) ) grad = vec2( 0.0 );
			else grad *= min( 1.0, 4.0 / max( slope, 1e-4 ) );
			float bias = ${f(SHADOW.bias)} / range;
			float thick = ${f(SHADOW.sheetThickness)} / range;
			float phi = paperIGN( gl_FragCoord.xy ) * 6.2831853;
			float rs = ${f(SHADOW.searchRadius)} / worldPerUv;
			float sumD = 0.0;
			float nB = 0.0;
			for ( int i = 0; i < ${SHADOW.taps[0]}; i ++ ) {
				vec2 o = paperVogel( float( i ), ${SHADOW.taps[0]}.0, phi ) * rs;
				float d = sc.z + dot( grad, o ) - textureLod( shadowMap, sc.xy + o, 0.0 ).r;
				if ( d > bias ) { sumD += d; nB += 1.0; }
			}
			float penMin = ${f(SHADOW.minPenumbraTexels)} * worldPerUv / shadowMapSize.x;
			if ( nB < 0.5 ) {
				// the sparse search can miss a thin contact sliver: catch it with four tight taps
				float rq = 0.5 * penMin / worldPerUv;
				vec2 l4 = vec2( 0.0 );
				for ( int i = 0; i < 4; i ++ ) {
					vec2 o = paperVogel( float( i ), 4.0, phi + 0.9 ) * rq;
					float d = sc.z + dot( grad, o ) - textureLod( shadowMap, sc.xy + o, 0.0 ).r;
					l4 += vec2( step( d, bias ), step( d, thick ) );
				}
				return l4 * 0.25;
			}
			float pen = clamp( lightSize * sumD / nB * range, penMin, ${f(SHADOW.maxPenumbra)} );
			float rp = 0.5 * pen / worldPerUv;
			vec2 lit = vec2( 0.0 );
			for ( int i = 0; i < ${SHADOW.taps[1]}; i ++ ) {
				vec2 o = paperVogel( float( i ), ${SHADOW.taps[1]}.0, phi + 1.7 ) * rp;
				float d = sc.z + dot( grad, o ) - textureLod( shadowMap, sc.xy + o, 0.0 ).r;
				lit += vec2( step( d, bias ), step( d, thick ) );
			}
			return lit / ${SHADOW.taps[1]}.0;
		}

		float getShadow( sampler2D shadowMap, vec2 shadowMapSize, float shadowIntensity, float shadowBias, float shadowRadius, vec4 shadowCoord ) {
			vec2 lit = paperPCSS( shadowMap, shadowMapSize, shadowRadius, shadowBias, shadowCoord );
			gShadowLit = mix( 1.0, lit.x, shadowIntensity );
			gShadowLitThin = mix( 1.0, lit.y, shadowIntensity );
			gShadowSet = true;
			return mix( ${f(SHADOW.stockLeak)}, 1.0, gShadowLit );
		}
`;

let installed = false;

/** Replaces three's basic shadow filter with the PCSS (once, before any material compiles). */
export function installPaperShadows(): void {
  if (installed) return;
  installed = true;
  const src = THREE.ShaderChunk.shadowmap_pars_fragment;
  const v = src.indexOf('#elif defined( SHADOWMAP_TYPE_VSM )');
  const a = v >= 0 ? src.indexOf('\n\t#else', v) + 1 : -1;
  const b = a > 0 ? src.indexOf('\n\t#endif', a) : -1;
  if (a <= 0 || b < 0) {
    console.warn('shadows: three.js shadow chunk layout changed; keeping the stock filter');
    return;
  }
  THREE.ShaderChunk.shadowmap_pars_fragment = src.slice(0, a) + PCSS + src.slice(b);
}
