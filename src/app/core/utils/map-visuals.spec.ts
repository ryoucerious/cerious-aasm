import { getMapVisual, mapDisplayName, mapImagePath } from './map-visuals';

describe('map-visuals', () => {
  it('names known maps', () => {
    expect(mapDisplayName('TheIsland_WP')).toBe('The Island');
    expect(mapDisplayName('ScorchedEarth_WP')).toBe('Scorched Earth');
    expect(mapDisplayName('Genesis_WP')).toBe('Genesis: Part 1');
  });

  it('derives a readable name for custom maps', () => {
    expect(mapDisplayName('MyCustomMap_WP')).toBe('My Custom Map');
    expect(mapDisplayName('')).toBe('Unknown map');
    expect(mapDisplayName(undefined)).toBe('Unknown map');
  });

  it('gives known maps their own gradient', () => {
    const ragnarok = getMapVisual('Ragnarok_WP');
    const aberration = getMapVisual('Aberration_WP');
    expect(ragnarok.background).toContain('linear-gradient');
    expect(ragnarok.background).not.toBe(aberration.background);
    expect(ragnarok.label).toBe('Ragnarok');
    expect(ragnarok.accent).toMatch(/^#/);
  });

  it('layers bundled artwork over the gradient for known maps only', () => {
    expect(mapImagePath('TheIsland_WP')).toBe('assets/background/the-island.png');
    expect(mapImagePath('Ragnarok_WP')).toBe('assets/background/ragnarok.png');
    expect(mapImagePath('Fjordur_WP')).toBeNull();
    expect(mapImagePath('Custom_WP')).toBeNull();
    const island = getMapVisual('TheIsland_WP');
    expect(island.image).toBe('assets/background/the-island.png');
    expect(island.layered).toBe(`url("assets/background/the-island.png"), ${island.background}`);
    const custom = getMapVisual('Custom_WP');
    expect(custom.image).toBeNull();
    expect(custom.layered).toBe(custom.background);
  });

  it('is deterministic for unknown maps', () => {
    const a = getMapVisual('Custom_A');
    const b = getMapVisual('Custom_A');
    expect(a).toEqual(b);
    expect(getMapVisual(null).label).toBe('Unknown map');
  });
});
