/**
 * The injected panel deliberately uses the renderer's existing React, JSX and
 * Button bindings. The function is serialized by renderer-patch.mjs and then
 * evaluated inside the inspected renderer scope.
 */
export function CodexMultiPredictionPanel(e) {
  const {
    controller,
    enabled,
    prediction,
    loading,
    error,
    intl,
    submitText,
    onPrediction,
    requestPrediction,
    candidateCount,
  } = e;
  const [localPrediction, setLocalPrediction] = RL.useState(null);
  const [isRefreshing, setIsRefreshing] = RL.useState(false);
  const [refreshFailed, setRefreshFailed] = RL.useState(false);
  const [isSending, setIsSending] = RL.useState(false);
  const [sendFailed, setSendFailed] = RL.useState(false);
  const requestIdRef = RL.useRef(0);

  RL.useEffect(() => {
    requestIdRef.current += 1;
    setLocalPrediction(null);
    setIsRefreshing(false);
    setRefreshFailed(false);
    setSendFailed(false);
    return () => {
      requestIdRef.current += 1;
    };
  }, [prediction?.predictionThreadId, prediction?.sourceTurnId, prediction?.generationId]);

  const currentPrediction = localPrediction ?? prediction;
  const suggestions = Array.isArray(currentPrediction?.suggestions)
    ? currentPrediction.suggestions
        .filter((value) => typeof value === "string" && value.trim() !== "")
        .slice(0, Math.max(1, Math.min(3, Number(candidateCount) || 3)))
    : currentPrediction?.text?.trim()
      ? [currentPrediction.text.trim()]
      : [];
  const hasDraft = (controller.getText?.() ?? "").trim() !== "";
  const disabled =
    !enabled ||
    isRefreshing ||
    hasDraft ||
    controller.view?.isDestroyed === true;
  const isBlockedNow = () => disabled || isSending ||
    (controller.getText?.() ?? "").trim() !== "" || controller.view?.isDestroyed === true;
  const isChinese = (intl?.locale ?? "").toLowerCase().startsWith("zh");
  const copy = isChinese
    ? {
        title: "预测回复",
        refresh: "换一批",
        fill: "填入",
        send: "发送",
        retry: "重试",
        loading: "正在生成预测回复…",
        empty: "暂无预测回复",
        generating: "生成中",
        predictionError: "预测回复生成失败",
        sendError: "发送失败，请重试",
      }
    : {
        title: "Predicted replies",
        refresh: "Refresh",
        fill: "Fill",
        send: "Send",
        retry: "Retry",
        loading: "Generating predicted replies…",
        empty: "No predicted replies",
        generating: "Generating",
        predictionError: "Couldn’t generate predicted replies",
        sendError: "Couldn’t send. Try again.",
      };

  const refresh = async () => {
    if (isBlockedNow()) return;
    const requestId = requestIdRef.current + 1;
    requestIdRef.current = requestId;
    setIsRefreshing(true);
    setRefreshFailed(false);
    setLocalPrediction(null);
    try {
      const nextPrediction = await requestPrediction();
      if (requestIdRef.current !== requestId) return;
      if (nextPrediction == null) {
        setRefreshFailed(true);
        return;
      }
      if ((controller.getText?.() ?? "").trim() !== "") return;
      setLocalPrediction(nextPrediction);
      onPrediction?.(nextPrediction);
    } catch {
      if (requestIdRef.current === requestId) setRefreshFailed(true);
    } finally {
      if (requestIdRef.current === requestId) setIsRefreshing(false);
    }
  };

  if (!enabled) return null;

  const choose = async (text, shouldSend) => {
    if (isBlockedNow() || (shouldSend && submitText == null)) return;
    if (!shouldSend) {
      controller.setText(text);
      controller.focus("end");
      return;
    }
    setIsSending(true);
    setSendFailed(false);
    try {
      const accepted = await submitText(text);
      if (accepted !== true) setSendFailed(true);
    } catch {
      setSendFailed(true);
    } finally {
      setIsSending(false);
    }
  };

  const refreshButton = (0, zL.jsx)(kt, {
    type: "button",
    color: "secondary",
    disabled: disabled || isSending,
    loading: isRefreshing,
    onClick: refresh,
    children: copy.refresh,
  });
  let content;
  if ((loading || isRefreshing) && currentPrediction == null) {
    content = (0, zL.jsx)("div", {
      role: "status",
      className: "px-3 py-2 text-sm text-secondary",
      children: copy.loading,
    });
  } else if ((error || refreshFailed) && currentPrediction == null && !isRefreshing) {
    content = (0, zL.jsxs)("div", {
      role: "alert",
      className: "flex items-center justify-between gap-2 px-3 py-2 text-sm text-secondary",
      children: [
        (0, zL.jsx)("span", { children: copy.predictionError }),
        (0, zL.jsx)(kt, {
          type: "button",
          color: "secondary",
          disabled: disabled || isSending,
          onClick: refresh,
          children: copy.retry,
        }),
      ],
    });
  } else if (suggestions.length === 0) {
    content = (0, zL.jsx)("div", {
      role: "status",
      className: "px-3 py-2 text-sm text-secondary",
      children: isRefreshing ? copy.loading : copy.empty,
    });
  } else {
    content = (0, zL.jsxs)(zL.Fragment, {
      children: [
        (0, zL.jsx)("div", {
          className: "flex flex-col gap-2 p-2",
          children: suggestions.map((text, index) =>
            (0, zL.jsxs)(
              "div",
              {
                className: "flex items-start gap-2 rounded-lg border border-default px-3 py-2",
                children: [
                  (0, zL.jsx)("div", {
                    className: "min-w-0 flex-1 whitespace-pre-wrap break-words text-sm text-default",
                    children: text,
                  }),
                  (0, zL.jsx)(kt, {
                    type: "button",
                    color: "secondary",
                    disabled: disabled || isSending,
                    onClick: () => choose(text, false),
                    children: copy.fill,
                  }),
                  (0, zL.jsx)(kt, {
                    type: "button",
                    color: "primary",
                    disabled: disabled || isSending || submitText == null,
                    onClick: () => choose(text, true),
                    children: copy.send,
                  }),
                ],
              },
              `candidate-${index}-${text}`,
            ),
          ),
        }),
        refreshFailed
          ? (0, zL.jsxs)("div", {
              role: "alert",
              className: "flex items-center justify-between gap-2 px-3 py-2 text-sm text-secondary",
              children: [
                (0, zL.jsx)("span", { children: copy.predictionError }),
                (0, zL.jsx)(kt, {
                  type: "button",
                  color: "secondary",
                  disabled: disabled || isSending,
                  onClick: refresh,
                  children: copy.retry,
                }),
              ],
            })
          : null,
      ],
    });
  }

  return (0, zL.jsx)("div", {
    className: "mb-2 rounded-lg border border-default",
    "data-codex-multi-predictions": "true",
    children: (0, zL.jsxs)("div", {
      className: "flex flex-col",
      children: [
        (0, zL.jsxs)("div", {
          className: "flex items-center justify-between gap-2 px-3 pt-3",
          children: [
            (0, zL.jsx)("span", {
              className: "text-sm font-medium text-default",
              children: copy.title,
            }),
            (0, zL.jsx)("div", {
              className: "flex items-center gap-2",
              children: [refreshButton],
            }),
          ],
        }),
        content,
        sendFailed
          ? (0, zL.jsx)("div", {
              role: "alert",
              className: "px-3 py-2 text-sm text-secondary",
              children: copy.sendError,
            })
          : null,
      ],
    }),
  });
}
