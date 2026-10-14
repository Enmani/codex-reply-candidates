import test from "node:test";
import assert from "node:assert/strict";
import { readBundledText } from "../src/client-package.mjs";
import { transformRenderer } from "../src/renderer-patch.mjs";

const fixture = readBundledText(/^webview\/assets\/app-primary-[\w-]+\.js$/).text;

test("patches the identified renderer once and keeps the original prediction path", () => {
  const patched = transformRenderer(fixture);

  assert.notEqual(patched, fixture);
  assert.match(patched, /function CodexMultiPredictionPanel\(e\)/);
  assert.match(patched, /suggestions/);
  assert.match(patched, /forceRefresh:!0/);
  assert.match(patched, /generationTrigger:`catch_up`/);
  assert.match(patched, /Woe\(l\.requestUserMessagePrediction\(e,new lr\(t=>\{Vi\(\{scope:s,target:e,ineligibility:t\}\)\}\)\)\)/);
  assert.doesNotMatch(patched, /requestUserMessagePrediction\(e,t=>Promise\.resolve\(Vi\(/);
  assert.match(patched, /submitText:submitText/);
  assert.match(patched, /submitText:async e=>\{let t=!1,n=\(\)=>\{t=!0\};try\{await Mc\(\{promptRawOverride:e,persistedPromptRawOverride:e/);
  assert.match(patched, /onDeferred:n,onSubmitted:n\}\)\}catch\(e\)\{return!1\}return t/);
  assert.match(patched, /intl:Ln/);
  assert.match(patched, /intl:predictionIntl/);
  assert.match(patched, /key:c==null\?null:\[c\.hostId,c\.threadId,c\.latestTurnId\]\.join/);
  assert.match(patched, /setQueryData\(\[`cumberbatch`,c\],t\)/);
  assert.match(patched, /Ck as kt/);
  assert.match(patched, /children: copy\.fill/);
  assert.match(patched, /children: copy\.send/);
  assert.match(patched, /children: copy\.refresh/);
  assert.match(patched, /loading: isRefreshing/);
  assert.match(patched, /\(error \|\| refreshFailed\)/);
  assert.match(patched, /role:["`]alert["`]/);
  assert.match(patched, /role:["`]status["`]/);
  assert.doesNotMatch(patched, /shadow-xs|bg-surface-primary\/80|bg-surface-secondary\/60/);
  assert.equal(transformRenderer(patched), patched);
});

test("fails closed when the renderer shape is not the inspected client", () => {
  assert.throws(() => transformRenderer("function ZXe(e){}"), /unsupported Codex renderer/);
  assert.throws(() => transformRenderer(fixture.replace("function QXe(e)", "function QXeChanged(e)")), /unsupported Codex renderer/);
});

test("does not use DOM text matching for sending", () => {
  const patched = transformRenderer(fixture);

  assert.doesNotMatch(patched, /querySelector\([^)]*发送/);
  assert.doesNotMatch(patched, /innerText[^;]*发送/);
  assert.match(patched, /submitText:submitText/);
  assert.match(patched, /await submitText\(text\)/);
  assert.match(patched, /promptRawOverride:e,persistedPromptRawOverride:e/);
});

// This invokes the injected component with a lightweight React/JSX hook harness.
// It exercises the component's event/state contract; it is not a real Codex app.
function makePanelHarness(patched) {
  const start = patched.indexOf("function CodexMultiPredictionPanel(e)");
  const end = patched.indexOf("function QXe(e)", start);
  assert.ok(start >= 0 && end > start, "panel function should be extractable from the patched renderer");
  const panelSource = patched.slice(start, end);
  const hookValues = [];
  let hookIndex = 0;
  const effectCleanups = [];
  const RL = {
    useState(initial) {
      const index = hookIndex++;
      if (!(index in hookValues)) hookValues[index] = initial;
      return [hookValues[index], (value) => {
        hookValues[index] = typeof value === "function" ? value(hookValues[index]) : value;
      }];
    },
    useRef(initial) {
      const index = hookIndex++;
      if (!(index in hookValues)) hookValues[index] = { current: initial };
      return hookValues[index];
    },
    useEffect(effect) {
      const cleanup = effect();
      if (typeof cleanup === "function") effectCleanups.push(cleanup);
    },
  };
  const Fragment = Symbol("Fragment");
  const zL = {
    Fragment,
    jsx(type, props, key) { return { type, props: { ...props, key } }; },
    jsxs(type, props, key) { return { type, props: { ...props, key } }; },
  };
  const Button = Symbol("Button");
  const Panel = new Function("RL", "zL", "kt", `${panelSource};return CodexMultiPredictionPanel;`)(RL, zL, Button);
  const render = (props) => {
    hookIndex = 0;
    return Panel(props);
  };
  const walk = (node, found = []) => {
    if (node == null || typeof node !== "object") return found;
    if (node.type === Button) found.push(node);
    const children = node.props?.children;
    if (Array.isArray(children)) children.forEach((child) => walk(child, found));
    else walk(children, found);
    return found;
  };
  const text = (node, values = []) => {
    if (node == null) return values;
    if (typeof node === "string") { values.push(node); return values; }
    const children = node.props?.children;
    if (Array.isArray(children)) children.forEach((child) => text(child, values));
    else text(children, values);
    return values;
  };
  return { render, buttons: (tree) => walk(tree), text: (tree) => text(tree), cleanups: effectCleanups };
}

test("component behavior sends the candidate text directly and preserves a draft", async () => {
  const patched = transformRenderer(fixture);
  const candidates = { suggestions: ["第一条", "第二条", "第三条"] };

  let draft = "";
  const setTextCalls = [];
  const fillController = {
    getText: () => draft,
    setText: (value) => { draft = value; setTextCalls.push(value); },
    focus: () => {},
    view: { isDestroyed: false },
  };
  const fillHarness = makePanelHarness(patched);
  const fillTree = fillHarness.render({
    controller: fillController,
    enabled: true,
    intl: { locale: "zh-CN" },
    prediction: candidates,
    loading: false,
    error: false,
    submitText: async () => { throw new Error("sending is not part of fill"); },
  });
  const fill = fillHarness.buttons(fillTree).find((button) => button.props.children === "填入");
  assert.ok(fill);
  await fill.props.onClick();
  assert.deepEqual(setTextCalls, ["第一条"]);
  assert.equal(draft, "第一条");

  let failedText = null;
  let failedCalls = 0;
  const failedController = { getText: () => "", setText: () => {}, focus: () => {}, view: { isDestroyed: false } };
  const failedHarness = makePanelHarness(patched);
  const failedProps = {
    controller: failedController,
    enabled: true,
    intl: { locale: "zh-CN" },
    prediction: candidates,
    loading: false,
    error: false,
    submitText: async (text) => { failedCalls += 1; failedText = text; return false; },
  };
  const failedTree = failedHarness.render(failedProps);
  const failedSend = failedHarness.buttons(failedTree).find((button) => button.props.children === "发送");
  assert.ok(failedSend);
  await failedSend.props.onClick();
  const failedAfter = failedHarness.render(failedProps);
  assert.equal(failedCalls, 1);
  assert.equal(failedText, "第一条");
  assert.ok(failedHarness.text(failedAfter).includes("第一条"));
  assert.ok(failedHarness.text(failedAfter).includes("发送失败，请重试"));

  let succeededText = null;
  const successController = { getText: () => "", setText: () => {}, focus: () => {}, view: { isDestroyed: false } };
  const successHarness = makePanelHarness(patched);
  const successProps = {
    controller: successController,
    enabled: true,
    intl: { locale: "en-US" },
    prediction: candidates,
    loading: false,
    error: false,
    submitText: async (text) => { succeededText = text; return true; },
  };
  const successTree = successHarness.render(successProps);
  const successSend = successHarness.buttons(successTree).find((button) => button.props.children === "Send");
  await successSend.props.onClick();
  assert.equal(succeededText, "第一条");
  assert.doesNotMatch(successHarness.text(successHarness.render(successProps)).join(" "), /Couldn.t send/);

  let existingDraft = "已有草稿";
  let existingCalls = 0;
  const existingController = { getText: () => existingDraft, setText: (value) => { existingDraft = value; }, focus: () => {}, view: { isDestroyed: false } };
  const existingHarness = makePanelHarness(patched);
  const existingProps = {
    controller: existingController,
    enabled: true,
    intl: { locale: "zh-CN" },
    prediction: candidates,
    loading: false,
    error: false,
    submitText: async () => { existingCalls += 1; return true; },
  };
  const existingTree = existingHarness.render(existingProps);
  const existingSend = existingHarness.buttons(existingTree).find((button) => button.props.children === "发送");
  assert.equal(existingSend.props.disabled, true);
  await existingSend.props.onClick();
  assert.equal(existingCalls, 0);
  assert.equal(existingDraft, "已有草稿");

  existingDraft = "";
  const renderedBeforeTyping = existingHarness.render(existingProps);
  const staleSend = existingHarness.buttons(renderedBeforeTyping).find((button) => button.props.children === "发送");
  existingDraft = "刚输入的草稿";
  await staleSend.props.onClick();
  assert.equal(existingCalls, 0);
  assert.equal(existingDraft, "刚输入的草稿");
});

test("component behavior leaves retry enabled after a prediction error", async () => {
  const patched = transformRenderer(fixture);
  const harness = makePanelHarness(patched);
  let requests = 0;
  const controller = { getText: () => "", setText: () => {}, focus: () => {}, view: { isDestroyed: false } };
  const props = {
    controller,
    enabled: true,
    intl: { locale: "en-US" },
    prediction: null,
    loading: false,
    error: true,
    submitText: () => {},
    requestPrediction: async () => { requests += 1; throw new Error("prediction failed"); },
  };
  let tree = harness.render(props);
  let retry = harness.buttons(tree).find((button) => button.props.children === "Retry");
  assert.ok(retry);
  assert.equal(retry.props.disabled, false);
  await retry.props.onClick();
  tree = harness.render(props);
  retry = harness.buttons(tree).find((button) => button.props.children === "Retry");
  assert.equal(requests, 1);
  assert.equal(retry.props.disabled, false);
});

test("empty state keeps only the header refresh action", () => {
  const patched = transformRenderer(fixture);
  const harness = makePanelHarness(patched);
  const controller = { getText: () => "", setText: () => {}, focus: () => {}, view: { isDestroyed: false } };
  const tree = harness.render({
    controller,
    enabled: true,
    intl: { locale: "en-US" },
    prediction: null,
    loading: false,
    error: false,
    submitText: () => {},
    requestPrediction: async () => null,
  });
  const refreshButtons = harness.buttons(tree).filter((button) => button.props.children === "Refresh");
  assert.equal(refreshButtons.length, 1);
});

