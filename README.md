# MIME Multipart 报文检查器

基于 **FastAPI + 原生 HTML/CSS/JavaScript** 的 MIME `multipart/*` 报文解析、
查看、编辑与重新编码工具。严格按 **RFC 2045 / 2046** 处理：

- 🔍 **解析**：粘贴 `Content-Type`、`boundary` 和原始报文，自动识别
  *完整 MIME 报文*（含顶层头部）或 *仅 multipart body*；
- 🪆 **嵌套 multipart**：递归解析 `multipart/mixed`、`multipart/alternative`、
  `multipart/form-data` 等任意 `multipart/*`；
- 📐 **CRLF 边界**：识别 `CRLF "--boundary"` 起始定界符与
  `"--boundary--"` 关闭定界符，校验 transport padding、preamble/epilogue、
  缺关闭定界符、报文截断等；
- 📝 **引号参数**：正确解析 Content-Type 中带引号的 `boundary` 参数、
  分号与反斜杠转义（如 `boundary="a;b"`、`charset="utf\"-8"`）；
- 🔡 **Content-Transfer-Encoding 语义**：按 RFC 2045 识别叶子部分的
  `base64`、`quoted-printable`、`7bit`、`8bit` 与 `binary`，把传输正文
  **解码为可编辑内容**并保留原始编码信息；可在前端切换
  base64 / quoted-printable 后重新编码下载（遵守 76 字符 MIME 折行）。
  畸形编码产生**带节点路径**的诊断且不丢失原始载荷，未编辑节点逐字节稳定；
- 🩺 **诊断面板**：按 *错误 / 警告 / 提示* 三级列出每个解析问题及所属部分路径；
- ✏️ **可视化编辑**：逐层展开/折叠，编辑任意部分的头部、正文、boundary、
  preamble / epilogue，可新增或删除部分；
- 🔁 **重新编码并下载**：按（可能已修改的）boundary 规则以 CRLF 重新生成报文，
  按头部声明回写 Content-Transfer-Encoding（base64/QP 自动折行），
  可选择是否包含顶层头部；未修改的部分逐字节还原（含二进制）。
- 🆚 **样本对比**：把两份解析结果存为样本 A / B（保存在浏览器 localStorage），
  按树路径对齐比较媒体类型、头部、正文编码、boundary、序言/尾注与诊断代码；
  差异以可展开的新增/删除/修改清单展示，点击条目即可在两侧结构树中定位节点，
  并可导出 JSON 差异报告。
- 📎 **附件提取与 ZIP 下载**：从当前（可能已编辑的）树中递归列出
  `Content-Disposition: attachment` 或带 `filename` 参数的叶子，展示
  *节点路径 / 文件名 / CTE 解码后字节数 / 不可导出原因*，勾选后一键打包为
  ZIP 下载。文件名按 **RFC 2231** 解析（`filename*` 与 `filename*0*` 分段
  优先于普通 `filename`，非法扩展值回退普通值，无文件名时按节点路径命名），
  统一净化路径分隔符与控制字符、重名自动加序号；畸形或未知 CTE 的
  **未编辑**叶子禁导并说明原因。

---

## 快速开始（Docker）

```bash
docker compose up --build
```

启动后用浏览器访问：

> **http://localhost:8000**

停止：

```bash
docker compose down
```

## 不使用 Compose（docker）

```bash
docker build -t mime-inspector .
docker run --rm -p 8000:8000 mime-inspector
# 浏览器打开 http://localhost:8000
```

## 本地开发（Python 3.11+）

```bash
python3 -m venv .venv
source .venv/bin/activate
pip install -r requirements.txt
uvicorn app.main:app --reload --port 8000
```

访问 http://localhost:8000 ；交互式 API 文档在
http://localhost:8000/docs 。

---

## 使用说明

1. 在顶部选择一个内置示例（**表单 / 嵌套 / 错误报文**），或直接粘贴：
   - **Content-Type**（可选）：例如
     `multipart/form-data; boundary="----xyz"`；留空则从报文头部读取；
   - **boundary**（可选）：单独填写，会覆盖 Content-Type 中的参数（可带引号）；
   - **原始报文**：完整 MIME 报文或 multipart body 均可，支持 CRLF / LF。
