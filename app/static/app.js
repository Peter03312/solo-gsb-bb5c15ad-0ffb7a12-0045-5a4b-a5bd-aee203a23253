/* MIME Multipart 检查器前端（无框架原生实现） */
"use strict";

const $ = (sel, root = document) => root.querySelector(sel);
const $$ = (sel, root = document) => Array.from(root.querySelectorAll(sel));

let parseResult = null;       // 最近一次解析返回
let tree = null;              // 当前可编辑树（对象引用，控件直接改它）
let encodedBytes = null;      // Uint8Array 编码结果
const issueFilter = { error: true, warning: true, info: true };

// 样本对比：A/B 两份解析结果快照（localStorage 持久化）与最近一次 diff 结果
const SAMPLES = { a: null, b: null };
let diffResult = null;
const diffFilter = { added: true, removed: true, modified: true, unchanged: false };
const CHANGE_LABEL = { added: "新增", removed: "删除", modified: "修改", unchanged: "未变化" };

// ---------------------------------------------------------------- samples --

// 说明：RFC 2046 要求首定界符前有 CRLF；顶层头部块后的空行已提供该 CRLF，
// 因此 body 直接以 "--boundary" 开始（HTTP multipart 的常见形态）。
const SAMPLE_BASIC =
  'Content-Type: multipart/form-data; boundary=----WebKitFormBoundaryABC\r\n' +
  '\r\n' +
  '------WebKitFormBoundaryABC\r\n' +
  'Content-Disposition: form-data; name="username"\r\n' +
  '\r\n' +
  'alice@example.com\r\n' +
  '------WebKitFormBoundaryABC\r\n' +
  'Content-Disposition: form-data; name="bio"\r\n' +
  '\r\n' +
  '你好，MIME！\r\n' +
  '------WebKitFormBoundaryABC\r\n' +
  'Content-Disposition: form-data; name="file"; filename="notes.txt"\r\n' +
  'Content-Type: text/plain\r\n' +
  '\r\n' +
  'line1\r\n' +
  'line2\r\n' +
  '------WebKitFormBoundaryABC--';

const SAMPLE_NESTED =
  'Content-Type: multipart/mixed; boundary="OUTER-001"\r\n' +
  'MIME-Version: 1.0\r\n' +
  '\r\n' +
  'This is a MIME-formatted message.  If you see this, your mailer is broken.\r\n' +
  '--OUTER-001\r\n' +
  'Content-Type: text/plain; charset="utf-8"\r\n' +
  'Content-Transfer-Encoding: 8bit\r\n' +
  '\r\n' +
  '外层正文：请查收附件。\r\n' +
  '--OUTER-001\r\n' +
  'Content-Type: multipart/alternative; boundary="INNER-42"\r\n' +
  '\r\n' +
  '--INNER-42\r\n' +
  'Content-Type: text/plain; charset=utf-8\r\n' +
  'Content-Transfer-Encoding: 8bit\r\n' +
  '\r\n' +
  'plain 版本\r\n' +
  '--INNER-42\r\n' +
  'Content-Type: text/html; charset=utf-8\r\n' +
  'Content-Transfer-Encoding: 8bit\r\n' +
  '\r\n' +
  '<p><b>HTML</b> 版本</p>\r\n' +
  '--INNER-42--\r\n' +
  '--OUTER-001\r\n' +
  'Content-Type: text/plain; charset="utf-8"\r\n' +
  'Content-Transfer-Encoding: quoted-printable\r\n' +
  '\r\n' +
  '=E6=8A=A5=E4=BB=B7=EF=BC=9ACaf=C3=A9=20=3D=20=C2=A5123.45=EF=BC=8C=E6=95=AC=\r\n' +
  '=E8=AF=B7=E6=9F=A5=E6=94=B6=E9=99=84=E4=BB=B6=E5=B9=B6=E5=9C=A8=E6=9C=AC=E5=\r\n' +
  '=91=A8=E5=86=85=E5=9B=9E=E5=A4=8D=E7=A1=AE=E8=AE=A4=EF=BC=8C=E8=B0=A2=E8=B0=\r\n' +
  '=A2=E5=90=88=E4=BD=9C=EF=BC=81\r\n' +
  '--=20=E7=BB=93=E5=B0=BE=20--\r\n' +
  '--OUTER-001\r\n' +
  'Content-Disposition: attachment; filename="payload.bin"\r\n' +
  'Content-Type: application/octet-stream\r\n' +
  'Content-Transfer-Encoding: base64\r\n' +
  '\r\n' +
  'TUlNRQABAiBiaW5hcnkg//4gcGF5bG9hZA0KbGluZTINCg==\r\n' +
  '--OUTER-001\r\n' +
  // 同名附件：ZIP 中按遍历顺序自动重命名为 payload(1).bin
  'Content-Disposition: attachment; filename="payload.bin"\r\n' +
  'Content-Type: text/plain\r\n' +
  '\r\n' +
  'second payload with the same name\r\n' +
  '--OUTER-001\r\n' +
  // RFC 2231：扩展文件名 报告.csv（UTF-8 百分号编码）优先于普通 filename
  'Content-Disposition: attachment; filename="report.csv"; ' +
  "filename*=utf-8''%E6%8A%A5%E5%91%8A.csv\r\n" +
  'Content-Type: text/csv; charset=utf-8\r\n' +
  'Content-Transfer-Encoding: 8bit\r\n' +
  '\r\n' +
  'id,name\r\n' +
  '1,张三\r\n' +
  '--OUTER-001--\r\n' +
  'epilogue text, must be ignored';

