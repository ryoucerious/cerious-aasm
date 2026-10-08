// Secondary text was hard to read in the dark theme: the dimmest shade measured 2.1:1 on a card.
describe('Theme text contrast', () => {
  /** Every shade used for secondary text, as a colour on its own. */
  const SECONDARY = ['--text-secondary', '--text-secondary-1', '--text-secondary-2', '--text-secondary-3', '--text-secondary-4', '--text-secondary-5', '--text-muted'];
  /** WCAG AA for normal-size text. */
  const AA = 4.5;

  const read = (name: string) => getComputedStyle(document.documentElement).getPropertyValue(name).trim();

  function luminance(hex: string): number {
    const [r, g, b] = [1, 3, 5].map(at => parseInt(hex.slice(at, at + 2), 16) / 255)
      .map(channel => channel <= 0.03928 ? channel / 12.92 : Math.pow((channel + 0.055) / 1.055, 2.4));
    return 0.2126 * r + 0.7152 * g + 0.0722 * b;
  }

  function ratio(foreground: string, background: string): number {
    const [light, dark] = [luminance(foreground), luminance(background)].sort((a, b) => b - a);
    return (light + 0.05) / (dark + 0.05);
  }

  /** A computed rgb()/rgba() colour as #rrggbb, or null when it is not fully opaque. */
  function opaque(color: string): string | null {
    const parts = color.match(/[\d.]+/g)?.map(Number) || [];
    if (parts.length < 3 || (parts.length > 3 && parts[3] < 1)) return null;
    return '#' + parts.slice(0, 3).map(part => Math.round(part).toString(16).padStart(2, '0')).join('');
  }

  afterEach(() => document.documentElement.removeAttribute('data-theme'));

  // On a server card the badge sits on the map artwork, which is always dark; transparent, its
  // light-theme brown all but vanished there.
  for (const theme of ['dark', 'light']) {
    it(`gives the Unreachable badge on a card its own background, readable in the ${theme} theme`, () => {
      document.documentElement.setAttribute('data-theme', theme);
      const badge = document.createElement('span');
      badge.className = 'status-badge card-status status-unreachable';
      badge.textContent = 'Unreachable';
      document.body.appendChild(badge);

      try {
        const style = getComputedStyle(badge);
        const background = opaque(style.backgroundColor);
        expect(background).withContext('an opaque background').not.toBeNull();
        expect(ratio(opaque(style.color)!, background || '#000000')).toBeGreaterThanOrEqual(AA);
      } finally {
        badge.remove();
      }
    });
  }

  for (const theme of ['dark', 'light']) {
    it(`keeps every secondary text colour readable on a card in the ${theme} theme`, () => {
      document.documentElement.setAttribute('data-theme', theme);
      const card = read('--surface-raised');

      const low = SECONDARY
        .map(name => ({ name, ratio: +ratio(read(name), card).toFixed(2) }))
        .filter(shade => shade.ratio < AA);

      expect(low).toEqual([]);
    });
  }
});