2. 点击 **解析报文**，查看诊断信息与树形结构。
3. 展开任意 multipart 节点，修改 boundary、头部、正文、preamble/epilogue，
   或增删子部分。
4. 在叶子节点上通过 **Content-Transfer-Encoding** 下拉框切换
   `7bit / 8bit / binary / base64 / quoted-printable`：
   - 解析时若头部声明为 `base64` 或 `quoted-printable`，正文框展示的是
     **解码后内容**，可直接编辑；节点标题旁的 `CTE:` 徽章与下拉框右侧的
     状态胶囊显示编码方式与解码状态（原始 / 解码成功 / 畸形 / 未知透传）；
   - 切换编码或修改正文后，点击 **重新编码并下载**，后端按所选 CTE 回写
     并遵守 MIME 折行规则（base64 与 quoted-printable 每行不超过 76 字符，
     以 CRLF 折行），同时同步 Content-Transfer-Encoding 头部；
   - **未编辑**的节点（含畸形 base64/QP）始终回写解析时保存的原始传输字节，
     保证逐字节稳定；原始载荷保存在节点的 `rawBodyBase64` 字段中，不会丢失。
5. 勾选/取消“编码时包含顶层头部”，点击 **重新编码并下载**。
6. 在结果区可重新下载、复制为文本，或查看编码后的完整报文。
7. **样本对比**（页面底部「4. 样本对比」卡片）：
   - 解析一份报文后点击结构区右上角的 **存为样本 A**；再解析（或编辑后重新解析）
     另一份报文，点击 **存为样本 B**。样本保存在浏览器 localStorage，刷新不丢失；
   - 点击 **开始对比**，查看按树路径对齐的差异清单（新增 / 删除 / 修改 / 未变化，
     可点击徽章筛选），展开条目查看字段级 A/B 对照；
   - 点击条目右侧的 **A** / **B** 按钮，在下方对应的只读结构树中高亮定位该节点；
   - 点击 **导出 JSON 差异报告** 下载 `mime-diff-report.json`。
8. **附件提取与 ZIP 下载**（页面「3. 附件提取与 ZIP 下载」卡片）：
   - 解析后自动递归列出附件叶子：`Content-Disposition: attachment`，或任意
     disposition 带 `filename` / `filename*` 参数（典型 form-data 文件上传）；
   - 每行显示 ZIP 内文件名（带命名来源徽标：**RFC 2231 filename*** /
     **filename 参数** / **按节点路径命名**）、节点路径、disposition 与
     form-data `name`、CTE 解码后字节数，以及禁导原因/文件名回退说明；
   - 勾选一个或多个可导出附件（或用「全选可导出项」），点击
     **下载所选为 ZIP** 即可得到 `attachments.zip`；
   - 在树中修改头部、正文或切换 CTE 后，点击列表旁的「刷新列表」（或直接
     点下载，会先用最新编辑状态重新计算），附件列表随之更新。

> 附件导出的字节规则：使用 **Content-Transfer-Encoding 解码后** 的字节；
> 在页面上被编辑（正文改动或 CTE 切换）的叶子取**编辑后**的内容。
> 未编辑叶子若 `decodeState` 为 `malformed`（畸形 base64/quoted-printable）
> 或 `passthrough`（未知 CTE），其解码结果不可信，将**禁止导出**并在
> 「不可导出原因」列说明；在树中编辑该叶子（或切换到受支持的 CTE）后
> 即可导出。

> 不是合法 UTF-8 的正文（如二进制附件）会以 **base64 编辑通道** 呈现；
> 只要不修改，重新编码时会逐字节还原。注意区分两个层面的编码：
> **Content-Transfer-Encoding**（MIME 传输编码，记录在
> `transferEncoding` 字段）与**编辑通道**（`bodyEncoding`，仅表示
> 前后端 JSON 中该正文以 utf-8 文本还是 base64 承载）。

