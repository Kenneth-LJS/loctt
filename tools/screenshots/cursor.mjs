// A simulated cursor for recorded GIFs.
//
// Playwright can't move the real OS pointer into a video, so we inject a
// fake cursor element and animate it to each target with an easing tween,
// then perform the real Playwright action underneath. The result reads as
// "the pointer flies to the control and clicks it".

/** Inject the fake cursor once per page. */
export async function installCursor(page) {
  await page.addStyleTag({
    content: `
      #__demo_cursor {
        position: fixed; top: 0; left: 0; z-index: 2147483647;
        width: 22px; height: 22px; margin: -2px 0 0 -2px;
        pointer-events: none; transition: transform 40ms linear;
        will-change: transform;
      }
      #__demo_cursor.click { animation: __demo_click 300ms ease; }
      @keyframes __demo_click { 0%{transform:scale(1)} 40%{transform:scale(.8)} 100%{transform:scale(1)} }
    `,
  });
  await page.evaluate(() => {
    if (document.getElementById("__demo_cursor")) return;
    const c = document.createElement("div");
    c.id = "__demo_cursor";
    // A crisp arrow pointer as inline SVG.
    c.innerHTML =
      '<svg viewBox="0 0 24 24" width="22" height="22" xmlns="http://www.w3.org/2000/svg">' +
      '<path d="M5 3l14 8-6 1.5L10 20 5 3z" fill="#111" stroke="#fff" stroke-width="1.5" stroke-linejoin="round"/>' +
      "</svg>";
    document.body.appendChild(c);
    window.__demoCursorAt = (x, y) => {
      c.style.transform = `translate(${x}px, ${y}px)`;
    };
    window.__demoCursorClick = () => {
      c.classList.remove("click");
      void c.offsetWidth;
      c.classList.add("click");
    };
  });
  cursorPos.set(page, { x: 40, y: 40 });
  await page.evaluate(([x, y]) => window.__demoCursorAt(x, y), [40, 40]);
}

const cursorPos = new WeakMap();
const easeInOut = (t) => (t < 0.5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2);

/** Glide the fake cursor from its current spot to (x, y). */
async function glideTo(page, x, y, steps = 24) {
  const from = cursorPos.get(page) ?? { x: 40, y: 40 };
  for (let i = 1; i <= steps; i++) {
    const t = easeInOut(i / steps);
    const cx = from.x + (x - from.x) * t;
    const cy = from.y + (y - from.y) * t;
    await page.evaluate(([px, py]) => window.__demoCursorAt(px, py), [cx, cy]);
    await page.waitForTimeout(16);
  }
  cursorPos.set(page, { x, y });
}

/** Move the simulated cursor to an element's center. */
export async function moveTo(page, selector) {
  const box = await page.locator(selector).first().boundingBox();
  if (!box) throw new Error(`moveTo: no box for ${selector}`);
  await glideTo(page, box.x + box.width / 2, box.y + box.height / 2);
}

/** Move to an element, play the click pulse, then really click it. */
export async function click(page, selector) {
  await moveTo(page, selector);
  await page.evaluate(() => window.__demoCursorClick());
  await page.waitForTimeout(120);
  await page.locator(selector).first().click();
  await page.waitForTimeout(300);
}
