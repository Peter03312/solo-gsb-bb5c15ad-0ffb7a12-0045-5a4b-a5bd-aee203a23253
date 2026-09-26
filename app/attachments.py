"""附件提取与 ZIP 导出。

从（可能已在前端编辑过的）解析树中递归找出带附件语义的叶子：

* ``Content-Disposition`` 的 disposition 为 ``attachment``（RFC 2183）；
* 或 Content-Disposition 任意 disposition 带 ``filename`` / ``filename*``
  / ``filename*0*`` 等 RFC 2231 文件名参数（典型 form-data 文件上传字段）。

文件名解析（:func:`app.mime.resolve_filename`）遵循 RFC 2231：
扩展值（``filename*`` / 分段 ``filename*0*``）优先于普通 ``filename``，
非法扩展值回退普通值；都没有时按节点路径命名。

导出字节规则：
* 使用 **CTE 解码后** 的字节；叶子在前端被编辑（正文改动或 CTE 切换）
  时取编辑后内容按当前 CTE 还原出的传输体；
* 未编辑叶子的 ``decodeState`` 为 ``malformed``（畸形 base64/QP）或
  ``passthrough``（未知 CTE）时无法安全导出，标记为不可导出并说明原因。

文件名统一做跨平台净化（去除路径分隔符与控制字符），重名按遍历顺序
加序号，保证 ZIP 内条目名唯一且不会产生目录穿越。
"""

from __future__ import annotations

import base64
import binascii
import io
import re
import zipfile

from .mime import _encode_leaf_body

# Windows 保留设备名（不区分大小写、可带任意扩展名）
_WINDOWS_RESERVED = {
    "con", "prn", "aux", "nul",
    *(f"com{i}" for i in range(1, 10)),
    *(f"lpt{i}" for i in range(1, 10)),
}
# Windows 文件名字符黑名单（含路径分隔符 / 与 : * ? " < > |）
_BAD_NAME_CHARS_RE = re.compile(r'[\\/:*?"<>|]')
# C0 控制字符 + DEL
_CONTROL_CHARS_RE = re.compile(r"[\x00-\x1f\x7f]")
# 路径净化的兜底名（节点路径也无法生成可用名时）
_FALLBACK_NAME = "attachment.bin"
_PATH_FALLBACK_NAME = "root.bin"


# --------------------------------------------------------------------------- #
# 文件名净化与重名处理
# --------------------------------------------------------------------------- #

def sanitize_filename(filename: str | None, fallback: str) -> str:
    """把附件文件名净化为单段、跨平台安全的文件名。

    * 去除路径分隔符（``/``、``\\``）与 Windows 非法字符（``: * ? " < > |``）；
    * 删除 C0 控制字符与 DEL；
    * 去除结尾的点与空格（Windows 会静默丢弃）；
    * 命中 Windows 保留设备名（``CON``、``PRN``…）时加下划线前缀；
    * 结果为空或仅剩点时使用 ``fallback``。
    """
    if not filename:
        return fallback
    name = _CONTROL_CHARS_RE.sub("", filename)
    name = _BAD_NAME_CHARS_RE.sub("_", name)
    name = name.strip()
    name = name.rstrip(". ")
    if not name or set(name) <= {"."}:
        return fallback
    stem = name.split(".", 1)[0].lower()
    if stem in _WINDOWS_RESERVED:
        name = "_" + name
    return name


def fallback_name_for_path(path: str) -> str:
    """无文件名时按节点路径生成单段文件名（统一追加 .bin 扩展名）。"""
    if not path or path == "root":
        return _PATH_FALLBACK_NAME
    cleaned = _CONTROL_CHARS_RE.sub("", path)
    cleaned = _BAD_NAME_CHARS_RE.sub("_", cleaned)
    cleaned = cleaned.strip().strip(".")
    if not cleaned:
        return _FALLBACK_NAME
    return cleaned + ".bin"


