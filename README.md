# 自研 CRM 系统

自用 + 面向其他企业本地化部署的 CRM。开发依据：`开发文档/` 下的 PRD 与界面设计文档，接口契约见 `docs/后端API接口清单.md`。

## 技术栈

| 端 | 技术 |
|---|---|
| 后端 | Node.js ≥ 18 + Express 4 + better-sqlite3（全同步）+ multer / exceljs / node-cron |
| 前端 | Vue 3 + TypeScript + Vite 6 + Element Plus + Pinia + Vue Router + Axios + ECharts |

前端对应 PRD 的 P01–P46，后端对应 M1–M17 模块，均已实现并完成联调验收。

## 目录结构

```
AI-crm/
├── docs/            后端 API 接口清单（开发依据，勿随意改动）
├── 开发文档/          PRD 与界面设计文档
├── server/           后端服务
│   ├── src/
│   │   ├── routes/   业务路由（m1-customers … m17-global）
│   │   ├── services/ 领域服务（stageEngine / dataScope / customField …）
│   │   ├── db/       schema.sql / init.js / seed.js
│   │   └── jobs/     定时任务（停滞预警、公海回落、线索回收、报表订阅）
│   ├── data/crm.db   SQLite 数据库（已纳入版本管理）
│   └── uploads/      附件存储目录
└── web/              前端
    └── src/
        ├── api/      请求封装与接口定义
        ├── views/    页面（对应 PRD 的 P01–P46）
        ├── config/   menu.ts 菜单树 / options.ts 枚举
        └── stores/   Pinia（user.ts 权限与数据范围）
```

## 快速开始

```bash
# 1) 后端
cd server
npm install
npm start          # http://localhost:3000/api/v1

# 2) 前端（另开一个终端）
cd web
npm install
npm run dev        # http://localhost:5173
```

数据库已随仓库提供（`server/data/crm.db`），克隆后直接就有数据，无需额外初始化。

## 测试账号

统一密码：`123456`

| 账号 | 姓名 | 角色 |
|---|---|---|
| `admin` | 系统管理员 | 系统管理员（全量权限 + 全部数据） |
| `manager01` | 周经理 | 管理层（可见本部门及下级数据） |
| `sales01` | 张销售 | 销售（仅本人名下数据） |
| `presales01` / `support01` / `purchase01` / `hr01` / `ecosystem01` | 王售前 / 李支撑 / 孙采购 / 吴人事 / 赵生态 | 售前 / 业务支撑 / 采购 / 人事 / 生态 |

## 常用命令（server 目录）

```bash
npm start              # 启动服务
npm run dev            # 开发模式；注意本机 node --watch 会反复自我重启，建议用 npm start
npm run db:reset       # 清库重建 + 写入出厂种子数据（危险：会清空现有数据）
npm run db:snapshot    # 把 WAL 日志合并回 crm.db，提交数据库前先执行
npm run smoke          # 接口冒烟测试
```

## 换电脑 / 协作注意事项

1. **不要拷贝 `node_modules`**，务必重新 `npm install`。`better-sqlite3` 是原生模块，Windows 与 macOS 的二进制不通用。
2. **提交数据库前先执行** `cd server && npm run db:snapshot`，否则 WAL 里的最新写入不会进 `crm.db`，换机后会丢数据。
3. 仓库为 **Private**：`crm.db` 内含用户表（密码哈希）与客户业务数据，不可公开。
4. 中文文件名在 macOS 上若显示为 `\xxx`，执行一次 `git config --global core.quotepath false`。
5. 换行符由 `.gitattributes` 统一为 LF，无需手动处理。

## 数据库说明

- `server/data/crm.db`：主库，**已提交**，作为开发数据集
- `server/data/backups/`：运行时自动备份，**不提交**
- `server/data/*.db-wal` / `*.db-shm`：运行时临时文件，**不提交**

如果想把数据恢复到出厂状态：`cd server && npm run db:reset`
