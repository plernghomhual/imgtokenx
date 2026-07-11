/**
 * Regression tests for D22 (keyboard-accessible image thumbnails) and D23
 * (dashboard live/loading/error a11y semantics — <main>, heading, live
 * region, error toasts). Render-time assertions on the dashboard HTML so a
 * future refactor can't quietly remove accessibility structure.
 */

import { describe, it, expect } from 'vitest';
import {
  renderContextMapFragment,
  renderPage,
  type ContextMapData,
} from '../src/dashboard/fragments.js';

function ctxWithImages(ids: number[]): ContextMapData {
  return {
    id: ids[0] ?? 1,
    baselineTokens: 1000,
    realInput: 400,
    baselineInputEff: 1000,
    actualInputEff: 400,
    haveBaseline: true,
    cacheRead: 0,
    warm: false,
    output: 80,
    imageCount: ids.length,
    buckets: {},
    imageIds: ids,
    compressed: true,
  };
}

describe('dashboard a11y (D22 + D23)', () => {
  describe('D22 — keyboard-accessible image thumbnails', () => {
    it('wraps every thumbnail in a <button class="page-btn"> with an aria-label', () => {
      const html = renderContextMapFragment(ctxWithImages([7, 8, 9]));
      expect(html).not.toMatch(/<img[^>]*\bonclick=/);
      const buttons = html.match(/<button class="page-btn"[^>]*aria-label="[^"]*"/g) ?? [];
      expect(buttons).toHaveLength(3);
      expect(buttons[0]).toContain('Read the source text behind image page 7');
      expect(buttons[1]).toContain('Read the source text behind image page 8');
      expect(buttons[2]).toContain('Read the source text behind image page 9');
    });

    it('inner img carries alt="" (button aria-label is the only accessible name — prevents double announcement)', () => {
      // NVDA+Firefox will announce BOTH a button's aria-label and a meaningful
      // img.alt under it. The fix is alt="" on the decorative child.
      const html = renderContextMapFragment(ctxWithImages([42]));
      expect(html).toMatch(/<button class="page-btn"[^>]*aria-label="Read the source text behind image page 42"[\s\S]*?<img class="page"[^>]*alt=""/);
      expect(html).not.toMatch(/<img class="page"[^>]*alt="[^"]"/);
    });
  });

  describe('D23 — dashboard live/loading/error a11y semantics', () => {
    const page = renderPage(47821);

    it('page has a skip-to-main link and a <main id="main-content"> landmark', () => {
      expect(page).toMatch(/<a href="#main-content" class="sr-only">[^<]*<\/a>/);
      expect(page).toMatch(/<main\s+id="main-content"/);
    });

    it('top of the page is a real <h1> (D23 — not an ARIA-only role="heading" dance)', () => {
      // Real semantic <h1>; .wordmark already sets margin:0 so visuals are
      // unchanged. Screen readers announce "imgtokenx, heading level 1" once.
      expect(page).toMatch(/<h1 class="wordmark">\s*imgtokenx\s*<\/h1>/);
      expect(page).not.toMatch(/role="heading"\s+aria-level="1"/);
    });

    it('toast tray is a polite live region (error/refresh announcements for AT users)', () => {
      expect(page).toMatch(/<div class="tray"[^>]*role="status"/);
      expect(page).toMatch(/<div class="tray"[^>]*aria-live="polite"/);
      // aria-atomic=false so each new toast is announced separately.
      expect(page).toMatch(/<div class="tray"[^>]*aria-atomic="false"/);
    });

    it('<main> encloses every dashboard section (not the <header> or the toast tray)', () => {
      const mainOpenIdx = page.search(/<main\s+id="main-content"/);
      const mainCloseIdx = page.search(/<\/main>/);
      const headerIdx = page.indexOf('<header class="topbar"');
      const trayIdx = page.indexOf('<div class="tray"');
      const firstSectionIdx = page.indexOf('<section class="section">');
      const lastSectionIdx = page.lastIndexOf('</section>');
      expect(mainOpenIdx).toBeGreaterThan(-1);
      expect(mainCloseIdx).toBeGreaterThan(mainOpenIdx);
      // header (banner) precedes <main>; tray (notifications) follows </main>.
      expect(headerIdx).toBeLessThan(mainOpenIdx);
      expect(trayIdx).toBeGreaterThan(mainCloseIdx);
      // All sections sit inside <main>.
      expect(firstSectionIdx).toBeGreaterThan(mainOpenIdx);
      expect(firstSectionIdx).toBeLessThan(mainCloseIdx);
      expect(lastSectionIdx).toBeGreaterThan(mainOpenIdx);
      expect(lastSectionIdx).toBeLessThan(mainCloseIdx);
    });
  });
});