def unique_filename(name: str, used: set[str]) -> str:
    """重名时按遍历顺序在最后一个扩展名前加 ``(1)``/``(2)``…。"""
    if name not in used:
        used.add(name)
        return name
    if "." in name:
        stem, ext = name.rsplit(".", 1)
        suffix = "." + ext
    else:
        stem, suffix = name, ""
    i = 1
    while True:
        candidate = f"{stem}({i}){suffix}"
        if candidate not in used:
            used.add(candidate)
            return candidate
        i += 1


# --------------------------------------------------------------------------- #
# 叶子判定与导出字节
# --------------------------------------------------------------------------- #

def _is_edited(node: dict) -> bool:
    """与 mime._assemble_node 的“未编辑快速路径”判据保持一致。"""
    if node.get("bodyEdited"):
        return True
    cte = (node.get("transferEncoding") or "7bit").strip().lower() or "7bit"
    declared = (node.get("transferEncodingDeclared") or cte).strip().lower()
    return cte != declared


def leaf_export_bytes(node: dict, path: str):
    """返回叶子的导出字节 ``(bytes, None)`` 或 ``(None, reason)``。

    已编辑叶子（含原本畸形/未知 CTE）按编辑后内容重新编码，允许导出；
    未编辑叶子在 ``malformed`` / ``passthrough`` 状态下禁导。
    """
    edited = _is_edited(node)
    state = node.get("decodeState") or "raw"
    cte = (node.get("transferEncoding") or "7bit").strip().lower() or "7bit"

    if not edited:
        if state == "malformed":
            return None, (
                f"该叶子的 Content-Transfer-Encoding（{cte}）正文存在畸形，"
                "CTE 解码结果可能不是原始字节；请在树中编辑（或重新选择 CTE）"
                "后再导出，未编辑状态下已禁止导出")
        if state == "passthrough":
            return None, (
                f"该叶子声明了未知的 Content-Transfer-Encoding（{cte}），"
                "无法做 CTE 解码；请在树中切换为 7bit/8bit/binary/base64/"
                "quoted-printable 或编辑正文后再导出")
        # 未编辑且解码可靠：body/bodyEncoding 携带的正是 CTE 解码后的字节
        # （base64/QP 已传输解码；7bit/8bit/binary 解码即原始正文）
        return _encode_leaf_text(node), None

    # 已编辑：与 /api/encode 相同的路径，按当前 CTE 重新编码为传输字节
    issues: list[dict] = []
    data = _encode_leaf_body(node, cte, issues, path)
    return data, None


def _encode_leaf_text(node: dict) -> bytes:
    """与 mime._encode_text 相同，把编辑器通道（utf-8/base64）还原为字节。"""
    text = node.get("body")
    if text is None:
        return b""
    if node.get("bodyEncoding") == "base64":
        try:
            return base64.b64decode(text, validate=False)
        except (binascii.Error, ValueError):
            return text.encode("latin-1", errors="replace")
    return text.encode("utf-8", errors="replace")


def is_attachment_leaf(node: dict) -> bool:
    """叶子是否带附件语义：disposition=attachment，或声明了文件名参数。"""
    if node.get("kind") == "multipart":
        return False
    disp = (node.get("disposition") or "").strip().lower()
    if disp == "attachment":
        return True
    # 带文件名参数（含空 filename=""）的任意 disposition 都视为附件叶子；
    # 解析器在有该参数但值不可用时会给出 hasFilenameParam 标记。
    if node.get("hasFilenameParam"):
        return True
    return False


# --------------------------------------------------------------------------- #
# 遍历与描述符
# --------------------------------------------------------------------------- #

def collect_attachments(tree: dict) -> list[dict]:
    """先序遍历解析树，返回附件叶子的描述符列表（含净化后唯一文件名）。

    描述符字段：path / disposition / name / filename / filenameSource /
    filenameNote / mediaType / size / wireSize / exportable / reason /
    exportName（ZIP 内文件名，仅 exportable 时保证非空）。
    """
    descriptors: list[dict] = []
    used_names: set[str] = set()

    def walk(node: dict):
        if not isinstance(node, dict):
            return
        if is_attachment_leaf(node):
            descriptors.append(_build_descriptor(node, used_names))
            return
        for child in node.get("parts") or []:
            walk(child)

    walk(tree or {})
    return descriptors


