# 全球旅行规划

私人旅行地图、收藏与路线规划。当前行程为伊比利亚半岛（西班牙与葡萄牙），日期为 2027 年 1 月 27 日至 2 月 10 日。

## Cloudflare Workers

1. 创建 D1 数据库 `iberia-roadbook-2027`。在数据库 Console 执行 `schema.sql`，将数据库 ID 填入仓库根目录 `wrangler.jsonc` 中的 `database_id`。
2. 在 Workers & Pages 创建应用并导入本仓库。名称填 `iberia-roadbook-2027`，生产分支选 `main`，根目录留空（仓库根目录），构建命令填 `npm run build`，部署命令填 `npm run deploy`。生产分支之外的部署保持关闭。
3. 在 Cloudflare Zero Trust 的 **Access controls → Applications** 建立 **Self-hosted** 应用。使用 Worker 的 `workers.dev` 主机名，保护路径填 `/account`。创建 Allow 策略，Include 选 Emails，只填站主邮箱。登录方式选 One-time PIN。公开首页使用根路径 `/`。
4. 在 Worker **Settings → Variables and Secrets** 添加 Secret `ROADBOOK_OWNER_EMAIL`，值填同一个邮箱，点 **Deploy**。原来设置过的 `ROADBOOK_PASSWORD` 可以在邮箱登录验证成功后移除。打开网站，点击「邮箱登录」。
5. 如需 Mapbox 道路时间与路径，添加 Secret `MAPBOX_ROUTING_TOKEN`，使用单独的 Mapbox 公共权限 token（`pk.`），只保存在 Worker 中。游客使用估算路线，登录后可调用 Mapbox 或 OSRM。也可加 `MAPBOX_PUBLIC_TOKEN`（另一个 `pk.`，限制到 Worker 网站 URL）启用 Mapbox 卫星瓦片。街道底图为 OpenFreeMap。
6. 登录后收藏一个体验，刷新确认私人收藏保留。访客清单保存在当前浏览器，与私人云端存档分开。

## 本地构建

`npm ci && npm run build`

构建将前端和路线计算代码打包成 `dist/worker.js`。地图渲染使用 MapLibre GL JS。路线优先用已配置的 Mapbox，失败时尝试 OSRM，最后使用明确标记的距离估算。Google Maps、Apple 地图与小红书为跳转链接。
