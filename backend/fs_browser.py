"""資料夾瀏覽 API 的邏輯：列出指定路徑下的子資料夾，供前端的資料夾瀏覽器使用。

安全要求：
- 本 API 只回報「資料夾清單」，永遠不回傳任何檔案內容，避免變成讀檔後門。
- 用 Path.resolve() 正規化路徑，讓 '..' 之類的組合不會產生非預期結果（防路徑穿越）。
"""

from __future__ import annotations

import os
import string
from pathlib import Path
import ctypes


class FsError(Exception):
    """資料夾瀏覽相關錯誤（路徑不存在、不是資料夾、無權限等）。"""


def _list_windows_drives() -> list[dict]:
    """利用 Windows API 直接獲取當前掛載的磁碟機，已修正 buffer.value 截斷問題。"""
    drives = []

    buffer_len = 255
    buffer = ctypes.create_unicode_buffer(buffer_len)

    # kernel32.GetLogicalDriveStringsW 回傳的是寫入緩衝區的「字元總長度」(不含最後的 null)
    result = ctypes.windll.kernel32.GetLogicalDriveStringsW(buffer_len, buffer)

    if result > 0 and result < buffer_len:
        # 【修正核心】: 
        # 不能用 buffer.value (會被第一個 \x00 截斷)
        # 必須利用 buffer[:] 或是根據 result 長度切片，取得完整的記憶體內容
        full_content = buffer[:result]
        
        # 此時 full_content 包含像 "C:\\\x00D:\\" 的字串，我們用 \x00 切開它
        raw_drives = full_content.split("\x00")
        
        for drive in raw_drives:
            if drive:  # 確保不是空字串
                drives.append({"name": drive, "path": drive})
                
    else:
        # 如果 API 失敗，退回到原本的暴力掃描法作為備援

        for letter in string.ascii_uppercase:
            root = f"{letter}:\\"
            if os.path.exists(root):
                drives.append({"name": root, "path": root})

    return drives


def list_dir(path: str | None) -> dict:
    """列出 path 下的子資料夾（只回資料夾，不含檔案內容）。

    path 為空 → 回傳磁碟機清單（Windows）作為起點；
    否則回傳該路徑的子資料夾、上一層路徑，以及此資料夾是否為 MC 伺服器。
    """
    # 沒給路徑：回磁碟機清單當起點
    if not path or not path.strip():
        return {
            "path": "",
            "parent": None,
            "is_minecraft_server": False,
            "drives": _list_windows_drives(),
            "dirs": [],
        }

    # 正規化並解析成絕對路徑（消除 '..' 等，防路徑穿越）
    p = Path(path).resolve()

    if not p.exists():
        raise FsError(f"路徑不存在：{p}")
    if not p.is_dir():
        raise FsError(f"這不是資料夾：{p}")

    dirs = []
    try:
        for entry in os.scandir(p):
            try:
                if entry.is_dir():
                    dirs.append({"name": entry.name, "path": str(Path(entry.path))})
            except OSError:
                # 個別項目讀取失敗（權限/連結問題）時略過，不讓整體壞掉
                continue
    except PermissionError:
        raise FsError(f"沒有權限讀取這個資料夾：{p}")

    dirs.sort(key=lambda d: d["name"].lower())

    # 已在磁碟機根目錄時 p.parent == p，此時 parent 設為 None
    parent = None if p.parent == p else str(p.parent)

    return {
        "path": str(p),
        "parent": parent,
        "is_minecraft_server": (p / "server.properties").exists(),
        "drives": [],
        "dirs": dirs,
    }
