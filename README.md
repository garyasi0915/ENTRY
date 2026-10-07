# INSERT PLAY

以 Three.js 建立的互動 3D 復古遊戲桌，連接 **M9DY、無名火、Untitled Design Agency** 三個品牌世界。

**[開啟網站 / Live demo](https://garyasi0915.github.io/ENTRY/)**

## 互動

- 移到或點按卡帶：卡帶升起。電視初始關機，插入卡帶後才會開機顯示該品牌；取出後熄機。
- 拖動卡帶到 Super Famicom 插槽：插入卡帶；換帶時，舊卡帶返回架上。
- 拖回卡帶架，或按主機 EJECT：取出卡帶。點按已開機的電視可探索該品牌。
- 拖動空白位置轉動視角，滾輪或雙指縮放；拉近到盡頭會聚焦完整電視螢幕，右上角按鈕重設視角。
- 右上角月亮按鈕切換夜間模式：環境燈光漸暗，螢幕投射品牌色燈光，並呈現光暈、動態陰影及柔化地面反射。
- 支援手機觸控、鍵盤操作及減少動態效果偏好。音效預設關閉。

## 本機執行

下載或 clone 此 repository，進入資料夾後執行：

```sh
python3 -m http.server 4173
```

Windows 可使用 `py -m http.server 4173`。

然後開啟 <http://localhost:4173>。本專案沒有建置步驟，無需 `npm install`。
ES Modules 需要 HTTP 伺服器，請勿直接雙擊 `index.html`。

## 修改網站

| 檔案 | 用途 |
| --- | --- |
| `app.js` | 3D 模型、材質、光線、CRT 畫面、卡帶互動及響應式鏡頭 |
| `style.css` | 介面及手機版面 |
| `index.html` | 網頁結構及 Three.js import map |
| `vendor/` | 本機隨附的 Three.js 0.169.0 及必要 addons |

在 `app.js` 的 `WORLDS` 設定品牌名稱、配色及網址。目前三個 `url` 都是 `null`，點按已開機的電視會顯示「即將登場」；提供正式品牌網址後即可替換。

GitHub Pages 使用 `main` 分支根目錄；推送更新後會自動重新發布。

## 技術與第三方檔案

Three.js、WebGL、CanvasTexture、ShaderMaterial、OrbitControls、UnrealBloomPass、Reflector；字型由 Google Fonts 載入。瀏覽器需支援 WebGL，並建議啟用硬件加速。

Three.js 授權見 [`vendor/THREE-LICENSE.txt`](vendor/THREE-LICENSE.txt)。
