/**
 * Helpers for panels that float over the page — a dropdown list, a card's action menu.
 *
 * They are positioned `fixed` so no scrolling or clipping ancestor can cut them off, but
 * "fixed" is only relative to the viewport while nothing above them establishes its own
 * containing block. A transform does exactly that, and the settings drawer slides in on one,
 * so viewport coordinates used inside it land the panel somewhere off the screen.
 */

/** Properties that make an ancestor the containing block for its fixed descendants. */
function establishesContainingBlock(style: CSSStyleDeclaration): boolean {
  return style.transform !== 'none'
    || style.perspective !== 'none'
    || style.filter !== 'none'
    || /transform|perspective|filter/.test(style.willChange || '')
    || /paint|layout|strict|content/.test(style.contain || '');
}

/**
 * The point a fixed child of `element` measures from.
 *
 * Returns the viewport origin (0, 0) in the ordinary case, or the top-left of the nearest
 * ancestor that a fixed descendant is positioned against.
 */
export function fixedOrigin(element: HTMLElement | null | undefined): { x: number; y: number } {
  let node = element?.parentElement ?? null;
  while (node && node !== document.documentElement) {
    if (establishesContainingBlock(getComputedStyle(node))) {
      const rect = node.getBoundingClientRect();
      return { x: rect.left, y: rect.top };
    }
    node = node.parentElement;
  }
  return { x: 0, y: 0 };
}
