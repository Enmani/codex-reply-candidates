package main

import (
	"fmt"
	"syscall"
	"unsafe"
)

func stampResource(path string, data []byte) error {
	kernel := syscall.NewLazyDLL("kernel32.dll")
	file, _ := syscall.UTF16PtrFromString(path)
	kind, _ := syscall.UTF16PtrFromString("INTEGRITY")
	name, _ := syscall.UTF16PtrFromString("ELECTRONASAR")
	module, _, err := kernel.NewProc("LoadLibraryExW").Call(uintptr(unsafe.Pointer(file)), 0, 0x2|0x20)
	if module == 0 {
		return fmt.Errorf("Read native packaging resource: %w", err)
	}
	var languages []uintptr
	callback := syscall.NewCallback(func(_ uintptr, _ uintptr, _ uintptr, language uintptr, _ uintptr) uintptr {
		languages = append(languages, language)
		return 1
	})
	_, _, enumErr := kernel.NewProc("EnumResourceLanguagesW").Call(module, uintptr(unsafe.Pointer(kind)), uintptr(unsafe.Pointer(name)), callback, 0)
	kernel.NewProc("FreeLibrary").Call(module)
	if len(languages) != 1 {
		return fmt.Errorf("Unsupported native packaging resource: %v", enumErr)
	}
	handle, _, err := kernel.NewProc("BeginUpdateResourceW").Call(uintptr(unsafe.Pointer(file)), 0)
	if handle == 0 {
		return fmt.Errorf("Open native packaging resource: %w", err)
	}
	updated, _, err := kernel.NewProc("UpdateResourceW").Call(handle, uintptr(unsafe.Pointer(kind)), uintptr(unsafe.Pointer(name)), languages[0], uintptr(unsafe.Pointer(&data[0])), uintptr(len(data)))
	if updated == 0 {
		kernel.NewProc("EndUpdateResourceW").Call(handle, 1)
		return fmt.Errorf("Update native packaging resource: %w", err)
	}
	ended, _, err := kernel.NewProc("EndUpdateResourceW").Call(handle, 0)
	if ended == 0 {
		return fmt.Errorf("Save native packaging resource: %w", err)
	}
	return nil
}