const SAMPLE_BAD =
  // 故意使用 LF、缺关闭定界符、畸形头部、畸形 base64
  'Content-Type: multipart/form-data; boundary="BROKEN"\n' +
  '\n' +
  '--BROKEN\n' +
  'Content-Disposition: form-data; name="ok"\n' +
  '\n' +
  'good part\n' +
  '--BROKEN\n' +
  'Content-Disposition: attachment; filename="broken.bin"\n' +
  'Content-Type: application/octet-stream\n' +
  'Content-Transfer-Encoding: base64\n' +
  '\n' +
  'TUlN@@invalid!!!not-enough-padding\n' +
  '--BROKEN\n' +
  'this line is not a valid header (no colon)\n' +
  'Content-Disposition: form-data; name="bad"\n' +
  '\n' +
  'second part\n' +
  '--BROKEN\n' +
  'Content-Type: multipart/mixed; boundary=CHILD\n' +
  '\n' +
  '--CHILD\n' +
  '\n' +
  'nested child\n' +
  '--CHILD--';

// ------------------------------------------------------------- utilities --

function humanSize(n) {
  if (n < 1024) return n + " B";
  if (n < 1024 * 1024) return (n / 1024).toFixed(1) + " KB";
  return (n / 1024 / 1024).toFixed(2) + " MB";
}

function escapeHtml(s) {
  return String(s ?? "").replace(/[&<>"']/g, (c) => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;",
  }[c]));
}

async function postJSON(url, payload) {
  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
  let data = null;
  try { data = await res.json(); } catch (_) { /* ignore */ }
  if (!res.ok) {
    throw new Error((data && (data.detail || data.error)) || `HTTP ${res.status}`);
  }
  return data;
}

function bytesToB64(bytes) {
  let bin = "";
  const CHUNK = 0x8000;
  for (let i = 0; i < bytes.length; i += CHUNK) {
    bin += String.fromCharCode.apply(null, bytes.subarray(i, i + CHUNK));
  }
  return btoa(bin);
}