def _build_descriptor(node: dict, used_names: set[str]) -> dict:
    path = node.get("path") or "root"
    raw_name = node.get("filename")
    extended = bool(node.get("filenameExtended"))
    note = node.get("filenameNote")
    has_name_param = raw_name is not None and raw_name != ""

    fallback = fallback_name_for_path(path)
    if has_name_param:
        source = "rfc2231" if extended else "header"
        display_name = sanitize_filename(raw_name, fallback)
    else:
        # filename 参数存在但为空：按路径命名（disposition=attachment 的情况）
        source = "path"
        display_name = fallback

    data, reason = leaf_export_bytes(node, path)
    exportable = data is not None
    wire_size = _raw_wire_size(node.get("rawBodyBase64"))
    descriptor = {
        "path": path,
        "disposition": node.get("disposition"),
        "name": node.get("name"),
        "filename": raw_name,
        "filenameSource": source,
        "filenameNote": note,
        "mediaType": node.get("mediaType") or "application/octet-stream",
        "size": len(data) if exportable else None,
        "wireSize": wire_size,
        "exportable": exportable,
        "reason": reason,
        "exportName": None,
    }
    if exportable:
        descriptor["exportName"] = unique_filename(display_name, used_names)
    return descriptor


def _raw_wire_size(raw_body_b64: str | None) -> int:
    """未做 CTE 解码的原始传输体大小（rawBodyBase64）。"""
    if not raw_body_b64:
        return 0
    try:
        return len(base64.b64decode(raw_body_b64, validate=False))
    except (binascii.Error, ValueError):
        return 0


# --------------------------------------------------------------------------- #
# ZIP 打包
# --------------------------------------------------------------------------- #

def build_attachment_zip(tree: dict, selected_paths: list[str] | None = None):
    """按勾选路径打包附件，返回 ``(zip_bytes, descriptors, issues)``。

    ``selected_paths`` 为 None/空时导出全部可导出附件。服务端重新遍历、
    重新判定可导出性与文件名（不相信前端计算结果）；被选中但当前不可
    导出的节点进入 issues 而不是写入 ZIP。
    """
    selected = set(selected_paths or [])
    descriptors = collect_attachments(tree)
    issues: list[dict] = []
    buffer = io.BytesIO()
    # ZIP 条目名允许 UTF-8（Python 自动设置 UTF-8 标志位）
    with zipfile.ZipFile(buffer, "w", zipfile.ZIP_DEFLATED) as zf:
        for desc in descriptors:
            if selected and desc["path"] not in selected:
                continue
            if not desc["exportable"]:
                issues.append({
                    "level": "warning",
                    "code": "ATTACHMENT_NOT_EXPORTABLE",
                    "path": desc["path"],
                    "message": f"{desc['path']}：{desc['reason']}",
                })
                continue
            node = _find_node(tree, desc["path"])
            data, reason = leaf_export_bytes(node, desc["path"])
            if data is None:
                issues.append({
                    "level": "warning",
                    "code": "ATTACHMENT_NOT_EXPORTABLE",
                    "path": desc["path"],
                    "message": f"{desc['path']}：{reason}",
                })
                continue
            zf.writestr(desc["exportName"], data)
    return buffer.getvalue(), descriptors, issues


def _find_node(tree: dict, path: str) -> dict:
    """按解析树 path（parts[i].parts[j]…）定位节点，缺失时返回树本身。"""
    if not path or path == "root":
        return tree or {}
    node = tree or {}
    for idx in re.findall(r"\[(\d+)\]", path):
        parts = node.get("parts") or []
        i = int(idx)
        if i >= len(parts):
            return node
        node = parts[i]
    return node
