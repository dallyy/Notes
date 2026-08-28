package main

import "bytes"

// SniffImageExt 按魔数判定图片扩展名（客户端文件名从不被信任）。
func SniffImageExt(data []byte) (string, bool) {
	switch {
	case bytes.HasPrefix(data, []byte{0xFF, 0xD8, 0xFF}):
		return ".jpg", true
	case bytes.HasPrefix(data, []byte{0x89, 'P', 'N', 'G', 0x0D, 0x0A, 0x1A, 0x0A}):
		return ".png", true
	case bytes.HasPrefix(data, []byte{'G', 'I', 'F', '8'}):
		return ".gif", true
	case bytes.HasPrefix(data, []byte{'R', 'I', 'F', 'F'}) && len(data) >= 12 &&
		bytes.Equal(data[8:12], []byte{'W', 'E', 'B', 'P'}):
		return ".webp", true
	}
	return "", false
}