### 附件文件名规则（RFC 2183 / RFC 2231）

* 同时存在普通 `filename` 与扩展参数时，**扩展值优先**：
  单个 `filename*=charset'lang'%XX%XX`，或分段 `filename*0*` /
  `filename*1`（续段允许省略末尾 `*`）；分段必须从 0 连续编号，
  首段携带 `charset'lang'` 前缀，拼接后统一按该 charset 解码
  （允许多字节字符跨分段边界）；
* 扩展值结构非法、charset 不支持、百分号转义错误或字节无法解码时，
  **回退普通 `filename`**，并在附件列表与叶子字段
  （`filenameNote`）中说明原因；
* 两者都没有时按**节点路径**命名（如 `parts[1].parts[0].bin`）；
* 文件名统一做跨平台净化：删除控制字符，把 `/ \ : * ? " < > |`
  替换为下划线，去除结尾点与空格，规避 Windows 保留设备名
  （`CON`、`PRN`、`COM1`…）；重名按树的先序遍历顺序追加
  `(1)`、`(2)` 序号，保证 ZIP 内条目名唯一且不含目录穿越。

---

## 解析规则与诊断代码

解析器采用“尽量恢复、绝不轻易失败”的策略：能继续解析的问题记录为 issue，
而不是中断。常见诊断：

| 代码 | 级别 | 含义 |
| --- | --- | --- |
| `NO_DELIMITER` | 错误 | 正文中找不到任何 `--boundary` |
| `MISSING_CLOSE_DELIMITER` | 错误 | 缺少 `--boundary--`，报文可能被截断 |
| `TRUNCATED_PART` | 错误 | 某部分之后缺少结束该部分的 CRLF |
| `BAD_DELIMITER` | 错误 | 定界符后存在非法字符，或出现碰撞文本 |
| `MISSING_BOUNDARY` | 错误 | `multipart/*` 的 Content-Type 无 boundary 参数 |
| `BOUNDARY_COLLISION` | 错误 | （编码时）正文行首出现本层定界符，会截断报文 |
| `BAD_HEADER_LINE` / `BAD_HEADER_NAME` | 错误 | 头部缺少冒号 / 字段名非法 |
| `BAD_QUOTED_STRING` / `BAD_PARAM_SYNTAX` | 错误 | 引号未闭合 / 参数语法错误 |
| `LF_NORMALIZED` | 警告 | 输入含孤立 LF/CR，已规范化为 CRLF |
| `BOUNDARY_NONCOMPLIANT` | 警告 | boundary 超过 70 字符或含非法字符 |
| `BOUNDARY_OVERRIDE` | 警告 | 输入框/Content-Type 中的 boundary 不一致 |
| `TRAILING_PADDING` | 警告 | 定界符后存在 transport padding 空白 |
| `NO_LEADING_CRLF` | 提示 | 首定界符前无 CRLF（HTTP multipart 常见） |
| `PREAMBLE` / `EPILOGUE` | 提示 | 存在序言 / 尾注，MIME 处理器应忽略 |
| `BINARY_BODY` | 提示 | 该部分为非文本，已按 base64 呈现 |
| `BAD_CTE_SYNTAX` | 警告 | Content-Transfer-Encoding 头不是单个合法 token（含多余参数），已原样透传 |
| `UNKNOWN_TRANSFER_ENCODING` | 警告 | 未知/非标准 CTE（如 `x-uuencode`），正文按原始字节透传 |
| `CTE_NOT_7BIT` / `CTE_BINARY_IN_8BIT` | 警告 | 声明 7bit 却含非 ASCII/控制字节，或 8bit 中混入 NUL 等 |
| `CTE_BARE_NEWLINE` | 警告 | 7bit/8bit/QP 正文含孤立 CR/LF（RFC 要求 CRLF） |
| `CTE_LONG_LINE` | 警告 | base64/QP 编码行超过 76 字符折行限制 |
| `CTE_TRAILING_WSP` | 警告 | QP 硬换行前的空格/制表符未编码为 `=20`/`=09` |
| `BAD_BASE64` | 警告 | base64 含非法字符/错误 padding，已剔除/补齐后尽力解码（状态 `malformed`） |
| `BAD_QUOTED_PRINTABLE` | 警告 | QP 含非法 `=XX` 转义，已按字面保留（状态 `malformed`，载荷不丢） |
| `BAD_CTE_ON_MULTIPART` | 警告 | multipart 实体只能使用 7bit/8bit/binary，已忽略该 CTE |
| `CTE_HEADER_ADDED` | 提示 | 切换到 base64/QP 等编码时自动添加 Content-Transfer-Encoding 头 |

