const test = require("node:test");
const assert = require("node:assert/strict");

const {
  DEFAULT_SETTINGS,
  findCustomSource,
  isDouyinUrl,
  isLikelyNextControl,
  isLikelyStopControl,
  isSupportedWorkbenchUrl,
  normalizeCustomSource,
  normalizeCustomSources,
  normalizeHttpOrigin,
  normalizeMaxVideos,
  normalizeSettings,
  pickScrollDistance,
  normalizeVideoMode,
} = require("../extension/lib/worklink.js");

test("normalizes settings and clamps video limits", () => {
  assert.deepEqual(normalizeSettings(undefined), DEFAULT_SETTINGS);
  assert.equal(normalizeMaxVideos(-4), 1);
  assert.equal(normalizeMaxVideos(999), 50);
  assert.equal(normalizeMaxVideos(12.6), 13);
  assert.equal(normalizeMaxVideos("not-a-number"), 12);
  assert.equal(normalizeSettings({ autoLink: false }).autoLink, false);
  assert.equal(normalizeSettings({ autoReturn: false }).autoReturn, false);
  assert.equal(normalizeSettings({ desktopLink: true }).desktopLink, true);
  assert.equal(normalizeSettings({ desktopLink: 1 }).desktopLink, false);
  assert.equal(normalizeSettings(undefined).videoMode, "web");
  assert.equal(normalizeSettings({ videoMode: "desktop" }).videoMode, "desktop");
  assert.equal(normalizeSettings({ videoMode: "app" }).videoMode, "web");
  assert.equal(normalizeVideoMode("desktop"), "desktop");
});

test("recognizes only supported workbench and Douyin origins", () => {
  assert.equal(isSupportedWorkbenchUrl("https://chatgpt.com/c/123"), true);
  assert.equal(isSupportedWorkbenchUrl("https://chat.openai.com/"), true);
  assert.equal(isSupportedWorkbenchUrl("https://example.com/"), false);
  assert.equal(isSupportedWorkbenchUrl("http://chatgpt.com/"), false);

  assert.equal(isDouyinUrl("https://www.douyin.com/video/1"), true);
  assert.equal(isDouyinUrl("https://live.douyin.com/123"), true);
  assert.equal(isDouyinUrl("https://douyin.com/"), true);
  assert.equal(isDouyinUrl("https://notdouyin.com/"), false);
});

test("detects ChatGPT stop and Douyin next controls without false positives", () => {
  assert.equal(isLikelyStopControl({ label: "Stop generating" }), true);
  assert.equal(isLikelyStopControl({ label: "停止生成" }), true);
  assert.equal(isLikelyStopControl({ text: "Stop" }), true);
  assert.equal(isLikelyStopControl({ label: "Stop listening" }), false);
  assert.equal(isLikelyStopControl({ label: "Stop" }), true);
  assert.equal(isLikelyStopControl({ label: "提交" }), false);

  assert.equal(isLikelyNextControl("下一条视频"), true);
  assert.equal(isLikelyNextControl("Next video"), true);
  assert.equal(isLikelyNextControl("下一个页面"), false);
});

test("keeps fallback scrolling within one viewport", () => {
  assert.equal(pickScrollDistance(900, 1000), 846);
  assert.equal(pickScrollDistance(200, 1000), 240);
  assert.equal(pickScrollDistance(0, 800), 720);
  assert.ok(pickScrollDistance(1200, 900) <= 855);
});

test("normalizes and matches custom AI sources by origin", () => {
  assert.equal(normalizeHttpOrigin("https://claude.ai/chat/123"), "https://claude.ai");
  assert.equal(normalizeHttpOrigin("claude.ai"), null);
  assert.equal(normalizeHttpOrigin("javascript:alert(1)"), null);

  const source = normalizeCustomSource({
    name: "  Claude  ",
    origin: "https://claude.ai/chat/123",
    selector: "  button[aria-label='Stop response']  ",
  });
  assert.equal(source.name, "Claude");
  assert.equal(source.origin, "https://claude.ai");
  assert.equal(source.selector, "button[aria-label='Stop response']");
  assert.equal(source.enabled, true);

  const sources = normalizeCustomSources([
    source,
    { name: "Duplicate", origin: "https://claude.ai/other" },
    { name: "Gemini", origin: "https://gemini.google.com/app" },
    { name: "Invalid", origin: "file:///tmp/chat.html" },
  ]);
  assert.equal(sources.length, 2);
  assert.equal(findCustomSource("https://claude.ai/new", sources)?.name, "Claude");
  assert.equal(findCustomSource("https://gemini.google.com/", sources)?.name, "Gemini");
  assert.equal(
    findCustomSource("https://claude.ai/", [{ ...source, enabled: false }]),
    null,
  );
});
