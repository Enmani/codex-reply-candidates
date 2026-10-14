package main

import (
	"fmt"
	"syscall"
	"unsafe"
)

var messageBox = syscall.NewLazyDLL("user32.dll").NewProc("MessageBoxW")

func showMessage(text string, flags uintptr) uintptr {
	caption, _ := syscall.UTF16PtrFromString("Codex 回复建议")
	content, _ := syscall.UTF16PtrFromString(text)
	result, _, _ := messageBox.Call(0, uintptr(unsafe.Pointer(content)), uintptr(unsafe.Pointer(caption)), flags)
	return result
}

func confirmInstall() bool {
	return showMessage("安装回复建议？\n\n输入框上方自动显示 1–3 条建议，可填入、发送或换一批。\n可在 Codex 的插件设置里关闭或修改条数。\n\n安装后通过桌面的「Codex 回复建议」打开。", 0x4|0x40) == 6
}

func showInstallResult(result installResult, err error) {
	if err != nil {
		showMessage(fmt.Sprintf("安装未完成。\n\n%s", err), 0x10)
		return
	}
	message := "回复建议已安装。\n\n退出当前 Codex 后，双击桌面的「Codex 回复建议」。\n以后从这个入口打开，候选列表会自动加载。\n\n设置位置：Codex → 插件 → 回复建议。"
	showMessage(message, 0x40)
}