### Content-Transfer-Encoding 语义（RFC 2045 §6）

- **识别**：叶子部分的 `Content-Transfer-Encoding` 头（不区分大小写）
  支持 `7bit`、`8bit`、`binary`、`base64`、`quoted-printable`；缺省视为 `7bit`。
  值非法或未知时记录诊断并**原样透传**，不做破坏性转换。
- **解码**：`base64` / `quoted-printable` 正文被解码为编辑内容
  （再按是否合法 UTF-8 决定编辑通道 `bodyEncoding`）。畸形数据尽力恢复，
  诊断消息带节点路径（如 `parts[1].parts[0]：base64 正文含非法字符…`），
  节点 `decodeState` 标为 `malformed`；原始传输体始终保留在 `rawBodyBase64`。
- **重新编码**：按节点的 `transferEncoding`（即头部声明）回写：
  base64 与 quoted-printable 自动按 **76 字符** 折行（CRLF），
  QP 中 `=`、非 ASCII、控制字节转义为 `=XX`，硬换行前的 WSP 编码为
  `=20`/`=09`，孤立 CR/LF 转义以避免裸换行；同时同步头部。
- **字节稳定**：未编辑（`bodyEdited` 非真、CTE 未切换）的节点直接回写
  `rawBodyBase64` 保存的原始传输体，即使原始编码畸形也逐字节还原。

---

## HTTP API

### `POST /api/parse`

请求：

```json
{
  "raw": "Content-Type: multipart/form-data; boundary=B\r\n\r\n--B\r\n\r\nv\r\n--B--",
  "rawBase64": "...(可选，二进制无损通道，优先于 raw)...",
  "contentType": "multipart/form-data; boundary=B",
  "boundary": "B"
}
```

响应（节选）：

```json
{
  "ok": true,
  "mediaType": "multipart/form-data",
  "effectiveBoundary": "B",
  "hasTopHeaders": true,
  "counts": { "error": 0, "warning": 0, "info": 0 },
  "issues": [ { "level": "warning", "code": "LF_NORMALIZED", "message": "..." } ],
  "tree": {
    "kind": "multipart",
    "mediaType": "multipart/form-data",
    "boundary": "B",
    "leadingCrlf": false,
    "headers": [ { "name": "Content-Type", "value": "..." } ],
    "preamble": "", "preambleEncoding": "utf-8",
    "epilogue": "", "epilogueEncoding": "utf-8",
    "parts": [ {
      "kind": "part",
      "mediaType": "text/plain",
      "headers": [],
      "hasHeaders": false,
      "body": "v",
      "bodyEncoding": "utf-8",
      "transferEncoding": "7bit",
      "transferEncodingDeclared": "7bit",
      "decodeState": "raw",
      "rawBodyBase64": "dg=="
    } ]
  }
}
```

### `POST /api/encode`

请求：

```json
{ "tree": { /* /api/parse 返回的 tree，可修改 */ }, "includeHeaders": true }
```

响应（叶子节点 CTE 字段说明）：

叶子节点与 Content-Transfer-Encoding 相关的字段（`/api/parse` 返回，
可在 tree 中修改后回传 `/api/encode`）：

