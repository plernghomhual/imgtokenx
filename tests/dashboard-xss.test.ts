/**
 * XSS regression tests for dashboard fragments. Every field that originates
 * outside the dashboard's own code — request paths and model ids from proxied
 * traffic, session ids / project paths / previews read from disk — must be
 * HTML-escaped before it lands in fragment markup. A regression here turns a
 * hostile upstream or a crafted JSONL file into script execution in the
 * operator's browser.
 */
import { describe, expect, it } from 'vitest';
import {
  renderRecentFragment,
  renderSessionsFragment,
} from '../src/dashboard/fragments.js';
import type { RecentPayload, SessionsPayload } from '../src/dashboard/types.js';

const PAYLOAD = `<script>alert(1)</script><img src=x onerror=alert(2)>`;

/** The raw payload must never appear; its escaped form must. */
function expectEscaped(html: string): void {
  expect(html).not.toContain('<script>alert(1)</script>');
  expect(html).not.toContain('<img src=x onerror=alert(2)>');
  expect(html).toContain('&lt;script&gt;');
}

describe('dashboard fragment XSS escaping', () => {
  it('escapes hostile request path and model in the recent table', () => {
    const p: RecentPayload = {
      recent: [
        {
          ts: Date.now() / 1000,
          method: 'POST',
          path: `/v1/${PAYLOAD}`,
          model: `claude-${PAYLOAD}`,
          status: 200,
          compressed: true,
        },
      ],
      has_preview: false,
      preview_meta: '',
    };
    expectEscaped(renderRecentFragment(p));
  });

  it('escapes hostile session id, project, and Claude Code fields in the sessions list', () => {
    const p: SessionsPayload = {
      sessions: [
        {
          id: `sess-${PAYLOAD}`,
          project: `proj-${PAYLOAD}`,
          firstSeen: new Date().toISOString(),
          lastSeen: new Date().toISOString(),
          requestCount: 1,
          charsSaved: 0,
          tokensSavedEst: 0,
          cacheReadTokens: 0,
          jsonlBytes: 0,
          sidecarBytes: 0,
          claudeCode: {
            sessionId: `cc-${PAYLOAD}`,
            projectPath: `/tmp/${PAYLOAD}`,
            firstUserPreview: `preview ${PAYLOAD}`,
          },
        },
      ],
      count: 1,
    };
    expectEscaped(renderSessionsFragment(p));
  });

  it('escapes attribute-context injection (quote breakout) in sessions titles', () => {
    const p: SessionsPayload = {
      sessions: [
        {
          id: 'sess-1',
          project: `x" onmouseover="alert(3)`,
          firstSeen: new Date().toISOString(),
          lastSeen: new Date().toISOString(),
          requestCount: 1,
          charsSaved: 0,
          tokensSavedEst: 0,
          cacheReadTokens: 0,
          jsonlBytes: 0,
          sidecarBytes: 0,
          claudeCode: null,
        },
      ],
      count: 1,
    };
    const html = renderSessionsFragment(p);
    // The raw double-quote must be entity-escaped everywhere the value is
    // interpolated into an attribute, so breakout is impossible.
    expect(html).not.toContain('" onmouseover="alert(3)');
    expect(html).toContain('&quot;');
  });
});
