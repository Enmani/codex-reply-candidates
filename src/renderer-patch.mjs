import { CodexMultiPredictionPanel } from "./prediction-panel.mjs";

const ZXE_START = "function ZXe(e){";
const QXE_START = "function QXe(e)";
const XXE_CALL = "(0,QX.jsx)(XXe,{controller:dn,hostId:Bi,pluginHostId:Ui,roots:ko,canShowPrediction:";
const PANEL_FUNCTION = "function CodexMultiPredictionPanel(e)";
const PANEL_SOURCE = CodexMultiPredictionPanel.toString();

/**
 * Inject the multi-candidate composer UI into the known Codex renderer chunk.
 *
 * The client is a minified bundle, so this deliberately uses a small set of
 * unique semantic anchors from the inspected Cumberbatch renderer instead of
 * broad text or DOM selectors. A new renderer shape must fail closed and be
 * re-inspected before a patch is produced.
 */
export function transformRenderer(source) {
  if (typeof source !== "string") {
    throw new TypeError("renderer source must be a string");
  }

  if (source.includes(PANEL_FUNCTION)) {
    return source;
  }

  const requiredAnchors = [
    ZXE_START,
    QXE_START,
    "let{data:p}=Sm(f,s.queryClient)",
    "Ck as kt",
    XXE_CALL,
    "function $Xe()",
    "RL=Z()",
    "zL=K()",
  ];
  const missing = requiredAnchors.filter((anchor) => !source.includes(anchor));
  if (missing.length > 0) {
    throw new Error(`unsupported Codex renderer: missing ${missing.join(", ")}`);
  }

  const count = (needle) => source.split(needle).length - 1;
  for (const anchor of [ZXE_START, QXE_START, XXE_CALL, "let{data:p}=Sm(f,s.queryClient)"]) {
    if (count(anchor) !== 1) {
      throw new Error(`unsupported Codex renderer: expected one ${anchor}`);
    }
  }

  const zxeStart = source.indexOf(ZXE_START);
  const qxeStart = source.indexOf(QXE_START, zxeStart + ZXE_START.length);
  const zxeSource = source.slice(zxeStart, qxeStart);
  const propsAnchor = "{controller:n,canShowPrediction:r,hostId:i,pluginHostId:a,roots:o}";
  if (zxeSource.indexOf(propsAnchor) === -1 || zxeSource.indexOf(propsAnchor) !== zxeSource.lastIndexOf(propsAnchor)) {
    throw new Error("unsupported Codex renderer: prediction props anchor is not unique");
  }
  const queryAnchor = "let{data:p}=Sm(f,s.queryClient)";
  const queryReplacement =
    "let{data:p,isPending:predictionsLoading,isError:predictionsError}=Sm(f,s.queryClient)";
  if (zxeSource.indexOf(queryAnchor) === -1 || zxeSource.indexOf(queryAnchor) !== zxeSource.lastIndexOf(queryAnchor)) {
    throw new Error("unsupported Codex renderer: prediction query anchor is not unique");
  }

  const originalTail = ":y=t[26],y}";
  if (!zxeSource.endsWith(originalTail)) {
    throw new Error("unsupported Codex renderer: prediction renderer tail changed");
  }

  const panel =
    "(0,zL.jsx)(CodexMultiPredictionPanel,{key:c==null?null:[c.hostId,c.threadId,c.latestTurnId].join(`:`),controller:n,enabled:r,prediction:p,loading:predictionsLoading,error:predictionsError,intl:predictionIntl,submitText:submitText,onPrediction:t=>{t!=null&&c!=null&&s.get(BL)===c.latestTurnId&&(s.queryClient.setQueryData([`cumberbatch`,c],t),coe({scope:s,target:{...c,generationTrigger:`catch_up`,forceRefresh:!0},prediction:t}))},requestPrediction:()=>{if(c==null||l==null)return Promise.resolve(null);let e={...c,generationTrigger:`catch_up`,forceRefresh:!0};return Woe(l.requestUserMessagePrediction(e,new lr(t=>{Vi({scope:s,target:e,ineligibility:t})})))}})";
  const replacementTail = `:y=t[26],(0,zL.jsxs)(zL.Fragment,{children:[y,${panel}]})}`;
  const patchedZxe = zxeSource
    .replace(propsAnchor, "{controller:n,canShowPrediction:r,hostId:i,pluginHostId:a,roots:o,intl:predictionIntl,submitText:submitText}")
    .replace(queryAnchor, queryReplacement)
    .replace(originalTail, replacementTail);

  const withPanel = source.slice(0, zxeStart) + patchedZxe + PANEL_SOURCE + source.slice(qxeStart);
  const patchedCall = withPanel.replace(
    XXE_CALL,
    "(0,QX.jsx)(XXe,{controller:dn,hostId:Bi,pluginHostId:Ui,roots:ko,intl:Ln,submitText:async e=>{let t=!1,n=()=>{t=!0};try{await Mc({promptRawOverride:e,persistedPromptRawOverride:e,focusComposerAfterSubmit:!0,skipGoalSubmit:!0,onDeferred:n,onSubmitted:n})}catch(e){return!1}return t},canShowPrediction:",
  );
  if (patchedCall === withPanel) {
    throw new Error("unsupported Codex renderer: composer prediction mount changed");
  }
  return patchedCall;
}
