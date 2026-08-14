import { expect, it } from "vitest";
import {
  actionOpacity,
  captureUiProof,
  createSessionManagementE2eSuite,
  installMockGateway,
  sessionRow,
  sessionsListResponse,
} from "./session-management.test-support.ts";

const suite = createSessionManagementE2eSuite();

/** A pinned row plus enough listed rows for a collapsed count to mean something. */
function matrixFixture() {
  return sessionsListResponse([
    sessionRow("agent:main:pinned", "Pinned thread", Date.parse("2026-07-01T16:00:00.000Z"), {
      pinned: true,
    }),
    sessionRow("agent:main:listed", "Listed thread", Date.parse("2026-07-01T15:59:00.000Z")),
    sessionRow("agent:main:second", "Release notes", Date.parse("2026-07-01T15:58:00.000Z")),
    sessionRow("agent:main:third", "Nightly export", Date.parse("2026-07-01T15:57:00.000Z")),
    sessionRow("agent:main:open", "Open thread", Date.parse("2026-07-01T15:56:00.000Z")),
  ]);
}

suite.define(() => {
  it("renders a pinned session with the same typography and density as a listed one", async () => {
    const context = await suite.browser.newContext({
      colorScheme: "dark",
      locale: "en-US",
      serviceWorkers: "block",
      viewport: { height: 900, width: 1280 },
    });
    const page = await context.newPage();
    await installMockGateway(page, {
      methodResponses: {
        "sessions.list": sessionsListResponse([
          sessionRow("agent:main:pinned", "Pinned thread", Date.parse("2026-07-01T16:00:00.000Z"), {
            pinned: true,
          }),
          sessionRow("agent:main:listed", "Listed thread", Date.parse("2026-07-01T15:59:00.000Z")),
          sessionRow("agent:main:open", "Open thread", Date.parse("2026-07-01T15:58:00.000Z")),
        ]),
      },
      featureMethods: ["chat.metadata", "chat.startup"],
      // A third session holds the route: the open row is drawn as the active
      // one, so comparing it against a pinned row would measure activity
      // instead of the placement this case exists to hold still.
      sessionKey: "agent:main:open",
    });

    try {
      await page.goto(`${suite.server.baseUrl}chat`);

      const readRow = (key: string) =>
        page.locator(`.sidebar-recent-session[data-session-key="${key}"]`).evaluate((row) => {
          const name = row.querySelector(".sidebar-recent-session__name");
          if (!name) {
            throw new Error("expected a session title");
          }
          const rowStyle = getComputedStyle(row);
          const nameStyle = getComputedStyle(name);
          return {
            color: nameStyle.color,
            fontSize: nameStyle.fontSize,
            fontWeight: nameStyle.fontWeight,
            height: Math.round(row.getBoundingClientRect().height),
            lineHeight: nameStyle.lineHeight,
            minHeight: rowStyle.minHeight,
            rowColor: rowStyle.color,
          };
        });

      const pinned = await readRow("agent:main:pinned");
      const listed = await readRow("agent:main:listed");
      // Placement and pin state are the only permitted differences: a pinned
      // row that borrows page-navigation type or density stops reading as a
      // session and the two lists visibly drift apart.
      expect(pinned).toEqual(listed);
    } finally {
      await context.close();
    }
  });

  it("captures pinned and listed sections in both themes", async () => {
    for (const colorScheme of ["light", "dark"] as const) {
      const context = await suite.browser.newContext({
        colorScheme,
        locale: "en-US",
        serviceWorkers: "block",
        viewport: { height: 900, width: 1280 },
      });
      const page = await context.newPage();
      await installMockGateway(page, {
        methodResponses: { "sessions.list": matrixFixture() },
        featureMethods: ["chat.metadata", "chat.startup"],
        // The open session is neither of the two rows being compared, so the
        // frame shows placement as the only difference between them.
        sessionKey: "agent:main:open",
      });

      try {
        await page.goto(`${suite.server.baseUrl}chat`);
        const sidebar = page.locator("openclaw-app-sidebar aside.sidebar");
        const pinned = page.locator('[data-sidebar-entry="session:agent:main:pinned"]');
        const sessions = page.locator('[data-session-section="ungrouped"]');
        const head = sessions.locator(".sidebar-recent-sessions__head");
        const toggle = head.locator(".sidebar-session-group-toggle");
        await pinned.waitFor({ state: "visible" });

        await captureUiProof(page, `pinned-parity-sidebar-${colorScheme}.png`, { clip: [sidebar] });
        // The claim of this layer, in one frame: a pinned row and a listed row
        // with nothing but placement between them.
        await captureUiProof(page, `pinned-parity-rows-${colorScheme}.png`, {
          clip: [pinned, sessions.locator(".sidebar-recent-session").first()],
        });
        await captureUiProof(page, `pinned-parity-head-rest-${colorScheme}.png`, { clip: [head] });

        await head.hover();
        await expect
          .poll(() => actionOpacity(head.locator(".sidebar-session-group-actions").first()))
          .toBe("1");
        await captureUiProof(page, `pinned-parity-head-hover-${colorScheme}.png`, { clip: [head] });

        await toggle.click();
        await expect.poll(() => toggle.getAttribute("aria-expanded")).toBe("false");
        await captureUiProof(page, `pinned-parity-head-collapsed-${colorScheme}.png`, {
          clip: [head],
        });
      } finally {
        await context.close();
      }
    }
  });
});