| 字段 | 含义 |
| --- | --- |
| `transferEncoding` | 当前生效 CTE：`7bit`/`8bit`/`binary`/`base64`/`quoted-printable`，或非标准透传值 |
| `transferEncodingDeclared` | 解析时头部声明的 CTE；与 `transferEncoding` 相同且未编辑时走字节稳定快速路径 |
| `decodeState` | `raw`（7/8bit/binary 原样）/ `decoded`（base64、QP 解码成功）/ `malformed`（畸形已尽力恢复）/ `passthrough`（未知 CTE） |
| `rawBodyBase64` | **未做 CTE 解码的原始传输体**；未编辑节点重新编码时原样回写，保证载荷不丢 |
| `body` / `bodyEncoding` | CTE 解码后的可编辑内容，及其编辑通道（`utf-8` 文本或 `base64` 二进制通道） |
| `bodyEdited` | 前端在正文被修改或 CTE 切换时置 `true`；缺省/为假时节点视为未编辑 |
| `disposition` | Content-Disposition 的 disposition token（小写），如 `attachment` / `form-data` |
| `filename` | 按 RFC 2231 优先级解析出的文件名（`filename*`/分段优先，非法回退普通值）；无文件名参数为 `null` |
| `filenameExtended` | 文件名是否来自 RFC 2231 扩展参数 |
| `filenameNote` | 文件名相关非致命说明（如扩展值非法已回退普通 filename） |

```json
{
  "ok": true,
  "payloadBase64": "Q29udGVudC1UeXBlOi...",
  "size": 123,
  "lineEnding": "CRLF",
  "counts": { "error": 0, "warning": 0, "info": 0 },
  "issues": []
}
```

### `POST /api/diff`

样本对比：按树路径对齐比较两份解析结果。请求中的 `tree` / `issues`
直接取自两次 `POST /api/parse` 的响应（`issues` 可省略，省略则不对比诊断代码）。

请求：

```json
{
  "a": { "tree": { /* 样本 A 的 tree */ }, "issues": [ /* 样本 A 的 issues */ ] },
  "b": { "tree": { /* 样本 B 的 tree */ }, "issues": [ /* 样本 B 的 issues */ ] }
}
```

响应（节选）：

```json
{
  "ok": true,
  "summary": { "added": 1, "removed": 0, "modified": 2, "unchanged": 3 },
  "previewLimit": 400,
  "entries": [
    {
      "path": "root",
      "kind": "multipart",
      "change": "modified",
      "fields": [
        { "field": "boundary", "label": "boundary",
          "a": { "text": "AA", "truncated": false, "length": 2 },
          "b": { "text": "BB", "truncated": false, "length": 2 } },
        { "field": "headers", "label": "头部",
          "added": ["X-New: 1"], "removed": [], "reordered": false,
          "aCount": 1, "bCount": 2 },
        { "field": "issues", "label": "诊断代码",
          "added": ["PREAMBLE"], "removed": [] }
      ]
    },
    {
      "path": "parts[2]",
      "kind": "part",
      "change": "added",
      "summary": { "mediaType": "application/json", "rawSize": 42,
                   "descendantParts": 0, "headers": 1 },
      "fields": []
    }
  ]
}
```

说明：

- `change` 取值：`added`（仅 B 有）/ `removed`（仅 A 有）/ `modified` / `unchanged`；
  增删的子树整体折叠为一条，`summary.descendantParts` 给出后代部分数量；
- `path` 为 `""` 的条目表示**全局诊断**变化（如 `LF_NORMALIZED` 这类不归属
  任何节点的 issue）；
- 长文本字段（正文、序言/尾注）以预览形式返回，`truncated: true` 时
  `length` 为完整长度（上限见 `previewLimit`）。

### `POST /api/attachments`

递归列出当前树（`/api/parse` 返回、可能已在前端编辑过的 tree）中的附件叶子。

请求：

```json
{ "tree": { /* /api/parse 返回的 tree，可含编辑 */ } }
```

响应（节选）：