function b64ToBytes(b64) {
  const bin = atob(b64);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

// --------------------------------------------------------------- issues --

function renderIssues(listEl, issues) {
  listEl.innerHTML = "";
  const shown = issues.filter((i) => issueFilter[i.level] !== false);
  if (!shown.length) {
    const li = document.createElement("li");
    li.className = "info";
    li.innerHTML = '<span class="tag">OK</span><span class="msg">当前筛选下没有诊断信息</span>';
    listEl.appendChild(li);
    return;
  }
  for (const it of shown) {
    const li = document.createElement("li");
    li.className = it.level;
    const label = it.level === "error" ? "错误" : it.level === "warning" ? "警告" : "提示";
    li.innerHTML =
      `<span class="tag">${label}</span>` +
      `<span class="code">${escapeHtml(it.code || "")}</span>` +
      `<span class="msg">${escapeHtml(it.message || "")}</span>`;
    listEl.appendChild(li);
  }
}

function setCounts(counts) {
  counts = counts || { error: 0, warning: 0, info: 0 };
  $("#cntError").textContent = counts.error || 0;
  $("#cntWarning").textContent = counts.warning || 0;
  $("#cntInfo").textContent = counts.info || 0;
}

// ------------------------------------------------------------ tree view --

function reindexPaths(node, path) {
  node.path = path;
  if (node.kind === "multipart") {
    node.parts.forEach((c, i) => reindexPaths(c, `${path === "root" ? "parts" : path + ".parts"}[${i}]`));
  }
}

// RFC 2045 Content-Transfer-Encoding 选项
const CTE_OPTIONS = [
  ["7bit", "7bit"],
  ["8bit", "8bit"],
  ["binary", "binary"],
  ["base64", "base64"],
  ["quoted-printable", "quoted-printable"],
];
const CTE_SET = new Set(CTE_OPTIONS.map((o) => o[0]));
const DECODE_STATE_LABEL = {
  raw: "原始字节（7bit/8bit/binary，未做传输解码）",
  decoded: "传输解码成功，下方为解码后正文",
  malformed: "传输解码异常：已尽力恢复，原始载荷保留（未编辑即字节还原）",
  passthrough: "未知编码：正文按原始字节透传",
};

function cteStateClass(node) {
  switch (node.decodeState) {
    case "decoded": return "cte-ok";
    case "malformed":
    case "passthrough": return "cte-warn";
    default: return "cte-neutral";
  }
}

function newPartNode(index) {
  return {
    kind: "part",
    path: `parts[${index}]`,
    mediaType: "text/plain",
    headers: [
      { name: "Content-Type", value: "text/plain", raw: "" },
      { name: "Content-Disposition", value: `form-data; name="part${index + 1}"`, raw: "" },
    ],
    hasHeaders: true,
    body: "",
    bodyEncoding: "utf-8",
    // 新增节点没有原始传输体，必须走重新编码路径
    transferEncoding: "7bit",
    transferEncodingDeclared: "7bit",
    decodeState: "raw",
    rawBodyBase64: "",
    bodyEdited: true,
    rawSize: 0,
  };
}

function headerRow(table, node, idx) {
  const tr = document.createElement("tr");
  tr.innerHTML =
    `<td><input type="text" spellcheck="false" placeholder="Header-Name"></td>` +
    `<td><input type="text" spellcheck="false" placeholder="value"></td>` +
    `<td class="del-cell"><button class="btn btn-sm btn-danger" type="button">删</button></td>`;
  const [nameIn, valIn] = $$("input", tr);
  nameIn.value = node.headers[idx].name || "";
  valIn.value = node.headers[idx].value || "";
  nameIn.addEventListener("input", () => { node.headers[idx].name = nameIn.value; });
  valIn.addEventListener("input", () => { node.headers[idx].value = valIn.value; });
  $("button", tr).addEventListener("click", () => {
    node.headers.splice(idx, 1);
    rerenderTree();
  });
  return tr;
}

function renderNode(node, depth) {
  const wrap = document.createElement("div");
  wrap.className = "node";
  const isMulti = node.kind === "multipart";

  const titleParts = [];
  if (node.name != null) titleParts.push(`name=<b>${escapeHtml(node.name)}</b>`);
  if (node.filename) titleParts.push(`filename=<b>${escapeHtml(node.filename)}</b>`);
  const titleExtra = titleParts.length ? ` · ${titleParts.join(" · ")}` : "";

  const bar = document.createElement("div");
  bar.className = "node-bar";
  const ctePill = isMulti ? "" :
    `<span class="cte-badge ${cteStateClass(node)}" title="${escapeHtml(DECODE_STATE_LABEL[node.decodeState] || "")}">` +
    `CTE: ${escapeHtml(node.transferEncoding || "7bit")}${node.bodyEdited ? " ✎" : ""}</span>`;
  bar.innerHTML =
    `<span class="caret">▼</span>` +
    `<span class="badge ${isMulti ? "multipart" : ""}">${escapeHtml(node.mediaType || (isMulti ? "multipart/*" : "application/octet-stream"))}</span>` +
    ctePill +
    `<span class="node-title">${escapeHtml(node.path)}${titleExtra}</span>` +
    `<span class="node-spacer"></span>` +
    `<span class="node-size">${humanSize(node.rawSize || 0)}</span>`;
  bar.addEventListener("click", (e) => {
    if (e.target.closest("button, input, a")) return;
    wrap.classList.toggle("collapsed");
  });
  wrap.appendChild(bar);

  const body = document.createElement("div");
  body.className = "node-body";

  // boundary 编辑（仅 multipart）
  if (isMulti) {
    const br = document.createElement("div");
    br.className = "inline-row";
    br.innerHTML =
      `<label>boundary</label>` +
      `<input type="text" spellcheck="false">` +
      `<span class="meta-pill">定界符 --${escapeHtml(node.boundary || "")} / --${escapeHtml(node.boundary || "")}--</span>`;
    const bIn = $("input", br);
    bIn.value = node.boundary || "";
    bIn.addEventListener("input", () => { node.boundary = bIn.value; });
    bIn.addEventListener("click", (e) => e.stopPropagation());
    body.appendChild(br);
  }

  // 头部表
  const hdrLabel = document.createElement("label");
  hdrLabel.textContent = "头部（按输入顺序保留）";
  body.appendChild(hdrLabel);
  const table = document.createElement("table");
  table.className = "headers-table";
  table.innerHTML = `<tr><th>字段名</th><th>值</th><th></th></tr>`;
  node.headers.forEach((_h, idx) => table.appendChild(headerRow(table, node, idx)));
  body.appendChild(table);
  const addHdr = document.createElement("button");
  addHdr.className = "btn btn-sm add-row";
  addHdr.type = "button";
  addHdr.textContent = "+ 添加头部";
  addHdr.addEventListener("click", () => {
    node.headers.push({ name: "", value: "", raw: "" });
    rerenderTree();
  });
  body.appendChild(addHdr);

  if (isMulti) {
    // preamble / epilogue
    for (const key of ["preamble", "epilogue"]) {
      const encKey = key + "Encoding";
      const isBin = node[encKey] === "base64";
      const lab = document.createElement("label");
      const title = key === "preamble"
        ? "序言 preamble（非 MIME 客户端可见，通常无意义）"
        : "尾注 epilogue（关闭定界符之后）";
      lab.innerHTML = `${title} <span class="meta-pill ${isBin ? "latin" : ""}">` +
        `${isBin ? "二进制 · base64（未修改即逐字节还原）" : node[encKey]}</span>`;
      body.appendChild(lab);
      const ta = document.createElement("textarea");
      ta.spellcheck = false;
      ta.value = node[key] || "";
      ta.addEventListener("input", () => { node[key] = ta.value; });
      body.appendChild(ta);
    }

    // 子部分
    const childWrap = document.createElement("div");
    childWrap.className = "sub-node-wrap";
    node.parts.forEach((child) => childWrap.appendChild(renderNode(child, depth + 1)));

    const addPart = document.createElement("button");
    addPart.className = "btn btn-sm add-row";
    addPart.type = "button";
    addPart.textContent = "+ 在末尾插入部分";
    addPart.addEventListener("click", () => {
      node.parts.push(newPartNode(node.parts.length));
      rerenderTree();
    });
    childWrap.appendChild(addPart);
    body.appendChild(childWrap);
  } else {
    // Content-Transfer-Encoding 切换行
    const cteRow = document.createElement("div");
    cteRow.className = "inline-row cte-row";
    cteRow.innerHTML =
      `<label>Content-Transfer-Encoding</label>` +
      `<select class="cte-select"></select>` +
      `<span class="meta-pill ${cteStateClass(node)}">${escapeHtml(DECODE_STATE_LABEL[node.decodeState] || "")}</span>`;
    const sel = $(".cte-select", cteRow);
    for (const [val, label] of CTE_OPTIONS) {
      const opt = document.createElement("option");
      opt.value = val;
      opt.textContent = label;
      sel.appendChild(opt);
    }
    // 解析时遇到非标准 CTE（如 x-uuencode）：作为额外选项保留，避免选择丢失
    const curCte = node.transferEncoding || "7bit";
    if (!CTE_SET.has(curCte)) {
      const opt = document.createElement("option");
      opt.value = curCte;
      opt.textContent = curCte + "（原样透传）";
      sel.appendChild(opt);
    }
    sel.value = curCte;
    sel.addEventListener("click", (e) => e.stopPropagation());
    sel.addEventListener("change", () => {
      // 切换 base64 / quoted-printable 等：后端按新 CTE 重新编码后下载
      node.transferEncoding = sel.value;
      node.bodyEdited = true;
      rerenderTree();
    });
    body.appendChild(cteRow);

    if (node.bodyEdited) {
      const edited = document.createElement("div");
      edited.className = "hint cte-edited";
      edited.textContent = "该节点已被编辑：重新编码时将按所选 CTE 与 MIME 折行规则生成新的传输正文。";
      body.appendChild(edited);
    }
    if (node.decodeState === "malformed" || node.decodeState === "passthrough") {
      const warn = document.createElement("div");
      warn.className = "hint cte-malformed";
      warn.textContent = node.decodeState === "malformed"
        ? "原始 CTE 编码畸形：上方诊断面板有带节点路径的详情。未编辑时下载仍逐字节还原原始载荷；编辑后按所选 CTE 重新编码。"
        : "未识别的 CTE：解析时按原始字节透传，未编辑即字节还原。";
      body.appendChild(warn);
    }

    const lab = document.createElement("label");
    const enc = node.bodyEncoding || "utf-8";
    const isBin = enc === "base64";
    const cteEncoded = curCte === "base64" || curCte === "quoted-printable";
    lab.innerHTML =
      (cteEncoded ? "解码后正文（编辑此内容；下载时按所选 CTE 回写）" : "正文") +
      ` <span class="meta-pill ${isBin ? "latin" : ""}">` +
      `${isBin ? "编辑器通道 · base64（二进制，未修改即逐字节还原）" : enc}</span>`;
    body.appendChild(lab);
    if (isBin) {
      const note = document.createElement("div");
      note.className = "hint";
      note.textContent = "该部分解码后仍不是合法 UTF-8，以 base64 通道展示。直接编辑会被当作 base64 解码；"
        + "若想改为纯文本，请把内容替换为文本即可（将自动按 latin-1 还原字节）。";
      body.appendChild(note);
    }
    const ta = document.createElement("textarea");
    ta.spellcheck = false;
    ta.value = node.body || "";
    ta.addEventListener("input", () => {
      node.body = ta.value;
      node.bodyEdited = true;
    });
    body.appendChild(ta);
  }

  // 删除按钮（根节点不显示）
  if (node.path !== "root") {
    const delRow = document.createElement("div");
    delRow.className = "add-row";
    const del = document.createElement("button");
    del.className = "btn btn-sm btn-danger";
    del.type = "button";
    del.textContent = "删除该部分";
    del.addEventListener("click", () => {
      const parent = findParent(tree, node);
      if (parent) {
        parent.parts = parent.parts.filter((p) => p !== node);
        rerenderTree();
      }
    });
    delRow.appendChild(del);
    body.appendChild(delRow);
  }

  wrap.appendChild(body);
  return wrap;
}

function findParent(root, target) {
  if (root.kind !== "multipart") return null;
  for (const p of root.parts) {
    if (p === target) return root;
    const found = findParent(p, target);
    if (found) return found;
  }
  return null;
}

function rerenderTree() {
  const rootEl = $("#treeRoot");
  rootEl.innerHTML = "";
  reindexPaths(tree, "root");
  rootEl.appendChild(renderNode(tree, 0));
  // 结构/头部/CTE 的就地增删会改变附件列表，后台静默刷新
  scheduleAttachmentsRefresh();
}

// ---------------------------------------------------------------- actions --

function fillSample(ta, text) {
  $("#rawInput").value = text;
  const firstLine = text.split(/\r?\n/, 1)[0];
  if (/content-type\s*:/i.test(firstLine)) {
    const m = firstLine.match(/content-type\s*:\s*(.+)/i);
    if (m) $("#contentTypeInput").value = m[1].trim();
  } else {
    $("#contentTypeInput").value = "";
  }
  $("#boundaryInput").value = "";
}

async function doParse() {
  const raw = $("#rawInput").value;
  if (!raw.trim()) {
    alert("请先粘贴报文或载入示例");
    return;
  }
  $("#btnParse").disabled = true;
  try {
    const rawBytes = new TextEncoder().encode($("#rawInput").value);
    const data = await postJSON("/api/parse", {
      raw: $("#rawInput").value,
      rawBase64: bytesToB64(rawBytes),
      contentType: $("#contentTypeInput").value || null,
      boundary: $("#boundaryInput").value || null,
    });
    parseResult = data;
    tree = data.tree;
    setCounts(data.counts);
    attachmentItems = [];
    attachmentSelection.clear();
    $("#effectiveBoundary").textContent = data.effectiveBoundary ?? "—（无）";
    const metaBits = [];
    metaBits.push(`媒体类型 <b>${escapeHtml(data.mediaType || "—")}</b>`);
    metaBits.push(`原始大小 <b>${humanSize(tree.rawSize || 0)}</b>`);
    metaBits.push(`行结束 <b>${data.normalizedCrlf ? "已规范化为 CRLF" : "CRLF"}</b>`);
    metaBits.push(`顶层头部 <b>${data.hasTopHeaders ? "检测到" : "未检测到"}</b>`);
    $("#parseMeta").innerHTML = metaBits.join("　·　");

    $("#issuesCard").classList.remove("hidden");
    $("#treeCard").classList.remove("hidden");
    $("#attachmentsCard").classList.remove("hidden");
    $("#outputCard").classList.add("hidden");
    renderIssues($("#issuesList"), data.issues);
    rerenderTree();
    refreshAttachments();
  } catch (e) {
    alert("解析失败：" + e.message);
  } finally {
    $("#btnParse").disabled = false;
  }
}

async function doEncode(andDownload = true) {
  if (!tree) return;
  reindexPaths(tree, "root");
  $("#btnEncode").disabled = true;
  try {
    const data = await postJSON("/api/encode", {
      tree,
      includeHeaders: $("#includeHeaders").checked,
    });
    encodedBytes = b64ToBytes(data.payloadBase64);
    $("#outputCard").classList.remove("hidden");
    const ok = (data.counts?.error || 0) === 0;
    $("#encodeMeta").innerHTML =
      (ok ? "✅ 编码成功" : "⚠️ 编码完成但存在错误") +
      `　·　大小 <b>${humanSize(data.size)}</b>　·　行结束 <b>${data.lineEnding}</b>`;
    renderIssues($("#encodeIssues"), data.issues);
    const preview = bytesToText(encodedBytes);
    $("#outputPreview").value = preview;
    if (andDownload && ok) downloadBlob();
    if (!ok) {
      $("#outputCard").scrollIntoView({ behavior: "smooth" });
    }
  } catch (e) {
    alert("编码失败：" + e.message);
  } finally {
    $("#btnEncode").disabled = false;
  }
}

function bytesToText(bytes) {
  // 优先 UTF-8，失败按 latin-1
  try {
    return new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  } catch (_) {
    let s = "";
    for (const b of bytes) s += String.fromCharCode(b);
    return s;
  }
}

function currentFilename() {
  let name = ($("#filenameInput").value || "message.eml").trim();
  name = name.replace(/[\\/]/g, "_");
  return name;
}

function downloadBlob() {
  if (!encodedBytes) return;
  const blob = new Blob([encodedBytes], { type: "application/octet-stream" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = currentFilename();
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

async function copyOutput() {
  if (!encodedBytes) return;
  const text = bytesToText(encodedBytes);
  try {
    await navigator.clipboard.writeText(text);
    $("#btnCopy").textContent = "已复制";
    setTimeout(() => ($("#btnCopy").textContent = "复制为文本"), 1200);
  } catch (_) {
    const ta = $("#outputPreview");
    ta.classList.remove("hidden");
    ta.select();
    document.execCommand("copy");
  }
}

// ------------------------------------------------------- attachments zip --

let attachmentItems = [];        // /api/attachments 返回的附件描述符
const attachmentSelection = new Set();  // 勾选的叶子 path（跨刷新保留）
let attachmentsRefreshTimer = null;

function scheduleAttachmentsRefresh() {
  if ($("#attachmentsCard").classList.contains("hidden")) return;
  clearTimeout(attachmentsRefreshTimer);
  attachmentsRefreshTimer = setTimeout(refreshAttachments, 300);
}

const FILENAME_SOURCE_LABEL = {
  rfc2231: "RFC 2231 filename*",
  header: "filename 参数",
  path: "按节点路径命名",
};

async function refreshAttachments() {
  if (!tree) return;
  reindexPaths(tree, "root");
  try {
    const data = await postJSON("/api/attachments", { tree });
    attachmentItems = data.items || [];
    // 清理已不存在的勾选项
    const valid = new Set(attachmentItems.map((it) => it.path));
    for (const p of Array.from(attachmentSelection)) {
      if (!valid.has(p)) attachmentSelection.delete(p);
    }
    renderAttachments(data);
  } catch (e) {
    alert("附件列表获取失败：" + e.message);
  }
}

function renderAttachments(data) {
  const tbody = $("#attachmentsList");
  tbody.innerHTML = "";
  const items = data.items || [];
  for (const it of items) {
    const tr = document.createElement("tr");
    tr.className = it.exportable ? "att-exportable" : "att-blocked";

    const tdCheck = document.createElement("td");
    tdCheck.className = "col-check";
    const cb = document.createElement("input");
    cb.type = "checkbox";
    cb.dataset.path = it.path;
    cb.checked = it.exportable && attachmentSelection.has(it.path);
    cb.disabled = !it.exportable;
    cb.title = it.exportable ? "" : (it.reason || "不可导出");
    cb.addEventListener("change", () => {
      if (cb.checked) attachmentSelection.add(it.path);
      else attachmentSelection.delete(it.path);
      updateAttachmentToolbar();
    });
    tdCheck.appendChild(cb);
    tr.appendChild(tdCheck);

    const tdName = document.createElement("td");
    tdName.className = "col-name";
    if (it.exportable) {
      const sourceKey = FILENAME_SOURCE_LABEL[it.filenameSource] ? it.filenameSource : "header";
      tdName.innerHTML = `<span class="att-zipname">${escapeHtml(it.exportName)}</span>` +
        `<span class="att-src src-${sourceKey}">` +
        `${escapeHtml(FILENAME_SOURCE_LABEL[sourceKey])}</span>`;
      if (it.filename && it.filename !== it.exportName) {
        const orig = document.createElement("div");
        orig.className = "att-orig";
        orig.textContent = "原始文件名：" + it.filename;
        orig.title = "已按跨平台规则净化（去除路径分隔符/控制字符等）";
        tdName.appendChild(orig);
      }
    } else {
      tdName.innerHTML = `<span class="att-zipname muted">${escapeHtml(it.filename || "（无文件名）")}</span>`;
    }
    tr.appendChild(tdName);

    const tdPath = document.createElement("td");
    tdPath.className = "col-path";
    tdPath.textContent = it.path;
    tr.appendChild(tdPath);

    const tdDisp = document.createElement("td");
    tdDisp.className = "col-disp";
    const dispBits = [];
    if (it.disposition) {
      dispBits.push(`<span class="att-disp">${escapeHtml(it.disposition)}</span>`);
    }
    if (it.name != null) dispBits.push(`<span class="att-fieldname">name=${escapeHtml(it.name)}</span>`);
    tdDisp.innerHTML = dispBits.join("<br>") || '<span class="muted">—</span>';
    tr.appendChild(tdDisp);

    const tdSize = document.createElement("td");
    tdSize.className = "col-size";
    tdSize.textContent = it.exportable
      ? humanSize(it.size)
      : `原始 ${humanSize(it.wireSize || 0)}`;
    tr.appendChild(tdSize);

    const tdReason = document.createElement("td");
    tdReason.className = "col-reason";
    if (!it.exportable) {
      const div = document.createElement("div");
      div.className = "att-reason";
      div.textContent = "⛔ " + (it.reason || "不可导出");
      tdReason.appendChild(div);
    }
    if (it.filenameNote) {
      const note = document.createElement("div");
      note.className = "att-fn-note";
      note.textContent = "ℹ " + it.filenameNote;
      tdReason.appendChild(note);
    }
    if (!it.exportable && !it.reason && !it.filenameNote) {
      tdReason.textContent = "—";
    }
    tr.appendChild(tdReason);
    tbody.appendChild(tr);
  }
  if (!items.length) {
    const tr = document.createElement("tr");
    tr.innerHTML = '<td colspan="6" class="att-empty">当前报文树中没有附件叶子' +
      "（需要 Content-Disposition: attachment 或带 filename 参数的叶子）</td>";
    tbody.appendChild(tr);
  }
  updateAttachmentToolbar(data);
}

function selectedAttachmentItems() {
  return attachmentItems.filter((it) => it.exportable && attachmentSelection.has(it.path));
}

function updateAttachmentToolbar(data) {
  const items = (data && data.items) || attachmentItems;
  const exportable = items.filter((it) => it.exportable);
  const blocked = items.length - exportable.length;
  const selected = selectedAttachmentItems();
  const totalBytes = exportable.reduce((s, it) => s + (it.size || 0), 0);
  const selBytes = selected.reduce((s, it) => s + (it.size || 0), 0);
  const bits = [`共 <b>${items.length}</b> 个附件`,
                `可导出 <b>${exportable.length}</b>`];
  if (blocked) bits.push(`禁导 <b>${blocked}</b>`);
  bits.push(`合计 <b>${humanSize(totalBytes)}</b>`);
  if (selected.length) {
    bits.push(`已选 <b>${selected.length}</b> 个 / <b>${humanSize(selBytes)}</b>`);
  }
  $("#attachmentsMeta").innerHTML = bits.join("　·　");
  $("#btnDownloadZip").disabled = selected.length === 0;
  const selectAll = $("#selectAllAttachments");
  selectAll.checked = exportable.length > 0 &&
    exportable.every((it) => attachmentSelection.has(it.path));
  selectAll.indeterminate = selected.length > 0 && selected.length < exportable.length;
}

async function downloadAttachmentZip() {
  if (!tree) return;
  // 下载前用最新编辑状态重新计算（文件名/CTE/正文的就地修改一并生效）
  await refreshAttachments();
  const paths = selectedAttachmentItems().map((it) => it.path);
  if (!paths.length) {
    alert("请先勾选至少一个可导出附件");
    return;
  }
  $("#btnDownloadZip").disabled = true;
  const oldText = $("#btnDownloadZip").textContent;
  $("#btnDownloadZip").textContent = "打包中…";
  try {
    const res = await fetch("/api/attachments/zip", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ tree, paths }),
    });
    if (!res.ok) {
      let msg = `HTTP ${res.status}`;
      try {
        const j = await res.json();
        msg = j.error || msg;
      } catch (_) { /* ignore */ }
      throw new Error(msg);
    }
    const blob = await res.blob();
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = "attachments.zip";
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
    const skipped = res.headers.get("X-Attachment-Skipped");
    if (skipped && skipped !== "0") {
      alert(`有 ${skipped} 个所选附件因当前不可导出被跳过（详见列表）。`);
    }
  } catch (e) {
    alert("ZIP 下载失败：" + e.message);
  } finally {
    $("#btnDownloadZip").textContent = oldText;
    updateAttachmentToolbar();
  }
}

// --------------------------------------------------------- sample compare --

function countParts(node) {
  let n = 0;
  (function walk(nd) {
    (nd.parts || []).forEach((c) => { n += 1; walk(c); });
  })(node || {});
  return n;
}

function loadSamples() {
  for (const slot of ["a", "b"]) {
    try {
      const raw = localStorage.getItem("mime-sample-" + slot);
      if (raw) SAMPLES[slot] = JSON.parse(raw);
    } catch (_) { /* 损坏的数据直接忽略 */ }
  }
}

function persistSample(slot) {
  try {
    if (SAMPLES[slot]) {
      localStorage.setItem("mime-sample-" + slot, JSON.stringify(SAMPLES[slot]));
    } else {
      localStorage.removeItem("mime-sample-" + slot);
    }
  } catch (_) {
    alert("样本过大，无法写入 localStorage；仅在当前页面有效。");
  }
}

function invalidateDiff() {
  diffResult = null;
  $("#diffResult").classList.add("hidden");
  $("#btnExportDiff").disabled = true;
  $("#diffMeta").textContent = "";
}

function saveSample(slot) {
  if (!tree) {
    alert("请先解析报文，再保存为样本");
    return;
  }
  reindexPaths(tree, "root");
  SAMPLES[slot] = {
    tree: JSON.parse(JSON.stringify(tree)),   // 深拷贝快照，后续编辑不影响样本
    issues: (parseResult && parseResult.issues) || [],
    counts: (parseResult && parseResult.counts) || null,
    mediaType: (parseResult && parseResult.mediaType) || tree.mediaType || null,
    savedAt: Date.now(),
  };
  persistSample(slot);
  invalidateDiff();
  renderSlots();
}

function clearSample(slot) {
  SAMPLES[slot] = null;
  persistSample(slot);
  invalidateDiff();
  renderSlots();
}

function renderSlots() {
  for (const slot of ["a", "b"]) {
    const el = $(slot === "a" ? "#slotA" : "#slotB");
    const meta = $(".slot-meta", el);
    const s = SAMPLES[slot];
    el.classList.toggle("filled", !!s);
    if (!s) {
      meta.textContent = `空 — 解析报文后点击「存为样本 ${slot.toUpperCase()}」`;
    } else {
      const c = s.counts || {};
      const time = new Date(s.savedAt).toLocaleString();
      meta.textContent =
        `${s.mediaType || "未知类型"} · ${countParts(s.tree)} 个部分 · ` +
        `诊断 ${c.error || 0}错/${c.warning || 0}警/${c.info || 0}提示 · 保存于 ${time}`;
    }
  }
  $("#btnCompare").disabled = !(SAMPLES.a && SAMPLES.b);
}

async function doCompare() {
  if (!SAMPLES.a || !SAMPLES.b) return;
  $("#btnCompare").disabled = true;
  try {
    const data = await postJSON("/api/diff", {
      a: { tree: SAMPLES.a.tree, issues: SAMPLES.a.issues || [] },
      b: { tree: SAMPLES.b.tree, issues: SAMPLES.b.issues || [] },
    });
    diffResult = data;
    renderDiff(data);
    $("#btnExportDiff").disabled = false;
  } catch (e) {
    alert("对比失败：" + e.message);
  } finally {
    $("#btnCompare").disabled = false;
  }
}

function renderDiff(data) {
  const s = data.summary || {};
  $("#cntAdded").textContent = s.added || 0;
  $("#cntRemoved").textContent = s.removed || 0;
  $("#cntModified").textContent = s.modified || 0;
  $("#cntUnchanged").textContent = s.unchanged || 0;
  $("#diffMeta").innerHTML =
    `新增 <b>${s.added || 0}</b> · 删除 <b>${s.removed || 0}</b> · ` +
    `修改 <b>${s.modified || 0}</b> · 未变化 <b>${s.unchanged || 0}</b>`;
  $("#diffResult").classList.remove("hidden");

  const changeMap = {};
  for (const e of data.entries || []) if (e.path) changeMap[e.path] = e.change;

  renderDiffList(data.entries || []);
  renderDiffTree("#diffTreeA", SAMPLES.a.tree, changeMap);
  renderDiffTree("#diffTreeB", SAMPLES.b.tree, changeMap);
  $("#diffResult").scrollIntoView({ behavior: "smooth", block: "start" });
}

function renderDiffList(entries) {
  const list = $("#diffList");
  list.innerHTML = "";
  const shown = entries.filter((e) => diffFilter[e.change] !== false);
  if (!shown.length) {
    const li = document.createElement("li");
    li.className = "diff-empty";
    li.textContent = "当前筛选下没有差异条目";
    list.appendChild(li);
    return;
  }
  for (const e of shown) list.appendChild(renderDiffEntry(e));
}

function briefText(s, prefix) {
  if (!s) return prefix;
  const bits = [s.mediaType || "?", `${s.descendantParts || 0} 个后代部分`,
                `${s.headers || 0} 条头部`, humanSize(s.rawSize || 0)];
  return `${prefix} · ${bits.join(" · ")}`;
}

function summarizeFields(e) {
  if (e.change === "added") return briefText(e.summary, "仅存在于样本 B");
  if (e.change === "removed") return briefText(e.summary, "仅存在于样本 A");
  if (e.change === "unchanged") return "一致";
  return (e.fields || []).map((f) => {
    if (f.field === "headers") {
      return `头部 +${f.added.length}/-${f.removed.length}${f.reordered ? "·仅顺序" : ""}`;
    }
    if (f.field === "issues") return `诊断 +${f.added.length}/-${f.removed.length}`;
    return f.label;
  }).join(" · ");
}

function renderDiffEntry(e) {
  const li = document.createElement("li");
  li.className = `diff-entry chg-${e.change} collapsed`;
  const isGlobal = !e.path;

  const bar = document.createElement("div");
  bar.className = "diff-entry-bar";
  bar.innerHTML =
    `<span class="caret">▼</span>` +
    `<span class="chg-badge ${e.change}">${CHANGE_LABEL[e.change] || e.change}</span>` +
    `<span class="diff-path">${isGlobal ? "（全局诊断）" : escapeHtml(e.path)}</span>` +
    `<span class="diff-fields-summary">${escapeHtml(summarizeFields(e))}</span>` +
    `<span class="node-spacer"></span>`;
  if (!isGlobal) {
    if (e.change !== "added") bar.appendChild(locateBtn("a", e.path));
    if (e.change !== "removed") bar.appendChild(locateBtn("b", e.path));
  }
  bar.addEventListener("click", (ev) => {
    if (ev.target.closest("button")) return;
    li.classList.toggle("collapsed");
  });
  li.appendChild(bar);

  const body = document.createElement("div");
  body.className = "diff-entry-body";
  if (e.change === "added" || e.change === "removed") {
    const brief = document.createElement("div");
    brief.className = "hint diff-brief";
    brief.textContent = summarizeFields(e) + "（整棵子树已折叠为一条）";
    body.appendChild(brief);
  }
  for (const f of e.fields || []) body.appendChild(renderField(f));
  if (!(e.fields || []).length && e.change !== "added" && e.change !== "removed") {
    body.innerHTML = '<div class="hint">无字段级差异</div>';
  }
  li.appendChild(body);
  return li;
}

function valHtml(v) {
  if (!v || v.text == null) return '<span class="trunc-note">（无）</span>';
  const t = escapeHtml(v.text);
  return v.truncated
    ? `${t}<span class="trunc-note"> …（已截断，共 ${v.length} 字符）</span>` : t;
}

function renderField(f) {
  const div = document.createElement("div");
  div.className = "diff-field";
  if (f.field === "headers") {
    let html = `<div class="diff-field-label">头部（A ${f.aCount} 条 / B ${f.bCount} 条）</div>`;
    for (const line of f.removed) html += `<div class="hdr-line del">− ${escapeHtml(line)}</div>`;
    for (const line of f.added) html += `<div class="hdr-line add">+ ${escapeHtml(line)}</div>`;
    if (f.reordered) html += `<div class="hint">头部内容一致，仅顺序不同</div>`;
    div.innerHTML = html;
    return div;
  }
  if (f.field === "issues") {
    let html = `<div class="diff-field-label">${escapeHtml(f.label)}</div><div class="issue-diff">`;
    for (const c of f.removed) html += `<span class="issue-pill del">− ${escapeHtml(c)}</span>`;
    for (const c of f.added) html += `<span class="issue-pill add">+ ${escapeHtml(c)}</span>`;
    html += "</div>";
    div.innerHTML = html;
    return div;
  }
  const table = document.createElement("table");
  table.className = "diff-field-table";
  table.innerHTML =
    `<tr><th rowspan="2">${escapeHtml(f.label)}</th>` +
    `<td><span class="side-tag">A</span> <span class="diff-val old">${valHtml(f.a)}</span></td></tr>` +
    `<tr><td><span class="side-tag">B</span> <span class="diff-val new">${valHtml(f.b)}</span></td></tr>`;
  div.appendChild(table);
  return div;
}

function renderDiffTree(sel, sampleTree, changeMap) {
  const el = $(sel);
  el.innerHTML = "";
  if (!sampleTree) {
    el.textContent = "（空）";
    return;
  }
  el.appendChild(renderRoNode(sampleTree, changeMap));
}

function renderRoNode(node, changeMap) {
  const wrap = document.createElement("div");
  wrap.className = "ro-node";
  wrap.dataset.diffPath = node.path || "";
  const change = changeMap[node.path];
  if (change && change !== "unchanged") wrap.classList.add("chg-" + change);
  const hasKids = node.kind === "multipart" && (node.parts || []).length > 0;
  const cteBadge = node.kind === "multipart" ? "" :
    `<span class="cte-badge ${cteStateClass(node)}" title="${escapeHtml(DECODE_STATE_LABEL[node.decodeState] || "")}">` +
    `${escapeHtml(node.transferEncoding || "7bit")}</span>`;
  const bar = document.createElement("div");
  bar.className = "ro-bar";
  bar.innerHTML =
    `<span class="caret">${hasKids ? "▼" : "·"}</span>` +
    `<span class="badge ${node.kind === "multipart" ? "multipart" : ""}">` +
    `${escapeHtml(node.mediaType || "?")}</span>` +
    cteBadge +
    `<span class="node-title">${escapeHtml(node.path || "")}</span>` +
    (change && change !== "unchanged"
      ? `<span class="chg-tag tag-${change}">${CHANGE_LABEL[change]}</span>` : "");
  if (hasKids) {
    bar.addEventListener("click", () => wrap.classList.toggle("collapsed"));
    const kids = document.createElement("div");
    kids.className = "ro-kids";
    node.parts.forEach((c) => kids.appendChild(renderRoNode(c, changeMap)));
    wrap.appendChild(bar);
    wrap.appendChild(kids);
  } else {
    wrap.appendChild(bar);
  }
  return wrap;
}

function locateBtn(slot, path) {
  const b = document.createElement("button");
  b.className = "btn btn-sm locate-btn";
  b.type = "button";
  b.textContent = slot.toUpperCase();
  b.title = `在样本 ${slot.toUpperCase()} 结构树中定位该节点`;
  b.addEventListener("click", (ev) => {
    ev.stopPropagation();
    locateNode(slot, path);
  });
  return b;
}

function locateNode(slot, path) {
  const panel = $(slot === "a" ? "#diffTreeA" : "#diffTreeB");
  const el = panel.querySelector(`[data-diff-path="${path}"]`);
  if (!el) return;
  // 展开所有祖先节点
  let p = el.parentElement;
  while (p && p !== panel) {
    if (p.classList && p.classList.contains("ro-node")) p.classList.remove("collapsed");
    p = p.parentElement;
  }
  el.scrollIntoView({ behavior: "smooth", block: "center" });
  el.classList.remove("flash");
  void el.offsetWidth;   // 重新触发高亮动画
  el.classList.add("flash");
  setTimeout(() => el.classList.remove("flash"), 1600);
}

function exportDiff() {
  if (!diffResult) return;
  const metaOf = (s) => s ? {
    mediaType: s.mediaType,
    savedAt: new Date(s.savedAt).toISOString(),
    parts: countParts(s.tree),
    counts: s.counts || null,
  } : null;
  const report = {
    tool: "mime-multipart-inspector",
    report: "sample-diff",
    version: 1,
    generatedAt: new Date().toISOString(),
    sampleA: metaOf(SAMPLES.a),
    sampleB: metaOf(SAMPLES.b),
    summary: diffResult.summary,
    entries: diffResult.entries,
  };
  const blob = new Blob([JSON.stringify(report, null, 2)], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = "mime-diff-report.json";
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

// ----------------------------------------------------------------- init --
function init() {
  $("#btnParse").addEventListener("click", doParse);
  $("#btnEncode").addEventListener("click", () => doEncode(true));
  $("#btnDownload").addEventListener("click", downloadBlob);
  $("#btnCopy").addEventListener("click", copyOutput);
  $("#showOutput").addEventListener("change", (e) => {
    $("#outputPreview").classList.toggle("hidden", !e.target.checked);
  });
  $("#btnSampleBasic").addEventListener("click", () => {
    fillSample($("#rawInput"), SAMPLE_BASIC);
  });
  $("#btnSampleNested").addEventListener("click", () => {
    fillSample($("#rawInput"), SAMPLE_NESTED);
  });
  $("#btnSampleBad").addEventListener("click", () => {
    fillSample($("#rawInput"), SAMPLE_BAD);
  });
  $$(".issue-filters .chip").forEach((chip) => {
    chip.addEventListener("click", () => {
      const lvl = chip.dataset.level;
      issueFilter[lvl] = !issueFilter[lvl];
      chip.classList.toggle("active", issueFilter[lvl]);
      if (parseResult) renderIssues($("#issuesList"), parseResult.issues);
    });
  });
  // 样本对比
  $("#btnSaveA").addEventListener("click", () => saveSample("a"));
  $("#btnSaveB").addEventListener("click", () => saveSample("b"));
  $$(".slot-clear").forEach((b) => {
    b.addEventListener("click", () => clearSample(b.dataset.slot));
  });
  $("#btnCompare").addEventListener("click", doCompare);
  $("#btnExportDiff").addEventListener("click", exportDiff);
  // 附件提取
  $("#btnRefreshAttachments").addEventListener("click", refreshAttachments);
  $("#btnDownloadZip").addEventListener("click", downloadAttachmentZip);
  $("#selectAllAttachments").addEventListener("change", (e) => {
    for (const it of attachmentItems) {
      if (!it.exportable) continue;
      if (e.target.checked) attachmentSelection.add(it.path);
      else attachmentSelection.delete(it.path);
    }
    renderAttachments({ items: attachmentItems });
  });
  $$(".diff-filters .chip").forEach((chip) => {
    chip.addEventListener("click", () => {
      const c = chip.dataset.change;
      diffFilter[c] = !diffFilter[c];
      chip.classList.toggle("active", diffFilter[c]);
      if (diffResult) renderDiffList(diffResult.entries || []);
    });
  });
  loadSamples();
  renderSlots();
  // 默认载入表单示例，打开即可体验
  fillSample($("#rawInput"), SAMPLE_BASIC);
}

document.addEventListener("DOMContentLoaded", init);
