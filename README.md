# ePUB 閱讀器

純前端 ePUB 閱讀器，支援中文直排／橫排，無需安裝、無需伺服器。

**線上版本：** https://lcat2000.github.io/epub-reader/

---

## 功能

- **ePUB 2 / ePUB 3** 支援
- **中文直排**（`writing-mode: vertical-rl`）自動偵測與手動切換
- **目錄側欄**（TOC）可開合
- **三種主題**：白天 / 棕色 / 夜間
- **字型大小**調整（A- / A+）
- **翻頁操作**：點螢幕左右兩側翻頁，抵達章節頭尾時自動跳章
- **中間選單**：點螢幕中央彈出「上一章 / 下一章」選單
- **閱讀進度記憶**：切換章節時保留捲軸位置
- 鍵盤快捷鍵（見下表）

### 鍵盤快捷鍵

| 按鍵 | 功能 |
|------|------|
| `←` / `→` | 上一章 / 下一章 |
| `T` | 開關目錄 |
| `V` | 切換直排／橫排 |
| `O` | 開啟新檔案 |

---

## 使用方式

### 線上使用
直接開啟 https://lcat2000.github.io/epub-reader/，拖放 `.epub` 檔案或點「選擇檔案」。

### 本機使用
1. 下載本 repo（或 clone）
2. 直接用瀏覽器開啟 `index.html`（不需要 web server）
3. 拖放 `.epub` 檔案

---

## 翻頁操作說明

```
┌────────────────────────────────────────┐
│  左側 (0–40%)  │  中間 (40–60%)  │  右側 (60–100%)  │
│                │                 │                  │
│  直排：下一頁   │  章節跳轉選單   │  直排：上一頁     │
│  橫排：上一頁   │                 │  橫排：下一頁     │
└────────────────────────────────────────┘
```

到達章節頭尾時，繼續點擊同方向會自動跳至上一章或下一章。

---

## 技術架構

| 項目 | 說明 |
|------|------|
| **渲染方式** | Shadow DOM（避免 `file://` 協定的 iframe 跨來源限制） |
| **ePUB 解壓** | [JSZip 3.10.1](https://stuk.github.io/jszip/)，SRI 驗證 |
| **HTML 過濾** | [DOMPurify 3.2.7](https://github.com/cure53/DOMPurify)，SRI 驗證 |
| **字型** | Noto Serif TC / Noto Sans TC（Google Fonts） |
| **相依套件** | 僅以上兩個 CDN 函式庫，其餘純原生 JS |

### 資源嵌入方式
epub 內的圖片與字型以 `data: URI`（base64）方式嵌入 Shadow DOM，避免 blob URL 跨來源問題。epub 的 CSS 樣式表文字直接注入 `<style>` 標籤（注入前過濾）。

---

## 安全設計

本閱讀器處理任意 epub 內容，採用以下防護：

| 風險 | 防護措施 |
|------|---------|
| 惡意 epub 執行 JS | DOMPurify 過濾，禁止 `<script>`、`<object>`、`<embed>`、`<iframe>` 及所有 `on*` 事件屬性 |
| CSS UI 干擾 | epub 樣式中 `position:fixed` → `absolute`、`z-index` 上限 100、移除 `@import` / `expression()` |
| Zip bomb / 資源耗盡 | 壓縮前 100 MB 上限、解壓後 300 MB 上限、章節上限 1000、每章圖片上限 200 張 |
| 惡意外部連結 | http/https 連結點擊前顯示確認視窗，以 `noopener,noreferrer` 開新分頁 |
| 其他協定注入 | 封鎖 `javascript:`、`data:` 等非 epub 協定連結 |
| Content Security Policy | `script-src` 限定 self + cdnjs、`connect-src 'none'`、`object-src 'none'`、`form-action 'none'` |
| CDN 供應鏈 | JSZip 與 DOMPurify 皆有 Subresource Integrity (SRI) 驗證 |

> **注意：** Clickjacking 防護（`frame-ancestors`）需要 HTTP header，GitHub Pages 不支援自訂 header，此項無法在現有平台上完全修復。

---

## 瀏覽器支援

現代瀏覽器（Chrome 90+、Firefox 85+、Safari 14+、Edge 90+）。
需要支援：Shadow DOM、`async/await`、`File API`。

---

## 授權

MIT License