```json
{
  "ok": true,
  "total": 3,
  "exportableCount": 2,
  "totalBytes": 312,
  "items": [
    {
      "path": "parts[0]",
      "disposition": "attachment",
      "name": null,
      "filename": "réport.csv",
      "filenameSource": "rfc2231",
      "filenameNote": null,
      "mediaType": "text/csv",
      "size": 12,
      "wireSize": 18,
      "exportable": true,
      "reason": null,
      "exportName": "réport.csv"
    },
    {
      "path": "parts[1]",
      "filename": "broken.bin",
      "filenameSource": "header",
      "size": null,
      "wireSize": 17,
      "exportable": false,
      "reason": "该叶子的 Content-Transfer-Encoding（base64）正文存在畸形…",
      "exportName": null
    }
  ]
}
```

字段说明：

| 字段 | 含义 |
| --- | --- |
| `filenameSource` | `rfc2231`（`filename*`/分段扩展值）/ `header`（普通 `filename`）/ `path`（无文件名，按节点路径命名） |
| `filenameNote` | RFC 2231 非法扩展值回退等非致命说明 |
| `size` | CTE 解码后（已编辑叶子为编辑后）的字节数；禁导时为 `null` |
| `wireSize` | 未做 CTE 解码的原始传输体字节数（禁导行仍可显示大小） |
| `exportable` / `reason` | 是否可导出及不可导出原因（未编辑且 `malformed`/`passthrough`） |
| `exportName` | 净化、重名加序号后的 ZIP 内文件名（仅可导出时非空） |

### `POST /api/attachments/zip`

把勾选附件打包为 ZIP（`application/zip`），内容为各叶子 CTE 解码后
（已编辑为编辑后）的字节。`paths` 为叶子 `path` 列表，省略或为空时
导出全部可导出附件；被勾选但当前不可导出的叶子会被跳过，数量见响应头
`X-Attachment-Skipped`。没有任何可导出项时返回 `409`。

请求：

```json
{ "tree": { /* 同 /api/attachments */ }, "paths": ["parts[0]", "parts[2]"] }
```

### `GET /api/health`

返回 `{"ok": true}`，供容器健康检查使用。

---

## 项目结构

```
.
├── app/
│   ├── __init__.py
│   ├── main.py              # FastAPI 应用：parse/encode/diff/attachments API、静态文件
│   ├── mime.py              # 零第三方依赖的 MIME 解析 / 重新编码核心（含 RFC 2231）
│   ├── attachments.py       # 附件递归收集、文件名净化/重名、导出字节判定与 ZIP 打包
│   ├── diff.py              # 样本对比：按树路径对齐的字段级差异计算
│   └── static/
│       ├── index.html       # 页面结构
│       ├── styles.css       # 深色主题样式
│       └── app.js           # 原生 JS：示例、树形编辑器、附件 ZIP、样本对比、下载
├── tests/
│   └── smoke_test.py        # 解析/编码/对比端到端测试（仅需 Python 标准库）
├── requirements.txt
├── Dockerfile
├── docker-compose.yml
└── README.md
```

## 运行测试

测试不依赖 FastAPI，只用 Python 标准库：

```bash
python3 tests/smoke_test.py
```

覆盖：基本 form-data、CJK、嵌套 multipart、preamble/epilogue、
引号与转义参数、boundary 覆盖、定界符碰撞、缺关闭定界符、LF 规范化、
二进制逐字节往返、编辑后重新编码、样本对比（节点增删折叠、
字段级差异、头部逐行对比、诊断代码归属与全局诊断），以及
Content-Transfer-Encoding（base64 / quoted-printable / 7bit / 8bit / binary
的识别、解码、畸形诊断与载荷保留、切换后按 76 字符折行重新编码、
未编辑节点字节稳定、超长行/裸换行/7bit 约束诊断、diff 检出 CTE 变化）、
RFC 2231 文件名（`filename*`/`filename*0*` 分段、多字节字符跨段、
非法扩展值回退、GBK 字符集）、附件收集/命名净化/重名序号、
畸形/未知 CTE 未编辑禁导与编辑后可导、ZIP 选择性打包与路径穿越防护。

---

## 安全说明

- 该工具用于**本地检查报文**，默认只监听容器的 `8000` 端口；请勿直接暴露到公网。
- 所有解析都在内存中完成，请求不会转发到任何第三方。
- 二进制正文以 base64 在前后端之间传输，避免编码损坏。
