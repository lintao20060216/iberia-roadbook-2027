# 伊比利亚漫游 · Iberia Roadbook

西班牙与葡萄牙的私人旅行地图、收藏与双路线行程。2027 年 1 月 27 日至 2 月 10 日。

## Cloudflare Workers

1. 创建 D1 数据库 `iberia-roadbook-2027`。在数据库 Console 执行 `schema.sql`，将数据库 ID 填入仓库根目录 `wrangler.jsonc` 中的 `database_id`。
2. 在 Workers & Pages 创建应用并导入本仓库。名称填 `iberia-roadbook-2027`，生产分支选 `main`，根目录留空（仓库根目录），构建命令填 `npm run build`，部署命令填 `npm run deploy`。生产分支之外的部署保持关闭。
3. 在 Worker **Settings → Variables and Secrets** 添加 Secret `ROADBOOK_PASSWORD`。用密码管理器生成至少 16 位的随机 ASCII 密码。部署设置后打开 Worker URL，用户名为 `tao`。密码配置前网站会拒绝访问。
4. 如需 Mapbox 道路时间与路径，添加 Secret `MAPBOX_ROUTING_TOKEN`。使用单独的 Mapbox 公共权限 token（`pk.`），只保存在 Worker 中。也可加 `MAPBOX_PUBLIC_TOKEN`（另一个 `pk.`，限制到 Worker 网站 URL）启用 Mapbox 卫星瓦片。后者会由浏览器读取。街道底图为 OpenFreeMap。
5. 登录后收藏一个体验，刷新确认收藏保留，再到「路线与行程」生成两条路线并检查路线来源。新 D1 初始为空。

请把 token 和密码只填在 Cloudflare Worker 的运行时 Variables and Secrets 中。

## 本地构建

`npm ci && npm run build`

构建将前端和路线计算代码打包成 `dist/worker.js`。地图渲染使用 MapLibre GL JS。路线优先用已配置的 Mapbox，失败时尝试 OSRM，最后使用明确标记的距离估算。Google Maps、Apple 地图与小红书为跳转链接。
