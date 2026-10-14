package main

import (
	"runtime"
	"syscall"
	"unsafe"
)

type windowMessage struct {
	Window  uintptr
	Message uint32
	WParam  uintptr
	LParam  uintptr
	Time    uint32
	X       int32
	Y       int32
	Private uint32
}

// Keep a small native progress window responsive during filesystem work.
func installWithProgress(work func() (installResult, error)) (installResult, error) {
	runtime.LockOSThread()
	defer runtime.UnlockOSThread()
	user := syscall.NewLazyDLL("user32.dll")
	class, _ := syscall.UTF16PtrFromString("STATIC")
	text, _ := syscall.UTF16PtrFromString("Codex 回复建议：正在安装，请稍候…")
	window, _, _ := user.NewProc("CreateWindowExW").Call(1, uintptr(unsafe.Pointer(class)), uintptr(unsafe.Pointer(text)), 0x10C00000, 0x80000000, 0x80000000, 480, 110, 0, 0, 0, 0)
	if window == 0 {
		return work()
	}
	user.NewProc("UpdateWindow").Call(window)
	type completion struct {
		result installResult
		err    error
	}
	done := make(chan completion, 1)
	const finished = 0x8001
	go func() {
		result, err := work()
		done <- completion{result, err}
		user.NewProc("PostMessageW").Call(window, finished, 0, 0)
	}()
	var message windowMessage
	for {
		status, _, _ := user.NewProc("GetMessageW").Call(uintptr(unsafe.Pointer(&message)), window, 0, 0)
		if status == 0 || int32(status) == -1 || message.Message == finished {
			break
		}
		user.NewProc("TranslateMessage").Call(uintptr(unsafe.Pointer(&message)))
		user.NewProc("DispatchMessageW").Call(uintptr(unsafe.Pointer(&message)))
	}
	user.NewProc("DestroyWindow").Call(window)
	completed := <-done
	return completed.result, completed.err
}
