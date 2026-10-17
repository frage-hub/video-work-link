import { chromium } from "playwright";

const browser = await chromium.connectOverCDP("http://127.0.0.1:9229");
try {
  const contexts = browser.contexts();
  const pages = contexts.flatMap((context) => context.pages());
  const page = pages.find((candidate) => candidate.url().startsWith("app://-/"));
  if (!page) {
    console.log(JSON.stringify({ ok: false, reason: "no-codex-page" }, null, 2));
    process.exitCode = 1;
  } else {
    const snapshot = await page.evaluate(() => {
      const visible = (element) => {
        const rect = element.getBoundingClientRect();
        const style = getComputedStyle(element);
        return (
          rect.width > 3 &&
          rect.height > 3 &&
          style.display !== "none" &&
          style.visibility !== "hidden"
        );
      };
      const describe = (element) => ({
        tag: element.tagName.toLowerCase(),
        text: (element.textContent || "").trim().replace(/\s+/g, " ").slice(0, 120),
        ariaLabel: element.getAttribute("aria-label") || "",
        title: element.getAttribute("title") || "",
        testId: element.getAttribute("data-testid") || "",
        role: element.getAttribute("role") || "",
        className:
          typeof element.className === "string"
            ? element.className.slice(0, 160)
            : "",
        disabled: Boolean(element.disabled),
      });
      const controls = [
        ...document.querySelectorAll(
          'button, [role="button"], [aria-label], [data-testid], [aria-busy="true"]',
        ),
      ]
        .filter(visible)
        .map(describe)
        .filter((item) =>
          /stop|停止|send|发送|thinking|working|生成|busy|composer|prompt/i.test(
            `${item.text} ${item.ariaLabel} ${item.title} ${item.testId} ${item.role} ${item.className}`,
          ),
        )
        .slice(0, 80);
      const buttons = [...document.querySelectorAll("button")]
        .filter(visible)
        .map(describe)
        .slice(0, 80);
      return {
        title: document.title,
        url: location.href,
        buttonCount: buttons.length,
        buttons,
        matchingControls: controls,
        busyElements: [...document.querySelectorAll('[aria-busy="true"]')]
          .filter(visible)
          .map(describe)
          .slice(0, 20),
        editableElements: [...document.querySelectorAll('textarea, [contenteditable="true"], input')]
          .filter(visible)
          .map(describe)
          .slice(0, 20),
      };
    });
    console.log(JSON.stringify({ ok: true, snapshot }, null, 2));
  }
} finally {
  await browser.close();
}
