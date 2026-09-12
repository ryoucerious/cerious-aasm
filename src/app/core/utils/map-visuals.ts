/**
 * Per-map presentation for server cards and headers.
 *
 * Known maps get artwork from `src/assets/background` (each map names its file below) drawn
 * over a signature gradient in the spirit of the biome. The gradient is always part of the
 * background, so a map without an image file still looks deliberate rather than broken.
 * Unknown or custom maps fall back to a neutral gradient keyed off the name so two custom maps
 * still look distinct. Every colour here is decorative artwork, not UI chrome, so it
 * intentionally stays the same in both themes.
 */

export interface MapVisual {
  /** Human name, e.g. "Scorched Earth". */
  label: string;
  /** CSS gradient for the hero area. */
  background: string;
  /** Path to the map's artwork, or null for maps with no bundled image. */
  image: string | null;
  /** `background-image` value: the artwork (when there is one) layered over the gradient. */
  layered: string;
  /** A single accent colour drawn from the gradient, for sparklines and meters. */
  accent: string;
}

interface MapStyle {
  label: string;
  colors: [string, string, string];
  /** File name inside MAP_ART_DIR; omitted for maps that ship no artwork. */
  file?: string;
}

export const MAP_ART_DIR = 'assets/background';

const KNOWN_MAPS: Record<string, MapStyle> = {
  TheIsland_WP:     { label: 'The Island',       colors: ['#1d4e89', '#2a9d8f', '#8ab17d'], file: 'the-island.png' },
  ScorchedEarth_WP: { label: 'Scorched Earth',   colors: ['#7f2f0a', '#c9772b', '#f2c078'], file: 'scorched_earth.png' },
  TheCenter_WP:     { label: 'The Center',       colors: ['#0b3954', '#087e8b', '#bfd7ea'], file: 'the-center.png' },
  Aberration_WP:    { label: 'Aberration',       colors: ['#2b1b4d', '#1b8a7a', '#8be0c2'], file: 'aberration.png' },
  Extinction_WP:    { label: 'Extinction',       colors: ['#3a3f52', '#6c5b7b', '#c06c84'], file: 'extinction.png' },
  Ragnarok_WP:      { label: 'Ragnarok',         colors: ['#3a0f0f', '#b02f1c', '#f39c12'], file: 'ragnarok.png' },
  Valguero_WP:      { label: 'Valguero',         colors: ['#1c3d2b', '#3f7d4e', '#a7c957'], file: 'valguero.png' },
  Genesis_WP:       { label: 'Genesis: Part 1',  colors: ['#0f2e5a', '#1f6fb2', '#7dd3fc'], file: 'genesis.png' },
  LostColony_WP:    { label: 'Lost Colony',      colors: ['#14213d', '#5f4b8b', '#e0aaff'], file: 'lost-colony.png' },
  Astraeos_WP:      { label: 'Astraeos',         colors: ['#0d2b45', '#2e6f95', '#f4d35e'], file: 'astraeos.png' },
  LostIsland_WP:    { label: 'Lost Island',      colors: ['#1b3a2f', '#2f855a', '#c2e59c'] },
  Fjordur_WP:       { label: 'Fjordur',          colors: ['#1e2a4a', '#4a6fa5', '#dbe9f6'] },
  CrystalIsles_WP:  { label: 'Crystal Isles',    colors: ['#3b1f5e', '#8e44ad', '#f5b7ff'] }
};

const FALLBACK_PALETTES: [string, string, string][] = [
  ['#1f2937', '#374151', '#9ca3af'],
  ['#1e3a5f', '#2b5d8f', '#9fc5e8'],
  ['#3b2a1e', '#7a5230', '#d9b99b'],
  ['#1f3b2e', '#2f6b4f', '#a8d5ba'],
  ['#3a1f3f', '#6a3d7a', '#d3a4e0']
];

export function mapDisplayName(mapName: string | null | undefined): string {
  if (!mapName) return 'Unknown map';
  const known = KNOWN_MAPS[mapName];
  if (known) return known.label;
  return mapName.replace(/_WP$/, '').replace(/([a-z])([A-Z])/g, '$1 $2');
}

/** Artwork path for a map that ships an image; null for the rest (including custom maps). */
export function mapImagePath(mapName: string | null | undefined): string | null {
  const file = mapName ? KNOWN_MAPS[mapName]?.file : undefined;
  return file ? `${MAP_ART_DIR}/${file}` : null;
}

export function getMapVisual(mapName: string | null | undefined): MapVisual {
  const known = mapName ? KNOWN_MAPS[mapName] : undefined;
  const colors = known ? known.colors : FALLBACK_PALETTES[hashString(mapName || '') % FALLBACK_PALETTES.length];
  const [deep, mid, light] = colors;
  const background = `linear-gradient(135deg, ${deep} 0%, ${mid} 55%, ${light} 100%)`;
  const image = mapImagePath(mapName);
  return {
    label: mapDisplayName(mapName),
    background,
    image,
    // Multiple backgrounds paint top to bottom, so a missing image file simply reveals the gradient.
    layered: image ? `url("${image}"), ${background}` : background,
    accent: mid
  };
}

function hashString(value: string): number {
  let hash = 0;
  for (let i = 0; i < value.length; i++) {
    hash = (hash * 31 + value.charCodeAt(i)) >>> 0;
  }
  return hash;
}
